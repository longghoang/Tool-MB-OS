const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const express = require('express');
const session = require('express-session');
const fs = require('fs/promises');
const path = require('path');
const service = require('../services/scopeReview.service');

async function docx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>BM01 - Phạm vi kiểm thử UAT</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>POST</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>/v1/orders</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('Input keeps hyphens in PYC and page ID; accepts Confluence URLs and rejects duplicates', () => {
  assert.deepEqual(service.parseEntries('20608 - 895978834'), [{ pyc: '20608', pageId: '20608-895978834' }]);
  assert.deepEqual(service.parseEntries('20608 - 20608-895978834'), [{ pyc: '20608', pageId: '20608-895978834' }]);
  assert.throws(() => service.parseEntries('20608 - 895978834\n20608 - 20608-895978834'));
  assert.deepEqual(service.parseEntries('PYC-123 - 20608-895978834'), [{ pyc: 'PYC-123', pageId: '20608-895978834' }]);
  assert.deepEqual(service.parseEntries('20608-895978834'), [{ pyc: '20608', pageId: '20608-895978834' }]);
  assert.deepEqual(service.parseEntries('20608 -895978834'), [{ pyc: '20608', pageId: '20608-895978834' }]);
  assert.deepEqual(service.parseEntries('20608- 895978834'), [{ pyc: '20608', pageId: '20608-895978834' }]);
  assert.deepEqual(service.parseEntries('123-20608-895978834'), [{ pyc: '123', pageId: '20608-895978834' }]);
  assert.deepEqual(service.parseEntries('20602-https://confluence.mbbank.com.vn/display/ORS/ms109-api-f88-preapp-limit'), [{ pyc: '20602', pageId: '20602-https://confluence.mbbank.com.vn/display/ORS/ms109-api-f88-preapp-limit', referenceUrl: 'https://confluence.mbbank.com.vn/display/ORS/ms109-api-f88-preapp-limit' }]);
  assert.deepEqual(service.parseEntries('20602 - [https://confluence.mbbank.com.vn/display/ORS/ms109-api-f88-preapp-limit]')[0].pageId, '20602-https://confluence.mbbank.com.vn/display/ORS/ms109-api-f88-preapp-limit');
  assert.throws(() => service.parseEntries('123 - id\n123 - id'));
});

test('HTML has traceable table text, no active content, and warns for diagrams', () => {
  const doc = service.documentContent('<h1>PYC thay đổi API</h1><table><tr><td>POST</td><td>/orders</td></tr></table><img src="https://evil.test/a"><script>bad()</script><p onclick="bad()">Ghi chú nghiệp vụ</p>', 'DOC1');
  assert.ok(doc.blocks.some(b => b.text.includes('POST | /orders')));
  assert.ok(!/script|onclick|<img/.test(doc.html));
  assert.ok(doc.warnings[0].includes('chưa được đọc'));
  assert.equal(doc.sha256.length, 64);
  const linked = service.documentContent('<p>Tài liệu đặc tả: <a href="https://docs.example.test/spec">Xem tại đây</a></p>', 'BM01');
  assert.ok(linked.blocks.some(b => b.text.includes('https://docs.example.test/spec')));
});

test('DOCX conversion preserves actual scope table and rejects broken inputs', async () => {
  const doc = await service.readBm01({ originalname: 'BM01.docx', buffer: await docx() });
  assert.match(doc.html, /<table>/);
  assert.ok(doc.blocks.some(b => b.text.includes('/v1/orders')));
  await assert.rejects(service.readBm01({ originalname: 'BM01.docx', buffer: Buffer.from('x') }), /DOCX/);
  const zip = await JSZip.loadAsync(await docx());
  const xml = await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml', xml.replace('</w:body>', '<w:p><w:r><w:sym w:font="Wingdings" w:char="F0FE"/><w:t>Pentest Hạ tầng</w:t></w:r></w:p></w:body>'));
  const checked = await service.readBm01({ originalname: 'BM01.docx', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  assert.ok(checked.blocks.some(b => b.text.includes('☑') && b.text.includes('Pentest Hạ tầng')));
});

test('Uploaded DOCX references become analysis sources and unsupported files are rejected', async () => {
  const reference = await service.readReferenceFile({ originalname: 'spec.docx', buffer: await docx() }, 0);
  assert.equal(reference.id, 'REF1');
  assert.equal(reference.kind, 'document');
  assert.equal(reference.origin, 'upload');
  assert.ok(reference.blocks.some(b => b.text.includes('/v1/orders')));
  await assert.rejects(service.readReferenceFile({ originalname: 'spec.txt', buffer: Buffer.from('text') }), /DOCX|PDF/);
});

test('Document fetch sends exact pageId and refuses login/redirect/non-HTML', async () => {
  const entry = service.parseEntries('20608 - 895978834')[0];
  const good = await service.fetchDocument(entry, 0, { get: async (url, options) => {
    assert.equal(options.params.pageId, '20608-895978834'); assert.equal(options.maxRedirects, 0);
    return { status: 200, headers: { 'content-type': 'text/html' }, data: '<h1>Tài liệu phát triển API POST /orders</h1>' };
  } });
  assert.equal(good.error, undefined);
  const urlEntry = service.parseEntries('20602-https://confluence.mbbank.com.vn/display/ORS/ms109-api-f88-preapp-limit')[0];
  const urlDoc = await service.fetchDocument(urlEntry, 0, { get: async (url, options) => {
    assert.equal(options.params.pageId, '20602-https://confluence.mbbank.com.vn/display/ORS/ms109-api-f88-preapp-limit');
    return { status: 200, headers: { 'content-type': 'text/html' }, data: '<h1>Tài liệu API POST /orders từ URL</h1>' };
  } });
  assert.equal(urlDoc.error, undefined);
  const denied = await service.fetchDocument(entry, 0, { get: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, data: '<title>Yêu cầu phê duyệt - Tool Support OS</title><h1>PageID chưa được phê duyệt</h1><p>Bạn không có quyền truy cập trang này.</p>' }) });
  assert.match(denied.error, /phê duyệt/);
  assert.equal(denied.blocks, undefined);
  assert.equal(denied.html, undefined);
  for (const response of [{ status: 302, headers: {}, data: '' }, { status: 200, headers: { 'content-type': 'text/html' }, data: '<form><input type="password"></form>' }, { status: 200, headers: { 'content-type': 'application/json' }, data: '{}' }]) {
    const result = await service.fetchDocument(entry, 0, { get: async () => response }); assert.ok(result.error);
  }
});

test('Match distinguishes versions, references, method mismatch, and missing scope', () => {
  const api = (source, method, path, change = 'modified') => ({ source, method, path, change, evidence: [] });
  const result = service.deterministicCompare([
    api('BM01','GET','/v1/orders/{id}'), api('DOC1','GET','/v1/orders/{orderId}'),
    api('DOC1','POST','/v1/orders/{id}'), api('DOC1','GET','/v2/orders/{id}'), api('DOC1','GET','/legacy','reference')
  ]);
  assert.match(result[0].status, /Khớp/); assert.match(result[1].status, /Mâu thuẫn/); assert.match(result[2].status, /thiếu scope/); assert.equal(result[3].status, 'Tham khảo');
});

test('Large explicit BM01 API scope is parsed directly while AI keeps the business analysis', async () => {
  const apiRows = Array.from({ length: 90 }, (_, index) => `<p>GET /api/orders/${index + 1} - Mô tả endpoint ${index + 1}</p>`).join('');
  const html = `<h2>Danh sách API / Web Service</h2><p>GET http://internal.test/api/orders/0 - Endpoint nội bộ</p>${apiRows}<h2>Mô tả chức năng mới của hệ thống</h2><p>Thêm luồng đồng bộ đơn hàng và kiểm tra trạng thái.</p>`;
  const sources = [{ id: 'BM01', kind: 'bm01', ...service.documentContent(html, 'BM01') }];
  const direct = service.extractBm01ScopeApis(sources[0].blocks);
  assert.equal(direct.usable, true); assert.equal(direct.apis.length, 91);
  assert.deepEqual(direct.apis[0], { method: 'GET', path: '/api/orders/0', service: 'internal.test', change: 'unknown', description: 'Endpoint nội bộ', evidence: [{ sourceId: 'BM01:L2', quote: 'GET http://internal.test/api/orders/0 - Endpoint nội bộ' }] });
  const extractionPrompts = []; let aggregateContext = '';
  const result = await service.analyze(sources, () => {}, async prompt => {
    if (prompt.startsWith('Trích xuất phần')) {
      extractionPrompts.push(prompt);
      assert.doesNotMatch(prompt, /\/api\/orders\/90/);
      assert.match(prompt, /Thêm luồng đồng bộ đơn hàng/);
      assert.match(prompt, /Trả apis là mảng rỗng/);
      return { apis: [], business: 'Luồng đồng bộ đơn hàng.', unknowns: [] };
    }
    aggregateContext = prompt;
    return { summary: 'Đã đọc scope.', businessAnalysis: 'Luồng đồng bộ đơn hàng.', scopeAssessment: { status: 'unknown', detail: 'Chưa có tài liệu tham chiếu.' }, functionAssessment: { status: 'matched', detail: 'Có mô tả chức năng mới.' }, findings: [] };
  });
  assert.equal(extractionPrompts.length, 1);
  assert.equal(result.extracted.flatMap(part => part.apis).length, 91);
  assert.match(aggregateContext, /\/api\/orders\/90/);
});

test('Direct BM01 scope parser counts path and URL forms but not the URL base', () => {
  const blocks = [
    { id: 'BM01:L1', text: 'Danh sách API / Web Service' },
    { id: 'BM01:L2', text: 'Base URL: https://service.example.test' },
    { id: 'BM01:L3', text: '/api/v1/test' },
    { id: 'BM01:L4', text: 'https://other.example.test/api/ok' },
    { id: 'BM01:L5', text: 'GET - https://service.example.test/api/items (%20https://service.example.test/api/items)' },
    { id: 'BM01:L6', text: 'Thông tin về tài khoản ứng dụng' }
  ];
  const result = service.extractBm01ScopeApis(blocks);
  assert.equal(result.usable, true);
  assert.equal(result.unparsed, 0);
  assert.deepEqual(result.apis.map(api => `${api.method || '-'} ${api.service}${api.path}`), [
    '- service.example.test/api/v1/test',
    '- other.example.test/api/ok',
    'GET service.example.test/api/items'
  ]);
});

test('AI pipeline rejects fabricated evidence and preserves source failures', async () => {
  const sources = [{ id: 'BM01', kind: 'bm01', ...service.documentContent('<p>Scope POST /orders thuộc PYC 123</p>', 'BM01') }, { id: 'DOC1', kind: 'document', pyc: '123', ...service.documentContent('<p>Thêm mới PATCH /orders/{id} sửa trạng thái đơn</p>', 'DOC1') }, { id: 'DOC2', error: 'HTTP 403' }];
  let calls = 0;
  const result = await service.analyze(sources, () => {}, async () => {
    calls++;
    if (calls <= 2) { const source = sources[calls - 1]; return { apis: [{ method: calls === 1 ? 'POST' : 'PATCH', path: calls === 1 ? '/orders' : '/orders/{id}', change: 'new', evidence: [{ sourceId: source.blocks[0].id, quote: source.blocks[0].text }] }, { path: '/fabricated', evidence: [{ sourceId: source.blocks[0].id, quote: 'THIS DOES NOT EXIST' }] }], business: 'Luồng nghiệp vụ', unknowns: [] }; }
    return { summary: 'Thiếu scope cần xác nhận', businessAnalysis: 'Giải thích thay đổi', scopeAssessment: { status: 'different', detail: 'Thiếu PATCH' }, functionAssessment: { status: 'unknown', detail: 'Thiếu mô tả' }, findings: [{ title: 'Thiếu PATCH', type: 'missing_scope', evidence: [{ sourceId: 'DOC1:L1', quote: 'Thêm mới PATCH /orders/{id}' }] }, { title: 'Không có bằng chứng', type: 'scope_mismatch', evidence: [{ sourceId: 'DOC1:L1', quote: 'Không tồn tại' }] }, { title: 'Đề xuất ngoài phạm vi', type: 'unclear', recommendation: 'Sửa BM01' }] };
  });
  assert.equal(result.findings[0].evidenceValid, true); assert.equal(result.findings[1].evidenceValid, false);
  assert.ok(result.warnings.some(w => w.includes('HTTP 403')));
  assert.ok(!result.matrix.some(a => a.path === '/fabricated'));
  assert.equal(result.findings.length, 2);
  assert.equal(result.scopeAssessment.status, 'unknown');
  assert.equal(result.testFocus, undefined);
  assert.equal(result.findings[0].recommendation, undefined);
  assert.equal(result.bm01Checks.length, 12);
});

test('Chat answers from the completed analysis context and returns only text', async () => {
  let payload;
  const sources = [{ id: 'BM01', kind: 'bm01', ...service.documentContent('<p>BM01 scope: POST /orders</p>', 'BM01') }];
  const answer = await service.chat({ sources, result: { summary: 'Scope có POST /orders', businessAnalysis: 'Người dùng tạo đơn.', bm01Checks: [], matrix: [], findings: [] }, history: [], question: 'API nào trong BM01?', }, { post: async (url, body) => { payload = body; return { data: { choices: [{ finish_reason: 'stop', message: { content: '{"answer":"BM01 có POST /orders."}' } }] } }; } });
  assert.equal(answer, 'BM01 có POST /orders.');
  assert.match(payload.messages.at(-1).content, /API nào trong BM01/);
  await assert.rejects(service.chat({ sources, result: {}, question: 'x' }, { post: async () => ({}) }), /2 đến 4.000/);
});

test('HTTP flow: upload, isolated ownership, HTML preview, JSON export, missing AI config', async t => {
  const original = service.fetchDocument;
  service.fetchDocument = async (entry, i) => ({ id: `DOC${i+1}`, kind: 'document', ...entry, ...service.documentContent('<h1>PYC mới POST /orders cập nhật dữ liệu</h1>', `DOC${i+1}`) });
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'views')); app.use(express.json()); app.use(session({ secret: 'test-only', resave: false, saveUninitialized: true })); app.use('/scope-review', require('../routes/scope-review'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => { service.fetchDocument = original; server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/scope-review`;
  const home = await fetch(base); assert.equal(home.status, 200); assert.match(await home.text(), /BM01 Scope Review/);
  const cookie = home.headers.get('set-cookie').split(';')[0];
  const form = new FormData(); form.append('documents', '20608 - 895978834\n20602-https://confluence.mbbank.com.vn/display/ORS/ms109-api-f88-preapp-limit'); form.append('bm01', new Blob([await docx()]), 'BM01.docx'); form.append('references', new Blob([await docx()]), 'spec.docx');
  const prepared = await fetch(base + '/prepare', { method: 'POST', headers: { Cookie: cookie }, body: form }); const job = await prepared.json(); assert.equal(prepared.status, 200);
  t.after(() => fs.unlink(path.join(__dirname, '..', 'reports', 'scope-reviews', job.id + '.json')));
  assert.equal(job.owner, undefined); assert.equal(job.sources[1].pageId, '20608-895978834');
  assert.equal(job.sources[2].pageId, '20602-https://confluence.mbbank.com.vn/display/ORS/ms109-api-f88-preapp-limit');
  assert.equal(job.sources[3].origin, 'upload');
  const fileOnly = new FormData(); fileOnly.append('documents', ''); fileOnly.append('bm01', new Blob([await docx()]), 'BM01-file-only.docx'); fileOnly.append('references', new Blob([await docx()]), 'spec-file-only.docx');
  const preparedFileOnly = await fetch(base + '/prepare', { method: 'POST', headers: { Cookie: cookie }, body: fileOnly }); const fileOnlyJob = await preparedFileOnly.json(); assert.equal(preparedFileOnly.status, 200); assert.equal(fileOnlyJob.sources.length, 2); assert.equal(fileOnlyJob.sources[1].origin, 'upload');
  t.after(() => fs.unlink(path.join(__dirname, '..', 'reports', 'scope-reviews', fileOnlyJob.id + '.json')));
  const bm01Only = new FormData(); bm01Only.append('documents', ''); bm01Only.append('bm01', new Blob([await docx()]), 'BM01-note-only.docx');
  const preparedBm01Only = await fetch(base + '/prepare', { method: 'POST', headers: { Cookie: cookie }, body: bm01Only }); const bm01OnlyJob = await preparedBm01Only.json();
  assert.equal(preparedBm01Only.status, 200); assert.equal(bm01OnlyJob.sources.length, 1); assert.equal(bm01OnlyJob.sources[0].kind, 'bm01');
  t.after(() => fs.unlink(path.join(__dirname, '..', 'reports', 'scope-reviews', bm01OnlyJob.id + '.json')));
  const documentOnly = new FormData(); documentOnly.append('documents', '20797 - 895978834');
  const preparedDocumentOnly = await fetch(base + '/prepare', { method: 'POST', headers: { Cookie: cookie }, body: documentOnly }); const documentOnlyJob = await preparedDocumentOnly.json();
  assert.equal(preparedDocumentOnly.status, 200); assert.equal(documentOnlyJob.sources.length, 1); assert.equal(documentOnlyJob.sources[0].kind, 'document');
  t.after(() => fs.unlink(path.join(__dirname, '..', 'reports', 'scope-reviews', documentOnlyJob.id + '.json')));
  const emptyInput = await fetch(base + '/prepare', { method: 'POST', headers: { Cookie: cookie }, body: new FormData() });
  assert.equal(emptyInput.status, 400); assert.match((await emptyInput.json()).error, /ID\/URL/);
  const stranger = await fetch(base + '/' + job.id); assert.equal(stranger.status, 404);
  const preview = await fetch(`${base}/${job.id}/source/DOC1`, { headers: { Cookie: cookie } }); assert.match(preview.headers.get('content-security-policy'), /sandbox/); assert.match(await preview.text(), /POST \/orders/);
  const exported = await fetch(`${base}/${job.id}/export/json`, { headers: { Cookie: cookie } }); const body = await exported.text(); assert.ok(!body.includes('session=')); assert.ok(!body.includes('owner'));
  const crossOrigin = await fetch(`${base}/${job.id}/analyze`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://untrusted.test' } }); assert.equal(crossOrigin.status, 403);
});
