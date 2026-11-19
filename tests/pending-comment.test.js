const { test } = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/pendingComment.service');

const issueHtml = `<!doctype html><html><body>
  <h1>📋 PENTEST-20784: Kiểm thử ứng dụng <span>In Progress</span></h1>
  <p><strong>Đầu mối:</strong> Nguyễn Văn Cầu - caunv1@mbbank.com.vn</p>
</body></html>`;

test('parseContact extracts the BDA username from the requested PYC', () => {
  assert.deepEqual(service.parseContact(issueHtml, '20784'), {
    name: 'Nguyễn Văn Cầu', email: 'caunv1@mbbank.com.vn', username: 'caunv1'
  });
  assert.throws(() => service.parseContact(issueHtml, '99999'), /Không tìm thấy PENTEST-99999/);
});

test('buildComment creates the original approved templates with Bangkok date', () => {
  const date = new Date('2026-03-09T04:00:00.000Z');
  assert.equal(service.buildComment('bm01', 'binhhv', date),
    'Ngày 9/3/2026 hiện trạng: Phần scope trong BM01 đang chưa đúng với hiện trạng Pentest nên không thể hoàn thành công việc Pentest.\nAnh/chị [~binhhv] sớm bổ sung và thông báo + chuyển trạng thái jira sau khi hoàn thành để đội pentest tiếp tục công việc ạ');
  assert.equal(service.buildComment('system', 'caunv1', date),
    'Ngày 9/3/2026 hiện trạng: Hệ thống đang lỗi nên không thể hoàn thành công việc Pentest.\nAnh/chị [~caunv1] sớm sửa lỗi + chuyển trạng thái jira sau khi hoàn thành để đội pentest tiếp tục công việc ạ');
  assert.throws(() => service.buildComment('other', 'caunv1', date), /lý do Pending/);
});

test('buildComment supports incorrect PYC name and duplicate BM01 templates', () => {
  const date = new Date('2026-09-30T04:00:00.000Z');
  assert.equal(service.buildComment('pyc_name', 'tunghd', date),
    'Ngày 30/9/2026 hiện trạng: Tên pyc trên Jira đang chưa đúng nên không thể hoàn thành công việc Pentest. Anh/chị [~tunghd] sớm bổ sung và thông báo + chuyển trạng thái jira sau khi hoàn thành để đội pentest tiếp tục công việc ạ');
  assert.equal(service.buildComment('old_bm01', 'tunghd', date),
    'Ngày 30/9/2026 hiện trạng: Hiện đang có 2 phiên bản BM01 trên Jira nên không thể hoàn thành công việc Pentest. Anh/chị [~tunghd] sớm bổ sung và thông báo + chuyển trạng thái jira sau khi hoàn thành để đội pentest tiếp tục công việc ạ');
});

test('Custom comment is prefilled with date and contact, remains editable and is bounded', () => {
  const date = new Date('2026-09-30T04:00:00.000Z');
  assert.equal(service.buildComment('custom', 'tunghd', date),
    'Ngày 30/9/2026 hiện trạng: [Nhập nội dung cần Pending]. Anh/chị [~tunghd] sớm bổ sung và thông báo + chuyển trạng thái jira sau khi hoàn thành để đội pentest tiếp tục công việc ạ');
  const edited = 'Ngày 30/9/2026 hiện trạng: API chưa sẵn sàng. Anh/chị [~tunghd] vui lòng xử lý giúp.';
  assert.equal(service.buildComment('custom', 'tunghd', date, `  ${edited}\r\n`), edited);
  assert.throws(() => service.buildComment('custom', 'tunghd', date, 'quá ngắn'), /ít nhất 20/);
  assert.throws(() => service.buildComment('custom', 'tunghd', date, 'x'.repeat(4001)), /4\.000/);
});

test('validateImage checks the file signature, not only the MIME type', () => {
  const png = { mimetype: 'image/png', buffer: Buffer.from('89504e470d0a1a0a00000000', 'hex') };
  assert.equal(service.validateImage(png), png);
  assert.throws(() => service.validateImage({ mimetype: 'image/png', buffer: Buffer.from('not an image') }), /Nội dung file/);
});

test('submit rereads the issue and sends the server-built comment and image', async () => {
  const calls = [];
  const image = { originalname: 'poc.png', mimetype: 'image/png', buffer: Buffer.from('89504e470d0a1a0a00000000', 'hex') };
  const api = {
    getIssue: async number => { calls.push(['issue', number]); return issueHtml; },
    addJcComment: async payload => { calls.push(['comment', payload]); return { ok: true }; }
  };
  const result = await service.submit({ number: '20784', reason: 'system', image }, api, new Date('2026-03-09T04:00:00.000Z'));
  assert.equal(result.pyc, 'PENTEST-20784');
  assert.equal(result.hasImage, true);
  assert.equal(calls[0][1], '20784');
  assert.equal(calls[1][1].pyc, 'PENTEST-20784');
  assert.equal(calls[1][1].image, image);
  assert.match(calls[1][1].comment, /^Ngày 9\/3\/2026 hiện trạng: Hệ thống đang lỗi/);
});

test('submit sends the edited Custom comment without replacing its content', async () => {
  let sent;
  const api = {
    getIssue: async () => issueHtml,
    addJcComment: async payload => { sent = payload; return { ok: true }; }
  };
  const customComment = 'Ngày 30/9/2026 hiện trạng: Môi trường chưa đồng bộ dữ liệu. Anh/chị [~caunv1] vui lòng xử lý và thông báo lại.';
  const result = await service.submit({ number: '20784', reason: 'custom', customComment }, api, new Date('2026-09-30T04:00:00.000Z'));
  assert.equal(sent.comment, customComment);
  assert.equal(result.comment, customComment);
});
