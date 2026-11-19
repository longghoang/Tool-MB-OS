const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGateway } = require('../services/bm02Gateway.service');
const settings = { jcBase: 'http://jc.test', csdBase: 'https://csd.test', jcUsername: 'test-jc', jcPassword: 'test-secret', csdUsername: 'test-csd', csdPassword: 'test-secret', csdCookie: 'SESSION=old; POOL=pool' };

test('CSD refresh merges cookies and retries the original POST exactly once', async () => {
  const calls = [];
  const api = createGateway({ settings, client: { post: async (url, body, options) => {
    calls.push(url); assert.equal(options.maxRedirects, 0);
    if (calls.length === 1) return { status: 401, headers: { 'set-cookie': ['SESSION=; Max-Age=0'] } };
    if (url.endsWith('/user/login')) { assert.deepEqual(body, { username: 'test-csd', password: 'test-secret' }); return { status: 200, headers: { 'set-cookie': ['SESSION=fresh; Path=/', 'USERID=user; Path=/'] }, data: { ok: true } }; }
    assert.match(options.headers.Cookie, /SESSION=fresh/); assert.match(options.headers.Cookie, /POOL=pool/); assert.deepEqual(body, { page: 2, size: 200 });
    return { status: 200, data: { data: { results: [] } } };
  } } });
  await api.getNotifications(2); assert.equal(calls.length, 3);
});

test('addMultiple sends the prepared Note BM02 payload to the draft endpoint', async () => {
  let call;
  const api = createGateway({ settings, client: { post: async (url, body, options) => { call = { url, body, options }; return { status: 200, data: { ok: true } }; } } });
  const payload = { taskId: 'e60c8940-c0b1-4e33-b4c8-196164ffdb9b', server_api: [{ api: 'https://api.test/v1/orders', env: false }], drafts: [] };
  assert.deepEqual(await api.addMultiple(payload), { ok: true });
  assert.equal(call.url, 'https://csd.test/api/draft/addMultiple');
  assert.deepEqual(call.body, payload);
  assert.match(call.options.headers.Cookie, /SESSION=old/);
});

test('addMultiple returns CSD ok:false for the note service to verify by rereading the draft', async () => {
  const api = createGateway({ settings, client: { post: async () => ({ status: 200, data: { ok: false, message: 'Saved asynchronously' } }) } });
  assert.deepEqual(await api.addMultiple({ taskId: 'e60c8940-c0b1-4e33-b4c8-196164ffdb9b' }), { ok: false, message: 'Saved asynchronously' });
  await assert.rejects(api.getFolderTree(), /không trả dữ liệu thành công/);
});

test('getFolderTree posts an empty JSON object and uses the CSD session refresh', async () => {
  const calls = [];
  const tree = { data: [{ service_id: '64eeb45d-a26a-4204-9288-42199ffa87fd', service_name: 'EMB Cam' }] };
  const api = createGateway({ settings, client: { post: async (url, body, options) => {
    calls.push({ url, body, options });
    if (url.endsWith('/api/user/login')) return { status: 200, headers: { 'set-cookie': ['SESSION=fresh; Path=/'] }, data: { ok: true } };
    if (calls.length === 1) return { status: 401, data: { code: 401 } };
    return { status: 200, data: tree };
  } } });
  assert.deepEqual(await api.getFolderTree(), tree);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://csd.test/api/assets/get-folder-tree');
  assert.deepEqual(calls[0].body, {});
  assert.deepEqual(calls[2].body, {});
  assert.equal(calls[2].options.headers['Content-Type'], 'application/json');
  assert.match(calls[2].options.headers.Cookie, /SESSION=fresh/);
});

test('JC login redirect refreshes cookie; form request uses the entered number', async () => {
  let count = 0;
  const api = createGateway({ settings, jcCookie: 'session=expired', client: { post: async (url, body, options) => {
    count++;
    if (count === 1) return { status: 200, data: '<html><form><input type="password"></form></html>' };
    if (url.includes('/login')) { assert.equal(body, 'username=test-jc&password=test-secret'); return { status: 302, headers: { location: '/jc/', 'set-cookie': ['session=fresh; HttpOnly'] } }; }
    assert.equal(body, 'pyc=20561'); assert.equal(options.headers.Cookie, 'session=fresh');
    return { status: 200, data: '<h1>PENTEST-20561</h1>' };
  } } });
  await api.getIssue('20561'); assert.equal(count, 3);
});

test('Bad login or repeated authorization failure is bounded and never leaks credentials', async () => {
  let count = 0;
  const api = createGateway({ settings, client: { post: async () => { count++; return { status: 401 }; } } });
  await assert.rejects(api.getDraft('test'), error => !error.message.includes('test-secret') && /Đăng nhập/.test(error.message)); assert.equal(count, 2);
  const offline = createGateway({ settings, client: { post: async () => { const e = new Error('SECRET request headers'); e.code = 'ETIMEDOUT'; throw e; } } });
  await assert.rejects(offline.getNotifications(1), error => error.message.includes('ETIMEDOUT') && !error.message.includes('SECRET'));
});

test('Concurrent expired requests share a login', async () => {
  let logins = 0;
  const api = createGateway({ settings, client: { post: async (url, body, options) => {
    if (url.endsWith('/user/login')) { logins++; await new Promise(r => setTimeout(r, 10)); return { status: 200, headers: { 'set-cookie': ['SESSION=fresh'] } }; }
    return options.headers.Cookie.includes('SESSION=fresh') ? { status: 200, data: { ok: true } } : { status: 401 };
  } } });
  await Promise.all([api.getNotifications(1), api.getNotifications(2)]); assert.equal(logins, 1);
});

test('addJcComment sends PYC, comment and image as multipart form data', async () => {
  let call;
  const api = createGateway({ settings, jcCookie: 'session=ready', client: { post: async (url, body, options) => {
    call = { url, body, options };
    return { status: 200, data: { success: true } };
  } } });
  const image = { originalname: 'poc.png', mimetype: 'image/png', buffer: Buffer.from('89504e470d0a1a0a00000000', 'hex') };
  assert.deepEqual(await api.addJcComment({ pyc: 'PENTEST-20784', comment: 'Nội dung kiểm thử', image }), { success: true });
  assert.equal(call.url, 'http://jc.test/jc/comment/add');
  assert.equal(call.body.get('pyc'), 'PENTEST-20784');
  assert.equal(call.body.get('comment'), 'Nội dung kiểm thử');
  assert.equal(call.body.get('image').name, 'poc.png');
  assert.equal(call.body.get('image').type, 'image/png');
  assert.equal(call.options.headers['Content-Type'], undefined);
  assert.equal(call.options.headers.Cookie, 'session=ready');
});
