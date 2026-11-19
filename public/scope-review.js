(() => {
  const $ = id => document.getElementById(id);
  let job; let polling = false; let pending = false; let uploadedFile; let preparedSignature; let noteBugIndex = 0; let activeStage = 'analysis'; let checklistCases;
  function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
  async function request(url, options) { const r = await fetch(url, options); const body = await r.json(); if (!r.ok) throw new Error(body.error || 'Yêu cầu không thành công.'); return body; }
  function error(e) { $('error').textContent = e?.message || ''; }
  function inputSignature() {
    const file = $('bm01').files[0];
    const references = [...$('references').files].map(item => [item.name, item.size, item.lastModified]);
    return JSON.stringify([file ? [file.name, file.size, file.lastModified] : null, $('documents').value.trim(), references]);
  }
  function prepareFormData() {
    const body = new FormData(); const file = $('bm01').files[0];
    if (file) body.append('bm01', file);
    body.append('documents', $('documents').value);
    for (const reference of $('references').files) body.append('references', reference);
    return body;
  }
  function renderControls() {
    const busy = pending || job?.status === 'analyzing' || job?.bm02?.status === 'checking';
    const file = $('bm01').files[0];
    const hasInput = Boolean(file || $('documents').value.trim() || $('references').files.length || job?.sources?.some(s => !s.error));
    for (const id of ['checkBm02','bm01','documents','references','bm02Number','notePycNumber','chatSend','chatQuestion','prepareNoteBm02','appendNoteBm02','noBugMode','addNoteBug','saveNoteBm02']) $(id).disabled = busy;
    if (job?.noteBm02?.mode === 'append') $('noBugMode').disabled = true;
    $('prepare').disabled = busy || !hasInput;
    // BM01-only analysis is still useful when a Confluence page is pending
    // approval. The result will retain the source error and mark comparisons
    // as needing confirmation instead of silently disabling the action.
    $('analyze').disabled = busy || !hasInput;
    $('bm02File').textContent = file ? `BM01 được chọn: ${file.name}` : job?.sources?.find(s => s.kind === 'bm01') ? `BM01 đã đọc: ${job.sources.find(s => s.kind === 'bm01').name}` : 'Chọn file BM01 ở phần nạp hồ sơ phía trên.';
  }
  function renderBm02() {
    const state = job?.bm02; const active = state?.status === 'checking';
    $('bm02Progress').hidden = !active;
    const percent = Math.max(0, Math.min(100, Number(state?.progressPercent || 0)));
    $('bm02ProgressBar').style.width = `${percent}%`; $('bm02Percent').textContent = `${percent}%`;
    $('bm02ProgressText').textContent = state?.progress || '';
    $('bm02Issue').replaceChildren();
    if (state?.issue) {
      const issue = state.issue; const card = el('article', undefined, issue.inProgress ? 'check-pass' : 'check-alert');
      card.append(el('h3', `Phiếu ${issue.number} · ${issue.systemName || 'Chưa đọc được tên hệ thống'}`), el('p', `Trạng thái: ${issue.status || 'chưa xác định'}${issue.inProgress ? '' : ' — ALERT: yêu cầu In Progress.'}`)); $('bm02Issue').append(card);
    }
    $('bm02Error').hidden = !state?.error; $('bm02Error').textContent = state?.error ? `Chưa thể hoàn tất kiểm tra BM02. ${state.error}` : '';
    const result = state?.result; $('bm02Result').hidden = !result; $('bm02Checks').replaceChildren();
    if (!result) return;
    $('bm02Summary').textContent = result.summary; $('bm02Summary').className = `result-summary ${result.ready ? 'check-pass' : 'check-alert'}`;
    const checks = result.checks || [];
    $('bm02Counts').textContent = `BM01 ${result.matched ? 'đã khớp' : 'chưa khớp đầy đủ'} BM02 · ${checks.filter(c => c.status === 'pass').length} mục đạt · ${checks.filter(c => c.status !== 'pass').length} alert`;
    for (const check of checks) { const pass = check.status === 'pass'; const card = el('article', undefined, pass ? 'check-pass' : 'check-alert'); card.append(el('h3', `${pass ? 'ĐẠT' : 'ALERT'} · ${check.title}`), el('p', check.detail, 'prose')); $('bm02Checks').append(card); }
  }
  function renderProgress() { const active = job?.status === 'analyzing'; $('progress').hidden = !active; const percent = Math.max(0, Math.min(100, Number(job?.progressPercent || 0))); $('progressBar').style.width = `${percent}%`; $('progressPercent').textContent = `${percent}%`; $('progressText').textContent = job?.progress || 'Đang phân tích…'; }
  function findings() { $('findings').replaceChildren(); for (const f of (job.result?.findings || [])) { const card = el('article', undefined, 'finding'); card.append(el('h3', `${f.id} · ${f.title}`), el('p', f.detail, 'prose')); $('findings').append(card); } if (!job.result?.findings?.length) $('findings').append(el('p', 'Không phát hiện sai lệch cụ thể trong scope hoặc mô tả chức năng mới.')); }
  function renderChat() {
    const history = Array.isArray(job?.chatHistory) ? job.chatHistory : [];
    $('chatHistory').replaceChildren();
    if (!history.length) { $('chatHistory').append(el('p', 'Bạn có thể hỏi về luồng nghiệp vụ, logic thay đổi, scope API hoặc một alert BM01.', 'chat-empty')); return; }
    for (const item of history) {
      const user = item.role === 'user'; const row = el('div', undefined, `chat-row ${user ? 'user' : 'assistant'}`); const bubble = el('div', item.content, `chat-bubble ${user ? 'chat-user' : 'chat-assistant'}`);
      if (user) row.append(bubble); else { row.append(el('span', '♙', 'chat-mini-avatar'), bubble); }
      $('chatHistory').append(row);
    }
    $('chatHistory').scrollTop = $('chatHistory').scrollHeight;
  }
  function showTyping() {
    const row = el('div', undefined, 'chat-row assistant'); const avatar = el('span', '♙', 'chat-mini-avatar'); const bubble = el('div', undefined, 'chat-bubble chat-assistant typing');
    bubble.append(el('i'), el('i'), el('i')); row.append(avatar, bubble); $('chatHistory').append(row); $('chatHistory').scrollTop = $('chatHistory').scrollHeight;
  }
  function renderResult() {
    $('resultLayout').hidden = !job.result; $('result').hidden = false; if (!job.result) return; const r = job.result;
    $('conclusion').textContent = r.conclusion || ''; $('summary').textContent = r.summary || ''; $('business').textContent = r.businessAnalysis || '';
    $('scopeAssessment').textContent = r.scopeAssessment ? `${r.scopeAssessment.status}: ${r.scopeAssessment.detail}` : ''; $('functionAssessment').textContent = r.functionAssessment ? `${r.functionAssessment.status}: ${r.functionAssessment.detail}` : ''; findings();
    $('matrix').replaceChildren(); for (const row of r.matrix || []) { const tr = el('tr'); tr.append(el('td', `${row.source} / ${row.pyc}`), el('td', `${row.method} ${row.path || row.name}\n${row.service}`, 'prose'), el('td', `${row.change}\n${row.description}`, 'prose'), el('td', row.status)); $('matrix').append(tr); }
    $('checkAlerts').replaceChildren(); $('checkPassed').replaceChildren(); const checks = r.bm01Checks || []; const labels = { pass: 'ĐẠT', alert: 'ALERT', review: 'CẦN XÁC NHẬN', na: 'KHÔNG ÁP DỤNG' };
    for (const check of checks) { const isAlert = check.status === 'alert'; const isReview = check.status === 'review'; const isNa = check.status === 'na'; const card = el('article', undefined, isAlert ? 'check-alert' : isReview ? 'check-review' : isNa ? 'check-na' : 'check-pass'); card.append(el('h3', `${labels[check.status] || check.status} · ${check.title}`), el('p', check.detail)); (isAlert || isReview ? $('checkAlerts') : $('checkPassed')).append(card); }
    $('checkSummary').textContent = checks.length ? `${checks.filter(c => c.status === 'alert').length} alert · ${checks.filter(c => c.status === 'review').length} mục cần xác nhận · ${checks.filter(c => c.status === 'pass').length} mục đạt` : 'Chưa có checklist BM01.';
    renderChat();
  }
  function makeNoteBug() {
    const index = ++noteBugIndex; const card = document.createElement('article'); card.className = 'note-bug'; card.dataset.index = String(index);
    const head = document.createElement('div'); head.className = 'note-bug-head'; const title = el('strong', `Bug ${index}`); const remove = el('button', 'Xóa bug', 'btn ghost remove-bug'); remove.type = 'button'; remove.onclick = () => card.remove(); head.append(title, remove); card.append(head);
    const grid = document.createElement('div'); grid.className = 'note-bug-grid';
    const inputField = (labelText, tag, placeholder, cls) => { const wrap = document.createElement('div'); const label = el('label', labelText); const input = document.createElement(tag); input.placeholder = placeholder; if (cls) input.className = cls; wrap.append(label, input); return { wrap, input }; };
    const severityWrap = document.createElement('div'); const severityLabel = el('label', 'Mức độ lỗ hổng'); const severity = document.createElement('select'); severity.required = true;
    for (const [value, labelText] of [['','Chọn mức độ'],['critical','Nghiêm trọng'],['high','Cao'],['medium','Trung bình'],['low','Thấp']]) { const option = el('option', labelText); option.value = value; severity.append(option); }
    severityWrap.append(severityLabel, severity);
    const testCaseCode = inputField('M\u00e3 test case (t\u00f9y ch\u1ecdn)', 'input', 'Ch\u1ecdn t\u1eeb checklist b\u00ean d\u01b0\u1edbi', 'bug-testcase');
    testCaseCode.input.readOnly = true;
    card.selectedTestCaseCodes = [];
    const casePicker = el('div', undefined, 'case-picker'); casePicker.style.gridColumn = '1 / -1';
    const openCases = el('button', 'Xem và tìm checklist', 'btn ghost'); openCases.type = 'button';
    const casePanel = el('div', undefined, 'case-panel'); casePanel.hidden = true;
    const caseSearch = el('input'); caseSearch.type = 'search'; caseSearch.placeholder = 'Tìm mã, tên hoặc nội dung kiểm tra...';
    const caseSummary = el('small', 'Chưa chọn test case; tên bug sẽ dùng N/A.');
    const caseList = el('div', undefined, 'case-list');
    const suggestions = el('div', undefined, 'case-suggestions'); suggestions.hidden = true;
    const renderCaseList = () => {
      const query = caseSearch.value.trim().toLocaleLowerCase('vi');
      const matches = (checklistCases || []).filter(item => `${item.code} ${item.title} ${item.description}`.toLocaleLowerCase('vi').includes(query));
      caseList.replaceChildren();
      for (const item of matches) {
        const row = el('label', undefined, 'case-row'); const check = el('input'); check.type = 'checkbox'; check.checked = card.selectedTestCaseCodes.includes(item.code); check.onchange = () => updateSelected(item.code);
        const details = el('span'); details.append(el('strong', `${item.code} · ${item.title}`), el('small', item.description), el('em', `Hiện tại: ${item.result}`)); row.append(check, details); caseList.append(row);
      }
      if (!matches.length) caseList.append(el('p', 'Không tìm thấy test case phù hợp.'));
      casePanel.dataset.count = `${matches.length} kết quả`;
    };
    const updateSelected = code => {
      const selected = new Set(card.selectedTestCaseCodes);
      if (selected.has(code)) selected.delete(code); else selected.add(code);
      card.selectedTestCaseCodes = [...selected]; testCaseCode.input.value = card.selectedTestCaseCodes.join(', ');
      caseSummary.textContent = selected.size ? `${selected.size} test case sẽ được đánh Fail khi lưu BM02: ${[...selected].join(', ')}` : 'Chưa chọn test case; tên bug sẽ dùng N/A.';
      const nameInput = card.querySelector?.('.bug-name');
      if (nameInput?.value) {
        const title = nameInput.value.replace(/^\s*(?:\[[^\]]+\]|[a-z0-9][a-z0-9._/-]*)\s*[-\u2013\u2014]\s*(?:\[UAT\]|UAT)\s*[-\u2013\u2014]\s*/i, '');
        nameInput.value = `[${testCaseCode.input.value || 'N/A'}] - [UAT] - ${title}`;
      }
      renderCaseList();
    };
    openCases.onclick = async () => {
      casePanel.hidden = !casePanel.hidden; if (casePanel.hidden) return;
      if (!checklistCases) {
        openCases.disabled = true; caseSummary.textContent = 'Đang tải checklist...';
        try { checklistCases = (await request('/scope-review/checklist-cases')).cases; }
        catch (e) { caseSummary.textContent = e.message; casePanel.hidden = true; }
        finally { openCases.disabled = false; }
      }
      if (!casePanel.hidden) renderCaseList();
    };
    caseSearch.oninput = renderCaseList;
    casePanel.append(caseSearch, caseList); casePicker.append(openCases, caseSummary, suggestions, casePanel);
    const description = inputField('M\u00f4 t\u1ea3 bug c\u1ee7a pentester', 'textarea', 'M\u00f4 t\u1ea3 hi\u1ec7n t\u01b0\u1ee3ng, \u0111i\u1ec1u ki\u1ec7n v\u00e0 k\u1ebft qu\u1ea3 quan s\u00e1t...', 'bug-description'); description.wrap.style.gridColumn = '1 / -1';
    grid.append(severityWrap, testCaseCode.wrap, casePicker, description.wrap); card.append(grid);
    const generate = el('button', 'AI viết Note bug', 'btn primary'); generate.type = 'button'; card.append(generate);
    const generated = document.createElement('div'); generated.className = 'generated'; generated.hidden = true;
    const name = inputField('Tên lỗ hổng', 'input', 'Tên ngắn gọn', 'bug-name'); const finalDescription = inputField('Mô tả trong báo cáo', 'textarea', '', 'bug-final-description');
    const steps = inputField('PoC do AI soạn (mỗi bước một dòng)', 'textarea', '', 'bug-final-poc'); const recommendation = inputField('Khuyến nghị', 'textarea', '', 'bug-recommendation');
    generated.append(name.wrap, finalDescription.wrap, steps.wrap, recommendation.wrap); card.append(generated);
    generate.onclick = async () => {
      if (pending) return; pending = true; $('noteBm02Error').hidden = true; generate.disabled = true; generate.textContent = 'Đang soạn note…'; renderControls();
      try {
        const data = await request(`/scope-review/${job.id}/note-bm02/bug-note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bug: { severity: severity.value, testCaseCode: testCaseCode.input.value, description: description.input.value } }) });
        name.input.value = data.vulnerabilityName; finalDescription.input.value = data.description; steps.input.value = data.pocSteps.join('\n'); recommendation.input.value = data.recommendation.join('\n'); generated.hidden = false; generate.textContent = 'Tạo lại bằng AI';
        suggestions.replaceChildren();
        for (const code of data.suggestedTestCaseCodes || []) {
          const item = (checklistCases || []).find(entry => entry.code === code);
          const choose = el('button', `AI gợi ý: ${code}${item ? ` · ${item.title}` : ''}`, 'case-suggestion'); choose.type = 'button';
          choose.onclick = () => { if (!card.selectedTestCaseCodes.includes(code)) updateSelected(code); };
          suggestions.append(choose);
        }
        suggestions.hidden = !suggestions.children.length;
      } catch (e) { $('noteBm02Error').hidden = false; $('noteBm02Error').textContent = e.message; }
      finally { pending = false; generate.disabled = false; renderControls(); }
    };
    $('noteBugs').append(card); return card;
  }
  function syncNoBugMode() {
    const appendMode = job?.noteBm02?.mode === 'append';
    if (appendMode) $('noBugMode').checked = false;
    const noBug = $('noBugMode').checked;
    $('noteBugEditor').hidden = noBug;
    $('noBugNotice').hidden = !noBug;
    // The hidden bug editor contains a required severity select. In No Bug mode,
    // native form validation would stop submit before the save handler can run.
    $('noteBm02Form').noValidate = noBug;
    if (appendMode) $('saveNoteBm02').textContent = 'L\u01b0u b\u1ed5 sung bug l\u00ean CSD';
    $('saveNoteBm02').textContent = noBug ? 'Lưu Phiếu No Bug lên CSD' : 'Lưu nháp Note BM02 lên CSD';
  }
  function setWorkflowStage(stage) {
    activeStage = stage;
    const analysisOnly = stage !== 'analysis';
    $('analysisReferences').hidden = analysisOnly;
    $('analysisActions').hidden = analysisOnly;
    $('inputGrid').className = `input-grid${analysisOnly ? ' references-hidden' : ''}`;
    $('workspace').hidden = stage !== 'analysis' || !job;
    $('bm02Stage').hidden = stage !== 'bm02';
    $('noteStage').hidden = stage !== 'note';
    for (const [id, key] of [['stageAnalysis','analysis'],['stageBm02','bm02'],['stageNote','note']]) {
      const button = $(id); button.className = `workflow-step${stage === key ? ' active' : ''}`; button.setAttribute?.('aria-current', stage === key ? 'step' : 'false');
    }
  }
  function renderNoteBm02() {
    const note = job?.noteBm02; $('noteBm02Form').hidden = !note?.payload;
    if (!note?.payload) return;
    if (note.number) { $('notePycNumber').value = note.number; $('bm02Number').value = note.number; }
    $('noteBm02Task').textContent = `${note.taskName} · task_id ${note.taskId}`;
    $('noteService').textContent = note.serviceId ? `${note.systemName} → ${note.serviceName} · ID ${note.serviceId}` : 'Chưa xác định dịch vụ CSD. Hãy chuẩn bị lại Note BM02.';
    const st = note.sourceStatus || {}; $('noteBm02SourceSummary').textContent = `BM01: Public Internet ${st.publicInternet || 'chưa rõ'} · Ảnh hưởng Internet ${st.internetImpact || 'chưa rõ'} · Giao dịch tài chính ${st.financialTransactions || 'chưa rõ'} · ${st.apiCount || 0} API`;
    const yesNo = value => value === true ? 'YES' : value === false ? 'NO' : 'Chưa xác định trong BM01';
    $('notePublicInternet').textContent = yesNo(note.payload.is_public_internet);
    $('noteInternetImpact').textContent = yesNo(note.payload.feature_public_internet);
    $('noteFinancial').textContent = yesNo(note.payload.have_financial_transactions);
    const platformNames = { '5d37739c-ad20-43d8-be7b-a4c2a10a6c09': 'Mobile', '86ba0f31-df07-46e4-83be-41fc6fc2b536': 'Web', 'b7d592dd-907f-4e70-8986-d18dff9eee0b': 'API', '6281850e-a316-4a7b-a93f-318cc98e5ece': 'Khác' };
    $('notePlatformSummary').textContent = (note.payload.platform_id || []).map(id => platformNames[id]).filter(Boolean).join(', ') || 'Chưa xác định trong BM01';
    $('noteApiUrls').textContent = (note.payload.server_api || []).map(item => item.api).join('\n');
    if (typeof note.noBugMode === 'boolean') $('noBugMode').checked = note.noBugMode;
    syncNoBugMode();
    if (note.mode === 'append') {
      $('noteBm02SourceSummary').textContent += ` · Bản nháp CSD hiện có ${note.existingDraftCount || 0} bug; các bug này sẽ được giữ nguyên.`;
      $('saveNoteBm02').textContent = 'Lưu bổ sung bug lên CSD';
    }
    if (note.status === 'saved') { $('noteSavedMessage').hidden = false; $('noteSavedMessage').textContent = note.noBugMode ? '\u0110\u00e3 l\u01b0u Phi\u1ebfu No Bug v\u00e0 checklist l\u00ean CSD.' : `\u0110\u00e3 l\u01b0u nh\u00e1p l\u00ean CSD \u00b7 ${note.savedBugCount || 0} bug`; }
  }
  function render() { setWorkflowStage(activeStage); const sourceErrors = (job.sources || []).filter(s => s.kind === 'document' && s.error); $('status').textContent = sourceErrors.length ? `${job.progress || 'Đã đọc đầu vào'} · ${sourceErrors.length} tài liệu tham chiếu chưa truy cập được; kết quả sẽ có cảnh báo.` : (job.progress || ''); $('export').href = `/scope-review/${job.id}/export/json`; renderProgress(); renderResult(); renderBm02(); renderNoteBm02(); renderControls(); if (job.error) error(new Error(job.error)); }
  async function poll() { if (polling) return; polling = true; try { while (job.status === 'analyzing' || job.bm02?.status === 'checking') { await new Promise(resolve => setTimeout(resolve, 1500)); job = await request(`/scope-review/${job.id}`); renderProgress(); renderBm02(); renderControls(); $('status').textContent = job.progress || ''; } render(); } catch (e) { error(new Error(`${e.message} Tải lại trang để cập nhật trạng thái.`)); } finally { polling = false; } }
  $('uploadForm').onsubmit = async event => { event.preventDefault(); if (pending) return; const file = $('bm01').files[0]; if (!file && !$('documents').value.trim() && !$('references').files.length) { error(new Error('Nhập ID/URL tài liệu hoặc tải BM01/file tham chiếu trước khi đọc đầu vào.')); return; } pending = true; error(null); renderControls(); $('status').textContent = 'Đang đọc đầu vào và lấy tài liệu…'; try { job = await request('/scope-review/prepare', { method: 'POST', body: prepareFormData() }); uploadedFile = file; preparedSignature = inputSignature(); sessionStorage.setItem('scopeReviewId', job.id); render(); } catch (e) { error(e); $('status').textContent = 'Chưa đọc được đầu vào.'; } finally { pending = false; renderControls(); } };
  $('bm01').addEventListener('change', renderControls);
  $('references').addEventListener('change', renderControls);
  $('documents').addEventListener('input', renderControls);
  $('bm02Number').addEventListener('input', () => { $('notePycNumber').value = $('bm02Number').value; });
  $('notePycNumber').addEventListener('input', () => { $('bm02Number').value = $('notePycNumber').value; });
  $('bm02Form').onsubmit = async event => {
    event.preventDefault(); if (pending || job?.status === 'analyzing' || job?.bm02?.status === 'checking') return;
    const number = $('bm02Number').value.trim(); const file = $('bm01').files[0];
    if (!file && !job?.sources?.some(source => source.kind === 'bm01' && !source.error)) { $('bm02Error').hidden = false; $('bm02Error').textContent = 'Chọn file BM01 ở phần nạp hồ sơ trước khi kiểm tra.'; return; }
    pending = true; renderControls(); error(null); $('bm02Error').hidden = true;
    try {
      if (!job || (file && file !== uploadedFile)) { const body = new FormData(); body.append('bm01', file); body.append('number', number); job = await request('/scope-review/bm02/prepare', { method: 'POST', body }); uploadedFile = file; }
      else job = await request(`/scope-review/${job.id}/bm02`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number }) });
      sessionStorage.setItem('scopeReviewId', job.id); render(); await poll();
    } catch (e) { $('bm02Error').hidden = false; $('bm02Error').textContent = e.message; }
    finally { pending = false; renderControls(); }
  };
  async function prepareNoteBm02(mode = 'new') {
    if (pending) return;
    const keepNoBugMode = mode === 'new' && $('noBugMode').checked;
    const number = $('notePycNumber').value.trim(); $('bm02Number').value = number; if (!number) { $('notePycNumber').focus(); $('noteBm02Error').hidden = false; $('noteBm02Error').textContent = 'Nh\u1eadp s\u1ed1 Phi\u1ebfu Y\u00eau c\u1ea7u tr\u01b0\u1edbc khi chu\u1ea9n b\u1ecb Note BM02.'; return; }
    const file = $('bm01').files[0];
    if (!file && !job?.sources?.some(source => source.kind === 'bm01' && !source.error)) { $('noteBm02Error').hidden = false; $('noteBm02Error').textContent = 'Chọn file BM01 ở mục 01 trước khi chuẩn bị Note BM02.'; return; }
    pending = true; $('noteBm02Error').hidden = true; $('noteBm02Status').textContent = 'Đang tìm task trên CSD và đọc thông tin BM01…'; renderControls();
    try {
      // Note BM02 chỉ cần BM01 và số Phiếu Yêu cầu; tài liệu tham chiếu là tùy chọn.
      if (!job || (file && file !== uploadedFile)) {
        const body = new FormData(); body.append('bm01', file);
        job = await request('/scope-review/prepare', { method: 'POST', body });
        uploadedFile = file;
        sessionStorage.setItem('scopeReviewId', job.id);
        render();
      }
      const data = await request(`/scope-review/${job.id}/note-bm02/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number, mode }) });
      job.noteBm02 = data.noteBm02; job.noteBm02.noBugMode = keepNoBugMode; $('noteBugs').replaceChildren(); $('noteSavedMessage').hidden = true; renderNoteBm02(); makeNoteBug(); $('noteBm02Status').textContent = 'Đã nạp thông tin báo cáo và API từ BM01.';
    } catch (e) { $('noteBm02Error').hidden = false; $('noteBm02Error').textContent = e.message; $('noteBm02Status').textContent = ''; }
    finally { pending = false; renderControls(); }
  }
  $('prepareNoteBm02').onclick = () => prepareNoteBm02('new');
  $('appendNoteBm02').onclick = () => prepareNoteBm02('append');
  $('stageAnalysis').onclick = () => setWorkflowStage('analysis');
  $('stageBm02').onclick = () => setWorkflowStage('bm02');
  $('stageNote').onclick = () => setWorkflowStage('note');
  $('noBugMode').addEventListener('change', () => { if (job?.noteBm02) job.noteBm02.noBugMode = $('noBugMode').checked; syncNoBugMode(); });
  $('addNoteBug').onclick = () => makeNoteBug();
  $('noteBm02Form').onsubmit = async event => {
    event.preventDefault(); if (pending || !job?.noteBm02?.payload) return;
    const bugs = $('noBugMode').checked ? [] : [...$('noteBugs').children].map(card => ({ severity: card.querySelector('select').value, testCaseCodes: card.selectedTestCaseCodes || [], testCaseCode: card.querySelector('.bug-testcase').value, vulnerabilityName: card.querySelector('.bug-name').value, description: card.querySelector('.bug-final-description').value, pocSteps: card.querySelector('.bug-final-poc').value, recommendation: card.querySelector('.bug-recommendation').value }));
    const body = { bugs, noBugMode: $('noBugMode').checked };
    pending = true; $('noteBm02Error').hidden = true; $('noteSavedMessage').hidden = true; $('noteBm02Status').textContent = 'Đang lưu nháp lên CSD…'; renderControls();
    try {
      const result = await request(`/scope-review/${job.id}/note-bm02/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      job.noteBm02.status = 'saved'; job.noteBm02.noBugMode = body.noBugMode; job.noteBm02.savedAt = result.savedAt; job.noteBm02.savedBugCount = result.bugCount; renderNoteBm02(); $('noteBm02Status').textContent = body.noBugMode ? '\u0110\u00e3 l\u01b0u Phi\u1ebfu No Bug th\u00e0nh c\u00f4ng.' : '\u0110\u00e3 l\u01b0u Note BM02 th\u00e0nh c\u00f4ng.';
    } catch (e) { $('noteBm02Error').hidden = false; $('noteBm02Error').textContent = e.message; $('noteBm02Status').textContent = ''; }
    finally { pending = false; renderControls(); }
  };
  $('analyze').onclick = async () => {
    if (pending) return;
    const file = $('bm01').files[0]; const hasNewInputs = Boolean(file || $('documents').value.trim() || $('references').files.length);
    if (!job && !hasNewInputs) { error(new Error('Nh\u1eadp ID/URL t\u00e0i li\u1ec7u ho\u1eb7c t\u1ea3i BM01/file tham chi\u1ebfu tr\u01b0\u1edbc khi ph\u00e2n t\u00edch.')); return; }
    pending = true; error(null); renderControls();
    try {
      if (!job || (file && file !== uploadedFile) || (hasNewInputs && inputSignature() !== preparedSignature)) {
        job = await request('/scope-review/prepare', { method: 'POST', body: prepareFormData() });
        uploadedFile = file; preparedSignature = inputSignature(); sessionStorage.setItem('scopeReviewId', job.id); render();
      }
      await request(`/scope-review/${job.id}/analyze`, { method: 'POST' }); job.status = 'analyzing'; job.progressPercent = 0; $('resultLayout').hidden = true; $('result').hidden = false; renderProgress(); await poll();
    } catch (e) { error(e); }
    finally { pending = false; renderControls(); }
  };
  $('chatForm').onsubmit = async event => { event.preventDefault(); const question = $('chatQuestion').value.trim(); if (!question || pending || job?.status === 'analyzing' || job?.bm02?.status === 'checking') return; pending = true; renderControls(); $('chatError').textContent = ''; const previous = Array.isArray(job.chatHistory) ? job.chatHistory : []; job.chatHistory = [...previous, { role: 'user', content: question }]; renderChat(); showTyping(); try { const data = await request(`/scope-review/${job.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) }); job.chatHistory = data.history; $('chatQuestion').value = ''; renderChat(); } catch (e) { job.chatHistory = previous; renderChat(); $('chatError').textContent = e.message; } finally { pending = false; renderControls(); $('chatQuestion').focus(); } };
  $('chatQuestion').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chatForm').requestSubmit(); } });
  $('print').onclick = () => window.print(); setWorkflowStage('analysis'); syncNoBugMode(); renderControls(); const id = sessionStorage.getItem('scopeReviewId'); if (id) request(`/scope-review/${id}`).then(data => { job = data; const number = job.bm02?.number || job.noteBm02?.number || ''; $('bm02Number').value = number; $('notePycNumber').value = number; render(); if (job.status === 'analyzing' || job.bm02?.status === 'checking') poll(); }).catch(() => sessionStorage.removeItem('scopeReviewId'));
})();
