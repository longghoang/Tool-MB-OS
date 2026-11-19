const express = require("express");
const router = express.Router();

const mandayService = require("../services/manday");

// UI
router.get("/", (req, res) => {
  const data = mandayService.load();
  res.render("manday", { data });
});

// tạo tuần
router.post("/create-week", (req, res) => {
  const { start_date, end_date } = req.body;

  mandayService.createWeek(start_date, end_date);
  res.redirect("/manday");
});

// thêm task
router.post("/add", (req, res) => {
  const { input, status, week_id } = req.body;

  mandayService.addItem(week_id, input, status);
  res.redirect("/manday");
});

router.post("/update", (req, res) => {
  mandayService.updateItem(
    req.body.week_id,
    req.body.index,
    req.body
  );
  res.redirect("/manday");
});

router.post("/delete", (req, res) => {
  mandayService.deleteItem(
    req.body.week_id,
    req.body.index
  );
  res.redirect("/manday");
});

const telegram = require("../services/telegram.service");

router.get("/push", async (req, res) => {
  const list = mandayService.getTodayDeadline();

  if (list.length === 0) {
    await telegram.sendMessage("✅ Hôm nay không có PYC nào đến hạn");
  } else {
    let msg = "🚨 <b>Nay nộp mấy con này nhá, làm việc đi lướt vú đít vừa thôi</b>\n\n";

    list.forEach((i, index) => {
      msg += `${index + 1}. ${i.ten_pyc}\n`;
      msg += `👉 Manday: ${i.manday}\n`;
      msg += `👤 ${i.supporter}\n`;
    //   msg += `📌 ${i.status}\n\n`;
    });

    await telegram.sendMessage(msg);
  }

  res.redirect("/manday");
});

module.exports = router;