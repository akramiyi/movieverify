/**
 * Telegram Inline Keyboard builder utilities
 */

/**
 * Build search result buttons — one "Select" button per result
 * @param {Array} results - TMDB search results
 * @param {string} callbackPrefix - 'select' for users, 'adminselect' for admins
 */
const buildSearchResultsKeyboard = (results, callbackPrefix = 'select') => {
  return results.map(item => ([{
    text: `${item.mediaType === 'tv' ? '📺' : '🎬'} ${item.title} (${item.year})`,
    callback_data: `${callbackPrefix}:${item.id}:${item.mediaType}`
  }]));
};

/**
 * Build download quality buttons for a movie
 * Only shows buttons for qualities that have actual URLs
 */
const buildDownloadButtons = (config) => {
  const buttons = [];
  
  if (config.download480p) {
    buttons.push({ text: '📥 480p (~500 MB)', url: config.download480p });
  }
  if (config.download720p) {
    buttons.push({ text: '📥 720p (~1.2 GB)', url: config.download720p });
  }
  if (config.download1080p) {
    buttons.push({ text: '📥 1080p (~2.5 GB)', url: config.download1080p });
  }
  
  // Return as rows (one button per row for clarity)
  return buttons.map(btn => [btn]);
};

/**
 * Build TV show season/episode buttons
 */
const buildSeasonsKeyboard = (config) => {
  if (!config.seasons || !Array.isArray(config.seasons)) return [];

  const keyboard = [];
  config.seasons.forEach(season => {
    if (!season.parts || season.parts.length === 0) return;
    const hasAnyLink = season.parts.some(p => p.download480p || p.download720p || p.download1080p);
    if (hasAnyLink) {
      keyboard.push([{
        text: `📺 Season ${season.season} (${season.parts.length} episodes)`,
        callback_data: `season:${config.id}:${season.season}`
      }]);
    }
  });
  return keyboard;
};

/**
 * Build pagination buttons
 */
const buildPaginationKeyboard = (currentPage, totalPages, callbackPrefix = 'listpage') => {
  const buttons = [];
  
  if (currentPage > 1) {
    buttons.push({ text: '⬅️ Previous', callback_data: `${callbackPrefix}:${currentPage - 1}` });
  }
  
  buttons.push({ text: `${currentPage}/${totalPages}`, callback_data: 'noop' });
  
  if (currentPage < totalPages) {
    buttons.push({ text: 'Next ➡️', callback_data: `${callbackPrefix}:${currentPage + 1}` });
  }
  
  return [buttons];
};

/**
 * Build confirmation keyboard
 */
const buildConfirmKeyboard = (confirmData, cancelData = 'cancel') => {
  return [
    [
      { text: '✅ Confirm Delete', callback_data: confirmData },
      { text: '❌ Cancel', callback_data: cancelData }
    ]
  ];
};

/**
 * Build admin action keyboard for a selected movie
 */
const buildAdminActionKeyboard = (tmdbId, mediaType) => {
  return [
    [
      { text: '➕ Add/Update Links', callback_data: `adminadd:${tmdbId}:${mediaType}` },
    ],
    [
      { text: '✏️ Edit Links', callback_data: `adminedit:${tmdbId}:${mediaType}` },
      { text: '🗑️ Delete', callback_data: `admindelete:${tmdbId}:${mediaType}` },
    ]
  ];
};

module.exports = {
  buildSearchResultsKeyboard,
  buildDownloadButtons,
  buildSeasonsKeyboard,
  buildPaginationKeyboard,
  buildConfirmKeyboard,
  buildAdminActionKeyboard
};
