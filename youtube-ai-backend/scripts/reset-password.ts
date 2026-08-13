import mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27019/youtube_ai';
const EMAIL = 'admin@test.com';
const NEW_PASSWORD = 'password123';

async function main() {
  await mongoose.connect(MONGODB_URI);
  const users = mongoose.connection.db!.collection('users');

  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  const result = await users.updateOne({ email: EMAIL }, { $set: { password: hash } });

  if (result.modifiedCount === 1) {
    console.log('Password updated for admin@test.com');
  } else if (result.matchedCount === 1) {
    console.log('Password was already set to this value');
  } else {
    console.log('User not found. Creating...');
    await users.insertOne({
      email: EMAIL,
      password: hash,
      name: 'Admin',
      role: 'ADMIN',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log('User created: admin@test.com');
  }

  await mongoose.disconnect();
}

main().catch(console.error);
