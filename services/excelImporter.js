const XLSX = require("xlsx");

function parseCell(cell) {
  if (!cell || typeof cell !== "string") return [];

  return cell
    .split("|")
    .map(v => v.trim())
    .map(v => {
      const pycMatch = v.match(/^(\d+)/);
      if (!pycMatch) return null;

      const pyc = pycMatch[1];

      const brackets = [...v.matchAll(/\(([\d.]+)\)/g)].map(m =>
        parseFloat(m[1])
      );

      if (!brackets.length) return null;

      const manday =
        brackets.length >= 2
          ? brackets[brackets.length - 1]
          : brackets[0];

      return { pyc, manday };
    })
    .filter(Boolean);
}

function parseDateFromHeader(cell) {
  if (!cell) return null;

  // Excel date number
  if (typeof cell === "number") {
    const d = XLSX.SSF.parse_date_code(cell);
    if (!d) return null;
    return `${String(d.d).padStart(2, "0")}/${String(d.m).padStart(2, "0")}/${d.y}`;
  }

  if (typeof cell === "string") {
    const m = cell.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;

    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yyyy = m[3];

    return `${dd}/${mm}/${yyyy}`;
  }

  return null;
}


function getWorkingDays(start, end) {
  const days = [];
  let d = new Date(start);

  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      days.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }

  return days;
}

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/* ================= MAIN ================= */

function calcTimeInOut(jiraList, mandayList) {
  const start = new Date("2025-12-01");
  const end = new Date("2025-12-30");

  const workingDays = getWorkingDays(start, end);

  let dayIndex = 0;
  const result = [];

  for (let i = 0; i < jiraList.length; i++) {
    const jira = jiraList[i];
    const manday = Number(mandayList[i]);

    const daysNeeded = Math.ceil(manday);

    const timeIn = workingDays[dayIndex];
    const timeOut = workingDays[dayIndex + daysNeeded - 1];

    result.push({
      jira,
      manday,
      time_in: formatDate(timeIn),
      time_out: formatDate(timeOut)
    });

    dayIndex += daysNeeded;
  }

  return result;
}


module.exports = function importExcel(filePath, staffName) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  /* ===== 1. FIND DATE HEADER ROW (>=3 ô là date) ===== */
  const dateRowIndex = data.findIndex(r =>
    r.filter(c => parseDateFromHeader(c)).length >= 3
  );

  if (dateRowIndex === -1) {
    throw new Error("Không tìm thấy hàng ngày");
  }

  const dateRow = data[dateRowIndex];

  /* ===== 2. MAP COLUMN -> DATE ===== */
  const colDateMap = {};
  dateRow.forEach((c, i) => {
    const d = parseDateFromHeader(c);
    if (d) colDateMap[i] = d;
  });

  /* ===== 3. FIND STAFF ROW ===== */
  const rowIndex = data.findIndex(r =>
    r.some(c => typeof c === "string" && c.trim() === staffName)
  );

  if (rowIndex === -1) {
    throw new Error("Không tìm thấy nhân sự");
  }

  const row = data[rowIndex];

  /* ===== 4. PARSE CELL DATA ===== */
  const temp = [];

  for (let i = 0; i < row.length; i++) {
    const parsed = parseCell(row[i]);
    parsed.forEach(p => {
      temp.push({
        ...p,
        colIndex: i
      });
    });
  }

  /* ===== 5. GROUP BY PYC ===== */
  const map = {};

  temp.forEach(item => {
    if (!map[item.pyc]) {
      map[item.pyc] = {
        pyc: item.pyc,
        manday: item.manday,
        dates: []
      };
    }

    const d = colDateMap[item.colIndex];
    if (d) map[item.pyc].dates.push(d);
  });

  /* ===== 6. BUILD RESULT ===== */
  return Object.values(map).map(v => {
    const sorted = v.dates
      .map(d => {
        const [dd, mm, yyyy] = d.split("/");
        return new Date(`${yyyy}-${mm}-${dd}`);
      })
      .sort((a, b) => a - b);

    const format = d =>
      `${String(d.getDate()).padStart(2, "0")}/${String(
        d.getMonth() + 1
      ).padStart(2, "0")}/${d.getFullYear()}`;

  


    return {
      pyc: v.pyc,
      manday: v.manday,
      time_in: sorted.length ? format(sorted[0]) : null,
      time_out: sorted.length ? format(sorted[sorted.length - 1]) : null
    };
  });
};

