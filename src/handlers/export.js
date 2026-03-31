const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { boolLabel } = require('../utils/format');

const exportState = new Map();

function register(bot) {
  bot.onText(/\/export/, (msg) => {
    const chatId = msg.chat.id;
    const auth = require('../auth');
    if (!auth.isAuthenticated(chatId)) {
      bot.sendMessage(chatId, 'Please /start and login first.');
      return;
    }

    bot.sendMessage(chatId, 'Select export range:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'All', callback_data: 'export_all' },
            { text: 'By ID Range', callback_data: 'export_idrange' },
          ],
          [
            { text: 'Last 7 Days', callback_data: 'export_days_7' },
            { text: 'Last 30 Days', callback_data: 'export_days_30' },
          ],
          [
            { text: 'Last 90 Days', callback_data: 'export_days_90' },
            { text: 'By Category', callback_data: 'export_category' },
          ],
        ],
      },
    });
  });
}

function handleExportCallback(bot, chatId, data) {
  if (data === 'export_all') {
    const rows = db.getAllSites();
    sendExcel(bot, chatId, rows, 'all_sites');
    return true;
  }

  if (data.startsWith('export_days_')) {
    const days = parseInt(data.replace('export_days_', ''));
    const rows = db.getSitesByDays(days);
    sendExcel(bot, chatId, rows, `sites_last_${days}_days`);
    return true;
  }

  if (data === 'export_idrange') {
    exportState.set(chatId, { step: 'id_range' });
    bot.sendMessage(chatId, 'Enter ID range (e.g. `1-50`):');
    return true;
  }

  if (data === 'export_category') {
    const { CATEGORIES } = require('./addWizard');
    const rows = [];
    for (let i = 0; i < CATEGORIES.length; i += 3) {
      const row = [];
      for (let j = i; j < i + 3 && j < CATEGORIES.length; j++) {
        row.push({ text: CATEGORIES[j], callback_data: `exportcat_${CATEGORIES[j]}` });
      }
      rows.push(row);
    }
    bot.sendMessage(chatId, 'Select category to export:', {
      reply_markup: { inline_keyboard: rows },
    });
    return true;
  }

  if (data.startsWith('exportcat_')) {
    const category = data.replace('exportcat_', '');
    const rows = db.getSitesByCategory(category);
    sendExcel(bot, chatId, rows, `sites_${category.toLowerCase().replace(/\s+/g, '_')}`);
    return true;
  }

  return false;
}

function handleExportText(bot, chatId, text) {
  const state = exportState.get(chatId);
  if (!state) return false;

  if (state.step === 'id_range') {
    exportState.delete(chatId);
    const match = text.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) {
      bot.sendMessage(chatId, 'Invalid range. Use format: `1-50`');
      return true;
    }
    const from = parseInt(match[1]);
    const to = parseInt(match[2]);
    const rows = db.getSitesByIdRange(from, to);
    sendExcel(bot, chatId, rows, `sites_${from}_to_${to}`);
    return true;
  }

  return false;
}

function isInExportFlow(chatId) {
  return exportState.has(chatId);
}

function sendExcel(bot, chatId, sites, filename) {
  if (sites.length === 0) {
    bot.sendMessage(chatId, 'No sites found for the selected range.');
    return;
  }

  const data = sites.map((s) => ({
    'ID': s.id,
    'URL': s.url,
    'Domain': s.domain,
    'Category': s.category,
    'Working': boolLabel(s.is_working),
    'Login Works': boolLabel(s.login_works),
    'Signup Works': boolLabel(s.signup_works),
    'Create Content': boolLabel(s.create_content_works),
    'Requires Approval': boolLabel(s.requires_approval),
    'Published': boolLabel(s.is_published),
    'Credentials': s.credentials || '',
    'Notes': s.notes || '',
    'Created': s.created_at,
    'Updated': s.updated_at,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);

  // Auto-width columns
  const colWidths = Object.keys(data[0]).map((key) => {
    const maxLen = Math.max(key.length, ...data.map((r) => String(r[key] || '').length));
    return { wch: Math.min(maxLen + 2, 50) };
  });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Sites');

  const filePath = path.resolve(__dirname, '..', '..', 'data', `${filename}.xlsx`);
  XLSX.writeFile(wb, filePath);

  bot.sendDocument(chatId, filePath, {
    caption: `Exported ${sites.length} site(s)`,
  }).then(() => {
    try { fs.unlinkSync(filePath); } catch {}
  });
}

module.exports = { register, handleExportCallback, handleExportText, isInExportFlow };
