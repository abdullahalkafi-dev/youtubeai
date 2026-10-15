import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { SharedChannel, SharedChannelDocument, SharedUser, SharedUserDocument } from '../db/schemas/shared.readonly';

export interface AuthedRequest {
  headers: Record<string, string | undefined>;
  params: Record<string, string>;
  user?: { id: string; role?: string };
}

/**
 * Verifies the SAME JWT the main app issues (shared secret, read-only user lookup) and,
 * when the route has :channelId, that the user owns the channel (admins may access any).
 */
@Injectable()
export class ReelAuthGuard implements CanActivate {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly jwt: JwtService,
    @InjectModel(SharedUser.name) private readonly users: Model<SharedUserDocument>,
    @InjectModel(SharedChannel.name) private readonly channels: Model<SharedChannelDocument>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing token');

    let sub: string;
    try {
      sub = (await this.jwt.verifyAsync<{ sub: string }>(token, { secret: this.cfg.JWT_SECRET })).sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!Types.ObjectId.isValid(sub)) throw new UnauthorizedException('Invalid token subject');
    const user = await this.users.findById(sub).select('role').lean();
    if (!user) throw new UnauthorizedException('User not found');
    req.user = { id: String(user._id), role: user.role };

    const channelId = req.params?.channelId;
    if (channelId) {
      if (!Types.ObjectId.isValid(channelId)) throw new NotFoundException('Channel not found');
      const channel = await this.channels.findById(channelId).select('userId').lean();
      if (!channel) throw new NotFoundException('Channel not found');
      if (user.role !== 'ADMIN' && String(channel.userId) !== req.user.id) throw new ForbiddenException('You do not own this channel');
    }
    return true;
  }
}
