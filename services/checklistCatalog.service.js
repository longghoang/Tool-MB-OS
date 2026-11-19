const fs = require("fs");
const path = require("path");

function readChecklist(fileName, group) {
  const filePath = path.join(__dirname, "../checklist", fileName);
  const items = JSON.parse(fs.readFileSync(filePath, "utf8"));

  return items.map(item => ({
    ...item,
    group
  }));
}

const checklistItems = [
  ...readChecklist("api.json", "api"),
  ...readChecklist("feature.json", "feature"),
  ...readChecklist("global.json", "global")
];

const checklistMap = new Map(
  checklistItems.map(item => [String(item.code || "").trim().toUpperCase(), item])
);

function getAllChecklistItems() {
  return checklistItems.slice();
}

function findChecklistItemByCode(code) {
  if (!code) {
    return null;
  }

  return checklistMap.get(String(code).trim().toUpperCase()) || null;
}

module.exports = {
  getAllChecklistItems,
  findChecklistItemByCode
};
