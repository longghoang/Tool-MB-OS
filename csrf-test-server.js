const express = require('express');

const DEFAULT_USERS = Object.freeze({
  long: 'OldPassword@123',
  alice: 'AlicePassword@123'
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createCsrfTestApp() {
  const app = express();
  const users = new Map(Object.entries(DEFAULT_USERS));

  // Intentionally do not install CORS or CSRF protection in this local lab.
  app.disable('x-powered-by');

  app.get('/', (_req, res) => {
    const rows = [...users.entries()]
      .map(([name, password]) => `<tr><td>${escapeHtml(name)}</td><td><code>${escapeHtml(password)}</code></td></tr>`)
      .join('');

    res.type('html').send(`<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CSRF GET test lab</title>
  <style>
    body { max-width: 820px; margin: 40px auto; padding: 0 20px; font: 16px/1.5 system-ui, sans-serif; color: #172033; }
    h1 { margin-bottom: 8px; }
    .warning { border-left: 4px solid #d97706; background: #fff7ed; padding: 12px 16px; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 9px 12px; text-align: left; }
    code { background: #f1f5f9; padding: 2px 5px; border-radius: 4px; word-break: break-all; }
    input { padding: 8px; margin: 4px; }
    button { padding: 8px 14px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>CSRF GET test lab</h1>
  <p class="warning"><strong>Cố ý không an toàn:</strong> endpoint thay đổi mật khẩu bằng GET, không kiểm tra CSRF token, Origin hoặc Referer. Chỉ dùng trên máy local.</p>

  <h2>Dữ liệu hiện tại</h2>
  <table><thead><tr><th>User</th><th>Password (lab only)</th></tr></thead><tbody>${rows}</tbody></table>

  <h2>Đổi mật khẩu bằng GET</h2>
  <form method="get" action="/test-csrf">
    <input name="user-name" value="long" aria-label="User name">
    <input name="new-pass" value="Long@123" aria-label="New password">
    <button type="submit">Đổi password</button>
  </form>

  <p>URL mẫu: <a href="/test-csrf?user-name=long&amp;new-pass=Long%40123"><code>/test-csrf?user-name=long&amp;new-pass=Long%40123</code></a></p>
  <p>Từ web khác có thể dùng: <code>&lt;img src="http://127.0.0.1:9900/test-csrf?user-name=long&amp;new-pass=Hacked%40123"&gt;</code></p>
  <form method="post" action="/reset"><button type="submit">Reset dữ liệu lab</button></form>
</body>
</html>`);
  });

  // Deliberately vulnerable: a state-changing action is accepted through GET.
  app.get('/test-csrf', (req, res) => {
    const userName = String(req.query['user-name'] || '').trim();
    const newPassword = String(req.query['new-pass'] || '');

    if (!userName || !newPassword) {
      return res.status(400).json({
        ok: false,
        error: 'Cần truyền đủ user-name và new-pass.'
      });
    }

    if (!users.has(userName)) {
      return res.status(404).json({ ok: false, error: `Không tìm thấy user ${userName}.` });
    }

    users.set(userName, newPassword);
    return res.json({
      ok: true,
      message: `Đã đổi password cho ${userName}.`,
      user: { name: userName, password: newPassword }
    });
  });

  app.get('/api/users', (_req, res) => {
    res.json(Object.fromEntries(users));
  });

  app.post('/reset', (_req, res) => {
    users.clear();
    for (const [name, password] of Object.entries(DEFAULT_USERS)) users.set(name, password);
    res.redirect('/');
  });

  return { app, users };
}

if (require.main === module) {
  const port = Number(process.env.CSRF_TEST_PORT) || 9900;
  const { app } = createCsrfTestApp();
  app.listen(port, '127.0.0.1', () => {
    console.log(`CSRF test lab running at http://127.0.0.1:${port}/`);
  });
}

module.exports = { createCsrfTestApp };
