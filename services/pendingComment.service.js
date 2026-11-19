const cheerio = require('cheerio');
const { createGateway } = require('./bm02Gateway.service');

const gateway = createGateway();
const REASONS = new Set(['bm01', 'system', 'pyc_name', 'old_bm01', 'custom']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function requestNumber(value) {
  const number = String(value || '').trim();
  if (!/^\d{1,12}$/.test(number)) throw new Error('Số Phiếu Yêu cầu chỉ được chứa chữ số.');
  return number;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseContact(html, number) {
  number = requestNumber(number);
  const $ = cheerio.load(String(html || ''));
  const pageText = $('body').text().replace(/\s+/g, ' ').trim();
  if (!new RegExp(`PENTEST[-:\\s]*${number}(?!\\d)`, 'i').test(pageText)) {
    throw new Error(`Không tìm thấy PENTEST-${number} trên hệ thống Phiếu Yêu cầu.`);
  }

  let contactText = '';
  $('strong').each((_, element) => {
    if (contactText || !normalize($(element).text()).startsWith('dau moi')) return;
    const candidates = [
      $(element).parent().text(),
      $(element).closest('td').text(),
      $(element).closest('tr').text(),
      $(element).closest('p, li, div').text()
    ];
    contactText = candidates.find(text => /[a-z0-9._-]+@mbbank\.com\.vn\b/i.test(text)) || '';
  });

  if (!contactText) {
    const index = normalize(pageText).indexOf('dau moi');
    if (index >= 0) contactText = pageText.slice(Math.max(0, index - 30), index + 300);
  }

  const emailMatch = String(contactText).match(/([a-z0-9._-]+)@mbbank\.com\.vn\b/i);
  if (!emailMatch) throw new Error('Không đọc được đầu mối BDA từ Phiếu Yêu cầu.');
  const username = emailMatch[1].toLowerCase();
  const beforeEmail = contactText.slice(0, emailMatch.index).replace(/\s+/g, ' ').trim();
  const name = beforeEmail
    .replace(/^.*?đầu\s*mối\s*:\s*/i, '')
    .replace(/^.*?dau\s*moi\s*:\s*/i, '')
    .replace(/[\s-]+$/, '')
    .trim();
  return { name: name || username, email: emailMatch[0], username };
}

function formatDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'numeric', year: 'numeric'
  }).formatToParts(date);
  const get = type => Number(parts.find(part => part.type === type)?.value);
  return `${get('day')}/${get('month')}/${get('year')}`;
}

function buildComment(reason, username, date = new Date(), editableComment) {
  if (!REASONS.has(reason)) throw new Error('Chọn một lý do Pending hợp lệ.');
  username = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) throw new Error('Username đầu mối BDA không hợp lệ.');
  const prefix = `Ngày ${formatDate(date)} hiện trạng: `;
  if (reason === 'custom') {
    const template = `${prefix}[Nhập nội dung cần Pending]. Anh/chị [~${username}] sớm bổ sung và thông báo + chuyển trạng thái jira sau khi hoàn thành để đội pentest tiếp tục công việc ạ`;
    const comment = String(editableComment == null ? template : editableComment).replace(/\r\n?/g, '\n').trim();
    if (comment.length < 20) throw new Error('Comment Custom phải có ít nhất 20 ký tự.');
    if (comment.length > 4000) throw new Error('Comment Custom không được vượt quá 4.000 ký tự.');
    if (comment.includes('\0')) throw new Error('Comment Custom chứa ký tự không hợp lệ.');
    return comment;
  }
  if (reason === 'bm01') {
    return `${prefix}Phần scope trong BM01 đang chưa đúng với hiện trạng Pentest nên không thể hoàn thành công việc Pentest.\nAnh/chị [~${username}] sớm bổ sung và thông báo + chuyển trạng thái jira sau khi hoàn thành để đội pentest tiếp tục công việc ạ`;
  }
  if (reason === 'system') {
    return `${prefix}Hệ thống đang lỗi nên không thể hoàn thành công việc Pentest.\nAnh/chị [~${username}] sớm sửa lỗi + chuyển trạng thái jira sau khi hoàn thành để đội pentest tiếp tục công việc ạ`;
  }
  if (reason === 'pyc_name') {
    return `${prefix}Tên pyc trên Jira đang chưa đúng nên không thể hoàn thành công việc Pentest. Anh/chị [~${username}] sớm bổ sung và thông báo + chuyển trạng thái jira sau khi hoàn thành để đội pentest tiếp tục công việc ạ`;
  }
  return `${prefix}Hiện đang có 2 phiên bản BM01 trên Jira nên không thể hoàn thành công việc Pentest. Anh/chị [~${username}] sớm bổ sung và thông báo + chuyển trạng thái jira sau khi hoàn thành để đội pentest tiếp tục công việc ạ`;
}

function validateImage(file) {
  if (!file) return null;
  if (!IMAGE_TYPES.has(file.mimetype) || !Buffer.isBuffer(file.buffer) || file.buffer.length < 4) {
    throw new Error('Ảnh PoC phải là PNG, JPG, GIF hoặc WEBP hợp lệ.');
  }
  const bytes = file.buffer;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const head = bytes.subarray(0, 6).toString('ascii');
  const isGif = head === 'GIF87a' || head === 'GIF89a';
  const isWebp = bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isPng && !isJpeg && !isGif && !isWebp) throw new Error('Nội dung file không phải ảnh PoC hợp lệ.');
  return file;
}

async function lookup(number, api = gateway) {
  number = requestNumber(number);
  const html = await api.getIssue(number);
  return { number, pyc: `PENTEST-${number}`, contact: parseContact(html, number) };
}

async function submit({ number, reason, image, customComment }, api = gateway, date = new Date()) {
  image = validateImage(image);
  const issue = await lookup(number, api);
  const comment = buildComment(reason, issue.contact.username, date, customComment);
  await api.addJcComment({ pyc: issue.pyc, comment, image });
  return { ...issue, comment, submittedAt: new Date().toISOString(), hasImage: Boolean(image) };
}

module.exports = { requestNumber, parseContact, formatDate, buildComment, validateImage, lookup, submit };
