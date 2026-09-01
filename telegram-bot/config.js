const dotenv = require('dotenv');
const path = require('path');

// Load .env from the telegram-bot directory
dotenv.config({ path: path.join(__dirname, '.env') });

const required = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ADMIN_IDS',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TMDB_TOKEN'
];

const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach(key => console.error(`   - ${key}`));
  console.error('\nCopy .env.example to .env and fill in all values.');
  process.exit(1);
}

module.exports = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  ADMIN_IDS: process.env.TELEGRAM_ADMIN_IDS.split(',').map(id => Number(id.trim())),
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  TMDB_TOKEN: process.env.TMDB_TOKEN
};
