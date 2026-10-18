import { Global, Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { StorageService } from './storage/storage.service';
import { AiService } from './ai/ai.service';
import { QueueService } from './queue/queue.service';
import { OrchestratorService } from './queue/orchestrator.service';
import { YouTubeSessionService } from './pipeline/youtube-session.service';
import { DownloaderService } from './pipeline/downloader.service';
import { AnalyzerService } from './pipeline/analyzer.service';
import { EntityService } from './pipeline/entity.service';
import { ResearchService } from './pipeline/research.service';
import { SourcingService } from './pipeline/sourcing.service';
import { ComposerService } from './pipeline/composer.service';
import { TemplateStoreService } from './pipeline/template-store.service';
import { RendererService } from './pipeline/renderer.service';
import { CampaignRunnerService } from './pipeline/campaign-runner.service';
import { MaintenanceService } from './pipeline/maintenance.service';
import { AnalyticsService } from './publishing/analytics.service';
import { ImageGenService } from './ai/image-gen.service';
import { VisualsService } from './pipeline/visuals.service';
import { GoogleTokenProvider } from './publishing/google-token.provider';
import { MetricsService } from './publishing/metrics.service';
import { PublishQuotaService } from './publishing/publish-quota.service';
import { PublishService } from './publishing/publish.service';
import { PublisherRegistry } from './publishing/registry';
import { YouTubePublisher } from './publishing/youtube.publisher';

const providers = [
  StorageService,
  AiService,
  QueueService,
  OrchestratorService,
  YouTubeSessionService,
  DownloaderService,
  AnalyzerService,
  EntityService,
  ResearchService,
  SourcingService,
  ComposerService,
  TemplateStoreService,
  RendererService,
  CampaignRunnerService,
  MaintenanceService,
  ImageGenService,
  VisualsService,
  // publishing (manual, YouTube first)
  PublisherRegistry,
  GoogleTokenProvider,
  PublishQuotaService,
  YouTubePublisher,
  PublishService,
  MetricsService,
  AnalyticsService,
];

/** Everything shared by the API process, the worker process and the CLI. Nothing here starts work by itself. */
@Global()
@Module({
  imports: [ConfigModule, DbModule],
  providers,
  exports: providers,
})
export class CoreModule {}
