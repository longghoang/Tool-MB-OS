const express = require('express');
const multer = require('multer');
const service = require('../services/pendingComment.service');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 3, fieldSize: 5000 },
  fileFilter: (_req, file, callback) => {
    if (/^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype)) return callback(null, true);
    callback(new Error('INVALID_IMAGE_TYPE'));
  }
});

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.method === 'POST' && req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
    } catch {
      return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
    }
  }
  next();
});

router.get('/', (_req, res) => res.render('pending-comment'));

router.post('/lookup', async (req, res) => {
  try {
    res.json(await service.lookup(req.body.number));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Không tra cứu được Phiếu Yêu cầu.' });
  }
});

router.post('/submit', (req, res, next) => {
  upload.single('image')(req, res, error => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Ảnh PoC không được vượt quá 10 MB.'
      : 'Chỉ được tải lên một ảnh PoC định dạng PNG, JPG, GIF hoặc WEBP.';
    res.status(400).json({ error: message });
  });
}, async (req, res) => {
  try {
    res.json({ ok: true, result: await service.submit({ number: req.body.number, reason: req.body.reason, image: req.file, customComment: req.body.comment }) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Không gửi được comment Pending.' });
  }
});

module.exports = router;
