const path = require("path");
const XLSX = require("xlsx");
const JSZip = require("jszip");
const crawlPyc = require("./pycCrawler");

const REQUIRED_HEADERS = {
  jira: "ma jira",
  title: "noi dung cong viec",
};

function normalizeText(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isBlankCell(cell) {
  return !cell || (!cell.f && (cell.v == null || String(cell.v).trim() === ""));
}

function toFiniteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value == null ? "" : value).trim().replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseLegacyManday(value) {
  const matches = [...String(value || "").matchAll(/\(([\d.,]+)\)/g)];
  return matches.length ? toFiniteNumber(matches[matches.length - 1][1]) : null;
}

function normalizePyc(value) {
  const match = String(value || "").match(/(?:PENTEST\s*[-_]\s*)?(\d+)/i);
  return match ? match[1] : null;
}

function findBbxnSheetName(sheetNames) {
  const exact = sheetNames.find(name => normalizeText(name) === "bbxn");
  if (exact) return exact;

  const candidates = sheetNames.filter(name => /^bbxn(?:\b|_|-)/.test(normalizeText(name)));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(`Có nhiều sheet BBXN: ${candidates.join(", ")}. Vui lòng chỉ giữ một sheet cần xử lý.`);
  }
  throw new Error('Không tìm thấy sheet BBXN (ví dụ: "BBXN" hoặc "BBXN_thang9") trong file Excel.');
}

function findHeaderRow(sheet) {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const columns = {};
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const ref = XLSX.utils.encode_cell({ r: row, c: col });
      const normalized = normalizeText(sheet[ref]?.v);
      for (const [key, label] of Object.entries(REQUIRED_HEADERS)) {
        if (normalized === label) columns[key] = col;
      }
    }
    if (Object.keys(REQUIRED_HEADERS).every(key => Number.isInteger(columns[key]))) {
      return { row, columns, lastRow: range.e.r };
    }
  }
  throw new Error("Sheet BBXN không có đủ cột Mã JIRA, Nội dung công việc và Manday dự kiến.");
}

function inspectWorkbook(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellFormula: true,
    cellStyles: true,
    cellNF: true,
  });
  const sheetName = findBbxnSheetName(workbook.SheetNames);
  const sheet = workbook.Sheets[sheetName];

  const layout = findHeaderRow(sheet);
  const rows = [];
  for (let row = layout.row + 1; row <= layout.lastRow; row += 1) {
    const jiraRef = XLSX.utils.encode_cell({ r: row, c: layout.columns.jira });
    const titleRef = XLSX.utils.encode_cell({ r: row, c: layout.columns.title });
    const jiraCell = sheet[jiraRef];
    const pyc = normalizePyc(jiraCell?.v);
    if (!pyc) continue;

    const needsTitle = isBlankCell(sheet[titleRef]);
    rows.push({
      excelRow: row + 1,
      pyc,
      titleRef,
      needsTitle,
    });
  }

  if (!rows.length) throw new Error("Sheet BBXN không có Mã JIRA hợp lệ để xử lý.");
  return { workbook, sheetName, rows };
}

async function mapWithConcurrency(values, limit, mapper) {
  const output = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function replaceAttribute(attributes, name, value) {
  const pattern = new RegExp(`\\s${name}=(?:"[^"]*"|'[^']*')`, "i");
  const without = attributes.replace(pattern, "");
  return value == null ? without : `${without} ${name}="${escapeXml(value)}"`;
}

function columnNumber(ref) {
  return XLSX.utils.decode_cell(ref).c;
}

function setWorksheetCell(xml, ref, value, type) {
  const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cellPattern = new RegExp(`<c\\b([^>]*\\br=(?:"${escapedRef}"|'${escapedRef}')[^>]*)>([\\s\\S]*?)<\\/c>`, "i");
  const selfClosingPattern = new RegExp(`<c\\b([^>]*\\br=(?:"${escapedRef}"|'${escapedRef}')[^>]*)\\s*\\/>`, "i");
  const body = type === "number"
    ? `<v>${String(value)}</v>`
    : `<is><t xml:space="preserve">${escapeXml(value)}</t></is>`;

  const replaceCell = attributes => {
    const next = replaceAttribute(attributes, "t", type === "number" ? "n" : "inlineStr");
    return `<c${next}>${body}</c>`;
  };
  if (cellPattern.test(xml)) return xml.replace(cellPattern, (_, attributes) => replaceCell(attributes));
  if (selfClosingPattern.test(xml)) return xml.replace(selfClosingPattern, (_, attributes) => replaceCell(attributes));

  const rowNumber = XLSX.utils.decode_cell(ref).r + 1;
  const rowPattern = new RegExp(`(<row\\b[^>]*\\br=(?:"${rowNumber}"|'${rowNumber}')[^>]*>)([\\s\\S]*?)(<\\/row>)`, "i");
  const match = rowPattern.exec(xml);
  if (!match) throw new Error(`Không tìm thấy dòng ${rowNumber} trong XML của sheet BBXN.`);

  const newCell = `<c r="${ref}" t="${type === "number" ? "n" : "inlineStr"}">${body}</c>`;
  const targetColumn = columnNumber(ref);
  const cells = [...match[2].matchAll(/<c\b[^>]*\br=(?:"([A-Z]+\d+)"|'([A-Z]+\d+)')[^>]*(?:\/>|>[\s\S]*?<\/c>)/gi)];
  const nextCell = cells.find(cell => columnNumber(cell[1] || cell[2]) > targetColumn);
  const rowBody = nextCell
    ? `${match[2].slice(0, nextCell.index)}${newCell}${match[2].slice(nextCell.index)}`
    : `${match[2]}${newCell}`;
  return `${xml.slice(0, match.index)}${match[1]}${rowBody}${match[3]}${xml.slice(match.index + match[0].length)}`;
}

function decodeXmlAttribute(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function getBbxnSheetPath(zip, sheetName) {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbookXml || !relsXml) throw new Error("File Excel thiếu cấu trúc workbook chuẩn.");

  const sheetMatch = [...workbookXml.matchAll(/<sheet\b([^>]*)\/>/gi)].find(match => {
    const name = /\bname=(?:"([^"]*)"|'([^']*)')/i.exec(match[1]);
    return decodeXmlAttribute(name?.[1] || name?.[2]) === sheetName;
  });
  const relId = sheetMatch && /\br:id=(?:"([^"]*)"|'([^']*)')/i.exec(sheetMatch[1]);
  if (!relId) throw new Error('Không xác định được sheet "BBXN" trong file Excel.');

  const id = relId[1] || relId[2];
  const relationship = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/gi)].find(match => {
    const currentId = /\bId=(?:"([^"]*)"|'([^']*)')/i.exec(match[1]);
    return (currentId?.[1] || currentId?.[2]) === id;
  });
  const target = relationship && /\bTarget=(?:"([^"]*)"|'([^']*)')/i.exec(relationship[1]);
  if (!target) throw new Error('Không đọc được đường dẫn XML của sheet "BBXN".');
  return path.posix.normalize(path.posix.join("xl", target[1] || target[2])).replace(/^\/+/, "");
}

async function patchWorkbook(buffer, updates, sheetName) {
  const zip = await JSZip.loadAsync(buffer);
  const sheetPath = await getBbxnSheetPath(zip, sheetName);
  const file = zip.file(sheetPath);
  if (!file) throw new Error('Không đọc được dữ liệu sheet "BBXN".');
  let xml = await file.async("string");
  for (const update of updates) {
    xml = setWorksheetCell(xml, update.ref, update.value, update.type);
  }
  zip.file(sheetPath, xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

async function processBbxnWorkbook(buffer, { crawler = crawlPyc, concurrency = 3 } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("File Excel rỗng hoặc không hợp lệ.");
  const { sheetName, rows } = inspectWorkbook(buffer);

  const titlePycs = [...new Set(rows.filter(row => row.needsTitle).map(row => row.pyc))];
  const titleEntries = await mapWithConcurrency(titlePycs, concurrency, async pyc => {
    try {
      return { pyc, title: await crawler(pyc) };
    } catch (error) {
      // A single unavailable/slow PYC must not prevent the user from receiving
      // the completed workbook. Its blank work-title cell is intentionally kept.
      console.warn(`BBXN: bỏ qua PENTEST-${pyc}: ${error.message}`);
      return { pyc, error };
    }
  });
  const titles = new Map(titleEntries
    .filter(entry => typeof entry.title === "string" && entry.title.trim())
    .map(entry => [entry.pyc, entry.title]));

  const updates = [];
  for (const row of rows) {
    const title = titles.get(row.pyc);
    if (row.needsTitle && title) updates.push({ ref: row.titleRef, value: title, type: "string" });
  }

  return {
    buffer: updates.length ? await patchWorkbook(buffer, updates, sheetName) : Buffer.from(buffer),
    summary: {
      sheetName,
      jiraRows: rows.length,
      uniquePycsCrawled: titlePycs.length,
      titlesFilled: updates.length,
      pycsSkipped: titleEntries.filter(entry => entry.error).length,
      mandaysFilled: 0,
    },
  };
}

module.exports = {
  processBbxnWorkbook,
  inspectWorkbook,
  normalizeText,
  findBbxnSheetName,
  parseLegacyManday,
  setWorksheetCell,
};
