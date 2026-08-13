import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../mongo/schemas/user.schema';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { YouTubeService } from '../youtube/youtube.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RegisterDto } from './dto/register.dto';

interface GoogleUser {
  googleId: string;
  email: string;
  name: string;
  avatar?: string;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly youtubeService: YouTubeService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.userModel.findOne({ email: dto.email });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const maxUsers = this.configService.get<number>('limits.maxUsers', 0);
    if (maxUsers > 0) {
      const count = await this.userModel.countDocuments();
      if (count >= maxUsers) {
        throw new ConflictException('Maximum user limit reached');
      }
    }

    const bcryptRounds = this.configService.get<number>('limits.bcryptRounds', 10);
    const hashedPassword = await bcrypt.hash(dto.password, bcryptRounds);

    const user = await this.userModel.create({
      email: dto.email,
      password: hashedPassword,
      name: dto.name,
    });

    this.logger.log(`New user registered: ${dto.email}`);

    const payload = { sub: user._id.toString(), email: user.email };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      id: user._id.toString(),
      email: user.email,
      name: user.name || undefined,
      avatar: user.avatar || undefined,
    };
  }

  async validateUserCredentials(
    email: string,
    password: string,
  ): Promise<{ id: string; email: string; name?: string; avatar?: string } | null> {
    const user = await this.userModel.findOne({ email });
    if (!user || !user.password) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name || undefined,
      avatar: user.avatar || undefined,
    };
  }

  login(user: { id: string; email: string; name?: string; avatar?: string }): AuthResponseDto {
    const payload = { sub: user.id, email: user.email };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    };
  }

  async handleGoogleLogin(user: GoogleUser): Promise<AuthResponseDto> {
    const { googleId, email, name, avatar, accessToken, refreshToken } = user;

    const allowedEmails = (this.configService.get<string>('ALLOWED_GOOGLE_EMAILS', 'uniquemeccaaudio@gmail.com') || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (allowedEmails.length > 0 && !allowedEmails.includes(email.toLowerCase())) {
      throw new UnauthorizedException('This email is not authorized to access this platform');
    }

    let dbUser = await this.userModel.findOne({
      $or: [{ googleId }, { email }],
    });

    if (dbUser) {
      const updateData: any = {
        googleId,
        name,
        avatar,
        accessToken,
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      };
      if (refreshToken) {
        updateData.refreshToken = refreshToken;
      }
      dbUser = await this.userModel.findByIdAndUpdate(
        dbUser._id,
        { $set: updateData },
        { new: true },
      );
    } else {
      const maxUsers = this.configService.get<number>('limits.maxUsers', 0);
      if (maxUsers > 0) {
        const count = await this.userModel.countDocuments();
        if (count >= maxUsers) {
          throw new ConflictException('Maximum user limit reached');
        }
      }

      dbUser = await this.userModel.create({
        googleId,
        email,
        name,
        avatar,
        accessToken,
        refreshToken,
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        role: 'ADMIN',
      });
      this.logger.log(`New user created via Google: ${email}`);
    }

    if (!dbUser) {
      throw new UnauthorizedException('Failed to create or find user');
    }

    if (email.toLowerCase() === 'uniquemeccaaudio@gmail.com') {
      try {
        await this.userModel.updateMany(
          { email: { $in: ['admin@prod.com', 'admin@test.com'] }, _id: { $ne: dbUser._id } },
          { $set: { accessToken, refreshToken, tokenExpiresAt: new Date(Date.now() + 3600 * 1000) } },
        );
        this.logger.log('Synced OAuth tokens to admin@prod.com & admin@test.com');
      } catch (e) {
        this.logger.warn(`Failed to sync tokens to admin: ${e.message}`);
      }
    }

    this.logger.log('='.repeat(50));
    this.logger.log(`GOOGLE OAUTH LOGIN SUCCESSFUL`);
    this.logger.log(`Email: ${email}`);
    this.logger.log(`Access Token: ${accessToken || 'MISSING'}`);
    this.logger.log(`Refresh Token: ${refreshToken || 'MISSING'}`);
    this.logger.log(`User ID: ${dbUser._id}`);
    this.logger.log('='.repeat(50));

    // Auto-create channel from YouTube if user has none
    const existingChannels = await this.channelModel.countDocuments({ userId: dbUser._id });
    if (existingChannels === 0) {
      try {
        const channelInfo = await this.youtubeService.getChannelInfo(accessToken);
        if (channelInfo) {
          const existing = await this.channelModel.findOne({ youtubeChannelId: channelInfo.channelId });
          if (existing) {
            await this.channelModel.findByIdAndUpdate(existing._id, { $set: { userId: dbUser._id } });
            this.logger.log(`Reassigned existing channel "${channelInfo.title}" to user ${dbUser._id}`);
          } else {
            await this.channelModel.create({
              userId: dbUser._id,
              youtubeChannelId: channelInfo.channelId,
              name: channelInfo.title,
              description: channelInfo.description,
              avatarUrl: channelInfo.thumbnailUrl,
              subscriberCount: channelInfo.subscriberCount,
              totalVideos: channelInfo.videoCount,
              totalViews: Number(channelInfo.viewCount),
            });
            this.logger.log(`Auto-created channel "${channelInfo.title}" for user ${dbUser._id}`);
          }
        }
      } catch (error) {
        this.logger.warn(`Could not auto-create channel from YouTube: ${error.message}`);
      }
    }

    const payload = { sub: dbUser._id.toString(), email: dbUser.email };
    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      id: dbUser._id.toString(),
      email: dbUser.email,
      name: dbUser.name || undefined,
      avatar: dbUser.avatar || undefined,
    };
  }

  async validateUser(userId: string) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new UnauthorizedException('User not found');
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    };
  }
}
