const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.render("home");
});

router.get("/ai-checklist", (req, res) => {
  res.redirect("/ai-checklist/decision");
});

module.exports = router;
