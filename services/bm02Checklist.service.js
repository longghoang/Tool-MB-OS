const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const DEFAULT_CHECKLIST = fs.readFileSync(path.join(__dirname, 'bm02-checklist.html'), 'utf8');

function parseRows(html) {
  const $ = cheerio.load(html, null, false);
  const rows = [];
  $('tr').each((_, element) => {
    const cells = $(element).children('td');
    if (cells.length < 5) return;
    const code = cells.eq(0).text().trim();
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(code)) return;
    rows.push({ code, title: cells.eq(1).text().trim(), description: cells.eq(2).text().replace(/\s+/g, ' ').trim(), result: cells.eq(4).text().trim(), element, cells });
  });
  return { $, rows };
}

const catalog = parseRows(DEFAULT_CHECKLIST).rows.map(({ code, title, description, result }) => ({ code, title, description, result }));
const knownCodes = new Set(catalog.map(item => item.code));

function listCases() { return catalog.map(item => ({ ...item })); }

function validateCodes(values) {
  if (!Array.isArray(values)) throw new Error('Danh sách test case phải là một mảng.');
  const codes = [...new Set(values.map(value => String(value || '').trim().toUpperCase()).filter(Boolean))];
  if (codes.length > 20) throw new Error('Mỗi bug chỉ được chọn tối đa 20 test case.');
  for (const code of codes) if (!knownCodes.has(code)) throw new Error(`Mã test case không có trong checklist BM02: ${code}`);
  return codes;
}

function applyFailures(existingHtml, selectedCodes) {
  const codes = validateCodes(selectedCodes);
  const original = String(existingHtml || '').trim() || DEFAULT_CHECKLIST;
  if (!codes.length) return original;
  const { $, rows } = parseRows(original);
  const rowMap = new Map(rows.map(row => [row.code, row]));
  for (const code of codes) {
    const row = rowMap.get(code);
    if (!row) throw new Error(`Bản checklist hiện tại không có test case ${code}; chưa thể cập nhật kết quả.`);
    row.cells.eq(4).html('<p><span style="color: rgb(231, 76, 60);"><strong>Fail</strong></span></p>');
  }
  return $.html();
}

module.exports = { DEFAULT_CHECKLIST, listCases, validateCodes, applyFailures };
