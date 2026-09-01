const TelegramBot = require('node-telegram-bot-api');
const { TELEGRAM_BOT_TOKEN, ADMIN_IDS } = require('./config');
const { registerUserHandlers } = require('./handlers/userHandlers');
const { registerAdminHandlers } = require('./handlers/adminHandlers');

// Create bot instance with long-polling
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log('🤖 MovieVerify Telegram Bot starting...');
console.log(`📋 Admin IDs: ${ADMIN_IDS.join(', ')}`);

// Register all handlers
registerUserHandlers(bot);
registerAdminHandlers(bot);

// Handle polling errors gracefully
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code, error.message);
});

// Handle uncaught errors
bot.on('error', (error) => {
  console.error('Bot error:', error.message);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down bot...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down bot...');
  bot.stopPolling();
  process.exit(0);
});

console.log('✅ MovieVerify Telegram Bot is running!');
console.log('📡 Listening for messages...');
