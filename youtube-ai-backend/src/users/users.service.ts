import { Injectable, NotFoundException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../mongo/schemas/user.schema';
import { leanDoc } from '../common/utils/lean';

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async onApplicationBootstrap() {
    await this.seedAdminUser();
  }

  async seedAdminUser() {
    const adminEmail = 'admin@prod.com';
    const adminPassword = 'password@123L';

    try {
      let admin = await this.userModel.findOne({ email: adminEmail });
      const hashedPassword = await bcrypt.hash(adminPassword, 10);

      if (!admin) {
        admin = await this.userModel.create({
          email: adminEmail,
          password: hashedPassword,
          name: 'Production Admin',
          role: 'ADMIN',
        });
        this.logger.log(`🌱 Default admin user seeded successfully (${adminEmail})`);
      } else {
        await this.userModel.updateOne(
          { email: adminEmail },
          { $set: { password: hashedPassword, role: 'ADMIN' } },
        );
        this.logger.log(`✅ Default admin password synced for ${adminEmail}`);
      }

      // Ensure any existing channels without valid userId belong to admin
      const channelModel = this.userModel.db.model('Channel') as any;
      if (channelModel && admin) {
        const orphanCount = await channelModel.countDocuments({
          $or: [{ userId: { $exists: false } }, { userId: null }],
        });
        if (orphanCount > 0) {
          await channelModel.updateMany(
            { $or: [{ userId: { $exists: false } }, { userId: null }] },
            { $set: { userId: admin._id } },
          );
          this.logger.log(`Linked ${orphanCount} orphan channel(s) to ${adminEmail}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to seed admin user: ${error.message}`);
    }
  }

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
