import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OpenAIService } from './openai.service';
import { MinioService } from '../minio/minio.service';
import {
  SubjectReference,
  SubjectReferenceDocument,
} from '../mongo/schemas/subject-reference.schema';
import * as fs from 'fs';
import * as path from 'path';

export interface StorySubject {
  id: string;
  name: string;
  role: string;
  searchQuery: string;
  imageUrl?: string;
  source?: string;
}

@Injectable()
export class SubjectReferenceService {
  private readonly logger = new Logger(SubjectReferenceService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly openaiService: OpenAIService,
    private readonly minioService: MinioService,
    @InjectModel(SubjectReference.name)
    private readonly subjectRefModel: Model<SubjectReferenceDocument>,
  ) {}

  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/["'“”]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Dynamically detect 1 to 3 real public figures from video title and visual concept.
   */
  async detectStorySubjects(
    videoTitle: string,
    visualConcept?: string,
  ): Promise<StorySubject[]> {
    try {
      const fastModel =
        this.configService.get<string>('OPENAI_FAST_MODEL') || 'gpt-5.6-luna';

      const systemPrompt = `You are an expert entity detection system for YouTube true crime, courtroom trials, and documentary channels.
Identify between 1 and 3 real, specific individuals (defendants, attorneys, judges, victims, celebrities, witnesses) central to the video topic.
Do NOT identify generic concepts (e.g. "spectators", "jury", "police officer", "prosecutor" without name). ONLY return real, named individuals.
If no real individual is named, return an empty array [].

For each person:
- name: The full canonical name of the real person (e.g. "Duane 'Keefe D' Davis", "Judge Carli Kierny", "Lil Durk", "Sean 'Diddy' Combs").
- role: Their case/trial role (e.g. "Defendant", "Judge", "Defense Attorney", "Rapper / Victim").
- searchQuery: An optimal image search phrase (e.g. "Duane Keefe D Davis courtroom trial").

Return strict JSON:
{"subjects": [{"name": "...", "role": "...", "searchQuery": "..."}]}`;

      const userMessage = `Video Title: "${videoTitle}"
Visual Concept: "${visualConcept || ''}"`;

      const rawJson = await this.openaiService.chatFast({
        systemPrompt,
        userMessage,
        temperature: 0.2,
        maxCompletionTokens: 2000,
      });

      let parsed: any = null;
      try {
        let clean = rawJson.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const firstBrace = clean.indexOf('{');
        const lastBrace = clean.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          clean = clean.substring(firstBrace, lastBrace + 1);
        }
        parsed = JSON.parse(clean);
      } catch (parseErr: any) {
        this.logger.warn(`Initial JSON parse failed, attempting regex recovery: ${parseErr.message}`);
        const nameMatches = [...rawJson.matchAll(/"name"\s*:\s*"([^"]+)"/gi)];
        const roleMatches = [...rawJson.matchAll(/"role"\s*:\s*"([^"]+)"/gi)];
        const queryMatches = [...rawJson.matchAll(/"searchQuery"\s*:\s*"([^"]+)"/gi)];
        if (nameMatches.length > 0) {
          parsed = {
            subjects: nameMatches.slice(0, 3).map((m, i) => ({
              name: m[1],
              role: roleMatches[i]?.[1] || 'Key Subject',
              searchQuery: queryMatches[i]?.[1] || m[1],
            })),
          };
        }
      }

      const rawSubjects = Array.isArray(parsed?.subjects)
        ? parsed.subjects.slice(0, 3)
        : [];

      return rawSubjects.map((s: any, idx: number) => ({
        id: `subj_${Date.now()}_${idx + 1}`,
        name: String(s.name || '').trim(),
        role: String(s.role || 'Key Subject').trim(),
        searchQuery: String(s.searchQuery || s.name || '').trim(),
      }));
    } catch (err: any) {
      this.logger.warn(`Failed to detect story subjects: ${err.message}`);
      return [];
    }
  }

  /**
   * Search for an authentic public portrait/photo URL for a given subject.
   * Priority 0: Check MongoDB cached subjects (0ms, 0 external API calls).
   * Priority 1: Official Wikipedia Summary API -> Download & Persist to MinIO.
   * Priority 2: OpenAI web search fallback -> Download & Persist to MinIO.
   */
  async searchSubjectPublicImage(
    subjectName: string,
    searchQuery?: string,
    role?: string,
  ): Promise<{ imageUrl: string; source: string } | null> {
    if (!subjectName || !subjectName.trim()) return null;

    const canonical = this.normalizeName(subjectName);

    // 0. Check MongoDB persistent cache
    try {
      const cached = await this.subjectRefModel.findOne({
        $or: [
          { canonicalName: canonical },
          { displayName: new RegExp(`^${subjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        ],
      });

      if (cached && cached.imageUrl) {
        this.logger.log(
          `[Subject Cache HIT] Using stored photo for "${subjectName}": ${cached.imageUrl}`,
        );
        this.subjectRefModel
          .updateOne({ _id: cached._id }, { $inc: { searchCount: 1 } })
          .catch(() => {});
        return {
          imageUrl: cached.imageUrl,
          source: cached.source || 'Stored Database',
        };
      }
    } catch (e: any) {
      this.logger.warn(`Subject cache lookup failed: ${e.message}`);
    }

    // 1. Wikipedia Summary API
    let foundResult: { imageUrl: string; source: string; originalUrl?: string } | null =
      await this.searchWikipediaImage(subjectName);

    // 2. Fallback to OpenAI responses web_search
    if (!foundResult) {
      foundResult = await this.searchWebWithOpenAI(subjectName, searchQuery);
    }

    if (!foundResult || !foundResult.imageUrl) {
      return null;
    }

    // 3. Download & Persist to MinIO or local assets
    let finalImageUrl = foundResult.imageUrl;
    try {
      const persistedUrl = await this.downloadAndPersistImage(
        canonical,
        foundResult.imageUrl,
      );
      if (persistedUrl) {
        finalImageUrl = persistedUrl;
      }
    } catch (persistErr: any) {
      this.logger.warn(`Failed to persist remote subject photo: ${persistErr.message}`);
    }

    // 4. Save to MongoDB
    try {
      await this.subjectRefModel.findOneAndUpdate(
        { canonicalName: canonical },
        {
          canonicalName: canonical,
          displayName: subjectName,
          role: role || 'Key Subject',
          imageUrl: finalImageUrl,
          originalSourceUrl: foundResult.originalUrl || foundResult.imageUrl,
          source: foundResult.source || 'web',
          $inc: { searchCount: 1 },
        },
        { upsert: true, new: true },
      );
      this.logger.log(
        `[Subject Stored] Cached and mirrored photo for "${subjectName}" -> ${finalImageUrl}`,
      );
    } catch (dbErr: any) {
      this.logger.warn(`Failed to save subject reference to MongoDB: ${dbErr.message}`);
    }

    return {
      imageUrl: finalImageUrl,
      source: foundResult.source,
    };
  }

  /**
   * Detect subjects and simultaneously resolve public photos for all 1-3 detected subjects.
   */
  async detectAndFetchSubjects(
    videoTitle: string,
    visualConcept?: string,
  ): Promise<StorySubject[]> {
    const subjects = await this.detectStorySubjects(videoTitle, visualConcept);
    if (!subjects || subjects.length === 0) return [];

    const enriched = await Promise.all(
      subjects.map(async (subj) => {
        try {
          const photo = await this.searchSubjectPublicImage(
            subj.name,
            subj.searchQuery,
            subj.role,
          );
          if (photo?.imageUrl) {
            return {
              ...subj,
              imageUrl: photo.imageUrl,
              source: photo.source,
            };
          }
        } catch (e: any) {
          this.logger.warn(`Failed photo search for ${subj.name}: ${e.message}`);
        }
        return subj;
      }),
    );

    return enriched;
  }

  private async searchWikipediaImage(
    name: string,
  ): Promise<{ imageUrl: string; source: string; originalUrl?: string } | null> {
    try {
      const cleanName = name
        .replace(/\b(?:duane\s*)?"keefe\s*d"\s*davis\b/gi, 'Keefe D')
        .replace(/\bduane davis\b/gi, 'Keefe D')
        .replace(/["'“”]/g, '')
        .trim();

      const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanName)}`;
      const res = await fetch(apiUrl, {
        headers: {
          'User-Agent':
            'UniqueMeccaStudio/1.0 (https://uniquemeccaaudio.com; contact@uniquemeccaaudio.com)',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) return null;
      const data = await res.json();

      const imgUrl =
        data.originalimage?.source || data.thumbnail?.source || null;
      if (imgUrl && typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
        return {
          imageUrl: imgUrl,
          originalUrl: imgUrl,
          source: `Wikipedia (${data.title || cleanName})`,
        };
      }
    } catch {
      // optional fallback
    }
    return null;
  }

  private async searchWebWithOpenAI(
    subjectName: string,
    searchQuery?: string,
  ): Promise<{ imageUrl: string; source: string; originalUrl?: string } | null> {
    try {
      this.logger.log(
        `[Subject Search] Querying web search for "${subjectName}"...`,
      );
      const query = searchQuery || `${subjectName} photo`;
      const searchPrompt = `Find a direct, accessible public image URL (JPEG or PNG) for the real person: "${subjectName}". Context: "${query}".
Search news archives (AP, Reuters, CNN, NBC), official court records, or public profiles.
Output ONLY valid JSON: {"imageUrl": "https://...", "source": "source name"}. If no direct image URL is found, return {"imageUrl": null}.`;

      const searchResp = await this.openaiService.chatWithSearch({
        userMessage: searchPrompt,
        systemPrompt:
          'You are a research bot that locates public, authentic news/courtroom photograph URLs of named individuals. Respond ONLY in strict JSON.',
      });

      const content = searchResp.content || '';
      const cleanJson = content
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleanJson);

      if (
        parsed?.imageUrl &&
        typeof parsed.imageUrl === 'string' &&
        parsed.imageUrl.startsWith('http')
      ) {
        return {
          imageUrl: parsed.imageUrl,
          originalUrl: parsed.imageUrl,
          source: parsed.source || 'Public News Archive',
        };
      }
    } catch (err: any) {
      this.logger.warn(
        `Web search image lookup failed for "${subjectName}": ${err.message}`,
      );
    }
    return null;
  }

  private async downloadAndPersistImage(
    canonical: string,
    remoteUrl: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(remoteUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer.length < 1000) return null;

      const ext = remoteUrl.toLowerCase().includes('.png') ? 'png' : 'jpg';
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const slug = canonical.replace(/[^a-z0-9]/g, '_').substring(0, 32);
      const filename = `subj_${slug}_${Date.now()}.${ext}`;

      // Try MinIO first
      try {
        const isMinioReady = await this.minioService.isAvailable().catch(() => false);
        if (isMinioReady) {
          const minioKey = `system/subjects/${filename}`;
          return await this.minioService.uploadBuffer(minioKey, buffer, contentType);
        }
      } catch {
        // fallback to local disk
      }

      // Local asset storage fallback
      const localDir = path.join(process.cwd(), 'src', 'assets', 'unique_images');
      if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
      fs.writeFileSync(path.join(localDir, filename), buffer);
      return `/api/assets/unique-images/${filename}`;
    } catch (err: any) {
      this.logger.warn(`Could not download remote subject photo: ${err.message}`);
      return null;
    }
  }
}
