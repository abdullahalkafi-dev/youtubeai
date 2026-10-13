import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('❌ OPENAI_API_KEY is missing from environment.');
  process.exit(1);
}

const client = new OpenAI({
  apiKey,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});

async function testModel(modelName: string) {
  console.log(`\n⏳ Testing model "${modelName}"...`);
  const start = Date.now();
  try {
    const res = await client.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'user',
          content: 'Output exactly one line: "MODEL_OK: <model_name>"',
        },
      ],
      max_completion_tokens: 50,
    });
    const elapsed = Date.now() - start;
    const reply = res.choices[0]?.message?.content?.trim();
    console.log(`✅ [${modelName}] Success in ${elapsed}ms: ${reply}`);
    return true;
  } catch (err: any) {
    console.error(`❌ [${modelName}] Failed: ${err.message}`);
    if (err.status) console.error(`   HTTP Status: ${err.status}`);
    return false;
  }
}

async function main() {
  console.log('====================================================');
  console.log('🧪 Verifying OpenAI Models (gpt-6.1-sol & gpt-6-luna)');
  console.log('====================================================');

  const solResult = await testModel('gpt-6.1-sol');
  const lunaResult = await testModel('gpt-6-luna');

  console.log('\n====================================================');
  if (solResult && lunaResult) {
    console.log('🎉 BOTH MODELS VERIFIED & READY FOR PRODUCTION!');
    process.exit(0);
  } else {
    console.log('⚠️ ONE OR MORE MODELS FAILED VERIFICATION.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
