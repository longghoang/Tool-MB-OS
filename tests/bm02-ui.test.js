const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('BM02 UI keeps existing analysis and chat visible during and after checking', async () => {
  class Element {
    constructor() { this.children = []; this.style = {}; this.dataset = {}; this.files = []; this.value = ''; this.listeners = {}; this.hidden = false; this.textContent = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    focus() {}
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'scope-review.ejs'), 'utf8');
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const job = { id: 'test', status: 'complete', sources: [{ kind: 'bm01', name: 'BM01.docx' }, { kind: 'document' }], result: { summary: 'Original analysis', businessAnalysis: 'Original flow', bm01Checks: [{ status: 'alert', title: 'Original alert', detail: 'Keep me' }] }, chatHistory: [{ role: 'assistant', content: 'Original answer' }] };
  const requests = []; let releasePoll;
  const context = { document: { getElementById: id => { assert.ok(elements[id], `Missing element ${id}`); return elements[id]; }, createElement: () => new Element() }, sessionStorage: { getItem: () => 'test', setItem() {}, removeItem() {} }, window: { print() {} }, setTimeout: fn => { releasePoll = fn; }, FormData, fetch: async (url, options) => {
    requests.push({ url, options });
    if (options?.method === 'POST' && url.endsWith('/note-bm02/prepare')) {
      job.noteBm02 = { number: '20797', taskName: 'PENTEST 20797 - Test system', taskId: 'e60c8940-c0b1-4e33-b4c8-196164ffdb9b', systemName: 'AI Platform', serviceName: 'AI Platform', serviceId: 'bd9b87c0-8268-48d8-bbf3-76a2808980d5', payload: { is_public_internet: false, feature_public_internet: false, have_financial_transactions: false, platform_id: [], server_api: [], services: ['bd9b87c0-8268-48d8-bbf3-76a2808980d5'] }, sourceStatus: { apiCount: 0 }, status: 'ready' };
      return { ok: true, json: async () => ({ noteBm02: structuredClone(job.noteBm02) }) };
    }
    if (options?.method === 'POST' && url.endsWith('/note-bm02/save')) {
      return { ok: true, json: async () => ({ ok: true, savedAt: '2026-09-24T00:00:00.000Z', bugCount: 0 }) };
    }
    if (options?.method === 'POST') { job.bm02 = { number: '20561', status: 'checking', progressPercent: 15, issue: { number: '20561', systemName: 'Test system', status: 'Waiting', inProgress: false } }; }
    return { ok: true, json: async () => structuredClone(job) };
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'scope-review.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.analysisReferences.hidden, false); assert.equal(elements.analysisActions.hidden, false);
  assert.equal(elements.resultLayout.hidden, false); assert.equal(elements.summary.textContent, 'Original analysis');
  elements.bm02Number.value = '20561';
  const operation = elements.bm02Form.onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.resultLayout.hidden, false); assert.equal(elements.summary.textContent, 'Original analysis');
  assert.equal(elements.bm02Issue.children[0].className, 'check-alert'); assert.equal(elements.checkBm02.disabled, true);
  job.bm02.status = 'complete'; job.bm02.result = { ready: false, matched: false, summary: 'Not ready', checks: [{ status: 'alert', title: 'Waiting', detail: 'Expected In Progress' }] };
  assert.ok(releasePoll); releasePoll(); await operation;
  assert.equal(elements.checkBm02.disabled, false); assert.equal(elements.resultLayout.hidden, false); assert.equal(elements.bm02Result.hidden, false);
  assert.equal(elements.summary.textContent, 'Original analysis'); assert.equal(elements.checkAlerts.children.length, 1); assert.equal(elements.chatHistory.children.length, 1);
  assert.equal(requests.find(r => r.options?.method === 'POST').url, '/scope-review/test/bm02');
  let submitted = 0, prevented = 0;
  elements.chatForm.requestSubmit = () => submitted++;
  const key = (shiftKey, isComposing) => elements.chatQuestion.listeners.keydown({ key: 'Enter', shiftKey, isComposing, preventDefault: () => prevented++ });
  key(false, false); key(true, false); key(false, true);
  assert.equal(submitted, 1); assert.equal(prevented, 1);
  elements.stageBm02.onclick(); assert.equal(elements.bm02Stage.hidden, false); assert.equal(elements.noteStage.hidden, true);
  assert.equal(elements.analysisIntake.hidden, false); assert.equal(elements.analysisReferences.hidden, true); assert.equal(elements.analysisActions.hidden, true);
  elements.bm02Number.value = '20797'; elements.bm02Number.listeners.input(); assert.equal(elements.notePycNumber.value, '20797');
  elements.stageNote.onclick(); assert.equal(elements.bm02Stage.hidden, true); assert.equal(elements.noteStage.hidden, false);
  assert.equal(elements.analysisIntake.hidden, false); assert.equal(elements.analysisReferences.hidden, true); assert.equal(elements.analysisActions.hidden, true);
  elements.notePycNumber.value = '20813'; elements.notePycNumber.listeners.input(); assert.equal(elements.bm02Number.value, '20813');
  elements.noBugMode.checked = true; elements.noBugMode.listeners.change();
  assert.equal(elements.noteBugEditor.hidden, true); assert.equal(elements.noBugNotice.hidden, false); assert.match(elements.saveNoteBm02.textContent, /No Bug/);
  assert.equal(elements.noteBm02Form.noValidate, true, 'the hidden required severity field must not block No Bug submission');
  elements.notePycNumber.value = '20797'; await elements.prepareNoteBm02.onclick();
  assert.match(elements.noteService.textContent, /AI Platform.*bd9b87c0-8268-48d8-bbf3-76a2808980d5/);
  assert.equal(elements.noBugMode.checked, true, 'preparing the note must preserve the selected No Bug mode');
  assert.equal(elements.noteBugEditor.hidden, true); assert.equal(elements.noBugNotice.hidden, false);
  assert.equal(elements.noteBm02Form.noValidate, true);
  elements.noBugMode.checked = false; elements.noBugMode.listeners.change();
  assert.equal(elements.noteBm02Form.noValidate, false, 'normal bug reports retain field validation');
  elements.noBugMode.checked = true; elements.noBugMode.listeners.change(); await elements.prepareNoteBm02.onclick();
  assert.equal(elements.noBugMode.checked, true, 'a later prepare response must not clear a newly selected No Bug mode');
  assert.equal(elements.noteBm02Form.noValidate, true);
  await elements.noteBm02Form.onsubmit({ preventDefault() {} });
  const noBugSave = requests.find(r => r.url.endsWith('/note-bm02/save'));
  assert.ok(noBugSave, 'No Bug submit must call the save endpoint');
  assert.equal(JSON.parse(noBugSave.options.body).noBugMode, true);
  assert.deepEqual(JSON.parse(noBugSave.options.body).bugs, []);
  assert.equal(elements.noteSavedMessage.hidden, false);
});

test('Analysis can start from a document ID or reference file without a BM01 upload', async () => {
  class Element {
    constructor() { this.children = []; this.style = {}; this.files = []; this.value = ''; this.listeners = {}; this.hidden = false; this.textContent = ''; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    focus() {}
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'scope-review.ejs'), 'utf8');
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const context = { document: { getElementById: id => elements[id] }, sessionStorage: { getItem: () => null }, window: { print() {} }, FormData, fetch: async () => { throw new Error('No request expected'); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'scope-review.js'), 'utf8'), context);
  assert.equal(elements.bm01.required, undefined);
  assert.equal(elements.prepare.disabled, true); assert.equal(elements.analyze.disabled, true);
  elements.documents.value = '2999 - 877777'; elements.documents.listeners.input();
  assert.equal(elements.prepare.disabled, false); assert.equal(elements.analyze.disabled, false);
  elements.documents.value = ''; elements.documents.listeners.input();
  elements.references.files = [{ name: 'spec.docx', size: 100, lastModified: 1 }]; elements.references.listeners.change();
  assert.equal(elements.prepare.disabled, false); assert.equal(elements.analyze.disabled, false);
});
