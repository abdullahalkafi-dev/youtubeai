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
import { retrieveSource } from '../chat/studio/research';
import * as fs from 'fs';
import * as path from 'path';
const sharp = require('sharp');

export type PhotoStatus = 'verified' | 'client_upload' | 'missing';

export interface StorySubject {
  id: string;
  name: string;
  role: string;
  searchQuery: string;
  imageUrl?: string;
  source?: string;
  /** verified: checked public photo; client_upload: supplied by the client; missing: none usable. */
  photoStatus?: PhotoStatus;
  sourcePageUrl?: string;
}

/** A photo the client uploaded for a named person; always wins over the web. */
export interface PhotoOverride {
  name: string;
  url: string;
}

interface Candidate {
  imageUrl: string;
  pageUrl?: string;
  source: string;
}

/**
 * The channel host is composited from his own photos; he is never a story
 * subject to search for or to draw.
 */
const HOST_NAMES = [
  'unique',
  'unique mecca',
  'unique mecca audio',
  'uniquemeccaaudio',
  'uniquemeccaaudionyc',
  'the host',
  'host',
  'commentator',
];

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

  static isHostName(name: string): boolean {
    const clean = name
      .toLowerCase()
      .replace(/["'“”@()]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const extra = (process.env.HOST_NAMES || '')
      .split(',')
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
    return (
      [...HOST_NAMES, ...extra].includes(clean) ||
      /\bunique mecca\b/.test(clean)
    );
  }

  /**
   * Detect 1 to 3 real, named people. With `focus: 'image'`, only people who must
   * visibly appear in this particular thumbnail concept are returned.
   */
  async detectStorySubjects(
    videoTitle: string,
    visualConcept?: string,
    focus: 'story' | 'image' = 'story',
  ): Promise<StorySubject[]> {
    try {
      const systemPrompt = `You are an expert entity detection system for YouTube true crime, courtroom trials, and documentary channels.
${
  focus === 'image'
    ? 'Identify the real, specific, NAMED people who must visibly appear in THIS thumbnail image according to the visual concept (0 to 3 people).'
    : 'Identify between 1 and 3 real, specific individuals (defendants, attorneys, judges, victims, celebrities, witnesses) central to the video topic.'
}
Do NOT identify generic concepts (e.g. "spectators", "jury", "police officer", "prosecutor" without name). ONLY return real, named individuals.
NEVER include the channel host "Unique" (Unique Mecca Audio, the commentator/host); he is added separately from his own photos.
If no real individual is named, return an empty array [].

For each person:
- name: The full canonical name of the real person (e.g. "Duane 'Keefe D' Davis", "Judge Carli Kierny", "Lil Durk", "Sean 'Diddy' Combs").
- role: Their case/trial role (e.g. "Defendant", "Judge", "Defense Attorney", "Rapper / Victim").
- searchQuery: An image search phrase for their most widely published, case-related photo (e.g. "Duane Keefe D Davis courtroom").

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

      return rawSubjects
        .map((s: any, idx: number) => ({
          id: `subj_${Date.now()}_${idx + 1}`,
          name: String(s.name || '').trim(),
          role: String(s.role || 'Key Subject').trim(),
          searchQuery: String(s.searchQuery || s.name || '').trim(),
        }))
        .filter(
          (s: StorySubject) =>
            s.name &&
            !SubjectReferenceService.isHostName(s.name) &&
            !/^(host|commentator|narrator)$/i.test(s.role),
        );
    } catch (err: any) {
      this.logger.warn(`Failed to detect story subjects: ${err.message}`);
      return [];
    }
  }

  /**
   * Find a recognizable, verified public photo of a named person.
   * Order: verified cache -> Wikipedia -> web candidates (each verified).
   * Unverified web results are never used or cached.
   */
  async searchSubjectPublicImage(
    subjectName: string,
    searchQuery?: string,
    role?: string,
  ): Promise<{ imageUrl: string; source: string; sourcePageUrl?: string } | null> {
    if (!subjectName || !subjectName.trim()) return null;
    if (SubjectReferenceService.isHostName(subjectName)) return null;

    const canonical = this.normalizeName(subjectName);

    // 0. Verified cache only. Old unverified web entries are searched again.
    try {
      const cached: any = await this.subjectRefModel.findOne({
        $or: [
          { canonicalName: canonical },
          { displayName: new RegExp(`^${subjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        ],
      });

      if (
        cached &&
        cached.imageUrl &&
        (cached.verified === true ||
          cached.source === 'wikipedia' ||
          cached.source === 'manual')
      ) {
        this.logger.log(
          `[Subject Cache HIT] Using verified photo for "${subjectName}": ${cached.imageUrl}`,
        );
        this.subjectRefModel
          .updateOne({ _id: cached._id }, { $inc: { searchCount: 1 } })
          .catch(() => {});
        return {
          imageUrl: cached.imageUrl,
          source: cached.source || 'Stored Database',
          sourcePageUrl: cached.sourcePageUrl,
        };
      }
    } catch (e: any) {
      this.logger.warn(`Subject cache lookup failed: ${e.message}`);
    }

    // 1. Wikipedia: a stable, widely recognized portrait.
    let found: (Candidate & { verifiedBy: string }) | null = null;
    const wiki = await this.searchWikipediaImage(subjectName);
    if (wiki) found = { ...wiki, verifiedBy: 'wikipedia' };

    // 2. Web candidates: the most widely published, case-related photo, verified.
    if (!found) {
      const candidates = await this.searchWebCandidates(
        subjectName,
        searchQuery,
        role,
      );
      for (const candidate of candidates) {
        if (await this.verifyCandidate(subjectName, candidate)) {
          found = { ...candidate, verifiedBy: 'web' };
          break;
        }
      }
    }

    if (!found) {
      this.logger.log(`[Subject Search] No verified photo found for "${subjectName}"`);
      return null;
    }

    // 3. Mirror to our storage
    let finalImageUrl = found.imageUrl;
    try {
      const persistedUrl = await this.downloadAndPersistImage(
        canonical,
        found.imageUrl,
      );
      if (persistedUrl) finalImageUrl = persistedUrl;
    } catch (persistErr: any) {
      this.logger.warn(`Failed to persist remote subject photo: ${persistErr.message}`);
    }

    // 4. Cache as verified
    try {
      await this.subjectRefModel.findOneAndUpdate(
        { canonicalName: canonical },
        {
          canonicalName: canonical,
          displayName: subjectName,
          role: role || 'Key Subject',
          imageUrl: finalImageUrl,
          originalSourceUrl: found.imageUrl,
          sourcePageUrl: found.pageUrl,
          source: found.verifiedBy === 'wikipedia' ? 'wikipedia' : 'web',
          verified: true,
          checkedAt: new Date(),
          $inc: { searchCount: 1 },
        },
        { upsert: true, new: true },
      );
      this.logger.log(
        `[Subject Stored] Verified photo for "${subjectName}" -> ${finalImageUrl}`,
      );
    } catch (dbErr: any) {
      this.logger.warn(`Failed to save subject reference to MongoDB: ${dbErr.message}`);
    }

    return {
      imageUrl: finalImageUrl,
      source: found.source,
      sourcePageUrl: found.pageUrl,
    };
  }

  /**
   * Resolve the people a thumbnail needs, with a photo status for each.
   * Client uploads (overrides) win; then verified public photos; otherwise "missing".
   */
  async resolveSubjects(params: {
    title: string;
    concept?: string;
    overrides?: PhotoOverride[];
    focus?: 'story' | 'image';
  }): Promise<StorySubject[]> {
    const subjects = await this.detectStorySubjects(
      params.title,
      params.concept,
      params.focus || 'story',
    );
    return Promise.all(
      subjects.map(async (subj) => {
        const override = matchOverride(subj.name, params.overrides || []);
        if (override)
          return {
            ...subj,
            imageUrl: override.url,
            source: 'Client upload',
            photoStatus: 'client_upload' as const,
          };
        try {
          const photo = await this.searchSubjectPublicImage(
            subj.name,
            subj.searchQuery,
            subj.role,
          );
          if (photo?.imageUrl)
            return {
              ...subj,
              imageUrl: photo.imageUrl,
              source: photo.source,
              sourcePageUrl: photo.sourcePageUrl,
              photoStatus: 'verified' as const,
            };
        } catch (e: any) {
          this.logger.warn(`Failed photo search for ${subj.name}: ${e.message}`);
        }
        return { ...subj, photoStatus: 'missing' as const };
      }),
    );
  }

  /** Back-compatible: detect story subjects and attach verified photos where found. */
  async detectAndFetchSubjects(
    videoTitle: string,
    visualConcept?: string,
    overrides?: PhotoOverride[],
  ): Promise<StorySubject[]> {
    return this.resolveSubjects({
      title: videoTitle,
      concept: visualConcept,
      overrides,
    });
  }

  private async searchWikipediaImage(name: string): Promise<Candidate | null> {
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
      // Disambiguation pages and non-person pages carry no useful portrait.
      if (data.type === 'disambiguation') return null;

      const imgUrl =
        data.originalimage?.source || data.thumbnail?.source || null;
      if (imgUrl && typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
        return {
          imageUrl: imgUrl,
          pageUrl: data.content_urls?.desktop?.page,
          source: `Wikipedia (${data.title || cleanName})`,
        };
      }
    } catch {
      // optional fallback
    }
    return null;
  }

  /** Ask web search for up to three recognizable, case-related photos with their source pages. */
  private async searchWebCandidates(
    subjectName: string,
    searchQuery?: string,
    role?: string,
  ): Promise<Candidate[]> {
    try {
      this.logger.log(`[Subject Search] Querying web search for "${subjectName}"...`);
      const query = searchQuery || `${subjectName} photo`;
      const searchPrompt = `Find up to 3 direct public image URLs (JPEG or PNG) showing the real person "${subjectName}"${role ? ` (${role})` : ''}. Context: "${query}".
Prefer the photo viewers would RECOGNIZE: the most widely published, case-related photo (booking photo, court appearance, or the main photo used by major news coverage of this case). Each image must show this person clearly, preferably alone.
For each, give the news/court/official PAGE where it appears; that page must name the person.
Output ONLY valid JSON: {"candidates":[{"imageUrl":"https://...","pageUrl":"https://...","source":"outlet name"}]}. If none, return {"candidates":[]}.`;

      const searchResp = await this.openaiService.chatWithSearch({
        userMessage: searchPrompt,
        systemPrompt:
          'You are a research bot that locates public, authentic news/courtroom photograph URLs of named individuals. Respond ONLY in strict JSON.',
      });

      const content = (searchResp.content || '')
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .trim();
      const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
      const parsed = JSON.parse(json);
      const list = Array.isArray(parsed?.candidates)
        ? parsed.candidates
        : parsed?.imageUrl
          ? [parsed]
          : [];
      return list
        .filter(
          (c: any) =>
            typeof c?.imageUrl === 'string' && /^https:\/\//.test(c.imageUrl),
        )
        .slice(0, 3)
        .map((c: any) => ({
          imageUrl: c.imageUrl,
          pageUrl: typeof c.pageUrl === 'string' ? c.pageUrl : undefined,
          source: String(c.source || 'Public news'),
        }));
    } catch (err: any) {
      this.logger.warn(
        `Web search image lookup failed for "${subjectName}": ${err.message}`,
      );
      return [];
    }
  }

  /**
   * A web photo is used only when (1) its source page names the person and
   * (2) a vision check sees a real photograph with one clear, prominent face.
   */
  async verifyCandidate(name: string, candidate: Candidate): Promise<boolean> {
    if (!candidate.pageUrl) return false;
    const page = await retrieveSource(candidate.pageUrl);
    if (!page.text) return false;
    const pageText = page.text.toLowerCase();
    const surname = name
      .replace(/["'“”]/g, ' ')
      .split(/\s+/)
      .filter((part) => part.length >= 4)
      .pop()
      ?.toLowerCase();
    if (!surname || !pageText.includes(surname)) return false;

    let buffer: Buffer;
    try {
      const res = await fetch(candidate.imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 ContentStudio/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return false;
      buffer = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buffer).metadata();
      if (Math.min(meta.width || 0, meta.height || 0) < 200) return false;
      buffer = await sharp(buffer)
        .resize({ width: 768, height: 768, fit: 'inside' })
        .jpeg()
        .toBuffer();
    } catch {
      return false;
    }
    try {
      const result = await this.openaiService.chat({
        messages: [
          {
            role: 'user',
            content: `Is this a real photograph (not a drawing, logo, collage, poster or screenshot of text) where ONE person's face is clearly visible and prominent? The page says it shows ${name}.`,
          },
        ],
        systemPromptOverride:
          'Return JSON only: {"realPhoto":boolean,"prominentFaces":number,"clearFace":boolean}.',
        imageUrls: ['data:image/jpeg;base64,' + buffer.toString('base64')],
        temperature: 0,
        maxCompletionTokens: 200,
      } as any);
      const text = String(result.content || '');
      const verdict = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      return (
        verdict.realPhoto === true &&
        verdict.prominentFaces === 1 &&
        verdict.clearFace === true
      );
    } catch (err: any) {
      this.logger.warn(`Photo check failed for "${name}": ${err.message}`);
      return false;
    }
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

/** A client upload matches when its name shares a distinctive word with the subject's name. */
export function matchOverride(
  name: string,
  overrides: PhotoOverride[],
): PhotoOverride | undefined {
  const words = (value: string) =>
    value
      .toLowerCase()
      .replace(/["'“”]/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4);
  const wanted = new Set(words(name));
  return overrides.find(
    (o) =>
      o.name.toLowerCase().trim() === name.toLowerCase().trim() ||
      words(o.name).some((w) => wanted.has(w)),
  );
}
