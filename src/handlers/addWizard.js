const db = require('../database');
const { extractDomain } = require('../utils/url');
const { formatSiteDetails } = require('../utils/format');

const wizardState = new Map();

const CATEGORIES = [
  'Blog', 'Article', 'Bookmarking', 'Classified',
  'Search Engine Ping', 'Forum', 'Directory',
  'Wiki', 'Social Networking', 'Profile Creation',
  'Guest Post', 'Image Sharing', 'Video Sharing',
  'PDF Sharing', 'Infographic', 'Web 2.0',
  'Press Release', 'Q&A', 'Business Listing',
  'Comment', 'RSS Feed',
];

function startWizard(chatId, url) {
  const parsed = extractDomain(url);
  if (!parsed) return null;
  wizardState.set(chatId, {
    step: 'category',
    data: { url: parsed.url, domain: parsed.domain },
  });
  return parsed;
}

function isInWizard(chatId) {
  return wizardState.has(chatId);
}

function getWizardStep(chatId) {
  const state = wizardState.get(chatId);
  return state ? state.step : null;
}

function cancelWizard(chatId) {
  wizardState.delete(chatId);
}

function handleWizardCallback(bot, chatId, messageId, callbackData) {
  const state = wizardState.get(chatId);
  if (!state) return;

  const step = state.step;
  const data = state.data;

  if (step === 'category') {
    if (callbackData.startsWith('cat_')) {
      const category = callbackData.replace('cat_', '');
      if (category === 'custom') {
        state.step = 'category_custom';
        wizardState.set(chatId, state);
        bot.sendMessage(chatId, 'Enter custom category:');
        return;
      }
      data.category = category;
      state.step = 'is_working';
      wizardState.set(chatId, state);
      sendIsWorkingPrompt(bot, chatId);
    }
    return;
  }

  if (step === 'is_working') {
    data.is_working = callbackData === 'working_yes' ? 1 : 0;
    if (data.is_working === 1) {
      state.step = 'login_works';
      wizardState.set(chatId, state);
      sendYesNoNa(bot, chatId, 'Does login work?', 'login');
    } else {
      data.login_works = null;
      data.signup_works = null;
      data.create_content_works = null;
      state.step = 'requires_approval';
      wizardState.set(chatId, state);
      sendYesNoUnknown(bot, chatId, 'Requires approval?', 'approval');
    }
    return;
  }

  if (step === 'login_works') {
    data.login_works = parseYesNoNa(callbackData, 'login');
    state.step = 'signup_works';
    wizardState.set(chatId, state);
    sendYesNoNa(bot, chatId, 'Does signup work?', 'signup');
    return;
  }

  if (step === 'signup_works') {
    data.signup_works = parseYesNoNa(callbackData, 'signup');
    state.step = 'create_content_works';
    wizardState.set(chatId, state);
    sendYesNoNa(bot, chatId, 'Does creating content work?', 'content');
    return;
  }

  if (step === 'create_content_works') {
    data.create_content_works = parseYesNoNa(callbackData, 'content');
    state.step = 'requires_approval';
    wizardState.set(chatId, state);
    sendYesNoUnknown(bot, chatId, 'Requires approval?', 'approval');
    return;
  }

  if (step === 'requires_approval') {
    data.requires_approval = parseYesNoUnknown(callbackData, 'approval');
    state.step = 'credentials';
    wizardState.set(chatId, state);
    bot.sendMessage(chatId, 'Enter credentials as key:value pairs (e.g. `email:test@test.com, password:abc123`)\nOr press Skip:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'Skip', callback_data: 'cred_skip' }]],
      },
    });
    return;
  }

  if (step === 'credentials' && callbackData === 'cred_skip') {
    data.credentials = null;
    state.step = 'notes';
    wizardState.set(chatId, state);
    bot.sendMessage(chatId, 'Any notes? Type them or press Skip:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'Skip', callback_data: 'notes_skip' }]],
      },
    });
    return;
  }

  if (step === 'notes' && callbackData === 'notes_skip') {
    data.notes = null;
    state.step = 'confirm';
    wizardState.set(chatId, state);
    sendConfirmation(bot, chatId, data);
    return;
  }

  if (step === 'confirm') {
    if (callbackData === 'confirm_yes') {
      try {
        const siteData = {
          url: data.url,
          domain: data.domain,
          category: data.category,
          is_working: data.is_working != null ? data.is_working : 1,
          login_works: data.login_works != null ? data.login_works : null,
          signup_works: data.signup_works != null ? data.signup_works : null,
          create_content_works: data.create_content_works != null ? data.create_content_works : null,
          requires_approval: data.requires_approval != null ? data.requires_approval : null,
          credentials: data.credentials && data.credentials !== '' ? data.credentials : null,
          notes: data.notes && data.notes !== '' ? data.notes : null,
        };
        const result = db.addSite(siteData);
        wizardState.delete(chatId);
        const site = db.getSiteById(result.lastInsertRowid);
        if (site) {
          bot.sendMessage(chatId, `Site added successfully!\n\n${formatSiteDetails(site)}`, { parse_mode: 'Markdown' });
        } else {
          bot.sendMessage(chatId, 'Site added successfully!');
        }
      } catch (err) {
        wizardState.delete(chatId);
        if (err.message.includes('UNIQUE constraint failed')) {
          bot.sendMessage(chatId, 'This domain/URL already exists in the database.');
        } else {
          bot.sendMessage(chatId, `Error saving site: ${err.message}`);
        }
      }
    } else {
      wizardState.delete(chatId);
      bot.sendMessage(chatId, 'Add cancelled.');
    }
    return;
  }
}

function handleWizardText(bot, chatId, text) {
  const state = wizardState.get(chatId);
  if (!state) return false;

  if (state.step === 'category_custom') {
    state.data.category = text.trim();
    state.step = 'is_working';
    wizardState.set(chatId, state);
    sendIsWorkingPrompt(bot, chatId);
    return true;
  }

  if (state.step === 'credentials') {
    try {
      const pairs = text.split(',').reduce((acc, pair) => {
        const [key, ...rest] = pair.split(':');
        if (key && rest.length) {
          acc[key.trim()] = rest.join(':').trim();
        }
        return acc;
      }, {});
      state.data.credentials = JSON.stringify(pairs);
    } catch {
      state.data.credentials = text;
    }
    state.step = 'notes';
    wizardState.set(chatId, state);
    bot.sendMessage(chatId, 'Any notes? Type them or press Skip:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'Skip', callback_data: 'notes_skip' }]],
      },
    });
    return true;
  }

  if (state.step === 'notes') {
    state.data.notes = text.trim();
    state.step = 'confirm';
    wizardState.set(chatId, state);
    sendConfirmation(bot, chatId, state.data);
    return true;
  }

  return false;
}

function sendCategoryKeyboard(bot, chatId) {
  const rows = [];
  for (let i = 0; i < CATEGORIES.length; i += 3) {
    const row = [];
    for (let j = i; j < i + 3 && j < CATEGORIES.length; j++) {
      row.push({ text: CATEGORIES[j], callback_data: `cat_${CATEGORIES[j]}` });
    }
    rows.push(row);
  }
  rows.push([{ text: '+ Custom...', callback_data: 'cat_custom' }]);
  bot.sendMessage(chatId, 'Select a category:', {
    reply_markup: { inline_keyboard: rows },
  });
}

function sendIsWorkingPrompt(bot, chatId) {
  bot.sendMessage(chatId, 'Is the site working?', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Yes', callback_data: 'working_yes' },
          { text: 'No', callback_data: 'working_no' },
        ],
      ],
    },
  });
}

function sendYesNoNa(bot, chatId, question, prefix) {
  bot.sendMessage(chatId, question, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Yes', callback_data: `${prefix}_yes` },
          { text: 'No', callback_data: `${prefix}_no` },
          { text: 'N/A', callback_data: `${prefix}_na` },
        ],
      ],
    },
  });
}

function sendYesNoUnknown(bot, chatId, question, prefix) {
  bot.sendMessage(chatId, question, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Yes', callback_data: `${prefix}_yes` },
          { text: 'No', callback_data: `${prefix}_no` },
          { text: 'Unknown', callback_data: `${prefix}_unknown` },
        ],
      ],
    },
  });
}

function parseYesNoNa(data, prefix) {
  if (data === `${prefix}_yes`) return 1;
  if (data === `${prefix}_no`) return 0;
  return null;
}

function parseYesNoUnknown(data, prefix) {
  if (data === `${prefix}_yes`) return 1;
  if (data === `${prefix}_no`) return 0;
  return null;
}

function sendConfirmation(bot, chatId, data) {
  const { boolLabel } = require('../utils/format');
  const lines = [
    '*Confirm adding this site:*',
    `URL: ${data.url}`,
    `Domain: ${data.domain}`,
    `Category: ${data.category}`,
    `Working: ${boolLabel(data.is_working)}`,
    `Login: ${boolLabel(data.login_works)}`,
    `Signup: ${boolLabel(data.signup_works)}`,
    `Create content: ${boolLabel(data.create_content_works)}`,
    `Requires approval: ${boolLabel(data.requires_approval)}`,
    `Credentials: ${data.credentials || 'None'}`,
    `Notes: ${data.notes || 'None'}`,
  ];
  bot.sendMessage(chatId, lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Confirm', callback_data: 'confirm_yes' },
          { text: 'Cancel', callback_data: 'confirm_no' },
        ],
      ],
    },
  });
}

module.exports = {
  startWizard,
  isInWizard,
  getWizardStep,
  cancelWizard,
  handleWizardCallback,
  handleWizardText,
  sendCategoryKeyboard,
  CATEGORIES,
};
