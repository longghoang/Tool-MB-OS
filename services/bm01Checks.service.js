const JSZip = require('jszip');
const cheerio = require('cheerio');

const FIELD_NAMES = {
  applicationAddress: 'Địa chỉ ứng dụng', specification: 'Tài liệu đặc tả',
  publicInternet: 'Hệ thống public internet', internetImpact: 'Ảnh hưởng tới tính năng ngoài internet',
  cmv: 'Scope thuộc hệ thống CMV', accounts: 'Thông tin tài khoản ứng dụng',
  architecture: '6.1. Mô hình tổng thể hệ thống', connections: '6.2. Các cơ chế kết nối',
  frameworkVersions: 'Version các framework', authorEmail: 'Họ tên và email người lập phiếu',
  recipient: 'Kính gửi', infrastructure: 'Pentest Hạ tầng', live: 'Môi trường LIVE', pilot: 'Môi trường PILOT'
};
const FIELD_PROMPT = `Trích xuất bm01Fields CHỈ từ BM01, theo các key sau: ${JSON.stringify(FIELD_NAMES)}.
Mỗi key có {value, detail, evidence:[{sourceId,quote}]}. Chỉ trả key tìm thấy ở phần đang đọc; không suy ra thiếu từ một chunk.
value của publicInternet,internetImpact,cmv,infrastructure,live,pilot: yes|no|unknown.
value của applicationAddress,specification,accounts,architecture,connections,frameworkVersions: present|missing|incomplete|unknown.
value authorEmail: plausible|mismatch|missing|unknown. Tên viết tắt + chữ cái họ/tên đệm + số là bình thường; ví dụ Vũ Đinh Trường An / anvdt1@mbbank.com.vn là plausible. Không được kết luận danh tính đã xác thực từ tên email. Chỉ mismatch khi rõ không liên quan; mơ hồ unknown.
value recipient: correct|incorrect|missing|unknown. Đúng là Phòng Đảm bảo An toàn thông tin – TT ATTT – Khối CNTT (cho phép khác dấu câu/khoảng trắng/hoa thường). Phòng Vận hành là incorrect.
Kiểm tra nội dung đã điền chứ không chỉ tiêu đề. accounts: có thông tin tài khoản hoặc cách cấp tài khoản cụ thể là present, không sao chép mật khẩu/secret vào detail hoặc evidence.
connections: kiểm tra các mục/cột trong mẫu 6.2 đã điền đủ; ghi rõ cột/mục còn trống, không tự đặt yêu cầu kết nối mới.
frameworkVersions: liệt kê framework không có version; không coi version của hệ điều hành/database là version framework. Nếu không có framework rõ ràng, unknown.
cmv chỉ yes khi CMV là hệ thống thuộc scope, không phải chỉ được nhắc tới như hệ thống tích hợp/tham khảo.
Checkbox: ☑ ☒ þ ✓ ✔ [x] là đã chọn; ☐ □ [ ] là chưa chọn. Chỉ có nhãn LIVE/PILOT/Pentest Hạ tầng không đồng nghĩa đã chọn. Không thấy dấu hoặc mất định dạng thì unknown, không tự suy ra yes/no.
Đặc tả: phải có link/tên tài liệu hoặc tham chiếu cụ thể, không chỉ có tiêu đề. Mô hình: không suy ra có sơ đồ chỉ từ tiêu đề 6.1.
Tách newFunctions: nội dung mục Mô tả chức năng mới của hệ thống trong BM01 (để trống nếu phần này không nằm trong chunk).`;

// Preserve checkbox semantics which DOCX-to-HTML converters can otherwise drop.
async function prepareDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('Missing document XML');
  const $ = cheerio.load(await file.async('string'), { xmlMode: true });
  const named = (root, name) => root.find('*').filter((i, e) => e.name === name);
  const structure = { inspected: true, architectureSection: false, architectureObjects: 0 };
  let inArchitecture = false;
  $('*').filter((i, e) => e.name === 'w:p').each((i, p) => {
    const paragraph = $(p);
    const text = named(paragraph, 'w:t').text().trim();
    if (/^(?:6[.,]1[.\s]*)?mô hình tổng thể hệ thống/i.test(text) || /^6[.,]1\b.*mô hình/i.test(text)) { inArchitecture = true; structure.architectureSection = true; }
    else if (inArchitecture && /^\d+[.,]\d+\b/.test(text)) inArchitecture = false;
    if (inArchitecture) structure.architectureObjects += named(paragraph, 'w:drawing').length + named(paragraph, 'w:pict').length;
  });
  $('*').filter((i, e) => e.name === 'w:sym').each((i, e) => {
    const code = ($(e).attr('w:char') || '').toUpperCase();
    const symbol = { F0FE: '☑', F0FD: '☒', F0FC: '☑', F0A8: '☐', '2610': '☐', '2611': '☑', '2612': '☒' }[code];
    if (symbol) $(e).replaceWith(`<w:t>${symbol} </w:t>`);
  });
  $('*').filter((i, e) => e.name === 'w:sdt').each((i, e) => {
    const box = named($(e), 'w14:checkbox').first();
    if (!box.length) return;
    const checked = named(box, 'w14:checked').attr('w14:val');
    const content = named($(e), 'w:sdtContent').first();
    if (checked !== undefined) content.prepend(`<w:r><w:t>${['1','true','on'].includes(checked) ? '☑' : '☐'} </w:t></w:r>`);
  });
  $('*').filter((i, e) => e.name === 'w:checkBox').each((i, e) => {
    const checkbox = $(e);
    const checked = named(checkbox, 'w:checked');
    const fallback = named(checkbox, 'w:default');
    const node = checked.length ? checked : fallback;
    if (node.length) {
      const val = node.attr('w:val');
      checkbox.parents().filter((j, p) => p.name === 'w:r').first().append(`<w:t>${val === undefined || ['1','true','on'].includes(val) ? '☑' : '☐'} </w:t>`);
    }
  });
  zip.file('word/document.xml', $.xml());
  return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), structure };
}

function buildChecks(parts, structure, validateEvidence) {
  const fields = {};
  for (const key of Object.keys(FIELD_NAMES)) {
    const candidates = parts.map(p => p.bm01Fields?.[key]).filter(v => v && typeof v.value === 'string').map(v => ({ ...v, evidence: validateEvidence(v.evidence) })).filter(v => v.evidence.length);
    const definite = candidates.filter(v => v.value !== 'unknown');
    const values = [...new Set(definite.map(v => v.value))];
    fields[key] = values.length === 1 ? { ...definite[0], evidence: definite.flatMap(v => v.evidence) } : { value: 'unknown', detail: values.length > 1 ? 'BM01 có thông tin mâu thuẫn giữa các phần.' : 'Chưa có đủ nội dung/bằng chứng để xác nhận.', evidence: candidates.flatMap(v => v.evidence) };
    if (!candidates.length) fields[key].detail = 'Chưa tìm thấy thông tin đã điền trong toàn bộ BM01 đã đọc.';
  }
  const checks = [];
  function add(code, title, status, detail, keys) { checks.push({ code, title, status, detail, evidence: keys.flatMap(k => fields[k].evidence) }); }
  for (const key of ['applicationAddress','specification','accounts','architecture','connections','frameworkVersions']) {
    const f = fields[key];
    if (key === 'architecture' && structure?.architectureObjects > 0) {
      add(key, FIELD_NAMES[key], 'pass', 'Có đối tượng ảnh/sơ đồ tại mục 6.1. Chỉ kiểm tra sự hiện diện, chưa xác minh nội dung hình.', [key]);
    } else add(key, FIELD_NAMES[key], f.value === 'present' ? 'pass' : ['missing','incomplete'].includes(f.value) ? 'alert' : 'review', f.detail, [key]);
  }
  const a = fields.publicInternet.value, b = fields.internetImpact.value;
  add('internetConsistency', 'Hai khai báo về Internet phải đồng nhất', ['yes','no'].includes(a) && ['yes','no'].includes(b) ? (a === b ? 'pass' : 'alert') : 'review', ['yes','no'].includes(a) && ['yes','no'].includes(b) ? `Public Internet: ${a.toUpperCase()} — ảnh hưởng tính năng ngoài Internet: ${b.toUpperCase()}.` : 'Chưa xác định đủ YES/NO của hai trường Internet.', ['publicInternet','internetImpact']);
  const cmv = fields.cmv.value;
  // Chỉ hiển thị rule này khi BM01 xác định rõ PYC thuộc CMV. Với PYC khác CMV,
  // pentester không cần thấy một cảnh báo/"cần xác nhận" riêng cho CMV.
  if (cmv === 'yes') add('cmvInternet', 'Scope CMV phải khai báo Public Internet = YES', a === 'no' ? 'alert' : a === 'yes' ? 'pass' : 'review', `Scope CMV; Public Internet: ${a.toUpperCase()}.`, ['cmv','publicInternet']);
  const author = fields.authorEmail;
  add('authorEmail', FIELD_NAMES.authorEmail, ['mismatch','missing'].includes(author.value) ? 'alert' : author.value === 'plausible' ? 'pass' : 'review', author.value === 'plausible' ? `${author.detail} Phù hợp cách viết tắt; chưa xác thực với danh bạ.` : author.detail, ['authorEmail']);
  const recipient = fields.recipient;
  add('recipient', FIELD_NAMES.recipient, recipient.value === 'correct' ? 'pass' : ['incorrect','missing'].includes(recipient.value) ? 'alert' : 'review', recipient.detail, ['recipient']);
  for (const key of ['infrastructure','live','pilot']) {
    const f = fields[key];
    add(key, key === 'infrastructure' ? 'Pentest hạ tầng' : `Môi trường ${key.toUpperCase()}`, f.value === 'yes' ? 'alert' : f.value === 'no' ? 'pass' : 'review', f.value === 'yes' ? (key === 'infrastructure' ? 'BM01 có tích Pentest hạ tầng.' : `BM01 có tích ${key.toUpperCase()} — pentester cần kiểm tra.`) : f.value === 'no' ? 'Không được tích chọn.' : 'Không đọc được trạng thái checkbox một cách chắc chắn.', [key]);
  }
  return checks;
}
module.exports = { FIELD_PROMPT, FIELD_NAMES, prepareDocx, buildChecks };
