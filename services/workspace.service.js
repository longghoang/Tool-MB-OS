const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MODULES = [
  { id: 'scope-review', label: 'BM01 Scope Review', path: '/scope-review' },
  { id: 'pending-comment', label: 'Comment Pending PYC', path: '/pending-comment' },
  { id: 'excel', label: 'BBXN Task Lookup', path: '/excel' },
  { id: 'pentest-report', label: 'Pentest Report', path: '/pentest-report' },
  { id: 'ai-checklist', label: 'AI Pentest Checklist', path: '/ai-checklist' },
  { id: 'pyc-transition', label: 'PYC Transition', path: '/home/pyc-transition' },
  { id: 'manday', label: 'Manday Manager', path: '/manday' },
  { id: 'aes', label: 'MO Crypto Tool', path: '/aes' }
];
const THEMES = ['dark', 'light', 'pink', 'red'];
const accounts = [
  ['vncs', 'vncs', 'user'],
  ['mb', 'mb', 'user'],
  ['admin', 'Long@123', 'admin']
].map(([username, password, role]) => ({ username, role, hash: crypto.scryptSync(password, `workspace:${username}`, 32) }));
const dataFile = process.env.WORKSPACE_STATE_FILE || path.join(__dirname, '..', 'data', 'workspace-state.json');

const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
function initialState() { return { modules: Object.fromEntries(MODULES.map(item => [item.id, true])), themes: {}, messages: [], rememberTokens: [] }; }
let state = initialState();
try {
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  state.modules = { ...state.modules, ...Object.fromEntries(Object.entries(saved.modules || {}).filter(([id, value]) => MODULES.some(item => item.id === id) && typeof value === 'boolean')) };
  state.themes = saved.themes && typeof saved.themes === 'object' ? saved.themes : {};
  state.messages = Array.isArray(saved.messages) ? saved.messages.slice(-500) : [];
  state.rememberTokens = Array.isArray(saved.rememberTokens) ? saved.rememberTokens.filter(item => item && typeof item.id === 'string' && typeof item.hash === 'string' && Number(item.expiresAt) > Date.now()).slice(-100) : [];
} catch (error) { if (error.code !== 'ENOENT') throw error; }

function persist() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const temp = `${dataFile}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.renameSync(temp, dataFile); }
  catch (error) {
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    fs.copyFileSync(temp, dataFile);
    fs.unlinkSync(temp);
  }
}
function authenticate(username, password) {
  const entry = accounts.find(item => item.username === String(username || '').trim().toLowerCase());
  if (!entry || typeof password !== 'string') return null;
  const candidate = crypto.scryptSync(password, `workspace:${entry.username}`, 32);
  return crypto.timingSafeEqual(candidate, entry.hash) ? { username: entry.username, role: entry.role } : null;
}
function rememberTokenParts(token) {
  const match = /^([0-9a-f]{32})\.([0-9a-f]{64})$/i.exec(String(token || ''));
  return match ? { id: match[1].toLowerCase(), secret: match[2].toLowerCase() } : null;
}
function issueRememberToken(username) {
  if (!accounts.some(entry => entry.username === username)) throw new Error('Tài khoản không hợp lệ.');
  const id = crypto.randomBytes(16).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(secret).digest('hex');
  state.rememberTokens = state.rememberTokens.filter(item => item.expiresAt > Date.now()).slice(-99);
  state.rememberTokens.push({ id, hash, username, expiresAt: Date.now() + REMEMBER_MS });
  persist();
  return `${id}.${secret}`;
}
function userFromRememberToken(token) {
  const parts = rememberTokenParts(token);
  if (!parts) return null;
  const saved = state.rememberTokens.find(item => item.id === parts.id && item.expiresAt > Date.now());
  if (!saved || !/^[0-9a-f]{64}$/i.test(saved.hash)) return null;
  const supplied = crypto.createHash('sha256').update(parts.secret).digest();
  if (!crypto.timingSafeEqual(supplied, Buffer.from(saved.hash, 'hex'))) return null;
  const account = accounts.find(item => item.username === saved.username);
  return account ? { username: account.username, role: account.role } : null;
}
function revokeRememberToken(token) {
  const parts = rememberTokenParts(token);
  if (!parts) return;
  const original = state.rememberTokens.length;
  state.rememberTokens = state.rememberTokens.filter(item => item.id !== parts.id);
  if (state.rememberTokens.length !== original) persist();
}
function getTheme(username) { const value = state.themes[username]; return THEMES.includes(value) ? value : 'dark'; }
function setTheme(username, theme) {
  if (!THEMES.includes(theme)) throw new Error('Màu giao diện không hợp lệ.');
  state.themes[username] = theme; persist(); return theme;
}
function moduleForPath(urlPath) {
  if (urlPath === '/home/ai-checklist') return 'ai-checklist';
  if (urlPath === '/api/pyc-transition') return 'pyc-transition';
  return MODULES.find(item => urlPath === item.path || urlPath.startsWith(`${item.path}/`))?.id || null;
}
function isEnabled(id) { return state.modules[id] !== false; }
function setModule(id, enabled) {
  if (!MODULES.some(item => item.id === id) || typeof enabled !== 'boolean') throw new Error('Module hoặc trạng thái không hợp lệ.');
  state.modules[id] = enabled; persist(); return enabled;
}
function modules() { return MODULES.map(item => ({ ...item, enabled: isEnabled(item.id) })); }
function addMessage(username, senderName, content) {
  const name = String(senderName || '').trim().replace(/\s+/g, ' ');
  const message = String(content || '').trim();
  if (name.length < 2 || name.length > 80) throw new Error('Nhập tên người gửi từ 2 đến 80 ký tự.');
  if (message.length < 2 || message.length > 2000) throw new Error('Lời nhắn cần từ 2 đến 2.000 ký tự.');
  const item = { id: crypto.randomUUID(), username, senderName: name, content: message, createdAt: new Date().toISOString(), read: false };
  state.messages = [...state.messages, item].slice(-500); persist(); return item;
}
function messages() { return [...state.messages].reverse(); }
function markMessage(id, read) {
  const item = state.messages.find(message => message.id === id);
  if (!item || typeof read !== 'boolean') throw new Error('Không tìm thấy lời nhắn.');
  item.read = read; persist(); return item;
}
function deleteMessage(id) {
  const count = state.messages.length;
  state.messages = state.messages.filter(message => message.id !== id);
  if (state.messages.length === count) throw new Error('Không tìm thấy lời nhắn.');
  persist();
}

module.exports = { MODULES, THEMES, REMEMBER_MS, authenticate, issueRememberToken, userFromRememberToken, revokeRememberToken, getTheme, setTheme, moduleForPath, isEnabled, setModule, modules, addMessage, messages, markMessage, deleteMessage };
