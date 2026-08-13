export default () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/youtube_ai',
  },
  chromadb: {
    url: process.env.CHROMADB_URL || 'http://localhost:8000',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRY || '7d',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
    fastModel: process.env.OPENAI_FAST_MODEL || 'gpt-4.1-nano',
    trendsModel:
      process.env.OPENAI_TRENDS_MODEL ||
      process.env.OPENAI_MODEL ||
      'gpt-5.4-mini',
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'thumbnails',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  },
  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
  limits: {
    maxUsers: parseInt(process.env.MAX_USERS || '0', 10),
    maxChannelsPerUser: parseInt(process.env.MAX_CHANNELS_PER_USER || '0', 10),
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
  },
});
