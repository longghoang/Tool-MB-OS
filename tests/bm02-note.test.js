const { test } = require('node:test');
const assert = require('node:assert/strict');
const note = require('../services/bm02Note.service');
const review = require('../services/bm02Review.service');

const taskId = 'e60c8940-c0b1-4e33-b4c8-196164ffdb9b';
const serviceId = 'bd9b87c0-8268-48d8-bbf3-76a2808980d5';

test('Note BM02 preparation resolves PYC 20797 task_id and maps BM01 data into the CSD payload', async () => {
  let issueRead = false;
  const prepared = await note.prepare({ number: '20797', bm01: { kind: 'bm01', blocks: [] } }, {
    api: {
      getBm02Tasks: async () => ({ data: [{ task_name: 'PENTEST 20797 - System', task_id: taskId }] }),
      getIssue: async number => { assert.equal(number, '20797'); issueRead = true; return '<h1>PENTEST-20797 <span>In Progress</span></h1><p><strong>Hệ thống:</strong> AI Platform</p>'; },
      getFolderTree: async () => { assert.equal(issueRead, true); return { data: { folders: [{ children: [{ service_id: serviceId, service_name: 'AI  Platform' }] }], other: [{ service_id: serviceId, service_name: 'AI Platform' }] } }; }
    },
    extract: async () => ({ fields: { publicInternet: 'no', internetImpact: 'no', financialTransactions: 'yes', mobile: 'no', web: 'yes', api: 'yes', other: 'no' }, apis: [
      { method: 'GET', host: 'api.test', path: '/v1/orders' }, { method: 'POST', host: 'api.test', path: '/v1/orders' }, { method: 'GET', path: '/api/items' }
    ], unparsed: 0 })
  });
  assert.equal(prepared.taskId, taskId);
  assert.equal(prepared.systemName, 'AI Platform');
  assert.equal(prepared.serviceId, serviceId);
  assert.deepEqual(prepared.payload.services, [serviceId]);
  assert.equal(prepared.payload.is_public_internet, false);
  assert.equal(prepared.payload.feature_public_internet, false);
  assert.equal(prepared.payload.have_financial_transactions, true);
  assert.deepEqual(prepared.payload.platform_id, [note.PLATFORM_IDS.web, note.PLATFORM_IDS.api]);
  assert.deepEqual(prepared.payload.server_api, [{ api: 'https://api.test/v1/orders', env: false }, { api: 'https://{base-url}/api/items', env: false }]);
  assert.equal(prepared.payload.source_code, true);
  assert.equal(prepared.payload.app_account, false);
  assert.equal(prepared.payload.reportType, '6783e051-85ee-4407-9b62-2dcdf61ba171');
});

test('Note tiếp bug loads the existing BM02 payload and appends without changing previous drafts', async () => {
  const fullDraftId = '0c2b5966-aef9-4e38-b1d8-39a3f81f85a1';
  const existing = {
    taskId,
    reportType: 'legacy-report-type',
    checklist: '<p>existing checklist</p>',
    custom_field_not_mentioned: 'keep unchanged',
    is_public_internet: true,
    feature_public_internet: true,
    have_financial_transactions: false,
    platform_id: [note.PLATFORM_IDS.mobile],
    services: [serviceId],
    server_api: [{ api: 'https://existing.example.test/v1', env: false }],
    drafts: [{ vulnerability_name: 'Existing finding', ordinal: 0, untouched: true }]
  };
  const api = {
    getBm02Tasks: async () => ({ data: [{ task_name: 'PENTEST 20797 - System', task_id: taskId, full_draft_id: fullDraftId }] }),
    getIssue: async () => '<h1>PENTEST-20797 <span>In Progress</span></h1><p><strong>Hệ thống:</strong> AI Platform</p>',
    getFolderTree: async () => ({ data: [{ service_id: serviceId, service_name: 'AI Platform' }] }),
    getDraft: async id => { assert.equal(id, fullDraftId); return { data: { ...existing, taskId } }; }
  };
  const extract = async () => ({ fields: { publicInternet: 'no', internetImpact: 'no', financialTransactions: 'yes', mobile: 'no', web: 'yes', api: 'yes' }, apis: [{ host: 'new.example.test', path: '/should-not-overwrite' }] });
  const prepared = await note.prepare({ number: '20797', bm01: { kind: 'bm01', blocks: [] }, mode: 'append' }, { api, extract });
  assert.equal(prepared.mode, 'append');
  assert.equal(prepared.existingDraftCount, 1);
  assert.equal(prepared.payload.taskId, taskId);
  assert.deepEqual(prepared.payload.drafts, existing.drafts);
  assert.equal(prepared.payload.custom_field_not_mentioned, 'keep unchanged');
  const newDraft = note.buildBugDraft({ bug: { severity: 'medium', testCaseCode: 'TC-02' }, generated: { vulnerabilityName: 'New finding', description: 'A confirmed vulnerability affects the tested feature.', pocSteps: ['Step one'], recommendation: ['First fix', 'Second fix', 'Third fix'] } });
  const merged = { ...prepared.payload, drafts: note.appendDrafts(prepared.payload, [newDraft]) };
  assert.equal(merged.drafts.length, 2);
  assert.deepEqual(merged.drafts[0], existing.drafts[0]);
  assert.equal(merged.drafts[1].ordinal, 1);
  assert.equal(merged.custom_field_not_mentioned, 'keep unchanged');
  await assert.rejects(() => note.prepare({ number: '20797', bm01: { kind: 'bm01', blocks: [] }, mode: 'new' }, { api, extract }), /already has a draft|đã có bản nháp/i);
});

test('CSD draft schema without taskId is recognized and mapped without losing its fields', () => {
  const raw = {
    range_type: 2,
    service: [serviceId],
    platform: [note.PLATFORM_IDS.web],
    server_api: [{ api: 'https://existing.example.test/api', env: false }],
    checklist: '<p>keep checklist</p>',
    is_public_internet: false,
    feature_public_internet: false,
    have_financial_transactions: false,
    drafts: [{ vulnerability_name: 'Existing', ordinal: 0 }],
    unknown_csd_field: 'must survive'
  };
  const found = note.findDraftPayload({ ok: true, data: raw }, taskId);
  assert.deepEqual(found, raw);
  const payload = note.toSavePayload(found, taskId);
  assert.equal(payload.taskId, taskId);
  assert.equal(payload.rangeType, 2);
  assert.deepEqual(payload.services, [serviceId]);
  assert.deepEqual(payload.platform_id, [note.PLATFORM_IDS.web]);
  assert.deepEqual(payload.drafts, raw.drafts);
  assert.equal(payload.unknown_csd_field, 'must survive');
});

test('Note tiếp bug treats CSD ok:false as saved only after the reread contains every draft', async () => {
  const draftId = 'e0b07d7a-d16a-464c-8289-b92a2603e0b8';
  const existing = { taskId, service: [serviceId], platform: [note.PLATFORM_IDS.web], is_public_internet: false, feature_public_internet: false, have_financial_transactions: false, server_api: [], drafts: [{ vulnerability_name: 'Old bug' }, { vulnerability_name: 'New bug' }] };
  const payload = { ...note.toSavePayload(existing, taskId), drafts: existing.drafts };
  const result = await note.save(payload, { addMultiple: async () => ({ ok: false }), getDraft: async id => { assert.equal(id, draftId); return { data: existing }; } }, { draftId });
  assert.equal(result.verified, true);
  await assert.rejects(() => note.save(payload, { addMultiple: async () => ({ ok: false }), getDraft: async () => ({ data: { ...existing, drafts: [existing.drafts[0]] } }) }, { draftId }), /không xác nhận lưu/);
});

test('Note BM02 rejects an absent service and chooses the first matching service when names repeat', () => {
  assert.deepEqual(note.reportDefaults(taskId).services, []);
  assert.throws(() => note.findService({ data: [{ service_id: serviceId, service_name: 'Other system' }] }, 'AI Platform'), /Không tìm thấy dịch vụ CSD/);
  assert.deepEqual(note.findService({ data: [
    { service_id: '64eeb45d-a26a-4204-9288-42199ffa87fd', service_name: 'ECM Archive' },
    { service_id: serviceId, service_name: 'ECM' },
    { children: [{ service_id: '64eeb45d-a26a-4204-9288-42199ffa87fd', service_name: ' ecm ' }] }
  ] }, 'ECM'), { id: serviceId, name: 'ECM' });
});

test('Note BM02 preserves explicit BM01 HTTP scheme and uses HTTPS for a path-only placeholder', () => {
  const extracted = review.parseApis('GET http://10.4.236.98:10002/mb-website-cms/v1/posts\nPOST http://10.4.236.98:10002/mb-website-cms/v1/posts\nGET https://uat.example.test/api/users\nGET /api/relative');
  assert.deepEqual(note.apiUrls(extracted.apis), [
    { api: 'http://10.4.236.98:10002/mb-website-cms/v1/posts', env: false },
    { api: 'https://uat.example.test/api/users', env: false },
    { api: 'https://{base-url}/api/relative', env: false }
  ]);
});

test('Note BM02 requires an unambiguous task and produces safe severity-specific bug drafts', async () => {
  assert.throws(() => note.findTask({ data: [{ task_name: 'PENTEST 20797 - A', task_id: taskId }, { task_name: 'PENTEST 20797 - B', task_id: taskId }] }, '20797'), /nhiều task/);
  const result = await note.generateBug({ bug: { severity: 'high', testCaseCode: 'TC-USER-001', description: 'Concurrent user creation requests allow duplicate usernames despite the uniqueness check.' }, bm01: { pyc: '20797', blocks: [{ text: 'User management feature' }] } }, async prompt => {
    assert.match(prompt, /20797/); assert.match(prompt, /TC-USER-001/); assert.match(prompt, /natural, concise Vietnamese paragraph/);
    assert.match(prompt, /do not pad the report or put each sentence on its own line/); assert.match(prompt, /\[Ảnh PoC:/); assert.match(prompt, /Never say that information\/evidence is missing/); assert.doesNotMatch(prompt, /must add the exact observed detail/);
    assert.match(prompt, /OTG-BUSLOGIC-004/);
    return { vulnerabilityName: 'TC-USER-001 - [UAT] - Race condition allows duplicate usernames', description: 'The user creation flow checks whether a username already exists before saving a new account.\nThe check and insert are separate operations, so concurrent requests can both pass the check before either write completes.\nThis allows multiple accounts with the same username to be created despite the duplicate-name validation.\nDuplicate identities can cause ambiguity in authentication, authorization, account lookup, and audit records.', pocSteps: ['Open user creation and enter a new test username.', 'Submit concurrent copies of the create request using that same username. [Screenshot evidence: concurrent request results]', 'Refresh the user list and confirm duplicate accounts exist. [Screenshot evidence: duplicate usernames]'], recommendation: ['Enforce a database unique constraint on usernames.', 'Perform the uniqueness check and insert atomically.', 'Return a consistent conflict response when a duplicate is rejected.'], suggestedTestCaseCodes: ['OTG-BUSLOGIC-004', 'FAKE-999'] };
  });
  assert.equal(result.generated.vulnerabilityName, '[TC-USER-001] - [UAT] - Race condition allows duplicate usernames');
  assert.deepEqual(result.generated.suggestedTestCaseCodes, ['OTG-BUSLOGIC-004']);
  assert.doesNotMatch(result.generated.description, /\n/);
  assert.match(result.draft.draft_content, /user creation flow/); assert.match(result.draft.draft_content, /new account\. The check and insert/);
  assert.doesNotMatch(result.draft.draft_content, /<br>/);
  assert.match(result.draft.draft_content, /Screenshot evidence: duplicate usernames/); assert.doesNotMatch(result.draft.draft_content, /\u1ea2nh PoC:<\/p><p><\/p>/);
  assert.equal(result.draft.affected_device, '');
  assert.equal(note.formatBugName('Race condition', ''), '[N/A] - [UAT] - Race condition');
  assert.equal(note.formatBugName('[AUTH-087] - [UAT] - AUTH-087 - [UAT] - Race condition', 'AUTH-087'), '[AUTH-087] - [UAT] - Race condition');
  assert.equal(note.buildBugDraft({ bug: { severity: 'high', testCaseCode: 'TC-USER-001' }, generated: result.generated }).vulnerability_name, result.generated.vulnerabilityName);
  assert.equal(result.draft.custom_rating_id, note.SEVERITIES.high.id);
  assert.equal(result.draft.assessment_detail[2].level.severity, note.SEVERITIES.high.id);
  assert.equal(result.draft.solution.split('\n').length, 3);
  let posted;
  await note.save({ ...note.reportDefaults(taskId), is_public_internet: false, feature_public_internet: false, have_financial_transactions: true, platform_id: [note.PLATFORM_IDS.api], server_api: [{ api: 'https://api.test/a', env: false }], services: [serviceId], drafts: [result.draft] }, { addMultiple: async payload => { posted = payload; return { ok: true }; } });
  assert.equal(posted.taskId, taskId); assert.equal(posted.drafts.length, 1);
  let emptyApiPosted;
  await note.save({ ...note.reportDefaults(taskId), is_public_internet: false, feature_public_internet: false, have_financial_transactions: false, platform_id: [note.PLATFORM_IDS.web], server_api: [], services: [serviceId], drafts: [] }, { addMultiple: async payload => { emptyApiPosted = payload; return { ok: true }; } });
  assert.deepEqual(emptyApiPosted.server_api, []);
});
