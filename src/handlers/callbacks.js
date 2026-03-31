const db = require('../database');
const auth = require('../auth');
const { formatSiteDetails } = require('../utils/format');
const { startWizard, handleWizardCallback, sendCategoryKeyboard, isInWizard } = require('./addWizard');
const { sendListPage, sendUpdateFieldKeyboard } = require('./commands');
const { handleExportCallback } = require('./export');

const updateState = new Map();

function register(bot) {
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    bot.answerCallbackQuery(query.id);

    if (!auth.isAuthenticated(chatId)) {
      bot.sendMessage(chatId, 'Please /start and login first.');
      return;
    }

    try {
      // Wizard callbacks
      if (isInWizard(chatId)) {
        handleWizardCallback(bot, chatId, query.message.message_id, data);
        return;
      }

      // Export callbacks
      if (data.startsWith('export_') || data.startsWith('exportcat_')) {
        if (handleExportCallback(bot, chatId, data)) return;
      }

      // Add URL from search
      if (data.startsWith('addurl_')) {
        const url = data.replace('addurl_', '');
        const parsed = startWizard(chatId, url);
        if (!parsed) {
          bot.sendMessage(chatId, 'Invalid URL.');
          return;
        }
        const existing = db.getSiteByDomain(parsed.domain);
        if (existing) {
          bot.sendMessage(chatId, `Domain already exists (ID: ${existing.id}).`);
          return;
        }
        sendCategoryKeyboard(bot, chatId);
        return;
      }

      // Pagination
      if (data.startsWith('page_')) {
        const page = parseInt(data.replace('page_', ''));
        sendListPage(bot, chatId, page);
        return;
      }

      // Update button
      if (data.startsWith('update_')) {
        const id = parseInt(data.replace('update_', ''));
        const site = db.getSiteById(id);
        if (!site) {
          bot.sendMessage(chatId, 'Site not found.');
          return;
        }
        sendUpdateFieldKeyboard(bot, chatId, id);
        return;
      }

      // Edit field selection
      if (data.startsWith('editfield_')) {
        const parts = data.replace('editfield_', '').split('_');
        const id = parseInt(parts[0]);
        const field = parts.slice(1).join('_');

        const boolFields = ['is_working', 'login_works', 'signup_works', 'create_content_works', 'requires_approval', 'is_published'];
        if (boolFields.includes(field)) {
          const buttons = [
            [
              { text: 'Yes', callback_data: `setfield_${id}_${field}_1` },
              { text: 'No', callback_data: `setfield_${id}_${field}_0` },
            ],
          ];
          if (field !== 'is_working') {
            buttons[0].push({ text: 'N/A', callback_data: `setfield_${id}_${field}_null` });
          }
          bot.sendMessage(chatId, `Set *${field.replace(/_/g, ' ')}*:`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons },
          });
        } else if (field === 'category') {
          // Show category buttons for update too
          const { CATEGORIES } = require('./addWizard');
          const rows = [];
          for (let i = 0; i < CATEGORIES.length; i += 3) {
            const row = [];
            for (let j = i; j < i + 3 && j < CATEGORIES.length; j++) {
              row.push({ text: CATEGORIES[j], callback_data: `setcat_${id}_${CATEGORIES[j]}` });
            }
            rows.push(row);
          }
          rows.push([{ text: '+ Custom...', callback_data: `setcat_${id}_custom` }]);
          bot.sendMessage(chatId, 'Select new category:', {
            reply_markup: { inline_keyboard: rows },
          });
        } else {
          updateState.set(chatId, { id, field });
          const hints = {
            url: 'Enter new URL:',
            credentials: 'Enter credentials as key:value pairs (e.g. `email:x, password:y`) or "clear" to remove:',
            notes: 'Enter new notes or "clear" to remove:',
          };
          bot.sendMessage(chatId, hints[field] || `Enter new value for ${field}:`);
        }
        return;
      }

      // Set category from buttons
      if (data.startsWith('setcat_')) {
        const parts = data.replace('setcat_', '').split('_');
        const id = parseInt(parts[0]);
        const category = parts.slice(1).join('_');
        if (category === 'custom') {
          updateState.set(chatId, { id, field: 'category' });
          bot.sendMessage(chatId, 'Enter custom category:');
        } else {
          const site = db.updateSiteField(id, 'category', category);
          if (site) {
            bot.sendMessage(chatId, `Updated!\n\n${formatSiteDetails(site)}`, { parse_mode: 'Markdown' });
          } else {
            bot.sendMessage(chatId, 'Update failed.');
          }
        }
        return;
      }

      // Set boolean field
      if (data.startsWith('setfield_')) {
        const parts = data.replace('setfield_', '').split('_');
        const id = parseInt(parts[0]);
        const value = parts[parts.length - 1];
        const field = parts.slice(1, -1).join('_');
        const dbValue = value === 'null' ? null : parseInt(value);
        const site = db.updateSiteField(id, field, dbValue);
        if (site) {
          bot.sendMessage(chatId, `Updated! ${formatSiteDetails(site)}`, { parse_mode: 'Markdown' });
        } else {
          bot.sendMessage(chatId, 'Update failed.');
        }
        return;
      }

      // Delete
      if (data.startsWith('delete_')) {
        const id = parseInt(data.replace('delete_', ''));
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
        return;
      }

      if (data.startsWith('confirmdelete_')) {
        const id = parseInt(data.replace('confirmdelete_', ''));
        db.deleteSite(id);
        bot.sendMessage(chatId, `Site #${id} deleted.`);
        return;
      }

      if (data === 'canceldelete') {
        bot.sendMessage(chatId, 'Delete cancelled.');
        return;
      }
    } catch (err) {
      console.error('Callback error:', err);
      bot.sendMessage(chatId, 'An error occurred.');
    }
  });
}

function isInUpdateFlow(chatId) {
  return updateState.has(chatId);
}

function handleUpdateText(bot, chatId, text) {
  const state = updateState.get(chatId);
  if (!state) return false;
  updateState.delete(chatId);

  const { id, field } = state;

  let value = text.trim();
  if (value.toLowerCase() === 'clear') value = null;

  if (field === 'url') {
    const { extractDomain } = require('../utils/url');
    const parsed = extractDomain(value);
    if (!parsed) {
      bot.sendMessage(chatId, 'Invalid URL.');
      return true;
    }
    const site = db.updateSite(id, { url: parsed.url, domain: parsed.domain });
    if (site) {
      bot.sendMessage(chatId, `Updated!\n\n${formatSiteDetails(site)}`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, 'Update failed.');
    }
    return true;
  }

  if (field === 'credentials' && value) {
    try {
      const pairs = value.split(',').reduce((acc, pair) => {
        const [key, ...rest] = pair.split(':');
        if (key && rest.length) acc[key.trim()] = rest.join(':').trim();
        return acc;
      }, {});
      value = JSON.stringify(pairs);
    } catch {
      // store as-is
    }
  }

  const site = db.updateSiteField(id, field, value);
  if (site) {
    bot.sendMessage(chatId, `Updated!\n\n${formatSiteDetails(site)}`, { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(chatId, 'Update failed.');
  }
  return true;
}

module.exports = { register, isInUpdateFlow, handleUpdateText };
