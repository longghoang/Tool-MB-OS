const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config/bm02');
const scopeConfig = require('../config/scope-review');

function cookies(initial) {
  const values = new Map(String(initial || '').split(';').map(v => v.trim()).filter(Boolean).map(v => { const i = v.indexOf('='); return [v.slice(0, i), v.slice(i + 1)]; }));
  return { header: () => [...values].map(([k, v]) => `${k}=${v}`).join('; '), update(headers) {
    for (const raw of (Array.isArray(headers) ? headers : headers ? [headers] : [])) {
      const pair = raw.split(';')[0]; const index = pair.indexOf('=');
      if (index > 0) { if (/max-age=0\b/i.test(raw)) values.delete(pair.slice(0, index)); else values.set(pair.slice(0, index), pair.slice(index + 1)); }
    }
  } };
}
function isAuthError(response) {
  if ([401,403].includes(response.status)) return true;
  if ([301,302,303,307,308].includes(response.status) && /login|signin/i.test(response.headers?.location || '')) return true;
  if ([401,403,'401','403'].includes(response.data?.code) || [401,403].includes(response.data?.status)) return true;
  if (typeof response.data === 'string' && /<html|<form/i.test(response.data)) {
    const $ = cheerio.load(response.data);
    if ($('input[type="password"],form[action*="login"]').length) return true;
  }
  return false;
}
function createGateway({ client = axios, settings = config, jcCookie = scopeConfig.cookie } = {}) {
  const jars = { jc: cookies(jcCookie), csd: cookies(settings.csdCookie) };
  const loginLocks = {};
  const generations = { jc: 0, csd: 0 };
  const base = type => type === 'jc' ? settings.jcBase : settings.csdBase;
  async function raw(type, route, data, form = false) {
    try {
      const response = await client.post(base(type) + route, form ? new URLSearchParams(data).toString() : data, {
        headers: { Cookie: jars[type].header(), 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', Origin: base(type), Referer: base(type) + (type === 'jc' ? '/jc/' : '/'), Accept: type === 'jc' ? 'text/html' : 'application/json' },
        timeout: 30000, maxRedirects: 0, maxContentLength: 8 * 1024 * 1024, validateStatus: () => true
      });
      jars[type].update(response.headers?.['set-cookie']);
      return response;
    } catch (error) { throw new Error(`${type === 'jc' ? 'Dịch vụ Phiếu Yêu cầu' : 'CSD'}: không kết nối được${error.code ? ` (${error.code})` : ''}.`); }
  }
  async function rawMultipart(type, route, fields, image) {
    try {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields || {})) form.append(name, String(value));
      if (image?.buffer?.length) form.append('image', new Blob([image.buffer], { type: image.mimetype }), image.originalname);
      const response = await client.post(base(type) + route, form, {
        headers: { Cookie: jars[type].header(), Origin: base(type), Referer: base(type) + '/jc/', Accept: '*/*' },
        timeout: 30000, maxRedirects: 0, maxBodyLength: 12 * 1024 * 1024, maxContentLength: 8 * 1024 * 1024, validateStatus: () => true
      });
      jars[type].update(response.headers?.['set-cookie']);
      return response;
    } catch (error) { throw new Error(`Dịch vụ Phiếu Yêu cầu: không kết nối được${error.code ? ` (${error.code})` : ''}.`); }
  }
  async function login(type) {
    if (loginLocks[type]) return loginLocks[type];
    loginLocks[type] = (async () => {
      const username = settings[type + 'Username'], password = settings[type + 'Password'];
      if (!username || !password) throw new Error(`Thiếu cấu hình đăng nhập ${type.toUpperCase()} trên server.`);
      const response = await raw(type, type === 'jc' ? '/jc/login?next=%2Fjc%2F' : '/api/user/login', { username, password }, type === 'jc');
      const redirectOk = type === 'jc' && [302,303].includes(response.status) && !/login/.test(response.headers?.location || '');
      if ((!redirectOk && response.status !== 200) || isAuthError(response) || response.data?.ok === false || !response.headers?.['set-cookie']) throw new Error(`Đăng nhập ${type.toUpperCase()} không thành công. Kiểm tra tài khoản trên server.`);
      generations[type]++;
    })();
    try { await loginLocks[type]; } finally { delete loginLocks[type]; }
  }
  async function request(type, route, data, form = false, { allowApiFalse = false } = {}) {
    const before = generations[type]; let response = await raw(type, route, data, form);
    if (isAuthError(response)) {
      // Another request may already have refreshed the shared service session.
      if (generations[type] === before || loginLocks[type]) await login(type);
      response = await raw(type, route, data, form);
    }
    if (isAuthError(response)) throw new Error(`${type.toUpperCase()}: phiên đăng nhập không hợp lệ hoặc tài khoản không có quyền.`);
    if (response.status !== 200) throw new Error(`${type.toUpperCase()}: API trả HTTP ${response.status}.`);
    if (response.data?.ok === false && !allowApiFalse) throw new Error(`${type.toUpperCase()}: API không trả dữ liệu thành công.`);
    return response.data;
  }
  async function requestMultipart(type, route, fields, image) {
    const before = generations[type]; let response = await rawMultipart(type, route, fields, image);
    if (isAuthError(response)) {
      if (generations[type] === before || loginLocks[type]) await login(type);
      response = await rawMultipart(type, route, fields, image);
    }
    if (isAuthError(response)) throw new Error(`${type.toUpperCase()}: phiên đăng nhập không hợp lệ hoặc tài khoản không có quyền.`);
    if (response.status < 200 || response.status >= 300) throw new Error(`${type.toUpperCase()}: API trả HTTP ${response.status}.`);
    if (response.data?.ok === false || response.data?.success === false) {
      const message = typeof response.data?.message === 'string' ? response.data.message.trim().slice(0, 300) : '';
      throw new Error(message ? `${type.toUpperCase()}: ${message}` : `${type.toUpperCase()}: API không xác nhận thêm comment.`);
    }
    return response.data;
  }
  return {
    getIssue: number => request('jc', '/jc/', { pyc: number }, true),
    getNotifications: page => request('csd', '/api/notification/get-list', { page, size: 200 }),
    getBm02Tasks: () => request('csd', '/api/task/getOwnList', { status: 'processing' }),
    getFolderTree: () => request('csd', '/api/assets/get-folder-tree', {}),
    getDraft: id => request('csd', '/api/draft/getMyListById/' + encodeURIComponent(id), null),
    addJcComment: ({ pyc, comment, image }) => requestMultipart('jc', '/jc/comment/add', { pyc, comment }, image),
    // CSD can reply { ok: false } after persisting an update. The caller
    // verifies the saved draft before treating that response as success.
    addMultiple: payload => request('csd', '/api/draft/addMultiple', payload, false, { allowApiFalse: true })
  };
}
module.exports = { createGateway, isAuthError };
