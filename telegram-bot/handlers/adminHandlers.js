const { ADMIN_IDS } = require('../config');
const { searchMoviesAndTV, getDetails } = require('../tmdb');
const { getDownloadConfig, upsertDownloadConfig, deleteDownloadConfig, listAllConfigs, getStats, getLiveStats, broadcastNotification } = require('../supabase');
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
      `📢 /broadcast _query or id_ — Send push notification to all users\n` +
      `📋 /list — List all configured downloads\n` +
      `📊 /stats — View live subscriber & platform analytics\n\n` +
      `_All changes sync instantly with the website._`,
      { parse_mode: 'Markdown' }
    );
  });

  // /stats — Show live platform analytics
  bot.onText(/\/stats/, async (msg) => {
    if (!adminGuard(bot, msg)) return;
    const chatId = msg.chat.id;

    try {
      const stats = await getLiveStats();
      if (!stats) {
        return bot.sendMessage(chatId, '❌ Error fetching statistics.');
      }

      bot.sendMessage(chatId,
        `📊 *MovieVerify — Live Platform Analytics*\n\n` +
        `👥 *Push Subscribers:*\n` +
        `• Active Web Push Devices: *${stats.activeTokens}*\n` +
        `• Total Campaigns Sent: *${stats.totalCampaigns}*\n` +
        `• User Watchlist Alerts: *${stats.totalAlerts}*\n\n` +
        `📦 *Content Library:*\n` +
        `• Total Configured: *${stats.total}*\n` +
        `• 🎬 Movies: *${stats.movies}* | 📺 TV Shows: *${stats.tvShows}*\n` +
        `• 1080p: ${stats.has1080p} | 720p: ${stats.has720p} | 480p: ${stats.has480p}\n\n` +
        `🛡️ *System Health:*\n` +
        `• Pending Broken Link Reports: *${stats.pendingReports}*\n` +
        `• Site Lock: *${stats.isLocked ? '🔒 LOCKED' : '🟢 OPEN (Active)'}*`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('Stats error:', err);
      bot.sendMessage(chatId, '❌ Error fetching statistics.');
    }
  });

  // /broadcast [query or tmdbId] or /notify [query or tmdbId]
  bot.onText(/\/(?:broadcast|notify)(?:\s+(.+))?/, async (msg, match) => {
    if (!adminGuard(bot, msg)) return;
    const chatId = msg.chat.id;
    const query = match[1] ? match[1].trim() : '';

    if (!query) {
      return bot.sendMessage(chatId,
        `📢 *Push Notification Broadcast*\n\n` +
        `Send an instant push notification to all subscribed users on MovieVerify!\n\n` +
        `*Usage:*\n` +
        `• \`/broadcast <movie name>\` — Search TMDB and select title\n` +
        `• \`/broadcast <tmdb_id>\` — Broadcast directly by TMDB ID\n\n` +
        `*Examples:*\n` +
        `\`/broadcast Jawan\`\n` +
        `\`/broadcast 872585\``,
        { parse_mode: 'Markdown' }
      );
    }

    if (/^\d+$/.test(query)) {
      return showBroadcastPreview(bot, chatId, query, 'movie');
    }

    const searching = await bot.sendMessage(chatId, `🔍 Searching TMDB for "${query}" to broadcast...`);
    try {
      const results = await searchMoviesAndTV(query);
      if (results.length === 0) {
        return bot.editMessageText(`😕 No TMDB results for "${query}".`, {
          chat_id: chatId,
          message_id: searching.message_id
        });
      }

      let text = `📢 *Broadcast — Select Title to Notify Users:*\n\n`;
      results.slice(0, 6).forEach((item, idx) => {
        const emoji = item.mediaType === 'tv' ? '📺' : '🎬';
        const cleanTitle = (item.title || 'Untitled').replace(/[*_`]/g, '');
        text += `${idx + 1}. ${emoji} *${cleanTitle}* (${item.year})\n`;
        text += `   TMDB ID: \`${item.id}\` • Type: ${item.mediaType}\n\n`;
      });
      text += `_Click a title below to prepare broadcast:_`;

      const keyboard = results.slice(0, 6).map(item => ([{
        text: `📢 ${item.mediaType === 'tv' ? '📺' : '🎬'} ${(item.title || '').slice(0, 30)} (${item.year})`,
        callback_data: `broadcast_prompt:${item.id}:${item.mediaType}`
      }]));

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: searching.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (err) {
      console.error('Broadcast search error:', err);
      bot.editMessageText('❌ Search failed.', { chat_id: chatId, message_id: searching.message_id });
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
          { text: '📢 Broadcast Push Alert', callback_data: `broadcast_prompt:${tmdbId}:${mediaType}` }
        ]);
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

  // Callback: broadcast_prompt:<tmdbId>:<mediaType>
  bot.on('callback_query', async (callbackQuery) => {
    if (!callbackQuery.data.startsWith('broadcast_prompt:')) return;
    if (!isAdmin(callbackQuery.from.id)) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: '🔒 Unauthorized' });
    }

    const parts = callbackQuery.data.split(':');
    const tmdbId = parts[1];
    const mediaType = parts[2] || 'movie';
    const chatId = callbackQuery.message.chat.id;

    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Loading preview...' });
    await showBroadcastPreview(bot, chatId, tmdbId, mediaType, callbackQuery.message.message_id);
  });

  // Callback: broadcast_cancel
  bot.on('callback_query', async (callbackQuery) => {
    if (callbackQuery.data !== 'broadcast_cancel') return;
    if (!isAdmin(callbackQuery.from.id)) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: '🔒 Unauthorized' });
    }

    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Broadcast cancelled' });
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    try {
      if (callbackQuery.message.caption) {
        await bot.editMessageCaption('❌ *Broadcast cancelled.* No notifications were sent.', {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown'
        });
      } else {
        await bot.editMessageText('❌ *Broadcast cancelled.* No notifications were sent.', {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown'
        });
      }
    } catch (_) {}
  });

  // Callback: broadcast_send:<tmdbId>:<mediaType>
  bot.on('callback_query', async (callbackQuery) => {
    if (!callbackQuery.data.startsWith('broadcast_send:')) return;
    if (!isAdmin(callbackQuery.from.id)) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: '🔒 Unauthorized' });
    }

    const parts = callbackQuery.data.split(':');
    const tmdbId = parts[1];
    const mediaType = parts[2] || 'movie';
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Sending broadcast...' });

    try {
      let details = await getDetails(tmdbId, mediaType);
      if (!details && mediaType === 'movie') {
        details = await getDetails(tmdbId, 'tv');
      }

      const cleanTitle = (details?.title || 'New Release').replace(/[*_`]/g, '');
      const year = details?.year ? ` (${details.year})` : '';
      const imageUrl = details?.posterUrl || details?.backdropUrl || null;

      const result = await broadcastNotification({
        title: `🎬 ${cleanTitle} Available Now!`,
        body: `Fast 1080p, 720p & 480p links are ready. Watch or download now on MovieVerify!`,
        tmdbId,
        mediaType,
        imageUrl
      });

      const successText =
        `🎉 *BROADCAST DISPATCHED SUCCESSFULLY!* 🚀\n\n` +
        `🎬 *Title:* ${cleanTitle}${year}\n` +
        `👥 *Queued Recipients:* *${result.totalRecipients || result.totalDeliveries || 'All active users'}*\n` +
        `🆔 *Campaign ID:* \`${result.campaignId || 'N/A'}\`\n` +
        `⚡ *Instant Dispatch:* ${result.dispatchTriggered ? '✅ Triggered (Vercel Dispatch)' : '⏳ Queued for Background Worker'}\n\n` +
        `_All subscribed users will receive the push notification on their devices._`;

      if (callbackQuery.message.caption) {
        await bot.editMessageCaption(successText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown'
        });
      } else {
        await bot.editMessageText(successText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown'
        });
      }
    } catch (err) {
      console.error('Broadcast send error:', err);
      const failText = `❌ *Broadcast Failed!*\n\nError: \`${err.message}\``;
      if (callbackQuery.message.caption) {
        await bot.editMessageCaption(failText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
      } else {
        await bot.editMessageText(failText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
      }
    }
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

          const cleanTitle = (conv.title || 'Untitled').replace(/[*_`]/g, '');
          let summary = `✅ *Saved Successfully!*\n\n`;
          summary += `🎬 *${cleanTitle}*\n`;
          summary += `🆔 ${conv.tmdbId} (${conv.mediaType})\n\n`;
          summary += `• 480p: ${conv.data.download480p ? '✅' : '❌'}\n`;
          summary += `• 720p: ${conv.data.download720p ? '✅' : '❌'}\n`;
          summary += `• 1080p: ${conv.data.download1080p ? '✅' : '❌'}\n\n`;
          summary += `_Changes are live on the website immediately._\n\n` +
                     `Would you like to notify all subscribers? 👇`;

          const keyboard = [
            [{ text: '📢 Broadcast Push Alert to Users 🚀', callback_data: `broadcast_prompt:${conv.tmdbId}:${conv.mediaType}` }]
          ];

          bot.sendMessage(chatId, summary, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
          });
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
 * Show broadcast confirmation preview card
 */
const showBroadcastPreview = async (bot, chatId, tmdbId, mediaType = 'movie', editMessageId = null) => {
  try {
    let details = await getDetails(tmdbId, mediaType);
    let detectedType = mediaType;
    if (!details && mediaType === 'movie') {
      details = await getDetails(tmdbId, 'tv');
      if (details) detectedType = 'tv';
    }

    if (!details) {
      const errText = `❌ Could not find details for TMDB ID \`${tmdbId}\`.`;
      if (editMessageId) {
        return bot.editMessageText(errText, { chat_id: chatId, message_id: editMessageId, parse_mode: 'Markdown' });
      }
      return bot.sendMessage(chatId, errText, { parse_mode: 'Markdown' });
    }

    const cleanTitle = (details.title || 'Untitled').replace(/[*_`]/g, '');
    const stats = await getLiveStats();
    const activeCount = stats?.activeTokens || 0;
    const typeLabel = detectedType === 'tv' ? 'TV Show' : 'Movie';

    const caption =
      `📢 *CONFIRM PUSH BROADCAST*\n\n` +
      `🎬 *Title:* ${cleanTitle} (${details.year})\n` +
      `🎞 *Type:* ${typeLabel} | ID: \`${details.id}\`\n` +
      `👥 *Target Audience:* *${activeCount} Active Push Devices*\n\n` +
      `🔔 *Notification Preview:*\n` +
      `📌 *Title:* 🎬 ${cleanTitle} Available Now!\n` +
      `💬 *Body:* Fast 1080p, 720p & 480p links are ready. Watch or download now on MovieVerify!\n` +
      `🔗 *Deep Link:* \`https://movieverify.vercel.app/?type=${detectedType}&id=${details.id}\`\n\n` +
      `⚠️ *Are you sure you want to broadcast this push notification to all users right now?*`;

    const keyboard = [
      [
        { text: '🚀 Yes, Broadcast Now!', callback_data: `broadcast_send:${details.id}:${detectedType}` }
      ],
      [
        { text: '❌ Cancel', callback_data: 'broadcast_cancel' }
      ]
    ];

    if (editMessageId) {
      try {
        await bot.deleteMessage(chatId, editMessageId);
      } catch (_) {}
    }

    if (details.posterUrl) {
      await bot.sendPhoto(chatId, details.posterUrl, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } else {
      await bot.sendMessage(chatId, caption, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  } catch (err) {
    console.error('showBroadcastPreview error:', err);
    bot.sendMessage(chatId, `❌ Failed to generate broadcast preview: ${err.message}`);
  }
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
