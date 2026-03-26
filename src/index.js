const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const auth = require('./auth');
const db = require('./database');

async function main() {
  await db.init();

  const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

  const commands = require('./handlers/commands');
  const callbacks = require('./handlers/callbacks');
  const { handleUrlSearch } = require('./handlers/search');
  const { isInWizard, handleWizardText, startWizard, sendCategoryKeyboard, cancelWizard } = require('./handlers/addWizard');
  const exportHandler = require('./handlers/export');
  const { looksLikeUrl } = require('./utils/url');

  commands.register(bot);
  callbacks.register(bot);
  exportHandler.register(bot);

  bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    try {
      if (auth.isInLoginFlow(chatId)) {
        const result = auth.handleLoginStep(chatId, text);
        if (result) bot.sendMessage(chatId, result.message);
        return;
      }

      if (!auth.isAuthenticated(chatId)) {
        bot.sendMessage(chatId, 'Please /start and login first.');
        return;
      }

      if (exportHandler.isInExportFlow(chatId)) {
        exportHandler.handleExportText(bot, chatId, text);
        return;
      }

      if (callbacks.isInUpdateFlow(chatId)) {
        callbacks.handleUpdateText(bot, chatId, text);
        return;
      }

      if (isInWizard(chatId)) {
        if (handleWizardText(bot, chatId, text)) return;

        if (looksLikeUrl(text)) {
          const parsed = startWizard(chatId, text);
          if (parsed) {
            const existing = db.getSiteByDomain(parsed.domain);
            if (existing) {
              cancelWizard(chatId);
              bot.sendMessage(chatId, `Domain already exists (ID: ${existing.id}).`);
              return;
            }
            sendCategoryKeyboard(bot, chatId);
            return;
          }
        }
        return;
      }

      if (looksLikeUrl(text)) {
        handleUrlSearch(bot, chatId, text);
        return;
      }
    } catch (err) {
      console.error('Message handler error:', err);
      bot.sendMessage(chatId, 'An error occurred.');
    }
  });

  console.log('SEO Research Tracker Bot is running...');
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
