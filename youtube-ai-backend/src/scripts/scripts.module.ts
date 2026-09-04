import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { Script, ScriptSchema } from '../mongo/schemas/script.schema';
import { ScriptVersion, ScriptVersionSchema } from '../mongo/schemas/script-version.schema';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { Thread, ThreadSchema } from '../mongo/schemas/thread.schema';
import { ScriptsService } from './scripts.service';
import { ScriptsController } from './scripts.controller';
import { ScriptVectorProcessor } from './processors/script-vector.processor';
import { ChromaModule } from '../chroma/chroma.module';
import { OpenAIModule } from '../openai/openai.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Script.name, schema: ScriptSchema },
      { name: ScriptVersion.name, schema: ScriptVersionSchema },
      { name: Channel.name, schema: ChannelSchema },
      { name: Thread.name, schema: ThreadSchema },
    ]),
    BullModule.registerQueue({
      name: 'script-vector-sync',
    }),
    ChromaModule,
    OpenAIModule,
  ],
  controllers: [ScriptsController],
  providers: [ScriptsService, ScriptVectorProcessor],
  exports: [ScriptsService],
})
export class ScriptsModule {}
