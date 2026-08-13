import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop()
  password?: string;

  @Prop()
  name?: string;

  @Prop()
  avatar?: string;

  @Prop({ default: 'USER', enum: ['USER', 'ADMIN'] })
  role: string;

  @Prop({ unique: true, sparse: true })
  googleId?: string;

  @Prop()
  accessToken?: string;

  @Prop()
  refreshToken?: string;

  @Prop()
  tokenExpiresAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
