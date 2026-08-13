import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../mongo/schemas/user.schema';
import { leanDoc } from '../common/utils/lean';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async findById(id: string) {
    const user = await this.userModel.findById(new Types.ObjectId(id)).lean();
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return leanDoc(user);
  }

  async findByEmail(email: string) {
    const user = await this.userModel.findOne({ email }).lean();
    return user ? leanDoc(user) : null;
  }

  async findByGoogleId(googleId: string) {
    const user = await this.userModel.findOne({ googleId }).lean();
    return user ? leanDoc(user) : null;
  }

  async update(id: string, data: { name?: string; avatar?: string }) {
    await this.findById(id);
    const updated = await this.userModel.findByIdAndUpdate(new Types.ObjectId(id), { $set: data }, { new: true }).lean();
    return leanDoc(updated);
  }

  async getChannels(userId: string) {
    const channelModel = this.userModel.db.model('Channel') as any;
    const channels = await channelModel.find({ userId: new Types.ObjectId(userId) }).lean();
    return channels.map((ch: any) => {
      const { _id, __v, ...rest } = ch;
      return { id: _id.toString(), ...rest };
    });
  }
}
