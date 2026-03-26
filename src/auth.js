const config = require('./config');

const sessions = new Map();
const loginState = new Map();

function isAuthenticated(chatId) {
  return sessions.get(chatId) === true;
}

function startLogin(chatId) {
  loginState.set(chatId, { step: 'username' });
}

function handleLoginStep(chatId, text) {
  const state = loginState.get(chatId);
  if (!state) return null;

  if (state.step === 'username') {
    state.username = text;
    state.step = 'password';
    loginState.set(chatId, state);
    return { step: 'password', message: 'Enter password:' };
  }

  if (state.step === 'password') {
    const success =
      state.username === config.ADMIN_USERNAME && text === config.ADMIN_PASSWORD;
    loginState.delete(chatId);
    if (success) {
      sessions.set(chatId, true);
      return { step: 'done', success: true, message: 'Login successful! Use /help to see available commands.' };
    }
    return { step: 'done', success: false, message: 'Invalid credentials. Use /start to try again.' };
  }

  return null;
}

function isInLoginFlow(chatId) {
  return loginState.has(chatId);
}

function logout(chatId) {
  sessions.delete(chatId);
  loginState.delete(chatId);
}

module.exports = {
  isAuthenticated,
  startLogin,
  handleLoginStep,
  isInLoginFlow,
  logout,
};
