const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../data/manday.json");

function load() {
  if (!fs.existsSync(FILE)) return { weeks: [] };
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

function formatDate(dateStr) {
  const [d, m, y] = dateStr.trim().split("/");
  return `${y}-${m}-${d}`;
}

function parseInput(input, status) {
  const parts = input
    .trim()
    .split(/\r?\n|\s{2,}/)
    .map(s => s.trim())
    .filter(Boolean);

  if (parts.length < 6) {
    throw new Error("Input không đúng format hoặc thiếu dữ liệu");
  }

  /*
    Hỗ trợ cả 2 format:

    Format cũ:
    PENTEST_16558_...  Mới  Mới  8  1.5  04/05/2026  05/05/2026  QA

    Format mới:
    PENTEST_16596_...
    Mới
    2
    0.5
    04/05/2026
    04/05/2026
    QA

    Cách parse:
    Luôn lấy dữ liệu quan trọng từ cuối chuỗi:
    - supporter: phần tử cuối
    - end_date: phần tử gần cuối
    - start_date
    - manday
    - tong_api
  */

  const supporter = parts[parts.length - 1];
  const endDate = parts[parts.length - 2];
  const startDate = parts[parts.length - 3];
  const mandayRaw = parts[parts.length - 4];
  const tongApiRaw = parts[parts.length - 5];

  const tong_api = parseInt(tongApiRaw, 10);
  const manday = parseFloat(mandayRaw);

  if (Number.isNaN(tong_api)) {
    throw new Error(`tong_api không hợp lệ: ${tongApiRaw}`);
  }

  if (Number.isNaN(manday)) {
    throw new Error(`manday không hợp lệ: ${mandayRaw}`);
  }

  return {
    ten_pyc: parts[0],
    tong_api,
    manday,
    start_date: formatDate(startDate),
    end_date: formatDate(endDate),
    supporter,
    status
  };
}

function createWeek(start, end) {
  const data = load();

  const week_id = `${start}_to_${end}`;

  data.weeks.push({
    week_id,
    start_date: start,
    end_date: end,
    total_manday: 0,
    items: []
  });

  save(data);
}

function addItem(week_id, input, status) {
  const data = load();

  const week = data.weeks.find(w => w.week_id === week_id);
  if (!week) return;

  const item = parseInput(input, status);
  week.items.push(item);

  week.total_manday = week.items.reduce((s, i) => s + i.manday, 0);

  save(data);
}

function parseDateBack(dateStr) {
  const [d, m, y] = dateStr.trim().split("/");

  if (y.length === 2) {
    return `20${y}-${m}-${d}`;
  }

  return `${y}-${m}-${d}`;
}

function updateItem(week_id, index, dataUpdate) {
  const data = load();

  const week = data.weeks.find(w => w.week_id === week_id);
  if (!week) return;

  const item = week.items[index];
  if (!item) return;

  item.tong_api = parseInt(dataUpdate.tong_api, 10);
  item.manday = parseFloat(dataUpdate.manday);
  item.start_date = parseDateBack(dataUpdate.start_date);
  item.end_date = parseDateBack(dataUpdate.end_date);
  item.supporter = dataUpdate.supporter;
  item.status = dataUpdate.status;

  week.total_manday = week.items.reduce((s, i) => s + i.manday, 0);

  save(data);
}

function deleteItem(week_id, index) {
  const data = load();

  const week = data.weeks.find(w => w.week_id === week_id);
  if (!week) return;

  week.items.splice(index, 1);

  week.total_manday = week.items.reduce((s, i) => s + i.manday, 0);

  save(data);
}

function getTodayDeadline() {
  const data = load();

  const today = new Date().toISOString().split("T")[0];

  let result = [];

  data.weeks.forEach(w => {
    w.items.forEach(i => {
      if (i.end_date === today) {
        result.push({
          ten_pyc: i.ten_pyc,
          manday: i.manday,
          supporter: i.supporter,
          status: i.status
        });
      }
    });
  });

  return result;
}

module.exports = {
  load,
  createWeek,
  addItem,
  updateItem,
  deleteItem,
  getTodayDeadline
};