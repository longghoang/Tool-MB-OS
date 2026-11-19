(() => {
  const form = document.getElementById('login-form');
  if (!form || !window.PasswordCredential || !navigator.credentials) return;

  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const remember = form.elements.remember;
  const savedButton = document.getElementById('saved-login');
  const submitButton = form.querySelector('[type="submit"]');
  const showError = message => {
    let banner = document.querySelector('.form-area .error');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'error';
      banner.setAttribute('role', 'alert');
      form.before(banner);
    }
    banner.textContent = message;
  };
  const fill = credential => {
    if (!credential || credential.type !== 'password') return;
    username.value = credential.id;
    password.value = credential.password;
    remember.checked = true;
  };

  savedButton.hidden = false;
  navigator.credentials.get({ password: true, mediation: 'silent' })
    .then(credential => credential || navigator.credentials.get({ password: true, mediation: 'optional' }))
    .then(fill)
    .catch(() => {});
  savedButton.addEventListener('click', async () => {
    try {
      const credential = await navigator.credentials.get({ password: true, mediation: 'optional' });
      fill(credential);
      if (credential) password.focus();
    } catch { showError('Không đọc được tài khoản đã lưu trong trình duyệt.'); }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const account = username.value.trim();
    const secret = password.value;
    const savePassword = remember.checked;
    submitButton.disabled = true;
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form))
      });
      const result = await response.json();
      if (!response.ok) { showError(result.error || 'Đăng nhập không thành công.'); return; }
      if (savePassword) {
        try {
          await navigator.credentials.store(new PasswordCredential({
            id: account,
            password: secret,
            name: 'VNCS Workspace',
            iconURL: new URL('/workspace/favicon.svg?v=2', location.origin).href
          }));
        } catch { /* The browser may decline password storage; the login itself succeeded. */ }
      }
      location.assign(result.redirect || '/home');
    } catch { showError('Không kết nối được máy chủ. Vui lòng thử lại.'); }
    finally { submitButton.disabled = false; }
  });
})();
