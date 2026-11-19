const express = require('express');
const crypto = require('crypto');
const path = require('path');
const workspace = require('../services/workspace.service');

const router = express.Router();
router.get('/workspace/favicon.svg', (_req, res) => res.type('image/svg+xml').sendFile(path.join(__dirname, '..', 'public', 'workspace-favicon.svg')));
router.get('/favicon.ico', (_req, res) => res.redirect(302, '/workspace/favicon.svg?v=2'));
router.get('/workspace/login.js', (_req, res) => res.type('js').sendFile(path.join(__dirname, '..', 'public', 'workspace-login.js')));
const attempts = new Map();
const REMEMBER_COOKIE = 'vncs.remember';
const REMEMBER_USERNAME_COOKIE = 'vncs.saved-user';
const csrf = req => req.session.csrf || (req.session.csrf = crypto.randomBytes(24).toString('hex'));
function cookieValue(req, name) {
  const pair = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return null; }
}
const rememberCookie = req => cookieValue(req, REMEMBER_COOKIE);
const rememberOptions = req => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
function restoreRememberedUser(req, res, next) {
  if (req.session.user) return next();
  const token = rememberCookie(req);
  if (!token) return next();
  const user = workspace.userFromRememberToken(token);
  if (!user) { res.clearCookie(REMEMBER_COOKIE, rememberOptions(req)); return next(); }
  req.session.regenerate(error => {
    if (error) return next(error);
    req.session.user = user;
    csrf(req);
    req.session.save(next);
  });
}
const wantsJson = req => req.path.startsWith('/api/') || req.xhr || req.get('accept')?.includes('application/json') || (req.method !== 'GET' && req.method !== 'HEAD');
const safeNext = value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/home';
function checkCsrf(req, res, next) {
  const token = req.get('x-csrf-token') || req.body?._csrf;
  const expected = req.session.csrf;
  if (!expected || typeof token !== 'string' || token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return res.status(403).json({ error: 'Phiên biểu mẫu không hợp lệ. Tải lại trang và thử lại.' });
  next();
}
function requireUser(req, res, next) {
  const user = req.session.user;
  if (!user || !['user', 'admin'].includes(user.role)) {
    if (wantsJson(req)) return res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    return res.redirect(`/login?next=${encodeURIComponent(safeNext(req.originalUrl))}`);
  }
  res.locals.workspaceUser = user;
  res.locals.workspaceTheme = workspace.getTheme(user.username);
  res.locals.workspaceCsrf = csrf(req);
  res.locals.workspaceModules = workspace.modules();
  res.locals.workspaceModule = workspace.moduleForPath(req.path) || (req.path.startsWith('/admin') ? 'admin' : 'home');
  next();
}
function requireAdmin(req, res, next) {
  if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin có quyền thực hiện thao tác này.' });
  next();
}
function moduleAccess(req, res, next) {
  const id = workspace.moduleForPath(req.path);
  if (id && req.session.user.role !== 'admin' && !workspace.isEnabled(id)) {
    if (wantsJson(req)) return res.status(403).json({ error: 'Module này hiện đã được admin tắt.' });
    return res.status(404).render('module-disabled');
  }
  next();
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/home');
  const savedUsername = cookieValue(req, REMEMBER_USERNAME_COOKIE);
  const username = ['vncs', 'mb', 'admin'].includes(savedUsername) ? savedUsername : '';
  res.render('login', { error: '', next: safeNext(req.query.next), csrfToken: csrf(req), remember: Boolean(username), username });
});
router.post('/login', checkCsrf, (req, res, next) => {
  const jsonLogin = req.get('accept')?.includes('application/json');
  const key = req.ip;
  const now = Date.now();
  const attempt = attempts.get(key) || { count: 0, until: now + 10 * 60_000 };
  if (attempt.until < now) { attempt.count = 0; attempt.until = now + 10 * 60_000; }
  if (attempt.count >= 10) {
    const error = 'Có quá nhiều lần đăng nhập sai. Vui lòng thử lại sau ít phút.';
    return jsonLogin ? res.status(429).json({ error }) : res.status(429).render('login', { error, next: safeNext(req.body.next), csrfToken: csrf(req), remember: req.body.remember === 'on', username: String(req.body.username || '') });
  }
  const user = workspace.authenticate(req.body.username, req.body.password);
  if (!user) {
    attempt.count++; attempts.set(key, attempt);
    const error = 'Tài khoản hoặc mật khẩu chưa đúng.';
    return jsonLogin ? res.status(401).json({ error }) : res.status(401).render('login', { error, next: safeNext(req.body.next), csrfToken: csrf(req), remember: req.body.remember === 'on', username: String(req.body.username || '') });
  }
  attempts.delete(key);
  req.session.regenerate(error => {
    if (error) return next(error);
    req.session.user = user;
    csrf(req);
    req.session.save(error => {
      if (error) return next(error);
      try {
        const previous = rememberCookie(req);
        if (previous) workspace.revokeRememberToken(previous);
        res.clearCookie(REMEMBER_COOKIE, rememberOptions(req));
        if (req.body.remember === 'on') {
          res.cookie(REMEMBER_COOKIE, workspace.issueRememberToken(user.username), { ...rememberOptions(req), maxAge: workspace.REMEMBER_MS });
          res.cookie(REMEMBER_USERNAME_COOKIE, user.username, { ...rememberOptions(req), maxAge: workspace.REMEMBER_MS });
        } else res.clearCookie(REMEMBER_USERNAME_COOKIE, rememberOptions(req));
        const destination = safeNext(req.body.next);
        if (jsonLogin) res.json({ redirect: destination });
        else res.redirect(destination);
      } catch (error) { next(error); }
    });
  });
});
router.post('/logout', requireUser, checkCsrf, (req, res, next) => {
  try { workspace.revokeRememberToken(rememberCookie(req)); }
  catch (error) { return next(error); }
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('vncs.sid', { path: '/' });
    res.clearCookie(REMEMBER_COOKIE, rememberOptions(req));
    res.redirect('/login');
  });
});
router.get('/workspace/theme.css', requireUser, (_req, res) => res.type('css').sendFile(path.join(__dirname, '..', 'public', 'workspace-theme.css')));
router.get('/workspace/ui.js', requireUser, (_req, res) => res.type('js').sendFile(path.join(__dirname, '..', 'public', 'workspace-ui.js')));
router.post('/workspace/theme', requireUser, checkCsrf, (req, res) => {
  try { res.json({ theme: workspace.setTheme(req.session.user.username, req.body.theme) }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
router.post('/workspace/messages', requireUser, checkCsrf, (req, res) => {
  if (req.session.user.role !== 'user') return res.status(403).json({ error: 'Chức năng này dành cho user.' });
  try { workspace.addMessage(req.session.user.username, req.body.senderName, req.body.content); res.status(201).json({ ok: true }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
router.get('/admin', requireUser, requireAdmin, (_req, res) => res.render('admin', { modules: workspace.modules(), messages: workspace.messages() }));
router.post('/admin/modules/:id', requireUser, requireAdmin, checkCsrf, (req, res) => {
  try { res.json({ enabled: workspace.setModule(req.params.id, req.body.enabled) }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
router.post('/admin/messages/:id/read', requireUser, requireAdmin, checkCsrf, (req, res) => {
  try { res.json({ message: workspace.markMessage(req.params.id, req.body.read) }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
router.delete('/admin/messages/:id', requireUser, requireAdmin, checkCsrf, (req, res) => {
  try { workspace.deleteMessage(req.params.id); res.json({ ok: true }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

module.exports = { router, restoreRememberedUser, requireUser, requireAdmin, moduleAccess, safeNext };
