const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('../services/bm02Review.service');
const scope = require('../services/scopeReview.service');
const issue = { number: '20561', systemName: 'AI Platform', status: 'In Progress', inProgress: true };
const draft = () => ({ checklist: '<p>Kiểm tra phân quyền</p>', is_public_internet: false, feature_public_internet: false, have_financial_transactions: true, platform: Object.keys(s.PLATFORMS).filter(k => ['web','api'].includes(s.PLATFORMS[k])), server_api: [{ api: 'https://uat.test/v1/orders', env: false }] });
const bm01 = () => ({ fields: { publicInternet: 'no', internetImpact: 'no', financialTransactions: 'yes', web: 'yes', api: 'yes', mobile: 'no', other: 'no', applicationAccount: 'present', appTest: 'missing' }, ...s.parseApis('POST /v1/orders') });
const check = (result, code) => result.checks.find(c => c.code === code).status;

test('BM02 readiness requires every comparison and an In Progress issue', () => {
  assert.equal(s.compare(bm01(), draft(), issue).ready, true);
  assert.ok(!s.compare(bm01(), draft(), issue).checks.some(c => c.code === 'bm01Identity'));
  for (const status of ['Backlog','Waiting','Done','']) {
    const parsed = s.parseIssue(`<h1>PENTEST-20561: Test <span>${status}</span></h1><p><strong>Hệ thống:</strong> AI Platform</p>`, '20561');
    const result = s.compare(bm01(), draft(), parsed);
    assert.equal(result.ready, false); assert.equal(check(result, 'requestStatus'), 'alert');
    assert.equal(result.matched, true);
  }
  for (const status of ['In Progress','Inprogress',' in   PROGRESS ']) assert.equal(s.parseIssue(`<h1>PENTEST-20561 <span>${status}</span></h1>`, '20561').inProgress, true);
  assert.throws(() => s.parseIssue('<h1>PENTEST-205610 <span>In Progress</span></h1>', '20561'));
});

test('Internet, finance and platform mismatches cannot pass', () => {
  for (const field of ['is_public_internet','feature_public_internet','have_financial_transactions']) {
    const d = draft(); d[field] = !d[field]; assert.equal(check(s.compare(bm01(), d, issue), field), 'alert');
    delete d[field]; assert.equal(check(s.compare(bm01(), d, issue), field), 'alert');
  }
  const b = bm01(); b.fields.internetImpact = 'yes'; const d = draft(); d.feature_public_internet = true;
  assert.equal(check(s.compare(b, d, issue), 'internetConsistency'), 'alert');
  for (const field of ['publicInternet','internetImpact','financialTransactions','web','api','mobile','other','applicationAccount']) { const b = bm01(); b.fields[field] = 'unknown'; assert.equal(s.compare(b, draft(), issue).ready, false); }
  for (const platform of [[],null,['unknown-id'],[Object.keys(s.PLATFORMS)[0]]]) { const d = draft(); d.platform = platform; assert.equal(s.compare(bm01(), d, issue).ready, false); }
});

test('Empty checklist variants alert; actual checklist text passes', () => {
  for (const checklist of [null, '', ' ', '<p><br></p>', '<p>&nbsp;</p>', '[]', [], {}, { id: 'uuid', checked: false }]) {
    assert.equal(check(s.compare(bm01(), { ...draft(), checklist }, issue), 'checklist'), 'alert');
  }
  assert.equal(s.meaningful([{ title: 'Ứng dụng', content: '<p>Kiểm tra session</p>' }]), true);
});

test('BM01 application account is required and App test is required only when APP is selected', () => {
  const base = bm01();
  assert.equal(check(s.compare(base, draft(), issue), 'applicationAccount'), 'pass');
  assert.equal(check(s.compare(base, draft(), issue), 'appTest'), 'pass');
  const missingAccount = { ...base, fields: { ...base.fields, applicationAccount: 'missing' } };
  assert.equal(check(s.compare(missingAccount, draft(), issue), 'applicationAccount'), 'alert');
  const appMissing = { ...base, fields: { ...base.fields, mobile: 'yes', appTest: 'missing' } };
  assert.equal(check(s.compare(appMissing, { ...draft(), platform: [...draft().platform, '5d37739c-ad20-43d8-be7b-a4c2a10a6c09'] }, issue), 'appTest'), 'alert');
  const appPresent = { ...base, fields: { ...base.fields, mobile: 'yes', appTest: 'present' } };
  assert.equal(check(s.compare(appPresent, { ...draft(), platform: [...draft().platform, '5d37739c-ad20-43d8-be7b-a4c2a10a6c09'] }, issue), 'appTest'), 'pass');
});

test('BM01 sections distinguish filled application accounts from a blank App test cell', () => {
  const blocks = [
    'Hệ thống phát triển trên nền tảng', '| ☑ Web', '| ☑ APP', '| ☑ API', '| ☐ Khác',
    'Thông tin về tài khoản ứng dụng (nếu có)', '| SC', 'GDV: tester1 / 1', 'App Retail sẽ tạo tài khoản theo từng yêu cầu.', '|',
    'App test (nếu có)', '| |', 'Dữ liệu input test', '| Mô tả trong thiết kế chi tiết'
  ].map((text, index) => ({ id: `BM01:L${index + 1}`, text }));
  const extracted = s.extractBm01Deterministic({ blocks });
  assert.equal(extracted.fields.mobile, 'yes');
  assert.equal(extracted.fields.applicationAccount, 'present');
  assert.equal(extracted.fields.appTest, 'missing');
});

test('API matching preserves versions, methods and hosts, and detects incomplete or ambiguous lists', () => {
  const diff = (a,b) => s.compareApis(s.parseApis(a).apis, s.parseApis(b).apis);
  assert.equal(diff('GET /v1/orders/{id}', 'GET https://uat.test/v1/orders/{orderId}?test=1').match, true);
  assert.equal(diff('GET /v1/orders', 'POST /v1/orders').match, false);
  assert.equal(diff('GET /v1/orders', 'GET /v2/orders').match, false);
  assert.equal(diff('https://one.test/api', 'https://two.test/api').match, false);
  assert.equal(diff('GET /api\nPOST /api', '/api').match, false);
  assert.equal(diff('https://one.test/api\nhttps://two.test/api', '/api').match, false);
  assert.equal(diff('/api', '/api\n/extra').extra.length, 1);
  assert.equal(diff('/api\n/missing', '/api').missing.length, 1);
  assert.equal(s.parseApis([{ api: 'https://one.test/api', env: false }, { api: 'https://two.test/api', env: false }]).apis.length, 2);
  assert.equal(s.compare(bm01(), { ...draft(), server_api: ['/v1/orders', 'unreadable entry'] }, issue).ready, false);
  const sameCount = s.compare(bm01(), { ...draft(), server_api: ['/different'] }, issue);
  assert.equal(check(sameCount, 'server_api'), 'pass');
  assert.deepEqual(sameCount.apiCounts, { bm01: 1, bm02: 1, complete: true });
  assert.equal(sameCount.checks.find(c => c.code === 'server_api').detail, 'BM01: 1 API · BM02: 1 API. Số lượng khớp.');
  const differentCount = s.compare(bm01(), { ...draft(), server_api: ['/first','/second'] }, issue);
  assert.equal(check(differentCount, 'server_api'), 'alert');
  assert.equal(differentCount.checks.find(c => c.code === 'server_api').detail, 'BM01: 1 API · BM02: 2 API. Chênh lệch 1 API.');
  const multipleMethods = { ...bm01(), ...s.parseApis('GET /api/langfuse/{path:path}\nPOST /api/langfuse/{path:path}\nPUT /api/langfuse/{path:path}\nDELETE /api/langfuse/{path:path}\nPATCH /api/langfuse/{path:path}') };
  const deduplicated = s.compare(multipleMethods, { ...draft(), server_api: ['GET https://uat.test/api/langfuse/{path:path}', 'POST https://uat.test/api/langfuse/%7Bpath:path%7D', 'https://uat.test/api/langfuse/{path:path}'] }, issue);
  assert.deepEqual(deduplicated.apiCounts, { bm01: 1, bm02: 1, complete: true });
  assert.equal(check(deduplicated, 'server_api'), 'pass');
  const differentPaths = s.parseApis('GET https://one.test/v1/api\nPOST https://one.test/v1/api\nGET https://two.test/v1/api\nGET https://one.test/v2/api\nGET https://one.test/v1/API');
  const distinct = s.compare({ ...bm01(), ...differentPaths }, { ...draft(), server_api: ['/one','/two','/three','/four'] }, issue);
  assert.deepEqual(distinct.apiCounts, { bm01: 4, bm02: 4, complete: true });
  const differentSchemes = s.parseApis('GET http://one.test/v1/api\nGET https://one.test/v1/api');
  assert.deepEqual(differentSchemes.apis.map(a => a.protocol), ['http:', 'https:']);
  assert.equal(s.compare({ ...bm01(), ...differentSchemes }, { ...draft(), server_api: ['http://one.test/v1/api'] }, issue).apiCounts.bm01, 2);
  const incomplete = s.compare(multipleMethods, { ...draft(), server_api: ['/api/langfuse/{path:path}', 'unreadable entry'] }, issue);
  assert.equal(check(incomplete, 'server_api'), 'alert');
});

test('BM01 API table is authoritative and normalizes URL-base rows before de-duplication', () => {
  const blocks = [
    { id: 'BM01:L1', text: 'Danh sách API / Web Service' },
    { id: 'BM01:L2', text: 'Url-base: https://pams-uat.mbbank.com.vn' },
    { id: 'BM01:L3', text: '- POST: {Url-base} /v1.0/ voucher' },
    { id: 'BM01:L4', text: '- PUT: { Url-base} /v1.0/ voucher' },
    { id: 'BM01:L5', text: '- GET: {Url-base} /v1.0/voucher/detail/{id}' },
    { id: 'BM01:L6', text: '- POST: {Url-base} / v1.0/voucher/payment/create' },
    { id: 'BM01:L7', text: '- DELETE: {Url-base} /v1.0/voucher/payment/delete' },
    { id: 'BM01:L8', text: 'Thông tin về tài khoản ứng dụng (nếu có)' }
  ];
  const listed = s.extractScopeApis(blocks);
  assert.equal(listed.found, true); assert.equal(listed.apis.length, 5); assert.equal(listed.unparsed, 0);
  const bm = { fields: { publicInternet: 'no', internetImpact: 'no', financialTransactions: 'no', web: 'no', api: 'yes', mobile: 'no', other: 'no', applicationAccount: 'present', appTest: 'missing' }, apis: listed.apis, unparsed: listed.unparsed };
  const d = { ...draft(), is_public_internet: false, feature_public_internet: false, have_financial_transactions: false, platform: ['b7d592dd-907f-4e70-8986-d18dff9eee0b'], server_api: listed.apis.map(a => `${a.method} https://pams-uat.mbbank.com.vn${a.path}`) };
  const result = s.compare(bm, d, issue);
  assert.deepEqual(result.apiCounts, { bm01: 4, bm02: 4, complete: true });
  assert.equal(check(result, 'server_api'), 'pass');
});

test('BM01 API descriptions are not appended to URLs, including colon-separated rows', () => {
  const blocks = [
    { id: 'BM01:L1', text: 'Danh sách API / Web Service' },
    { id: 'BM01:L2', text: 'POST http://10.4.236.98:10002/mb-website-cms/v1/content-version/preview-token - Tạo token xem lại phiên bản cũ' },
    { id: 'BM01:L3', text: 'GET: http://10.4.236.98:10003/mb-website-public/v1/image-gallery/folders: lấy danh sách folder public' },
    { id: 'BM01:L4', text: 'Thông tin về tài khoản ứng dụng' }
  ];
  const listed = s.extractScopeApis(blocks);
  assert.equal(listed.unparsed, 0);
  assert.deepEqual(listed.apis.map(a => `${a.method} ${a.host}${a.path}`), [
    'POST 10.4.236.98:10002/mb-website-cms/v1/content-version/preview-token',
    'GET 10.4.236.98:10003/mb-website-public/v1/image-gallery/folders'
  ]);
  assert.deepEqual(listed.apis.map(a => a.protocol), ['http:', 'http:']);
});

test('BM01 API table pairs a URL column with its separate method column and curl rows', () => {
  const blocks = [
    { id: 'BM01:L1', text: 'Danh sách API / Web Service' },
    { id: 'BM01:L2', text: 'https://admin-dev-lab.mbbank.com.vn/api/v1/system-prompts/{id} (https://admin-dev-lab.mbbank.com.vn/api/v1/system-prompts/%7Bid%7D)' },
    { id: 'BM01:L3', text: '| GET' },
    { id: 'BM01:L4', text: '| Chi tiết System Prompt' },
    { id: 'BM01:L5', text: 'https://admin-dev-lab.mbbank.com.vn/api/v1/system-prompts/{id}' },
    { id: 'BM01:L6', text: '| DELETE' },
    { id: 'BM01:L7', text: "curl 'https://admin-dev-lab.mbbank.com.vn/api/v1/partners/search' \\" },
    { id: 'BM01:L8', text: "-H 'origin: https://admin-dev-lab.mbbank.com.vn' \\" },
    { id: 'BM01:L9', text: '| POST' },
    { id: 'BM01:L10', text: 'Thông tin về tài khoản ứng dụng' }
  ];
  const listed = s.extractScopeApis(blocks);
  assert.equal(listed.unparsed, 0);
  assert.deepEqual(listed.apis.map(api => `${api.method} ${api.host}${api.path}`), [
    'GET admin-dev-lab.mbbank.com.vn/api/v1/system-prompts/%7Bid%7D',
    'DELETE admin-dev-lab.mbbank.com.vn/api/v1/system-prompts/%7Bid%7D',
    'POST admin-dev-lab.mbbank.com.vn/api/v1/partners/search'
  ]);
  assert.deepEqual([...new Set(listed.apis.map(api => `${api.host}${api.path}`))], [
    'admin-dev-lab.mbbank.com.vn/api/v1/system-prompts/%7Bid%7D',
    'admin-dev-lab.mbbank.com.vn/api/v1/partners/search'
  ]);
});

test('BM01 API scope accepts relative paths and full URLs without methods, strips Word link copies, and excludes URL base', () => {
  const blocks = [
    { id: 'BM01:L1', text: 'Danh sách API / Web Service' },
    { id: 'BM01:L2', text: 'URL Base: https://devsmartbpm.mbbank.com.vn' },
    { id: 'BM01:L3', text: '/api/v1/test' },
    { id: 'BM01:L4', text: 'https\\://test.example/api/ok' },
    { id: 'BM01:L5', text: 'POST - https://devsmartbpm.mbbank.com.vn/api/sync (%20https://devsmartbpm.mbbank.com.vn/api/sync)' },
    { id: 'BM01:L6', text: 'Thông tin về tài khoản ứng dụng' }
  ];
  const listed = s.extractScopeApis(blocks);
  assert.equal(listed.unparsed, 0);
  assert.deepEqual(listed.apis.map(api => `${api.method || '-'} ${api.host}${api.path}`), [
    '- devsmartbpm.mbbank.com.vn/api/v1/test',
    '- test.example/api/ok',
    'POST devsmartbpm.mbbank.com.vn/api/sync'
  ]);
  assert.equal(listed.apis.some(api => api.path === '/'), false);
});

test('Note BM02 reads explicit BM01 choices and API scope without calling AI', async () => {
  const blocks = [
    'Dịch vụ có giao dịch tài chính', '| ☐ Yes', '| ☒ No',
    'Hệ thống phát triển trên nền tảng', '| ☒ Web', '| ☐ APP', '| ☒ API', '| ☐ Khác',
    'Hệ thống public internet', '| ☒ Yes', '| ☐ No',
    'Hệ thống phát triển có ảnh hưởng tới các tính năng ngoài internet', '| ☒ Yes', '| ☐ No',
    'Danh sách API / Web Service',
    'GET https://uat.example.test/api/users - Tra cứu người dùng',
    'POST https://uat.example.test/api/users - Tạo người dùng',
    'Thông tin về tài khoản ứng dụng', '| tester / password', 'App test (nếu có)', '| |', 'Dữ liệu input test'
  ].map((text, i) => ({ id: `BM01:L${i+1}`, text }));
  const result = await s.extractBm01({ id: 'BM01', blocks }, '20788', async () => {}, async () => { throw new Error('AI must not be called'); });
  assert.deepEqual(result.fields, { publicInternet: 'yes', internetImpact: 'yes', financialTransactions: 'no', mobile: 'no', web: 'yes', api: 'yes', other: 'no', applicationAccount: 'present', appTest: 'missing' });
  assert.equal(result.apis.length, 2);
  assert.equal(result.unparsed, 0);
});

test('Only AI no-response can use partial deterministic fallback; unknown stays unknown', async () => {
  const blocks = [
    { id: 'BM01:L1', text: 'Hệ thống public internet' },
    { id: 'BM01:L2', text: '| ☐ Yes' },
    { id: 'BM01:L3', text: '| ☒ No' },
    { id: 'BM01:L4', text: 'Danh sách API / Web Service' },
    { id: 'BM01:L5', text: 'GET https://uat.example.test/api/users - Tra cứu người dùng' }
  ];
  const source = { id: 'BM01', blocks };
  const networkError = Object.assign(new Error('AI connection timed out'), { code: 'AI_NETWORK_ERROR' });
  const partial = await s.extractBm01(source, '20788', async () => {}, async () => { throw networkError; });
  assert.equal(partial.fields.publicInternet, 'no');
  assert.equal(partial.fields.internetImpact, 'unknown');
  assert.equal(partial.fields.financialTransactions, 'unknown');
  assert.equal(partial.fields.web, 'unknown');
  assert.deepEqual(partial.apis.map(a => a.path), ['/api/users']);
  let prompt;
  await s.extractBm01(source, '20788', async () => {}, async value => { prompt = value; return { fields: {}, apis: [] }; });
  assert.ok(!prompt.includes('Tra cứu người dùng'));
  await assert.rejects(s.extractBm01(source, '20788', async () => {}, async () => { throw new Error('AI trả HTTP 429'); }), /HTTP 429/);
});

test('Task full_draft_id resolves BM02 despite unrelated notification IDs; exact request only', async () => {
  const id = 'df667e14-614a-4f01-96ed-38dd78e7e73d'; let called;
  const api = {
    getNotifications: async () => ({ data: { results: [{ id: 'notification-id', content: 'BM02 PENTEST 20561' }], total: 1 } }),
    getBm02Tasks: async () => ({ data: [{ task_name: 'PENTEST 205610', full_draft_id: 'wrong' }, { task_name: 'PENTEST 20561 - System', full_draft_id: id }] }),
    getDraft: async value => { called = value; return { data: draft() }; }
  };
  const result = await s.locateDraft('20561', api); assert.equal(called, id); assert.equal(result.via, 'task');
  assert.equal(s.matchesNumber('PENTEST 205610', '20561'), false);
  assert.equal(s.matchesNumber('PENTEST-20561', '20561'), true);
  api.getBm02Tasks = async () => ({ data: [{ task_name: 'PENTEST 20561' }, { task_name: 'PENTEST 20561' }] });
  await assert.rejects(s.locateDraft('20561', api), /nhiều task/);
});

test('Notifications paginate and retrieval errors or wrong draft identity cannot create readiness', async () => {
  const pages = [];
  const api = { getNotifications: async p => { pages.push(p); return { data: { total: 201, results: p === 1 ? Array.from({ length: 200 }, () => ({ content: 'PENTEST 205610', id: 'wrong' })) : [{ content: 'BM02 PENTEST-20561', id: 'right' }] } }; }, getDraft: async id => { assert.equal(id, 'right'); return { data: draft() }; } };
  assert.equal((await s.locateDraft('20561', api)).draftId, 'right'); assert.deepEqual(pages, [1,2]);
  api.getDraft = async () => { throw new Error('CSD: API trả HTTP 400.'); };
  await assert.rejects(s.locateDraft('20561', api), /HTTP 400/);
  assert.throws(() => s.draftFrom({ data: { ...draft(), pyc: '205610' } }, '20561'), /không có BM02/);
  assert.throws(() => s.draftFrom({ data: [draft(), draft()] }, '20561'), /nhiều bản/);
});

test('BM01 extraction rejects invented evidence and conflicting checkboxes', async () => {
  const source = { id: 'BM01', ...scope.documentContent('<p>Phiếu Yêu cầu 20561</p><p>Hệ thống public internet: ☑ NO ☐ YES</p><p>POST /v1/orders</p>', 'BM01') };
  const proof = index => [{ sourceId: source.blocks[index].id, quote: source.blocks[index].text }];
  const extracted = await s.extractBm01(source, '20561', async () => {}, async () => ({ fields: { publicInternet: { value: 'no', evidence: proof(1) }, internetImpact: { value: 'yes', evidence: [{ sourceId: 'BM01:L2', quote: 'invented' }] } }, apis: [{ method: 'POST', path: '/v1/orders', evidence: proof(2) }, { path: '/invented', evidence: [] }] }));
  assert.equal(extracted.fields.publicInternet, 'no'); assert.equal(extracted.fields.internetImpact, 'unknown');
  assert.equal(extracted.apis.length, 1); assert.equal(extracted.unparsed, 1); assert.equal(extracted.requestNumbers, undefined);
});

test('BM01 checkbox rows override an AI reversal for the two Internet fields', async () => {
  const blocks = [
    { id: 'BM01:L1', text: 'Hệ thống public internet' },
    { id: 'BM01:L2', text: '| ☐ Yes' },
    { id: 'BM01:L3', text: '| ☑ No' },
    { id: 'BM01:L4', text: 'Hệ thống phát triển có ảnh hưởng tới các tính năng ngoài internet' },
    { id: 'BM01:L5', text: '| ☐ Yes' },
    { id: 'BM01:L6', text: '| ☑ No' }
  ];
  const source = { id: 'BM01', blocks };
  const result = await s.extractBm01(source, '20561', async () => {}, async () => ({ fields: {
    publicInternet: { value: 'yes', evidence: [{ sourceId: 'BM01:L2', quote: '| ☐ Yes' }] },
    internetImpact: { value: 'yes', evidence: [{ sourceId: 'BM01:L5', quote: '| ☐ Yes' }] }
  }, apis: [{ path: '/orders', evidence: [{ sourceId: 'BM01:L1', quote: 'Hệ thống public internet' }] }] }));
  assert.equal(result.fields.publicInternet, 'no');
  assert.equal(result.fields.internetImpact, 'no');
});

test('Issue status is published before BM02 fetch or AI failure', async () => {
  const updates = []; let extracted = false;
  await assert.rejects(s.run({ bm01: {}, number: '20561' }, async (...args) => updates.push(args), { api: { getIssue: async () => '<h1>PENTEST-20561 <span>Backlog</span></h1><p><strong>Hệ thống:</strong> AI Platform</p>', getNotifications: async () => { throw new Error('offline'); } }, extract: async () => { extracted = true; } }), /offline/);
  assert.equal(updates.find(u => u[2])?.[2].status, 'Backlog'); assert.equal(extracted, false);
});
