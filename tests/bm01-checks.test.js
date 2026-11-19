const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { prepareDocx, buildChecks } = require('../services/bm01Checks.service');
const proof = [{ sourceId: 'BM01:L1', quote: 'Giá trị kiểm thử' }];
const field = value => ({ value, detail: 'Giá trị kiểm thử', evidence: proof });
function check(fields, structure) { return buildChecks([{ bm01Fields: fields }], structure, e => e || []); }

test('Internet consistency covers all four YES/NO combinations and missing data', () => {
  for (const a of ['yes','no']) for (const b of ['yes','no']) {
    const rows = check({ publicInternet: field(a), internetImpact: field(b) });
    assert.equal(rows.find(r => r.code === 'internetConsistency').status, a === b ? 'pass' : 'alert');
  }
  assert.equal(check({ publicInternet: field('yes') }).find(r => r.code === 'internetConsistency').status, 'review');
});

test('CMV, selected infrastructure and LIVE/PILOT trigger alerts independently', () => {
  const rows = check({ cmv: field('yes'), publicInternet: field('no'), infrastructure: field('yes'), live: field('yes'), pilot: field('yes') });
  for (const code of ['cmvInternet','infrastructure','live','pilot']) assert.equal(rows.find(r => r.code === code).status, 'alert');
  assert.equal(check({ cmv: field('no') }).find(r => r.code === 'cmvInternet'), undefined);
  assert.equal(check({ live: field('unknown') }).find(r => r.code === 'live').status, 'review');
});

test('Required BM01 fields, recipient, and author email use explicit outcomes', () => {
  const rows = check({ applicationAddress: field('missing'), specification: field('present'), accounts: field('missing'), connections: field('incomplete'), frameworkVersions: field('incomplete'), recipient: field('incorrect'), authorEmail: field('plausible') });
  for (const code of ['applicationAddress','accounts','connections','frameworkVersions','recipient']) assert.equal(rows.find(r => r.code === code).status, 'alert');
  assert.equal(rows.find(r => r.code === 'specification').status, 'pass');
  assert.match(rows.find(r => r.code === 'authorEmail').detail, /chưa xác thực/);
  assert.equal(check({ authorEmail: field('mismatch') }).find(r => r.code === 'authorEmail').status, 'alert');
});

test('Conflicting facts or invented citations cannot pass a check', () => {
  const rows = buildChecks([{ bm01Fields: { publicInternet: field('yes') } }, { bm01Fields: { publicInternet: field('no'), internetImpact: field('yes') } }], {}, e => e);
  assert.equal(rows.find(r => r.code === 'internetConsistency').status, 'review');
  const invalid = buildChecks([{ bm01Fields: { applicationAddress: field('present') } }], {}, () => []);
  assert.equal(invalid.find(r => r.code === 'applicationAddress').status, 'review');
});

test('DOCX preserves Wingdings, modern and legacy checkbox states; counts only section 6.1 images', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document xmlns:w="w" xmlns:w14="w14"><w:body>
    <w:p><w:r><w:drawing/></w:r></w:p>
    <w:p><w:r><w:t>6.1. Mô hình tổng thể hệ thống</w:t></w:r></w:p>
    <w:p><w:r><w:drawing/></w:r></w:p>
    <w:p><w:r><w:t>6.2. Các cơ chế kết nối</w:t></w:r></w:p>
    <w:p><w:r><w:drawing/></w:r></w:p>
    <w:p><w:r><w:sym w:font="Wingdings" w:char="F0FE"/><w:t>Pentest Hạ tầng</w:t></w:r></w:p>
    <w:p><w:r><w:sym w:font="Wingdings" w:char="F0A8"/><w:t>LIVE</w:t></w:r></w:p>
    <w:p><w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="1"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>PILOT</w:t></w:r></w:sdtContent></w:sdt></w:p>
    <w:p><w:r><w:fldChar><w:ffData><w:checkBox><w:checked w:val="0"/></w:checkBox></w:ffData></w:fldChar></w:r></w:p>
  </w:body></w:document>`);
  const result = await prepareDocx(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(result.structure.architectureObjects, 1);
  assert.equal(result.structure.architectureSection, true);
  const parsed = await JSZip.loadAsync(result.buffer);
  const xml = await parsed.file('word/document.xml').async('string');
  const decoded = require('cheerio').load(xml, { xmlMode: true }).root().text();
  assert.equal((decoded.match(/☑/g) || []).length, 2);
  assert.equal((decoded.match(/☐/g) || []).length, 2);
  assert.equal(check({}, result.structure).find(r => r.code === 'architecture').status, 'pass');
  assert.equal(check({}, { inspected: true, architectureObjects: 0 }).find(r => r.code === 'architecture').status, 'review');
});
