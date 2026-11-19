const express = require("express");
const crawlPyc = require("../services/pycCrawler");

const router = express.Router();
const MAX_PYCS = 500;

function parsePycList(value) {
  const entries = String(value || "")
    .split(/[\r\n,;\t]+/)
    .map(value => value.trim())
    .filter(Boolean);

  if (!entries.length) throw new Error("Hãy dán danh sách mã PYC cần tra cứu.");
  if (entries.length > MAX_PYCS) throw new Error(`Mỗi lần tra tối đa ${MAX_PYCS} mã PYC.`);

  return entries.map((entry, index) => {
    const match = /(?:PENTEST\s*[-_]\s*(\d+)|^\s*(\d+)(?:\s|$|[,(]))/i.exec(entry);
    const pyc = match?.[1] || match?.[2];
    if (!pyc) throw new Error(`Không nhận diện được mã PYC ở dòng ${index + 1}: ${entry}`);
    return pyc;
  });
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let index = 0;
  async function worker() {
    while (index < values.length) {
      const current = index++;
      results[current] = await mapper(values[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

router.get("/", (req, res) => res.render("excel"));

router.post("/lookup", async (req, res) => {
  try {
    const pycs = parsePycList(req.body?.pycs);
    const titleByPyc = new Map();
    const uniquePycs = [...new Set(pycs)];

    await mapWithConcurrency(uniquePycs, 3, async pyc => {
      try {
        titleByPyc.set(pyc, await crawlPyc(pyc));
      } catch (error) {
        console.warn(`BBXN: bỏ qua PENTEST-${pyc}: ${error.message}`);
        titleByPyc.set(pyc, "");
      }
    });

    const items = pycs.map((pyc, index) => ({
      order: index + 1,
      pyc,
      title: titleByPyc.get(pyc) || "",
    }));
    const filled = items.filter(item => item.title).length;

    return res.json({ items, filled, skipped: items.length - filled });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
