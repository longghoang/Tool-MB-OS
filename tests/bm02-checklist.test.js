const { test } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const express = require('express');
const session = require('express-session');
const fs = require('node:fs/promises');
const path = require('node:path');
const checklist = require('../services/bm02Checklist.service');
const scope = require('../services/scopeReview.service');
const note = require('../services/bm02Note.service');

function results(html) {
  const $ = cheerio.load(html);
  return new Map($('tr').map((_, row) => {
    const cells = $(row).children('td');
    return cells.length >= 5 ? [[cells.eq(0).text().trim(), cells.eq(4).text().trim()]] : [];
  }).get());
}

test('BM02 checklist catalog exposes every case in the supplied template', () => {
  const cases = checklist.listCases();
  assert.equal(cases.length, 133);
  assert.equal(new Set(cases.map(item => item.code)).size, cases.length);
  assert.ok(cases.some(item => item.code === 'OTG-SESS-001'));
  assert.ok(cases.some(item => item.code === 'PAY-01'));
  assert.ok(cases.every(item => item.title && item.description && item.result));
});

test('marking selected cases Fail keeps every other checklist result and earlier Fail', () => {
  const before = results(checklist.DEFAULT_CHECKLIST);
  const first = checklist.applyFailures('', ['OTG-SESS-001']);
  const afterFirst = results(first);
  assert.equal(afterFirst.get('OTG-SESS-001'), 'Fail');
  assert.match(first, /color: rgb\(231, 76, 60\);"><strong>Fail<\/strong>/);
  const second = checklist.applyFailures(first, ['PAY-01']);
  const afterSecond = results(second);
  assert.equal(afterSecond.get('OTG-SESS-001'), 'Fail');
  assert.equal(afterSecond.get('PAY-01'), 'Fail');
  for (const [code, status] of before) if (!['OTG-SESS-001', 'PAY-01'].includes(code)) assert.equal(afterSecond.get(code), status, code);
  assert.throws(() => checklist.applyFailures(first, ['FAKE-001']), /không có trong checklist/);
  assert.equal(checklist.applyFailures('', []), checklist.DEFAULT_CHECKLIST);
});

test('Note BM02 saves chosen cases as red Fail with the new bug draft, without calling live CSD', async t => {
  const oldRead = scope.readBm01, oldSave = note.save;
  scope.readBm01 = async file => ({ id: 'BM01', kind: 'bm01', name: file.originalname, blocks: [] });
  let posted;
  note.save = async payload => { posted = structuredClone(payload); return { ok: true }; };
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.json()); app.use(session({ secret: 'checklist-test', resave: false, saveUninitialized: true })); app.use('/scope-review', require('../routes/scope-review'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let jobFile;
  t.after(async () => { scope.readBm01 = oldRead; note.save = oldSave; server.closeAllConnections(); server.close(); if (jobFile) await fs.rm(jobFile, { force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/scope-review`;
  const home = await fetch(base); const headers = { Cookie: home.headers.get('set-cookie').split(';')[0] };
  const catalogResponse = await fetch(`${base}/checklist-cases`, { headers });
  assert.equal(catalogResponse.status, 200);
  assert.equal((await catalogResponse.json()).cases.length, 133);
  const form = new FormData(); form.append('bm01', new Blob(['docx']), 'BM01.docx'); form.append('documents', '');
  const created = await fetch(`${base}/prepare`, { method: 'POST', headers, body: form });
  assert.equal(created.status, 200); const job = await created.json();
  jobFile = path.join(__dirname, '..', 'reports', 'scope-reviews', `${job.id}.json`);
  const stored = JSON.parse(await fs.readFile(jobFile, 'utf8'));
  const taskId = 'e60c8940-c0b1-4e33-b4c8-196164ffdb9b';
  const serviceId = 'bd9b87c0-8268-48d8-bbf3-76a2808980d5';
  stored.noteBm02 = { serviceId, mode: 'new', payload: { ...note.reportDefaults(taskId), is_public_internet: false, feature_public_internet: false, have_financial_transactions: false, platform_id: [note.PLATFORM_IDS.web], services: [serviceId] }, status: 'ready' };
  await fs.writeFile(jobFile, JSON.stringify(stored));
  const bug = { severity: 'high', testCaseCodes: ['PAY-01', 'OTG-SESS-001'], vulnerabilityName: '[N/A] - [UAT] - Duplicate account', description: 'Concurrent requests create duplicate accounts.', pocSteps: 'Send two concurrent requests.\nObserve duplicate accounts.', recommendation: 'Add a unique constraint.\nMake the operation atomic.\nRetest concurrent requests.' };
  const saved = await fetch(`${base}/${job.id}/note-bm02/save`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ noBugMode: false, bugs: [bug] }) });
  assert.equal(saved.status, 200, await saved.text());
  assert.equal(posted.drafts.length, 1);
  assert.match(posted.drafts[0].vulnerability_name, /^\[PAY-01, OTG-SESS-001\] - \[UAT\]/);
  const statuses = results(posted.checklist);
  assert.equal(statuses.get('PAY-01'), 'Fail');
  assert.equal(statuses.get('OTG-SESS-001'), 'Fail');
  assert.equal(statuses.get('OTG-SESS-002'), results(checklist.DEFAULT_CHECKLIST).get('OTG-SESS-002'));
});
