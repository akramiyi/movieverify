const { searchMoviesAndTV } = require('../tmdb');
const { getDownloadConfig } = require('../supabase');
const { buildSearchResultsKeyboard, buildDownloadButtons, buildSeasonsKeyboard } = require('../utils/keyboard');

/**
 * Register all user-facing command handlers
 * @param {TelegramBot} bot 
 */
const registerUserHandlers = (bot) => {

  // /start — Welcome message
  bot.onText(/\/start/, (msg) => {
    const name = msg.from.first_name || 'there';
    bot.sendMessage(msg.chat.id, 
      `🎬 *Welcome to MovieVerify Bot, ${name}!*\n\n` +
      `I can help you find movies and check download availability.\n\n` +
      `*Commands:*\n` +
      `🔍 /search _movie name_ — Search for a movie or TV show\n` +
      `ℹ️ /help — Show this help message\n\n` +
      `Try: \`/search Jawan\``,
      { parse_mode: 'Markdown' }
    );
  });

  // /help
  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
      `🎬 *MovieVerify Bot — Help*\n\n` +
      `*User Commands:*\n` +
      `🔍 /search _query_ — Search movies & TV shows\n` +
      `ℹ️ /help — Show this message\n\n` +
      `When you search, I'll show matching results from TMDB.\n` +
      `Select a result to check if download links are available.\n\n` +
      `_Powered by MovieVerify & TMDB_`,
      { parse_mode: 'Markdown' }
    );
  });

  // /search <query>
  bot.onText(/\/search(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : '';

    if (!query) {
      return bot.sendMessage(chatId, '❌ Please provide a search query.\n\nExample: `/search Jawan`', { parse_mode: 'Markdown' });
    }

    const searching = await bot.sendMessage(chatId, `🔍 Searching for "${query}"...`);

    try {
      const results = await searchMoviesAndTV(query);

      if (results.length === 0) {
        return bot.editMessageText(
          `😕 No results found for "${query}".\n\nTry a different spelling or title.`,
          { chat_id: chatId, message_id: searching.message_id }
        );
      }

      // Build the results text
      let text = `🔍 *Search Results for "${query}":*\n\n`;
      results.forEach((item, idx) => {
        const typeEmoji = item.mediaType === 'tv' ? '📺' : '🎬';
        text += `${idx + 1}. ${typeEmoji} *${item.title}* (${item.year})\n`;
        text += `   ⭐ ${item.rating} • 🌐 ${item.language}\n\n`;
      });
      text += `_Select a title below to check availability:_`;

      const keyboard = buildSearchResultsKeyboard(results, 'select');

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: searching.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (err) {
      console.error('Search handler error:', err);
      bot.editMessageText(
        '❌ Something went wrong while searching. Please try again later.',
        { chat_id: chatId, message_id: searching.message_id }
      );
    }
  });

  // Callback: select:<tmdbId>:<mediaType>
  bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    if (!data.startsWith('select:')) return;

    const parts = data.split(':');
    if (parts.length < 3) return;

    const tmdbId = parts[1];
    const mediaType = parts[2];
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Checking availability...' });

    try {
      const config = await getDownloadConfig(tmdbId, mediaType);

      if (!config) {
        return bot.editMessageText(
          `🎬 *TMDB ID:* ${tmdbId}\n` +
          `🎞 *Type:* ${mediaType === 'tv' ? 'TV Show' : 'Movie'}\n\n` +
          `❌ *Download is currently unavailable for this title.*\n\n` +
          `_Check back later — links are added regularly._`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
      }

      const title = config.title || 'Unknown Title';
      const hasQualities = config.download480p || config.download720p || config.download1080p;
      const hasSeasons = config.seasons && Array.isArray(config.seasons) && config.seasons.length > 0;

      let text = `🎬 *${title}*\n`;
      text += `🎞 Type: ${mediaType === 'tv' ? 'TV Show' : 'Movie'}\n\n`;

      if (hasSeasons) {
        // TV Show with seasons
        text += `📺 *Available Seasons:*\n`;
        text += `_Select a season below:_`;

        const seasonKeyboard = buildSeasonsKeyboard(config);
        return bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: seasonKeyboard }
        });
      }

      if (hasQualities) {
        text += `✅ *Available Qualities:*\n`;
        if (config.download480p) text += `• 480p (~500 MB)\n`;
        if (config.download720p) text += `• 720p (~1.2 GB)\n`;
        if (config.download1080p) text += `• 1080p (~2.5 GB)\n`;
        text += `\n_Tap a button below to download:_`;

        const downloadKeyboard = buildDownloadButtons(config);
        return bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: downloadKeyboard }
        });
      }

      // Config exists but no actual links
      text += `⚠️ *This title is configured but download links haven't been added yet.*`;
      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
      });

    } catch (err) {
      console.error('Select callback error:', err);
      bot.editMessageText(
        '❌ Error checking download availability. Please try again.',
        { chat_id: chatId, message_id: messageId }
      );
    }
  });

  // Callback: season:<configId>:<seasonNum>
  bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    if (!data.startsWith('season:')) return;

    const parts = data.split(':');
    if (parts.length < 3) return;

    const configId = parts[1];
    const seasonNum = parseInt(parts[2], 10);
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    await bot.answerCallbackQuery(callbackQuery.id);

    try {
      // Re-fetch config to get latest data
      const idParts = configId.split('-');
      const mediaType = idParts.pop();
      const tmdbId = idParts.join('-');
      const config = await getDownloadConfig(tmdbId, mediaType);

      if (!config || !config.seasons) {
        return bot.editMessageText('❌ Season data not found.', {
          chat_id: chatId, message_id: messageId
        });
      }

      const season = config.seasons.find(s => s.season === seasonNum);
      if (!season || !season.parts) {
        return bot.editMessageText('❌ No episodes found for this season.', {
          chat_id: chatId, message_id: messageId
        });
      }

      let text = `📺 *${config.title}* — Season ${seasonNum}\n\n`;

      season.parts.forEach((ep, idx) => {
        const name = ep.name || `Episode ${idx + 1}`;
        const quals = [];
        if (ep.download480p) quals.push('480p');
        if (ep.download720p) quals.push('720p');
        if (ep.download1080p) quals.push('1080p');
        text += `${idx + 1}. ${name}`;
        if (quals.length > 0) {
          text += ` — ${quals.join(', ')}`;
        } else {
          text += ` — _No links_`;
        }
        text += `\n`;
      });

      // Build episode download buttons (max 5 per message for readability)
      const keyboard = [];
      season.parts.forEach((ep, idx) => {
        const name = ep.name || `Episode ${idx + 1}`;
        const row = [];
        if (ep.download480p) row.push({ text: `${name} 480p`, url: ep.download480p });
        if (ep.download720p) row.push({ text: `${name} 720p`, url: ep.download720p });
        if (ep.download1080p) row.push({ text: `${name} 1080p`, url: ep.download1080p });
        if (row.length > 0) keyboard.push(row);
      });

      // Add back button
      keyboard.push([{ text: '⬅️ Back to Seasons', callback_data: `select:${tmdbId}:${mediaType}` }]);

      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (err) {
      console.error('Season callback error:', err);
      bot.editMessageText('❌ Error loading season data.', {
        chat_id: chatId, message_id: messageId
      });
    }
  });
};

module.exports = { registerUserHandlers };
