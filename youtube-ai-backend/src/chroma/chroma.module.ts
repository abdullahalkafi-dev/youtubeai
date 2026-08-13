import { Global, Module } from '@nestjs/common';
import { ChromaService } from './chroma.service';
import { AutoSeedService } from './auto-seed.service';

@Global()
@Module({
  providers: [ChromaService, AutoSeedService],
  exports: [ChromaService, AutoSeedService],
})
export class ChromaModule {}

