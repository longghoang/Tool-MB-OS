const checklistService = require('./bm02Checklist.service');
const { createGateway } = require('./bm02Gateway.service');
const bm02Review = require('./bm02Review.service');
const scopeReview = require('./scopeReview.service');
const gateway = createGateway();
const DEFAULT_CHECKLIST = checklistService.DEFAULT_CHECKLIST;
const PLATFORM_IDS = { mobile: '5d37739c-ad20-43d8-be7b-a4c2a10a6c09', web: '86ba0f31-df07-46e4-83be-41fc6fc2b536', api: 'b7d592dd-907f-4e70-8986-d18dff9eee0b', other: '6281850e-a316-4a7b-a93f-318cc98e5ece' };
const SEVERITIES = {
  critical: { id: '9490cda0-003b-4336-b1b3-0fade589ca90', name: 'Nghiêm trọng', impact: ['Cao', 2, 'cao'], priority: ['Khẩn cấp', 1, 'khan_cap'], seriousness: ['Nghiêm trọng', 1], tempWeight: 1, time: true },
  high: { id: '6f57a391-577f-4387-99f5-ceade6867e3e', name: 'Cao', impact: ['Trung bình', 3, 'trung_binh'], priority: ['Cao', 2, 'cao'], seriousness: ['Cao', 2], tempWeight: 1 },
  medium: { id: 'd42fa417-0da8-4b4d-9fef-6e137718beb1', name: 'Trung bình', impact: ['Trung bình', 3, 'trung_binh'], priority: ['Trung bình', 3, 'trung_binh'], seriousness: ['Trung bình', 3], tempWeight: 4 },
  low: { id: 'a5288387-03e8-441b-b3ee-a0d9aaff9d67', name: 'Thấp', impact: ['Trung bình', 3, 'trung_binh'], priority: ['Thấp', 4, 'thap'], seriousness: ['Thấp', 4], tempWeight: 4, detailVulnCode: 'c9e3b2f6-a7c3-4e0c-b459-6cef6ec89c2d', referenceDraftId: '7c1b1ad2-d55e-4deb-8fb9-a580512634ac' }
};
const yesNo = value => value === 'yes' ? true : value === 'no' ? false : null;
function asArray(body) { for (const c of [body?.data, body?.results, body?.tasks, body]) { if (Array.isArray(c)) return c; if (Array.isArray(c?.results)) return c.results; if (Array.isArray(c?.tasks)) return c.tasks; } return []; }
function findTask(response, number) {
  const matches = asArray(response).filter(task => task && bm02Review.matchesNumber(task.task_name, number));
  if (matches.length !== 1) throw new Error(matches.length ? `Có nhiều task cùng số Phiếu Yêu cầu ${number}; chưa xác định được task cần ghi Note BM02.` : `Chưa tìm thấy task đang xử lý cho Phiếu Yêu cầu ${number}.`);
  const task = matches[0];
  if (typeof task.task_id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(task.task_id)) throw new Error('Task BM02 không có task_id hợp lệ.');
  const fullDraftId = typeof task.full_draft_id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(task.full_draft_id) ? task.full_draft_id : null;
  return { taskId: task.task_id, taskName: String(task.task_name || ''), fullDraftId };
}
function normalizeServiceName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
}
function findService(response, systemName) {
  if (!String(systemName || '').trim()) throw new Error('Không đọc được tên hệ thống từ Phiếu Yêu cầu.');
  const entries = []; const visited = new WeakSet();
  function visit(value) {
    if (typeof value === 'string' && /^[\[{]/.test(value.trim())) { try { visit(JSON.parse(value)); } catch {} return; }
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value.service_id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.service_id) && typeof value.service_name === 'string') entries.push({ id: value.service_id, name: value.service_name.trim() });
    Object.values(value).forEach(visit);
  }
  visit(response);
  const target = normalizeServiceName(systemName);
  const matches = [...new Map(entries.filter(entry => normalizeServiceName(entry.name) === target).map(entry => [entry.id.toLowerCase(), entry])).values()];
  if (!matches.length) throw new Error(`Không tìm thấy dịch vụ CSD khớp tên hệ thống "${systemName}" trong Phiếu Yêu cầu.`);
  // CSD can return distinct IDs for the same service name. Use the first match
  // in the folder tree so the report contains exactly one service ID.
  return matches[0];
}
function apiUrls(apis) {
  const seen = new Set(); const output = [];
  for (const api of Array.isArray(apis) ? apis : []) {
    const path = String(api.path || '/api').replace(/%7b/ig, '{').replace(/%7d/ig, '}').replace(/\s+/g, '');
    const host = String(api.host || '').trim();
    const protocol = /^https?:?$/i.test(String(api.protocol || '')) ? String(api.protocol).toLowerCase().replace(/:?$/, '://') : 'https://';
    const url = `${host ? protocol + host : 'https://{base-url}'}${path.startsWith('/') ? path : '/' + path}`;
    const key = `${protocol}${host.toLowerCase()}${path}`;
    if (!seen.has(key)) { seen.add(key); output.push({ api: url, env: false }); }
  }
  return output;
}
function parseApiUrls(input) {
  const lines = String(input || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const seen = new Set(); const output = [];
  for (const raw of lines) {
    const line = raw.replace(/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*:?[\s]+/i, '').replace(/\s+/g, '');
    let url;
    if (/^https?:\/\//i.test(line)) {
      const parsed = new URL(line); url = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/%7b/ig, '{').replace(/%7d/ig, '}')}`;
    } else if (line.startsWith('/')) url = `https://{base-url}${line.replace(/%7b/ig, '{').replace(/%7d/ig, '}')}`;
    else throw new Error(`API không hợp lệ: ${raw}`);
    const key = url.replace(/^https?:\/\//i, '').toLowerCase();
    if (!seen.has(key)) { seen.add(key); output.push({ api: url, env: false }); }
  }
  return output;
}
function reportDefaults(taskId) {
  return { taskId, reportType: '6783e051-85ee-4407-9b62-2dcdf61ba171', rangeType: 2, rangeAddr: null, source_code: true, app_account: false, system_account: true, url: false, documents: true, list_api: false, audit_and_malware: '', process_scan: '', network_scan: '', registry_scan: '', system_audit: '', cloud_audit: '', list_check_result: '', checklist: '', drafts: [], is_new_system: false, is_public_internet: null, feature_public_internet: null, have_financial_transactions: null, name_app: null, name_room: null, strong_authentication: null, partner_connection: 'Leaseline / Direct connect / VPN  / Public Internet / ....', system_hostname: [], server_api: [], platform_id: [], is_type_of_review: true, services: [], other: '', note_1: '', note_2: '', note_3: '', note_4: '', note_5: '', response_bda1: '', response_bda2: '', response_bda3: '', response_bda4: '', response_bda5: '' };
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function findDraftPayload(response, taskId) {
  const exactMatches = [];
  const structuralMatches = [];
  const seen = new WeakSet();
  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) {
      const sameTask = String(value.taskId || value.task_id || '').toLowerCase() === String(taskId).toLowerCase();
      const looksLikeDraft = Array.isArray(value.drafts) && (Array.isArray(value.server_api) || Array.isArray(value.service) || Array.isArray(value.services) || value.checklist !== undefined);
      if (sameTask && looksLikeDraft) exactMatches.push(value);
      else if (looksLikeDraft) structuralMatches.push(value);
      Object.values(value).forEach(visit);
      return;
    }
    value.forEach(visit);
  }
  visit(response);
  const match = exactMatches[0] || structuralMatches[0];
  return match ? clone(match) : null;
}
async function getExistingDraft(draftId, taskId, api = gateway) {
  if (typeof api.getDraft !== 'function') return null;
  try {
    return findDraftPayload(await api.getDraft(draftId), taskId);
  } catch (error) {
    // CSD returns 404 for a task that has not had its first BM02 draft created.
    if (/\bHTTP 404\b/i.test(String(error?.message || ''))) return null;
    throw error;
  }
}
function appendDrafts(payload, newDrafts) {
  const previous = Array.isArray(payload?.drafts) ? payload.drafts : [];
  return [...previous, ...newDrafts.map((draft, index) => ({ ...draft, ordinal: previous.length + index }))];
}
function toSavePayload(existing, taskId) {
  const source = clone(existing || {});
  const defaults = reportDefaults(taskId);
  const payload = { ...source, taskId };
  for (const [key, value] of Object.entries(defaults)) {
    if (Object.hasOwn(source, key)) payload[key] = clone(source[key]);
    else if (!Object.hasOwn(payload, key)) payload[key] = clone(value);
  }
  payload.rangeType = source.rangeType ?? source.range_type ?? defaults.rangeType;
  payload.rangeAddr = source.rangeAddr ?? source.range_addr ?? defaults.rangeAddr;
  payload.platform_id = Array.isArray(source.platform_id) ? clone(source.platform_id) : Array.isArray(source.platform) ? clone(source.platform) : defaults.platform_id;
  payload.services = Array.isArray(source.services) ? clone(source.services) : Array.isArray(source.service) ? clone(source.service) : defaults.services;
  payload.drafts = Array.isArray(source.drafts) ? clone(source.drafts) : [];
  return payload;
}
async function prepare({ bm01, number, mode = 'new' }, { api = gateway, extract = bm02Review.extractBm01 } = {}) {
  number = bm02Review.requestNumber(number);
  if (!['new', 'append'].includes(mode)) throw new Error('Chế độ Note BM02 không hợp lệ.');
  if (!bm01 || bm01.kind !== 'bm01' || bm01.error) throw new Error('Chưa có BM01 hợp lệ trong phiên.');
  const [taskResponse, extracted, issueHtml] = await Promise.all([api.getBm02Tasks(), extract(bm01, number, async () => {}), api.getIssue(number)]);
  const task = findTask(taskResponse, number);
  const issue = bm02Review.parseIssue(issueHtml, number);
  const matchedService = findService(await api.getFolderTree(), issue.systemName);
  // CSD's getMyListById endpoint expects full_draft_id. task_id is retained
  // solely for addMultiple's taskId field and must never be used to fetch a draft.
  const existingDraft = task.fullDraftId ? await getExistingDraft(task.fullDraftId, task.taskId, api) : null;
  if (mode === 'new' && existingDraft) throw new Error('BM02 này đã có bản nháp trên CSD. Chọn “Note tiếp bug” để giữ nguyên bản nháp và bổ sung lỗ hổng.');
  if (mode === 'append' && !existingDraft) throw new Error('Chưa có bản nháp BM02 trên CSD. Hãy dùng “Note BM02 mới” trước.');
  const payload = existingDraft ? toSavePayload(existingDraft, task.taskId) : reportDefaults(task.taskId);
  if (!existingDraft) {
    payload.is_public_internet = yesNo(extracted.fields?.publicInternet); payload.feature_public_internet = yesNo(extracted.fields?.internetImpact); payload.have_financial_transactions = yesNo(extracted.fields?.financialTransactions);
    payload.platform_id = Object.entries(PLATFORM_IDS).filter(([key]) => extracted.fields?.[key] === 'yes').map(([, id]) => id); payload.server_api = apiUrls(extracted.apis); payload.services = [matchedService.id];
  }
  if (!Array.isArray(payload.drafts)) payload.drafts = [];
  const existingServiceId = Array.isArray(payload.services) && payload.services.length === 1 ? payload.services[0] : null;
  return { number, ...task, mode, systemName: issue.systemName, serviceName: existingServiceId === matchedService.id ? matchedService.name : (mode === 'append' ? 'Dịch vụ trong bản nháp hiện có' : matchedService.name), serviceId: existingServiceId || matchedService.id, payload, existingDraftCount: existingDraft ? payload.drafts.length : 0, sourceStatus: { publicInternet: extracted.fields?.publicInternet || 'unknown', internetImpact: extracted.fields?.internetImpact || 'unknown', financialTransactions: extracted.fields?.financialTransactions || 'unknown', platforms: Object.fromEntries(Object.keys(PLATFORM_IDS).map(key => [key, extracted.fields?.[key] || 'unknown'])), apiCount: (payload.server_api || []).length, unparsedApis: extracted.unparsed || 0 } };
}
function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function normalizeDescription(value) {
  return String(value || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean).join('\n\n');
}
function detailForSeverity(s) {
  const tuple = (id, name, v) => ({ id, name, level: { name: v[0], weight: v[1], severity: v[2] } });
  const details = [tuple('MUC_DO_ANH_HUONG', 'Mức độ ảnh hưởng', s.impact), tuple('MUC_DO_UU_TIEN', 'Mức độ ưu tiên', s.priority), tuple('MUC_DO_NGHIEM_TRONG', 'Mức độ nghiêm trọng', [...s.seriousness, s.id])];
  details[2].level.severity = s.id; details.push({ id: 'TEMP_MUC_DO_NGHIEM_TRONG', name: null, level: { name: null, weight: s.tempWeight, severity: null } });
  if (s.time) details.push({ id: 'THOI_GIAN_XU_LY', name: 'Thời gian xử lý', level: { name: '1 ngày', weight: null, severity: '1' } });
  return details;
}
const BUG_TITLE_PREFIX = /^\s*(?:\[[^\]]+\]|[a-z0-9][a-z0-9._/-]*)\s*[-\u2013\u2014]\s*(?:\[UAT\]|UAT)\s*[-\u2013\u2014]\s*/i;
function stripBugTitlePrefix(value) {
  let title = String(value || '').trim();
  while (BUG_TITLE_PREFIX.test(title)) title = title.replace(BUG_TITLE_PREFIX, '').trim();
  return title;
}
function formatBugName(value, testCaseCode) {
  const suppliedCode = String(testCaseCode || '').trim().replace(/^\[|\]$/g, '');
  const code = suppliedCode && !/^(?:m\u00e3 test case|test case|n\/?a)$/i.test(suppliedCode) ? suppliedCode : 'N/A';
  const title = stripBugTitlePrefix(value);
  return '[' + code + '] - [UAT] - ' + title;
}
function buildBugDraft({ bug, generated, ordinal = 0 }) {
  const s = SEVERITIES[String(bug?.severity || '').toLowerCase()]; if (!s) throw new Error('Chọn mức độ bug hợp lệ cho từng bug.');
  const rawTitle = stripBugTitlePrefix(generated?.vulnerabilityName || bug?.vulnerabilityName); const title = formatBugName(rawTitle, bug?.testCaseCode).slice(0, 180); const description = normalizeDescription(generated?.description);
  const steps = Array.isArray(generated?.pocSteps) ? generated.pocSteps.map(v => String(v).trim()).filter(Boolean).slice(0, 12) : [];
  const recommendations = Array.isArray(generated?.recommendation) ? generated.recommendation.map(v => String(v).trim()).filter(Boolean).slice(0, 4) : [];
  if (!rawTitle || !description || !steps.length || recommendations.length < 3) throw new Error('Hãy tạo đủ tên lỗi, mô tả, PoC và khuyến nghị AI trước khi lưu.');
  const descriptionHtml = description.split('\n\n').map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('');
  const content = `<p>M\u00f4 t\u1ea3:</p>${descriptionHtml}<p>PoC:</p><ol>${steps.map(v => `<li>${escapeHtml(v)}</li>`).join('')}</ol>`;
  const draft = { description_draft: null, vulnerability_name: title, draft_content: content, affected_device: '', solution: recommendations.join('\n'), custom_rating_id: s.id, status: null, draft_handler: null, range_type: 2, draft_type: 2, ordinal, reference_draft_id: s.referenceDraftId || null, assessment_detail: detailForSeverity(s), asset_by: [] };
  if (s.detailVulnCode) { draft.detail_vuln_code = s.detailVulnCode; draft.new_draft_detail_vuln_code = s.detailVulnCode; }
  return draft;
}
async function generateBug({ bug, bm01 }, ai = scopeReview.askJson) {
  const description = String(bug?.description || '').trim(); const s = SEVERITIES[String(bug?.severity || '').toLowerCase()];
  if (description.length < 10) throw new Error('Mô tả bug cần ít nhất 10 ký tự.'); if (!s) throw new Error('Chọn mức độ bug hợp lệ.');
  const testCaseCode = String(bug?.testCaseCode || '').trim().slice(0, 80);
  const context = (bm01?.blocks || []).slice(0, 120).map(block => block.text).join('\n').slice(0, 20000);
  const checklistCases = checklistService.listCases();
  const checklistIndex = checklistCases.map(item => `${item.code}: ${item.title} — ${item.description.slice(0, 100)}`).join('\n');
  const generated = await ai([
    'Write a polished, ready-to-use Vietnamese BM02 vulnerability report from the pentester bug description and BM01 context.',
    'Title: return only a concise vulnerability title. Do not include a test case code, [UAT], or any prefix; the application adds the prefix automatically. The pentester-selected title code is ' + (testCaseCode || 'N/A') + '. Keep suggested checklist codes in their separate JSON field; never put them in the title.',
    'Description: write a natural, concise Vietnamese paragraph explaining the feature, how the flaw works, the observed behavior, and its practical impact. Aim for roughly 4-5 useful sentences when the facts support them, but do not pad the report or put each sentence on its own line. Write a finished report with concrete reasoning. Never say that information/evidence is missing, never ask the pentester to add details, and never insert placeholders. Do not claim a specific endpoint, parameter, account, payload, response, log, or observation unless supplied. When those details are unknown, omit them and explain the confirmed behavior clearly.',
    'PoC: write 4-6 detailed, ordered, reproducible steps grounded in the bug description. Generic UI navigation and safe synthetic sample values are allowed; identify sample values as examples, not observed data. Do not invent exact endpoints, real accounts, responses, or proof. Append a short Vietnamese note such as [Ảnh PoC: kết quả hiển thị hai user trùng tên] directly to each step where a screenshot should be captured. Do not add a separate empty image section.',
    'Recommendations: give 3-4 concise actionable lines specific to this flaw. Do not write the affected location; it is a separate field. Keep the pentester-selected severity: ' + s.name + '.',
    'Suggest 1-3 matching checklist test case codes from the exact catalog below. Base suggestions on the flaw described, not merely shared generic words. If none fits, return an empty array. Never invent a code. Suggestions are advisory: the pentester chooses which cases actually fail.',
    'Return JSON: {"vulnerabilityName":"title without prefix","description":"one natural paragraph","pocSteps":["step 1"],"recommendation":["recommendation 1","recommendation 2","recommendation 3"],"suggestedTestCaseCodes":["OTG-..."]}.',
    'PYC: ' + String(bm01?.pyc || ''),
    'Test case code: ' + (testCaseCode || 'N/A'),
    'Bug description: ' + description.slice(0, 8000),
    'BM01 context: ' + context,
    'Checklist catalog:\n' + checklistIndex
  ].join('\n'));
  if (!generated || typeof generated.vulnerabilityName !== 'string' || typeof generated.description !== 'string' || !Array.isArray(generated.pocSteps) || !Array.isArray(generated.recommendation)) throw new Error('AI returned an invalid bug note structure.');
  const normalizedGenerated = { ...generated, description: normalizeDescription(generated.description) };
  const suggestions = Array.isArray(generated.suggestedTestCaseCodes) ? [...new Set(generated.suggestedTestCaseCodes.map(code => String(code).trim().toUpperCase()))].filter(code => checklistCases.some(item => item.code === code)).slice(0, 3) : [];
  const draft = buildBugDraft({ bug, generated: normalizedGenerated }); return { generated: { vulnerabilityName: draft.vulnerability_name, description: normalizedGenerated.description, pocSteps: generated.pocSteps, recommendation: generated.recommendation, suggestedTestCaseCodes: suggestions }, draft };
}
async function save(payload, api = gateway, { draftId } = {}) {
  if (!payload || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(payload.taskId || ''))) throw new Error('taskId không hợp lệ. Hãy tải lại task trước khi lưu.');
  if (![true, false].includes(payload.is_public_internet) || ![true, false].includes(payload.feature_public_internet) || ![true, false].includes(payload.have_financial_transactions)) throw new Error('BM01 còn thiếu một trường YES/NO bắt buộc.');
  if (!Array.isArray(payload.platform_id) || !payload.platform_id.length) throw new Error('BM01 chưa xác định được nền tảng.');
  if (!Array.isArray(payload.server_api)) throw new Error('Danh sách API không hợp lệ.');
  if (!Array.isArray(payload.services) || payload.services.length !== 1 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(payload.services[0]))) throw new Error('Chưa xác định được đúng một dịch vụ CSD cho hệ thống trong Phiếu Yêu cầu. Hãy chuẩn bị lại Note BM02.');
  if (!Array.isArray(payload.drafts)) throw new Error('Danh sách note bug không hợp lệ.');
  const response = await api.addMultiple(payload);
  if (response?.ok !== false) return response;
  if (draftId && typeof api.getDraft === 'function') {
    const saved = findDraftPayload(await api.getDraft(draftId), payload.taskId);
    const savedTitles = new Set((saved?.drafts || []).map(item => String(item?.vulnerability_name || '')));
    const intendedTitles = (payload.drafts || []).map(item => String(item?.vulnerability_name || '')).filter(Boolean);
    if (saved && intendedTitles.every(title => savedTitles.has(title))) return { ...response, verified: true };
  }
  const message = typeof response?.message === 'string' ? response.message.trim().slice(0, 300) : '';
  throw new Error(message ? `CSD: ${message}` : 'CSD không xác nhận lưu bản nháp.');
}
module.exports = { PLATFORM_IDS, SEVERITIES, DEFAULT_CHECKLIST, findTask, findService, apiUrls, parseApiUrls, reportDefaults, findDraftPayload, getExistingDraft, appendDrafts, toSavePayload, prepare, formatBugName, buildBugDraft, generateBug, save, gateway };
