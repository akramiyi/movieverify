const { ADMIN_IDS } = require('../config');
const { searchMoviesAndTV, getDetails } = require('../tmdb');
const { getDownloadConfig, upsertDownloadConfig, deleteDownloadConfig, listAllConfigs, getStats } = require('../supabase');
const { buildSearchResultsKeyboard, buildPaginationKeyboard, buildConfirmKeyboard } = require('../utils/keyboard');

/**
 * Check if a user is an authorized admin
 */
const isAdmin = (userId) => ADMIN_IDS.includes(userId);

/**
 * Guard wrapper — sends unauthorized message if not admin
 */
const adminGuard = (bot, msg) => {
  if (!isAdmin(msg.from.id)) {
    bot.sendMessage(msg.chat.id, '🔒 *Unauthorized.* You are not an admin.', { parse_mode: 'Markdown' });
    return false;
  }
  return true;
};

// Conversation state for multi-step flows (per chatId)
const conversations = new Map();

/**
 * Register all admin command handlers
 * @param {TelegramBot} bot 
 */
const registerAdminHandlers = (bot) => {

  // /admin — Show admin menu
  bot.onText(/\/admin/, (msg) => {
    if (!adminGuard(bot, msg)) return;

    bot.sendMessage(msg.chat.id,
      `🔐 *Admin Panel — MovieVerify Bot*\n\n` +
      `*Available Commands:*\n` +
      `🔍 /searchadmin _query_ — Search TMDB to add/edit/delete\n` +
      `📋 /list — List all configured downloads\n` +
      `📊 /stats — View statistics\n\n` +
      `_All changes sync instantly with the website._`,
      { parse_mode: 'Markdown' }
    );
  });

  // /stats — Show statistics
  bot.onText(/\/stats/, async (msg) => {
    if (!adminGuard(bot, msg)) return;
    const chatId = msg.chat.id;

    try {
      const stats = await getStats();

      bot.sendMessage(chatId,
        `📊 *MovieVerify — Statistics*\n\n` +
        `📦 Total Configured: *${stats.total}*\n` +
        `🎬 Movies: *${stats.movies}*\n` +
        `📺 TV Shows: *${stats.tvShows}*\n\n` +
        `*Quality Breakdown:*\n` +
        `• 480p configured: ${stats.has480p}\n` +
        `• 720p configured: ${stats.has720p}\n` +
        `• 1080p configured: ${stats.has1080p}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('Stats error:', err);
      bot.sendMessage(chatId, '❌ Error fetching statistics.');
    }
  });

  // /list — Paginated list of configured movies
  bot.onText(/\/list/, async (msg) => {
    if (!adminGuard(bot, msg)) return;
    await sendListPage(bot, msg.chat.id, 1);
  });

  // Callback: listpage:<page>
  bot.on('callback_query', async (callbackQuery) => {
    if (!callbackQuery.data.startsWith('listpage:')) return;
    if (!isAdmin(callbackQuery.from.id)) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: '🔒 Unauthorized' });
    }

    const page = parseInt(callbackQuery.data.split(':')[1], 10);
    await bot.answerCallbackQuery(callbackQuery.id);
    await sendListPage(bot, callbackQuery.message.chat.id, page, callbackQuery.message.message_id);
  });

  // /searchadmin <query>
  bot.onText(/\/searchadmin(?:\s+(.+))?/, async (msg, match) => {
    if (!adminGuard(bot, msg)) return;

    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : '';

    if (!query) {
      return bot.sendMessage(chatId, '❌ Please provide a movie/show name to search.\n\nExample: `/searchadmin Jawan`', { parse_mode: 'Markdown' });
    }

    const searching = await bot.sendMessage(chatId, `🔍 Admin search: "${query}"...`);

    try {
      const results = await searchMoviesAndTV(query);

      if (results.length === 0) {
        return bot.editMessageText(`😕 No TMDB results for "${query}".`, {
          chat_id: chatId, message_id: searching.message_id
        });
      }

      let text = `🔍 *Admin Search — "${query}":*\n\n`;
      results.forEach((item, idx) => {
        const emoji = item.mediaType === 'tv' ? '📺' : '🎬';
        text += `${idx + 1}. ${emoji} *${item.title}* (${item.year})\n`;
        text += `   TMDB ID: \`${item.id}\` • Type: ${item.mediaType}\n\n`;
      });
      text += `_Select a title to manage:_`;

      const keyboard = buildSearchResultsKeyboard(results, 'adminselect');

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: searching.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (err) {
      console.error('Admin search error:', err);
      bot.editMessageText('❌ Search failed.', { chat_id: chatId, message_id: searching.message_id });
    }
  });

  // Callback: adminselect:<tmdbId>:<mediaType>
  bot.on('callback_query', async (callbackQuery) => {
    if (!callbackQuery.data.startsWith('adminselect:')) return;
    if (!isAdmin(callbackQuery.from.id)) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: '🔒 Unauthorized' });
    }

    const parts = callbackQuery.data.split(':');
    const tmdbId = parts[1];
    const mediaType = parts[2];
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    await bot.answerCallbackQuery(callbackQuery.id);

    try {
      const details = await getDetails(tmdbId, mediaType);
      const config = await getDownloadConfig(tmdbId, mediaType);

      let text = `🎬 *${details?.title || 'Unknown'}*\n`;
      text += `📅 Year: ${details?.year || 'N/A'}\n`;
      text += `🎞 Type: ${mediaType === 'tv' ? 'TV Show' : 'Movie'}\n`;
      text += `🆔 TMDB ID: \`${tmdbId}\`\n\n`;

      if (config) {
        text += `✅ *Currently Configured:*\n`;
        text += `• 480p: ${config.download480p ? '✅' : '❌'}\n`;
        text += `• 720p: ${config.download720p ? '✅' : '❌'}\n`;
        text += `• 1080p: ${config.download1080p ? '✅' : '❌'}\n`;
        if (config.seasons) text += `• Seasons: ${config.seasons.length}\n`;
      } else {
        text += `⚠️ *Not yet configured*\n`;
      }

      text += `\n_Select an action:_`;

      const keyboard = [
        [{ text: '➕ Add/Update Links', callback_data: `adminadd:${tmdbId}:${mediaType}` }],
      ];

      if (config) {
        keyboard.push([
          { text: '🗑️ Delete Config', callback_data: `admindelete:${tmdbId}:${mediaType}` }
        ]);
      }

      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (err) {
      console.error('Admin select error:', err);
      bot.editMessageText('❌ Error loading details.', { chat_id: chatId, message_id: messageId });
    }
  });

  // Callback: adminadd:<tmdbId>:<mediaType> — Start add/edit conversation
  bot.on('callback_query', async (callbackQuery) => {
    if (!callbackQuery.data.startsWith('adminadd:')) return;
    if (!isAdmin(callbackQuery.from.id)) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: '🔒 Unauthorized' });
    }

    const parts = callbackQuery.data.split(':');
    const tmdbId = parts[1];
    const mediaType = parts[2];
    const chatId = callbackQuery.message.chat.id;

    await bot.answerCallbackQuery(callbackQuery.id);

    // Get existing config and TMDB details
    const details = await getDetails(tmdbId, mediaType);
    const existing = await getDownloadConfig(tmdbId, mediaType);

    // Start conversation
    conversations.set(chatId, {
      step: 'url_480p',
      tmdbId,
      mediaType,
      title: details?.title || existing?.title || 'Unknown',
      data: {
        download480p: existing?.download480p || null,
        download720p: existing?.download720p || null,
        download1080p: existing?.download1080p || null,
      }
    });

    const currentVal = existing?.download480p ? `\nCurrent: \`${existing.download480p}\`` : '';
    bot.sendMessage(chatId,
      `✏️ *Adding/Updating: ${details?.title || 'Unknown'}*\n\n` +
      `Send the *480p download URL*${currentVal}\n\n` +
      `Send \`-\` to skip (leave empty) or \`cancel\` to abort.`,
      { parse_mode: 'Markdown' }
    );
  });

  // Callback: admindelete:<tmdbId>:<mediaType>
  bot.on('callback_query', async (callbackQuery) => {
    if (!callbackQuery.data.startsWith('admindelete:')) return;
    if (!isAdmin(callbackQuery.from.id)) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: '🔒 Unauthorized' });
    }

    const parts = callbackQuery.data.split(':');
    const tmdbId = parts[1];
    const mediaType = parts[2];
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    await bot.answerCallbackQuery(callbackQuery.id);

    const configId = `${tmdbId}-${mediaType}`;

    bot.editMessageText(
      `⚠️ *Are you sure you want to delete this configuration?*\n\n` +
      `This will remove all download links for this title.\n` +
      `ID: \`${configId}\``,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: buildConfirmKeyboard(`confirmdelete:${configId}`, 'cancel')
        }
      }
    );
  });

  // Callback: confirmdelete:<configId>
  bot.on('callback_query', async (callbackQuery) => {
    if (!callbackQuery.data.startsWith('confirmdelete:')) return;
    if (!isAdmin(callbackQuery.from.id)) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: '🔒 Unauthorized' });
    }

    const configId = callbackQuery.data.replace('confirmdelete:', '');
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Deleting...' });

    try {
      await deleteDownloadConfig(configId);
      bot.editMessageText(
        `✅ *Deleted successfully!*\n\nConfig \`${configId}\` has been removed from the database.`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('Delete error:', err);
      bot.editMessageText('❌ Failed to delete. Please try again.', {
        chat_id: chatId, message_id: messageId
      });
    }
  });

  // Callback: cancel
  bot.on('callback_query', async (callbackQuery) => {
    if (callbackQuery.data !== 'cancel') return;

    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Cancelled' });
    conversations.delete(callbackQuery.message.chat.id);
    bot.editMessageText('❌ Action cancelled.', {
      chat_id: callbackQuery.message.chat.id,
      message_id: callbackQuery.message.message_id
    });
  });

  // Handle text messages for conversation flow (add/edit URLs)
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const conv = conversations.get(chatId);
    if (!conv) return;
    if (!isAdmin(msg.from.id)) return;

    const input = msg.text.trim();

    if (input.toLowerCase() === 'cancel') {
      conversations.delete(chatId);
      return bot.sendMessage(chatId, '❌ Operation cancelled.');
    }

    const value = input === '-' ? null : input;

    switch (conv.step) {
      case 'url_480p': {
        conv.data.download480p = value;
        conv.step = 'url_720p';
        const currentVal = conv.data.download720p ? `\nCurrent: \`${conv.data.download720p}\`` : '';
        bot.sendMessage(chatId,
          `✅ 480p ${value ? 'set' : 'skipped'}.\n\n` +
          `Now send the *720p download URL*${currentVal}\n\n` +
          `Send \`-\` to skip or \`cancel\` to abort.`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      case 'url_720p': {
        conv.data.download720p = value;
        conv.step = 'url_1080p';
        const currentVal = conv.data.download1080p ? `\nCurrent: \`${conv.data.download1080p}\`` : '';
        bot.sendMessage(chatId,
          `✅ 720p ${value ? 'set' : 'skipped'}.\n\n` +
          `Now send the *1080p download URL*${currentVal}\n\n` +
          `Send \`-\` to skip or \`cancel\` to abort.`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      case 'url_1080p': {
        conv.data.download1080p = value;

        // Save to Supabase
        try {
          await upsertDownloadConfig({
            tmdbId: conv.tmdbId,
            mediaType: conv.mediaType,
            title: conv.title,
            download480p: conv.data.download480p,
            download720p: conv.data.download720p,
            download1080p: conv.data.download1080p,
          });

          let summary = `✅ *Saved Successfully!*\n\n`;
          summary += `🎬 *${conv.title}*\n`;
          summary += `🆔 ${conv.tmdbId} (${conv.mediaType})\n\n`;
          summary += `• 480p: ${conv.data.download480p ? '✅' : '❌'}\n`;
          summary += `• 720p: ${conv.data.download720p ? '✅' : '❌'}\n`;
          summary += `• 1080p: ${conv.data.download1080p ? '✅' : '❌'}\n\n`;
          summary += `_Changes are live on the website immediately._`;

          bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error('Save error:', err);
          bot.sendMessage(chatId, `❌ Failed to save: ${err.message}`);
        }

        conversations.delete(chatId);
        break;
      }

      default:
        conversations.delete(chatId);
        break;
    }
  });
};

/**
 * Send a paginated list of configured downloads
 */
const sendListPage = async (bot, chatId, page, editMessageId = null) => {
  const perPage = 10;

  try {
    const { data, total } = await listAllConfigs(page, perPage);
    const totalPages = Math.max(1, Math.ceil(total / perPage));

    if (data.length === 0 && page === 1) {
      const text = '📋 *No downloads configured yet.*\n\nUse /searchadmin to add your first movie.';
      if (editMessageId) {
        return bot.editMessageText(text, { chat_id: chatId, message_id: editMessageId, parse_mode: 'Markdown' });
      }
      return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }

    let text = `📋 *Configured Downloads* (${total} total)\n\n`;
    data.forEach((item, idx) => {
      const num = (page - 1) * perPage + idx + 1;
      const emoji = item.media_type === 'tv' ? '📺' : '🎬';
      const quals = [];
      if (item.download480p) quals.push('480p');
      if (item.download720p) quals.push('720p');
      if (item.download1080p) quals.push('1080p');
      if (item.seasons) quals.push(`${item.seasons.length} seasons`);
      text += `${num}. ${emoji} *${item.title || 'Untitled'}*\n`;
      text += `   ${quals.length > 0 ? quals.join(', ') : 'No links'}\n\n`;
    });

    const keyboard = buildPaginationKeyboard(page, totalPages);

    const opts = {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    };

    if (editMessageId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: editMessageId, ...opts });
    } else {
      bot.sendMessage(chatId, text, opts);
    }
  } catch (err) {
    console.error('List error:', err);
    const errorText = '❌ Error loading download list.';
    if (editMessageId) {
      bot.editMessageText(errorText, { chat_id: chatId, message_id: editMessageId });
    } else {
      bot.sendMessage(chatId, errorText);
    }
  }
};

module.exports = { registerAdminHandlers };
