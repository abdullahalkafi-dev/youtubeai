import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { MetaConnection, MetaConnectionSchema } from '../mongo/schemas/meta-connection.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([{ name: MetaConnection.name, schema: MetaConnectionSchema }]),
  ],
  controllers: [MetaController],
  providers: [MetaService],
  exports: [MetaService],
})
export class MetaModule {}
