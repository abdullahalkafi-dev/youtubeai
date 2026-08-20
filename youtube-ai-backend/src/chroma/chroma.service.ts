import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChromaClient, Collection, IEmbeddingFunction } from 'chromadb';

const COLLECTIONS = [
  'chat_messages',
  'seo_suggestions',
  'scripts',
  'video_metadata',
  'trending_topics',
  'channel_analytics',
  'client_book',
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

export interface ChromaQueryResult {
  id: string;
  text: string;
  metadata: Record<string, any>;
  distance: number;
}

class OllamaEmbeddingFunction implements IEmbeddingFunction {
  private readonly url: string;
  private readonly model: string;
  private readonly logger = new Logger('OllamaEmbeddingFunction');
  private readonly batchChunkSize: number = 20;

  constructor(url: string, model: string = 'nomic-embed-text') {
    this.url = url;
    this.model = model;
  }

  private async fetchEmbedChunk(chunk: string[], attempt: number = 1): Promise<number[][]> {
    try {
      // 1. Try modern batch /api/embed endpoint
      const res = await fetch(`${this.url}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: chunk }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.embeddings) && data.embeddings.length === chunk.length) {
          return data.embeddings;
        }
      }

      // 2. Fallback to /api/embeddings per item if /api/embed is not available
      const singleEmbeddings: number[][] = [];
      for (const text of chunk) {
        const singleRes = await fetch(`${this.url}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, prompt: text }),
        });
        if (!singleRes.ok) {
          const errData = await singleRes.json().catch(() => ({}));
          throw new Error(errData?.error || `HTTP ${singleRes.status}: ${singleRes.statusText}`);
        }
        const singleData = await singleRes.json();
        if (!singleData || !Array.isArray(singleData.embedding)) {
          throw new Error('Invalid embedding response format from Ollama');
        }
        singleEmbeddings.push(singleData.embedding);
      }
      return singleEmbeddings;
    } catch (error) {
      if (attempt < 3) {
        const delay = attempt * 1000;
        this.logger.warn(`Embedding request failed (attempt ${attempt}/3). Retrying in ${delay}ms... Error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchEmbedChunk(chunk, attempt + 1);
      }
      throw error;
    }
  }

  async generate(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    const embeddings: number[][] = [];

    // Process in chunks of 20 to avoid overloading Ollama CPU queue
    for (let i = 0; i < texts.length; i += this.batchChunkSize) {
      const chunk = texts.slice(i, i + this.batchChunkSize);
      try {
        const chunkEmbeddings = await this.fetchEmbedChunk(chunk);
        embeddings.push(...chunkEmbeddings);
      } catch (error) {
        const sample = chunk[0]?.substring(0, 50) || '';
        this.logger.error(`Ollama embedding batch failed for snippet "${sample}...": ${error.message}`);
        throw error;
      }
    }

    return embeddings;
  }
}

@Injectable()
export class ChromaService implements OnModuleInit {
  private readonly logger = new Logger(ChromaService.name);
  private client: ChromaClient;
  private embeddingFunction: OllamaEmbeddingFunction;
  private collections: Map<string, Collection> = new Map();

  constructor(private readonly configService: ConfigService) {
    const chromaUrl = this.configService.get<string>('CHROMADB_URL', 'http://localhost:8000');
    const ollamaUrl = this.configService.get<string>('OLLAMA_URL', 'http://localhost:11434');
    this.client = new ChromaClient({ path: chromaUrl });
    this.embeddingFunction = new OllamaEmbeddingFunction(ollamaUrl);
  }

  async onModuleInit() {
    for (const name of COLLECTIONS) {
      try {
        const collection = await this.client.getOrCreateCollection({
          name,
          metadata: { 'hnsw:space': 'cosine' },
          embeddingFunction: this.embeddingFunction,
        });
        this.collections.set(name, collection);
        this.logger.log(`ChromaDB collection "${name}" ready`);
      } catch (error) {
        this.logger.error(`Failed to create collection "${name}": ${error.message}`);
      }
    }
  }

  private getCollection(name: CollectionName): Collection {
    const col = this.collections.get(name);
    if (!col) throw new Error(`ChromaDB collection "${name}" not found`);
    return col;
  }

  async upsert(
    collectionName: CollectionName,
    id: string,
    text: string,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    try {
      const collection = this.getCollection(collectionName);
      const safeText = (text || '').substring(0, 4000);
      const safeMetadata: Record<string, any> = {};
      for (const [key, val] of Object.entries(metadata || {})) {
        if (val !== undefined && val !== null) {
          safeMetadata[key] = typeof val === 'object' ? JSON.stringify(val) : val;
        }
      }
      await collection.upsert({
        ids: [id],
        documents: [safeText],
        metadatas: [safeMetadata],
      });
    } catch (error) {
      this.logger.error(`ChromaDB upsert failed (${collectionName}/${id}): ${error.message}`);
    }
  }

  async upsertBatch(
    collectionName: CollectionName,
    ids: string[],
    texts: string[],
    metadatas: Record<string, any>[],
  ): Promise<void> {
    try {
      const collection = this.getCollection(collectionName);
      const safeTexts = (texts || []).map(t => (t || '').substring(0, 4000));
      const safeMetadatas = (metadatas || []).map(meta => {
        const cleaned: Record<string, any> = {};
        for (const [key, val] of Object.entries(meta || {})) {
          if (val !== undefined && val !== null) {
            cleaned[key] = typeof val === 'object' ? JSON.stringify(val) : val;
          }
        }
        return cleaned;
      });
      await collection.upsert({
        ids,
        documents: safeTexts,
        metadatas: safeMetadatas,
      });
      this.logger.log(`ChromaDB batch upsert: ${ids.length} docs into "${collectionName}"`);
    } catch (error) {
      this.logger.error(`ChromaDB batch upsert failed (${collectionName}): ${error.message}`);
    }
  }

  async query(
    collectionName: CollectionName,
    queryText: string,
    nResults: number = 5,
    filter?: Record<string, any>,
  ): Promise<ChromaQueryResult[]> {
    try {
      const collection = this.getCollection(collectionName);
      const results = await collection.query({
        queryTexts: [queryText],
        nResults,
        where: filter,
      });

      const ids = results.ids?.[0] || [];
      const documents = results.documents?.[0] || [];
      const metadatas = results.metadatas?.[0] || [];
      const distances = results.distances?.[0] || [];

      return ids.map((id, i) => ({
        id,
        text: documents[i] || '',
        metadata: (metadatas[i] || {}) as Record<string, any>,
        distance: distances[i] || 0,
      }));
    } catch (error) {
      this.logger.error(`ChromaDB query failed (${collectionName}): ${error.message}`);
      return [];
    }
  }

  async delete(collectionName: CollectionName, id: string): Promise<void> {
    try {
      const collection = this.getCollection(collectionName);
      await collection.delete({ ids: [id] });
    } catch (error) {
      this.logger.error(`ChromaDB delete failed (${collectionName}/${id}): ${error.message}`);
    }
  }

  async deleteByMetadata(collectionName: CollectionName, where: Record<string, any>): Promise<void> {
    try {
      const collection = this.getCollection(collectionName);
      await collection.delete({ where });
    } catch (error) {
      this.logger.error(`ChromaDB deleteByMetadata failed (${collectionName}): ${error.message}`);
    }
  }

  async getStats(collectionName: CollectionName): Promise<{ count: number }> {
    try {
      const collection = this.getCollection(collectionName);
      const count = await collection.count();
      return { count };
    } catch (error) {
      this.logger.error(`ChromaDB stats failed (${collectionName}): ${error.message}`);
      return { count: 0 };
    }
  }

  async getAllStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};
    for (const name of COLLECTIONS) {
      const s = await this.getStats(name);
      stats[name] = s.count;
    }
    return stats;
  }
}
