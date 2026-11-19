const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const fs = require('fs/promises');
const path = require('path');
const scope = require('../services/scopeReview.service');
const note = require('../services/bm02Note.service');

const taskId = 'e60c8940-c0b1-4e33-b4c8-196164ffdb9b';
const serviceId = 'bd9b87c0-8268-48d8-bbf3-76a2808980d5';

test('Phiếu No Bug saves an empty vulnerability list and the supplied checklist', async t => {
  const oldRead = scope.readBm01, oldSave = note.save;
  scope.readBm01 = async file => ({ id: 'BM01', kind: 'bm01', name: file.originalname, blocks: [{ id: 'BM01:L1', text: 'BM01' }] });
  let posted;
  note.save = async payload => { posted = structuredClone(payload); return { ok: true }; };
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.json()); app.use(session({ secret: 'no-bug-test', resave: false, saveUninitialized: true })); app.use('/scope-review', require('../routes/scope-review'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let jobFile;
  t.after(async () => { scope.readBm01 = oldRead; note.save = oldSave; server.closeAllConnections(); server.close(); if (jobFile) await fs.rm(jobFile, { force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/scope-review`;
  const home = await fetch(base); const headers = { Cookie: home.headers.get('set-cookie').split(';')[0] };
  const form = new FormData(); form.append('bm01', new Blob(['docx']), 'BM01.docx'); form.append('documents', '');
  const createdResponse = await fetch(`${base}/prepare`, { method: 'POST', headers, body: form }); assert.equal(createdResponse.status, 200);
  const job = await createdResponse.json(); jobFile = path.join(__dirname, '..', 'reports', 'scope-reviews', `${job.id}.json`);
  const stored = JSON.parse(await fs.readFile(jobFile, 'utf8'));
  stored.noteBm02 = { serviceId, systemName: 'AI Platform', serviceName: 'AI Platform', payload: { ...note.reportDefaults(taskId), is_public_internet: false, feature_public_internet: false, have_financial_transactions: false, platform_id: [note.PLATFORM_IDS.web], server_api: [], services: [serviceId] }, status: 'ready' };
  await fs.writeFile(jobFile, JSON.stringify(stored));
  const savedResponse = await fetch(`${base}/${job.id}/note-bm02/save`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ noBugMode: true, bugs: [] }) });
  assert.equal(savedResponse.status, 200); assert.equal((await savedResponse.json()).bugCount, 0);
  assert.deepEqual(posted.drafts, []); assert.equal(posted.server_api.length, 0); assert.deepEqual(posted.services, [serviceId]); assert.equal(posted.checklist, note.DEFAULT_CHECKLIST);
  assert.match(posted.checklist, /OTG-SESS-001/); assert.match(posted.checklist, /OTG-INPVAL-001/);
  const savedJob = JSON.parse(await fs.readFile(jobFile, 'utf8'));
  assert.equal(savedJob.noteBm02.noBugMode, true); assert.equal(savedJob.noteBm02.payload.checklist, note.DEFAULT_CHECKLIST);
});
