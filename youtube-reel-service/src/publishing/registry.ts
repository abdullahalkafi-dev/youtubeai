import { Injectable } from '@nestjs/common';
import { PLANNED_PLATFORMS, PlatformId, Publisher } from './types';

/** Looks up the adapter for a platform. Adding X / LinkedIn / Instagram / Facebook later = register one more Publisher. */
@Injectable()
export class PublisherRegistry {
  private readonly publishers = new Map<PlatformId, Publisher>();

  register(publisher: Publisher) {
    this.publishers.set(publisher.platform, publisher);
  }

  get(platform: PlatformId): Publisher | undefined {
    return this.publishers.get(platform);
  }

  list(): Publisher[] {
    return [...this.publishers.values()];
  }

  /** Platforms the UI should show as "coming soon". */
  planned(): PlatformId[] {
    return PLANNED_PLATFORMS.filter((p) => !this.publishers.has(p));
  }
}
