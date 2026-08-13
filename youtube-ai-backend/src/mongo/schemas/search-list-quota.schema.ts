import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SearchListQuotaDocument = HydratedDocument<SearchListQuota>;

@Schema({ timestamps: { createdAt: false, updatedAt: 'updatedAt' }, collection: 'search_list_quotas' })
export class SearchListQuota {
  @Prop({ required: true, unique: true })
  date: string; // YYYY-MM-DD (UTC)

  @Prop({ default: 0 })
  callCount: number;

  @Prop({ default: 10 })
  limit: number;
}

export const SearchListQuotaSchema = SchemaFactory.createForClass(SearchListQuota);
