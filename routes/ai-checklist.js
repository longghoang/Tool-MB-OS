const express = require("express");
const router = express.Router();

const { buildChecklistTemplate } = require("../services/checklistDecision.service");

function renderChecklistDecision(res) {
  res.render("ai-checklist-decision", {
    checkedList: buildChecklistTemplate()
  });
}

router.get("/", (req, res) => {
  renderChecklistDecision(res);
});

router.get("/decision", (req, res) => {
  renderChecklistDecision(res);
});

router.post("/decision", (req, res) => {
  renderChecklistDecision(res);
});

router.get("/analyze", (req, res) => {
  res.redirect("/ai-checklist/decision");
});

router.post("/analyze", (req, res) => {
  res.redirect("/ai-checklist/decision");
});

router.post("/upload", (req, res) => {
  res.redirect("/ai-checklist/decision");
});

module.exports = router;
