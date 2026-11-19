const { test } = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const JSZip = require("jszip");
const { processBbxnWorkbook } = require("../services/bbxnWorkbook.service");

function createWorkbook({ missingManday = false, sheetName = "BBXN" } = {}) {
  const headers = Array(21).fill(null);
  headers[9] = "Mã JIRA";
  headers[10] = "Nội dung công việc";
  headers[13] = "Manday dự kiến";
  headers[14] = "Normal Working";
  headers[20] = "Tổng số Manday";

  const rows = [headers];
  const first = Array(21).fill(null);
  first[0] = "Dữ liệu giữ nguyên";
  first[9] = "PENTEST-123";
  first[14] = missingManday ? null : 0.5;
  rows.push(first);

  const second = Array(21).fill(null);
  second[9] = "PENTEST-123";
  second[10] = "Tên đã có";
  second[14] = 1;
  rows.push(second);

  const third = Array(21).fill(null);
  third[9] = "456 (2) (1.5)";
  rows.push(third);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Không đổi"]]), "BCC");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("BBXN processor fills only blank work title cells", async () => {
  const calls = [];
  const input = createWorkbook();
  const result = await processBbxnWorkbook(input, {
    crawler: async pyc => {
      calls.push(pyc);
      return `PENTEST-${pyc}: Tên công việc`;
    },
    concurrency: 2,
  });

  assert.deepEqual(calls.sort(), ["123", "456"]);
  assert.deepEqual(result.summary, {
    sheetName: "BBXN",
    jiraRows: 3,
    uniquePycsCrawled: 2,
    titlesFilled: 2,
    pycsSkipped: 0,
    mandaysFilled: 0,
  });

  const workbook = XLSX.read(result.buffer, { type: "buffer", cellFormula: true });
  const sheet = workbook.Sheets.BBXN;
  assert.equal(sheet.K2.v, "PENTEST-123: Tên công việc");
  assert.equal(sheet.K3.v, "Tên đã có");
  assert.equal(sheet.K4.v, "PENTEST-456: Tên công việc");
  assert.equal(sheet.N2, undefined);
  assert.equal(sheet.N3, undefined);
  assert.equal(sheet.N4, undefined);
  assert.equal(sheet.A2.v, "Dữ liệu giữ nguyên");
  assert.equal(workbook.Sheets.BCC.A1.v, "Không đổi");
  assert.deepEqual(workbook.SheetNames, ["BCC", "BBXN"]);

  const beforeZip = await JSZip.loadAsync(input);
  const afterZip = await JSZip.loadAsync(result.buffer);
  for (const [name, file] of Object.entries(beforeZip.files)) {
    if (file.dir || name === "xl/worksheets/sheet2.xml") continue;
    assert.deepEqual(
      await afterZip.file(name).async("nodebuffer"),
      await file.async("nodebuffer"),
      `${name} must remain unchanged`
    );
  }
});

test("BBXN processor accepts a unique monthly BBXN sheet name", async () => {
  const result = await processBbxnWorkbook(createWorkbook({ sheetName: "BBXN_thang9" }), {
    crawler: async pyc => `PENTEST-${pyc}: Tên công việc`,
  });
  const workbook = XLSX.read(result.buffer, { type: "buffer" });
  assert.equal(result.summary.sheetName, "BBXN_thang9");
  assert.equal(workbook.Sheets.BBXN_thang9.K2.v, "PENTEST-123: Tên công việc");
});

test("BBXN processor does not require or modify expected manday", async () => {
  const result = await processBbxnWorkbook(createWorkbook({ missingManday: true }), {
    crawler: async pyc => `PENTEST-${pyc}: Tên công việc`,
  });
  const workbook = XLSX.read(result.buffer, { type: "buffer" });
  assert.equal(workbook.Sheets.BBXN.N2, undefined);
});

test("BBXN processor leaves a title blank when its PYC crawl times out", async () => {
  const result = await processBbxnWorkbook(createWorkbook(), {
    crawler: async pyc => {
      if (pyc === "123") throw new Error("timeout");
      return `PENTEST-${pyc}: Tên công việc`;
    },
  });
  const workbook = XLSX.read(result.buffer, { type: "buffer" });
  assert.equal(workbook.Sheets.BBXN.K2, undefined);
  assert.equal(workbook.Sheets.BBXN.K3.v, "Tên đã có");
  assert.equal(workbook.Sheets.BBXN.K4.v, "PENTEST-456: Tên công việc");
  assert.equal(result.summary.titlesFilled, 1);
  assert.equal(result.summary.pycsSkipped, 1);
});
