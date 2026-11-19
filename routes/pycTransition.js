const express = require("express");
const router = express.Router();
const { transitionPYCList } = require("../services/pycTransition.service");

router.get("/home/pyc-transition", (req, res) => {
  res.render("pyc-transition");
});

router.post("/api/pyc-transition", async (req, res) => {
  const { pycList } = req.body;

  if (!pycList) {
    return res.status(400).json({ error: "Missing pycList" });
  }

  const list = pycList
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  const result = await transitionPYCList(list);
  res.json(result);
});

module.exports = router;
