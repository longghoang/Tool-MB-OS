const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config/scope-review');
const { askJson } = require('../services/scopeReview.service');

const original = { aiUrl: config.aiUrl, aiModel: config.aiModel, aiKey: config.aiKey };
config.aiUrl = 'http://127.0.0.1:20128/v1/chat/completions';
config.aiModel = 'test-model';
config.aiKey = 'test-secret';
test.after(() => Object.assign(config, original));

test('AI request retries one transient connection reset and accepts valid JSON', async () => {
  let calls = 0;
  const client = { post: async () => {
    calls += 1;
    if (calls === 1) { const error = new Error('request failed'); error.code = 'ECONNRESET'; throw error; }
    return { data: { choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] } };
  } };
  assert.deepEqual(await askJson('Return JSON', client), { ok: true });
  assert.equal(calls, 2);
});

test('AI connection error has stable code and does not expose request secrets', async () => {
  let calls = 0;
  const originalError = new Error('request failed with test-secret and document text');
  originalError.code = 'EACCES';
  const client = { post: async () => { calls += 1; throw originalError; } };
  await assert.rejects(askJson('document text', client), error => {
    assert.equal(error.code, 'AI_NETWORK_ERROR');
    assert.equal(error.cause, originalError);
    assert.match(error.message, /EACCES/);
    assert.doesNotMatch(error.message, /test-secret|document text/);
    return true;
  });
  assert.equal(calls, 1);
});

test('AI HTTP 429 is never retried or misclassified as a network failure', async () => {
  let calls = 0;
  const client = { post: async () => {
    calls += 1;
    const error = new Error('provider rate limit');
    error.response = { status: 429, headers: { 'retry-after': '60' }, data: { error: { message: 'cooldown' } } };
    throw error;
  } };
  await assert.rejects(askJson('Return JSON', client), error => {
    assert.match(error.message, /HTTP 429/);
    assert.notEqual(error.code, 'AI_NETWORK_ERROR');
    return true;
  });
  assert.equal(calls, 1);
});

test('AI timeout exposes a safe specific explanation without retrying', async () => {
  let calls = 0;
  const client = { post: async () => {
    calls += 1;
    const error = new Error('request contained sensitive data');
    error.code = 'ECONNABORTED';
    throw error;
  } };
  await assert.rejects(askJson('Return JSON', client), error => {
    assert.equal(error.code, 'AI_NETWORK_ERROR');
    assert.match(error.message, /120 giây/);
    assert.doesNotMatch(error.message, /sensitive data/);
    return true;
  });
  assert.equal(calls, 1);
});
