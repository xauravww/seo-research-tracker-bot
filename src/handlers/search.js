const db = require('../database');
const { extractDomain, looksLikeUrl } = require('../utils/url');
const { formatSiteDetails } = require('../utils/format');

function handleUrlSearch(bot, chatId, text) {
  if (!looksLikeUrl(text)) return false;

  const parsed = extractDomain(text);
  if (!parsed) {
    bot.sendMessage(chatId, 'Could not parse that URL.');
    return true;
  }

  const site = db.getSiteByDomain(parsed.domain);
  if (site) {
    bot.sendMessage(chatId, `*Site found:*\n\n${formatSiteDetails(site)}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Update', callback_data: `update_${site.id}` },
            { text: 'Delete', callback_data: `delete_${site.id}` },
          ],
        ],
      },
    });
  } else {
    bot.sendMessage(chatId, `No entry found for *${parsed.domain}*`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Add this site', callback_data: `addurl_${parsed.url}` }],
        ],
      },
    });
  }
  return true;
}

module.exports = { handleUrlSearch };
