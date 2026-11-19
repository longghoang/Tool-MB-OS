const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const service = require('../services/scopeReview.service');
const bm02Service = require('../services/bm02Review.service');
const bm02NoteService = require('../services/bm02Note.service');
const bm02Checklist = require('../services/bm02Checklist.service');
const config = require('../config/scope-review');
const router = express.Router();
const directory = path.join(__dirname, '..', 'reports', 'scope-reviews');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 11, fields: 3, fieldSize: 10000 } });
const running = new Set();
const runningBm02 = new Set();
const runningNote = new Set();
const chatting = new Set();
const busy = id => running.has(id) || runningBm02.has(id) || runningNote.has(id) || chatting.has(id);
const saveLocks = new Map();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.method === 'POST' && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' }); }
    catch { return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' }); }
  }
  next();
});
function filename(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Phiên đánh giá không hợp lệ.');
  return path.join(directory, `${id}.json`);
}
async function save(job) {
  const previous = saveLocks.get(job.id) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    await fs.mkdir(directory, { recursive: true });
    const file = filename(job.id);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(job), 'utf8');
      try {
        await fs.rename(temp, file);
      } catch (error) {
        // Windows does not replace an existing destination with rename().
        // The per-job lock prevents another progress write from interleaving.
        if (!['EPERM', 'EEXIST', 'EBUSY'].includes(error.code)) throw error;
        await fs.rm(file, { force: true });
        await fs.rename(temp, file);
      }
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
    }
  });
  saveLocks.set(job.id, operation);
  try { await operation; } finally { if (saveLocks.get(job.id) === operation) saveLocks.delete(job.id); }
}
async function owned(req) {
  await saveLocks.get(req.params.id);
  const job = JSON.parse(await fs.readFile(filename(req.params.id), 'utf8'));
  if (job.owner !== req.sessionID) throw new Error('Không tìm thấy phiên đánh giá trong phiên đăng nhập hiện tại.');
  return job;
}
function publicJob(job) {
  const { owner, ...out } = job;
  return { ...out, sources: job.sources.map(({ html, ...source }) => source) };
}
router.get('/', (req, res) => res.render('scope-review', { aiReady: Boolean(config.aiUrl && config.aiModel) }));
router.get('/client.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'scope-review.js')));
async function startBm02(job, number) {
  if (busy(job.id)) throw new Error('Phiên này đang xử lý. Vui lòng đợi hoàn tất.');
  number = bm02Service.requestNumber(number);
  const bm01 = job.sources.find(s => s.kind === 'bm01');
  if (!bm01) throw new Error('Chưa có BM01 để đối chiếu.');
  runningBm02.add(job.id);
  job.bm02 = { number, status: 'checking', progress: 'Bắt đầu kiểm tra BM02', progressPercent: 0, issue: null, result: null, error: null };
  try { await save(job); } catch (error) { runningBm02.delete(job.id); throw error; }
  return () => (async () => {
    try {
      job.bm02.result = await bm02Service.run({ bm01, number }, async (message, percent, issue) => {
        job.bm02.progress = message;
        if (Number.isFinite(percent)) job.bm02.progressPercent = Math.max(0, Math.min(100, percent));
        if (issue) job.bm02.issue = issue;
        await save(job);
      });
      job.bm02.status = 'complete'; job.bm02.progressPercent = 100;
    } catch (error) { job.bm02.status = 'failed'; job.bm02.error = error.message; }
    finally { try { await save(job); } finally { runningBm02.delete(job.id); } }
  })().catch(() => {});
}
router.post('/bm02/prepare', (req, res, next) => upload.single('bm01')(req, res, err => err ? res.status(400).json({ error: 'Upload một file DOCX tối đa 10 MB và nhập số Phiếu Yêu cầu.' }) : next()), async (req, res) => {
  try {
    const number = bm02Service.requestNumber(req.body.number);
    const bm01 = await service.readBm01(req.file);
    const job = { id: crypto.randomUUID(), owner: req.sessionID, createdAt: new Date().toISOString(), status: 'ready', progress: 'Đã đọc BM01', progressPercent: 0, sources: [bm01], result: null, chatHistory: [] };
    const run = await startBm02(job, number);
    res.status(202).json(publicJob(job)); run();
  } catch (error) { res.status(400).json({ error: error.message }); }
});
router.post('/:id/bm02', async (req, res) => {
  try {
    const job = await owned(req);
    if (busy(job.id)) return res.status(409).json({ error: 'Phiên này đang xử lý. Vui lòng đợi hoàn tất.' });
    const run = await startBm02(job, req.body.number);
    res.status(202).json(publicJob(job)); run();
  } catch (error) { res.status(400).json({ error: error.message }); }
});
router.post('/:id/note-bm02/prepare', async (req, res) => {
  let lockedId;
  try {
    const job = await owned(req);
    if (busy(job.id)) return res.status(409).json({ error: 'Phiên này đang xử lý. Vui lòng đợi hoàn tất.' });
    const bm01 = job.sources.find(source => source.kind === 'bm01');
    if (!bm01) return res.status(400).json({ error: 'Đọc BM01 trước khi chuẩn bị Note BM02.' });
    lockedId = job.id; runningNote.add(lockedId);
    const mode = req.body?.mode === 'append' ? 'append' : 'new';
    const prepared = await bm02NoteService.prepare({ bm01, number: req.body.number, mode });
    bm01.pyc = prepared.number;
    job.noteBm02 = { ...prepared, reportNote: '', checklist: '', listCheckResult: '', status: 'ready', savedAt: null };
    await save(job);
    res.json({ noteBm02: job.noteBm02 });
  } catch (error) { res.status(400).json({ error: error.message }); }
  finally { if (lockedId) runningNote.delete(lockedId); }
});
router.get('/checklist-cases', (req, res) => res.json({ cases: bm02Checklist.listCases() }));
router.post('/:id/note-bm02/bug-note', async (req, res) => {
  let lockedId;
  try {
    const job = await owned(req);
    if (busy(job.id)) return res.status(409).json({ error: 'Phiên này đang xử lý. Vui lòng đợi hoàn tất.' });
    if (!job.noteBm02?.payload?.taskId) return res.status(400).json({ error: 'Chuẩn bị task Note BM02 trước.' });
    const bm01 = job.sources.find(source => source.kind === 'bm01');
    lockedId = job.id; runningNote.add(lockedId);
    const result = await bm02NoteService.generateBug({ bug: req.body?.bug, bm01 });
    res.json(result.generated);
  } catch (error) { res.status(400).json({ error: error.message || 'Không tạo được note bug.' }); }
  finally { if (lockedId) runningNote.delete(lockedId); }
});
router.post('/:id/note-bm02/save', async (req, res) => {
  let lockedId;
  try {
    const job = await owned(req);
    if (busy(job.id)) return res.status(409).json({ error: 'Phiên này đang xử lý. Vui lòng đợi hoàn tất.' });
    if (!job.noteBm02?.payload?.taskId) return res.status(400).json({ error: 'Chuẩn bị task Note BM02 trước.' });
    const body = req.body || {}; const payload = structuredClone(job.noteBm02.payload);
    if (!job.noteBm02.serviceId || payload.services?.length !== 1) return res.status(400).json({ error: 'Chưa xác định được dịch vụ CSD trong bản nháp. Hãy chuẩn bị lại Note BM02 trước khi lưu.' });
    const noBugMode = body.noBugMode === true;
    const bugs = noBugMode ? [] : (Array.isArray(body.bugs) ? body.bugs.slice(0, 20) : []);
    const selectedByBug = bugs.map(bug => bm02Checklist.validateCodes(bug.testCaseCodes || []));
    if (job.noteBm02.mode === 'append' && noBugMode) return res.status(400).json({ error: 'Chế độ Note tiếp bug chỉ dùng để bổ sung lỗ hổng. Phiếu No Bug chỉ áp dụng khi tạo BM02 mới.' });
    if (job.noteBm02.mode === 'append' && !bugs.length) return res.status(400).json({ error: 'Thêm ít nhất một bug đã được AI soạn trước khi Note tiếp bug.' });
    if (noBugMode) payload.checklist = bm02NoteService.DEFAULT_CHECKLIST;
    else {
      const selectedCodes = selectedByBug.flat();
      payload.checklist = bm02Checklist.applyFailures(payload.checklist, selectedCodes);
    }
    const newDrafts = bugs.map((bug, ordinal) => bm02NoteService.buildBugDraft({ bug: { severity: bug.severity, testCaseCode: selectedByBug[ordinal].length ? selectedByBug[ordinal].join(', ') : bug.testCaseCode, vulnerabilityName: bug.vulnerabilityName }, generated: { vulnerabilityName: bug.vulnerabilityName, description: bug.description, pocSteps: String(bug.pocSteps || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean), recommendation: String(bug.recommendation || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean) }, ordinal }));
    payload.drafts = job.noteBm02.mode === 'append' ? bm02NoteService.appendDrafts(payload, newDrafts) : newDrafts;
    lockedId = job.id; runningNote.add(lockedId);
    await bm02NoteService.save(payload, bm02NoteService.gateway, { draftId: job.noteBm02.fullDraftId });
    job.noteBm02 = { ...job.noteBm02, payload, noBugMode, status: 'saved', savedAt: new Date().toISOString(), savedBugCount: payload.drafts.length, appendedBugCount: job.noteBm02.mode === 'append' ? newDrafts.length : 0 };
    await save(job);
    res.json({ ok: true, savedAt: job.noteBm02.savedAt, bugCount: payload.drafts.length, appendedBugCount: job.noteBm02.appendedBugCount });
  } catch (error) { res.status(400).json({ error: error.message || 'Không lưu được Note BM02.' }); }
  finally { if (lockedId) runningNote.delete(lockedId); }
});
router.post('/prepare', (req, res, next) => upload.fields([{ name: 'bm01', maxCount: 1 }, { name: 'references', maxCount: 10 }])(req, res, err => err ? res.status(400).json({ error: 'Upload BM01 DOCX và tối đa 10 file tham chiếu DOCX/PDF, mỗi file không quá 10 MB.' }) : next()), async (req, res) => {
  try {
    const bm01File = req.files?.bm01?.[0];
    const referenceFiles = req.files?.references || [];
    const documentInput = String(req.body.documents || '').trim();
    const entries = documentInput ? service.parseEntries(documentInput) : [];
    if (!bm01File && !entries.length && !referenceFiles.length) throw new Error('Nhập ID/URL tài liệu hoặc tải BM01/file tham chiếu trước khi đọc đầu vào.');
    const sources = [];
    if (bm01File) sources.push(await service.readBm01(bm01File));
    for (let i = 0; i < entries.length; i++) sources.push(await service.fetchDocument(entries[i], i));
    for (let i = 0; i < referenceFiles.length; i++) sources.push(await service.readReferenceFile(referenceFiles[i], i));
    const job = { id: crypto.randomUUID(), owner: req.sessionID, createdAt: new Date().toISOString(), status: 'ready', progress: 'Đã đọc đầu vào', progressPercent: 0, sources, result: null, chatHistory: [] };
    await save(job);
    res.json(publicJob(job));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.get('/:id', async (req, res) => {
  try {
    const job = await owned(req);
    if (job.status === 'analyzing' && !running.has(job.id)) { job.status = 'failed'; job.error = 'Phân tích bị gián đoạn do server khởi động lại. Có thể chạy lại.'; await save(job); }
    if (job.bm02?.status === 'checking' && !runningBm02.has(job.id)) { job.bm02.status = 'failed'; job.bm02.error = 'Kiểm tra BM02 bị gián đoạn do server khởi động lại. Bấm Check BM02 để chạy lại.'; await save(job); }
    res.json(publicJob(job));
  } catch { res.status(404).json({ error: 'Không tìm thấy phiên đánh giá của bạn.' }); }
});
router.get('/:id/source/:sourceId', async (req, res) => {
  try {
    const job = await owned(req);
    const source = job.sources.find(s => s.id === req.params.sourceId);
    if (!source || source.error) return res.status(404).send('Không có nội dung tài liệu.');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.set('Cache-Control', 'no-store');
    res.type('html').send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><link rel="icon" type="image/svg+xml" href="/workspace/favicon.svg?v=2"><style>body{font:15px/1.65 system-ui;padding:24px;color:#172033;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px}pre{white-space:pre-wrap}a{pointer-events:none}</style></head><body>${source.html}</body></html>`);
  } catch { res.status(404).send('Không tìm thấy tài liệu.'); }
});
router.post('/:id/analyze', async (req, res) => {
  try {
    const job = await owned(req);
    if (!config.aiUrl || !config.aiModel) return res.status(400).json({ error: 'Cấu hình SCOPE_AI_URL và SCOPE_AI_MODEL rồi khởi động lại server.' });
    if (busy(job.id)) return res.status(409).json({ error: 'Phiên này đang xử lý. Vui lòng đợi hoàn tất.' });
    if (!job.sources.some(s => !s.error)) return res.status(400).json({ error: 'Chưa đọc được BM01 hoặc tài liệu nào để phân tích.' });
    running.add(job.id);
    job.status = 'analyzing'; job.result = null; job.error = null; job.progress = 'Bắt đầu phân tích'; job.progressPercent = 0;
    try { await save(job); } catch (e) { running.delete(job.id); throw e; }
    res.status(202).json({ ok: true });
    (async () => {
      try {
        job.result = await service.analyze(job.sources, async (message, percent) => { job.progress = message; if (Number.isFinite(percent)) job.progressPercent = Math.max(0, Math.min(100, percent)); await save(job); });
        job.status = 'complete'; job.progress = 'Đã phân tích; cần pentester xác nhận'; job.progressPercent = 100;
      } catch (e) { job.status = 'failed'; job.error = e.message; }
      finally { try { await save(job); } finally { running.delete(job.id); } }
    })().catch(() => {});
  } catch { res.status(400).json({ error: 'Không thể bắt đầu phân tích phiên này.' }); }
});
router.post('/:id/review', async (req, res) => {
  try {
    const job = await owned(req);
    if (busy(job.id)) return res.status(409).json({ error: 'Phiên này đang xử lý. Vui lòng đợi hoàn tất.' });
    if (job.status !== 'complete') throw new Error('Chưa có kết quả hoàn tất.');
    const finding = job.result.findings.find(f => f.id === req.body.findingId);
    if (!finding || !['pending','confirmed','fixed','exception'].includes(req.body.review)) throw new Error('Trạng thái không hợp lệ.');
    const note = String(req.body.note || '').trim().slice(0, 5000);
    if (req.body.review === 'exception' && !note) throw new Error('Nhập lý do cho ngoại lệ.');
    finding.review = req.body.review; finding.note = note; finding.reviewedAt = new Date().toISOString();
    await save(job); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/:id/chat', async (req, res) => {
  let lockedId;
  try {
    const job = await owned(req);
    if (busy(job.id)) return res.status(409).json({ error: 'Phiên này đang xử lý. Vui lòng đợi hoàn tất.' });
    if (job.status !== 'complete' || !job.result) return res.status(400).json({ error: 'Chỉ có thể hỏi chatbot sau khi phân tích hoàn tất.' });
    const question = String(req.body?.question || '').trim();
    if (question.length < 2 || question.length > 4000) return res.status(400).json({ error: 'Câu hỏi phải dài từ 2 đến 4.000 ký tự.' });
    const history = Array.isArray(job.chatHistory) ? job.chatHistory : [];
    lockedId = job.id; chatting.add(lockedId);
    const answer = await service.chat({ sources: job.sources, result: job.result, history, question });
    job.chatHistory = [...history, { role: 'user', content: question, createdAt: new Date().toISOString() }, { role: 'assistant', content: answer, createdAt: new Date().toISOString() }].slice(-20);
    await save(job);
    res.json({ answer, history: job.chatHistory });
  } catch (e) { res.status(400).json({ error: e.message || 'Không thể hỏi chatbot.' }); }
  finally { if (lockedId) chatting.delete(lockedId); }
});
router.get('/:id/export/json', async (req, res) => {
  try {
    const job = await owned(req);
    res.attachment(`scope-review-${job.id}.json`).json(publicJob(job));
  } catch { res.status(404).json({ error: 'Không tìm thấy phiên đánh giá.' }); }
});
module.exports = router;
