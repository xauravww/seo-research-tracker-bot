const db = require('../database');
const auth = require('../auth');
const { extractDomain } = require('../utils/url');
const { formatSiteDetails, formatSiteRow } = require('../utils/format');
const { startWizard, sendCategoryKeyboard } = require('./addWizard');

function register(bot) {
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (auth.isAuthenticated(chatId)) {
      bot.sendMessage(chatId, 'You are already logged in. Use /help to see commands.');
      return;
    }
    auth.startLogin(chatId);
    bot.sendMessage(chatId, 'Welcome! Please enter your username:');
  });

  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    if (!auth.isAuthenticated(chatId)) {
      bot.sendMessage(chatId, 'Please /start and login first.');
      return;
    }
    bot.sendMessage(chatId, [
      '*SEO Research Tracker Commands:*',
      '',
      '/add - Add a new site',
      '/search <url> - Search for a site',
      '/list - List all sites (paginated)',
      '/get <id> - View site details',
      '/update <id> - Update a site',
      '/delete <id> - Delete a site',
      '/export - Download data as Excel sheet',
      '/logout - Logout',
      '/help - Show this message',
      '',
      'Or just send any URL to search/add it.',
    ].join('\n'), { parse_mode: 'Markdown' });
  });

  bot.onText(/\/logout/, (msg) => {
    const chatId = msg.chat.id;
    auth.logout(chatId);
    bot.sendMessage(chatId, 'Logged out. Use /start to login again.');
  });

  bot.onText(/\/add(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!auth.isAuthenticated(chatId)) {
      bot.sendMessage(chatId, 'Please /start and login first.');
      return;
    }
    const urlArg = match[1];
    if (urlArg) {
      const parsed = startWizard(chatId, urlArg);
      if (!parsed) {
        bot.sendMessage(chatId, 'Invalid URL.');
        return;
      }
      const existing = db.getSiteByDomain(parsed.domain);
      if (existing) {
        bot.sendMessage(chatId, `Domain *${parsed.domain}* already exists (ID: ${existing.id}).`, { parse_mode: 'Markdown' });
        return;
      }
      sendCategoryKeyboard(bot, chatId);
    } else {
      bot.sendMessage(chatId, 'Send the URL you want to add:');
    }
  });

  bot.onText(/\/search(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!auth.isAuthenticated(chatId)) {
      bot.sendMessage(chatId, 'Please /start and login first.');
      return;
    }
    const query = match[1];
    if (!query) {
      bot.sendMessage(chatId, 'Usage: /search <url or domain>');
      return;
    }
    const parsed = extractDomain(query);
    const searchTerm = parsed ? parsed.domain : query;
    const results = db.searchSites(searchTerm);
    if (results.length === 0) {
      bot.sendMessage(chatId, `No results for "${searchTerm}".`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Add this site', callback_data: `addurl_${parsed ? parsed.url : query}` }],
          ],
        },
      });
      return;
    }
    const text = results.map(formatSiteRow).join('\n');
    bot.sendMessage(chatId, `*Search results:*\n\n${text}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/list/, (msg) => {
    const chatId = msg.chat.id;
    if (!auth.isAuthenticated(chatId)) {
      bot.sendMessage(chatId, 'Please /start and login first.');
      return;
    }
    sendListPage(bot, chatId, 1);
  });

  bot.onText(/\/get(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!auth.isAuthenticated(chatId)) {
      bot.sendMessage(chatId, 'Please /start and login first.');
      return;
    }
    const id = match[1] ? parseInt(match[1]) : null;
    if (!id) {
      bot.sendMessage(chatId, 'Usage: /get <id>');
      return;
    }
    const site = db.getSiteById(id);
    if (!site) {
      bot.sendMessage(chatId, 'Site not found.');
      return;
    }
    bot.sendMessage(chatId, formatSiteDetails(site), {
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
  });

  bot.onText(/\/update(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!auth.isAuthenticated(chatId)) {
      bot.sendMessage(chatId, 'Please /start and login first.');
      return;
    }
    const id = match[1] ? parseInt(match[1]) : null;
    if (!id) {
      bot.sendMessage(chatId, 'Usage: /update <id>');
      return;
    }
    const site = db.getSiteById(id);
    if (!site) {
      bot.sendMessage(chatId, 'Site not found.');
      return;
    }
    sendUpdateFieldKeyboard(bot, chatId, id);
  });

  bot.onText(/\/delete(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!auth.isAuthenticated(chatId)) {
      bot.sendMessage(chatId, 'Please /start and login first.');
      return;
    }
    const id = match[1] ? parseInt(match[1]) : null;
    if (!id) {
      bot.sendMessage(chatId, 'Usage: /delete <id>');
      return;
    }
    const site = db.getSiteById(id);
    if (!site) {
      bot.sendMessage(chatId, 'Site not found.');
      return;
    }
    bot.sendMessage(chatId, `Delete *${site.domain}* (ID: ${site.id})?`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Yes, delete', callback_data: `confirmdelete_${id}` },
            { text: 'Cancel', callback_data: 'canceldelete' },
          ],
        ],
      },
    });
  });
}

function sendListPage(bot, chatId, page) {
  const { sites, total, totalPages } = db.listSites(page);
  if (sites.length === 0) {
    bot.sendMessage(chatId, 'No sites in database.');
    return;
  }
  const text = sites.map(formatSiteRow).join('\n');
  const nav = [];
  if (page > 1) nav.push({ text: '< Prev', callback_data: `page_${page - 1}` });
  if (page < totalPages) nav.push({ text: 'Next >', callback_data: `page_${page + 1}` });

  bot.sendMessage(chatId, `*Sites (${total} total, page ${page}/${totalPages}):*\n\n${text}`, {
    parse_mode: 'Markdown',
    reply_markup: nav.length ? { inline_keyboard: [nav] } : undefined,
  });
}

function sendUpdateFieldKeyboard(bot, chatId, id) {
  const fields = [
    ['URL', `editfield_${id}_url`],
    ['Category', `editfield_${id}_category`],
    ['Is Working', `editfield_${id}_is_working`],
    ['Login Works', `editfield_${id}_login_works`],
    ['Signup Works', `editfield_${id}_signup_works`],
    ['Create Content', `editfield_${id}_create_content_works`],
    ['Requires Approval', `editfield_${id}_requires_approval`],
    ['Published', `editfield_${id}_is_published`],
    ['Credentials', `editfield_${id}_credentials`],
    ['Notes', `editfield_${id}_notes`],
  ];
  const rows = [];
  for (let i = 0; i < fields.length; i += 2) {
    const row = [{ text: fields[i][0], callback_data: fields[i][1] }];
    if (fields[i + 1]) row.push({ text: fields[i + 1][0], callback_data: fields[i + 1][1] });
    rows.push(row);
  }
  bot.sendMessage(chatId, 'Select field to update:', {
    reply_markup: { inline_keyboard: rows },
  });
}

module.exports = { register, sendListPage, sendUpdateFieldKeyboard };
