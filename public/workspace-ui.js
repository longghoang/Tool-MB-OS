(() => {
  const settings = window.workspaceSettings;
  if (!settings) return;
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  async function send(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': settings.csrf, ...options.headers } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không thực hiện được thao tác.');
    return result;
  }
  window.workspaceRequest = send;
  function init() {
    const dock = make('div', undefined, 'workspace-dock');
    const home = make('a', '⌂ Home'); home.href = '/home';
    const account = make('span', settings.username, 'workspace-account');
    const select = make('select'); select.setAttribute('aria-label', 'Màu giao diện');
    for (const [value, label] of [['dark', 'Dark'], ['light', 'Light'], ['pink', 'Hồng'], ['red', 'Đỏ']]) {
      const option = make('option', label); option.value = value; select.append(option);
    }
    select.value = settings.theme;
    select.onchange = async () => {
      const previous = settings.theme;
      document.documentElement.dataset.theme = select.value;
      try { const data = await send('/workspace/theme', { method: 'POST', body: JSON.stringify({ theme: select.value }) }); settings.theme = data.theme; }
      catch (error) { select.value = previous; document.documentElement.dataset.theme = previous; alert(error.message); }
    };
    const logout = make('form'); logout.method = 'post'; logout.action = '/logout';
    const token = make('input'); token.type = 'hidden'; token.name = '_csrf'; token.value = settings.csrf;
    const logoutButton = make('button', 'Đăng xuất'); logoutButton.type = 'submit'; logout.append(token, logoutButton);
    dock.append(home, account, select);
    if (settings.role === 'admin') { const admin = make('a', 'Quản trị'); admin.href = '/admin'; dock.append(admin); }
    dock.append(logout); document.body.append(dock);

    if (settings.role === 'user' && (location.pathname === '/home' || location.pathname === '/')) {
      const launch = make('button', undefined, 'love-launch'); launch.type = 'button'; launch.setAttribute('aria-label', 'Nhắn gửi lời yêu thương');
      launch.append(make('span', '♥', 'love-heart'), make('span', 'Nhắn gửi lời yêu thương', 'love-label'));
      const overlay = make('div', undefined, 'love-modal'); overlay.hidden = true;
      const dialog = make('form', undefined, 'love-dialog');
      const close = make('button', '×', 'love-close'); close.type = 'button'; close.setAttribute('aria-label', 'Đóng');
      const title = make('h2', 'Nhắn gửi lời yêu thương');
      const intro = make('p', 'Gửi một lời nhắn tới đội ngũ quản trị workspace.');
      const nameLabel = make('label', 'Tên người gửi'); const name = make('input'); name.name = 'senderName'; name.maxLength = 80; name.required = true; name.placeholder = 'Tên của bạn';
      const messageLabel = make('label', 'Lời nhắn'); const message = make('textarea'); message.name = 'content'; message.maxLength = 2000; message.required = true; message.placeholder = 'Viết lời nhắn của bạn...';
      const submit = make('button', 'Gửi lời nhắn'); submit.type = 'submit';
      const feedback = make('div', '', 'love-feedback'); feedback.setAttribute('role', 'status');
      dialog.append(close, title, intro, nameLabel, name, messageLabel, message, submit, feedback); overlay.append(dialog); document.body.append(launch, overlay);
      launch.onclick = () => { overlay.hidden = false; feedback.textContent = ''; name.focus(); };
      close.onclick = () => { overlay.hidden = true; };
      overlay.onclick = event => { if (event.target === overlay) overlay.hidden = true; };
      document.addEventListener('keydown', event => { if (event.key === 'Escape') overlay.hidden = true; });
      dialog.onsubmit = async event => {
        event.preventDefault(); submit.disabled = true; feedback.textContent = 'Đang gửi...';
        try { await send('/workspace/messages', { method: 'POST', body: JSON.stringify({ senderName: name.value, content: message.value }) }); feedback.textContent = 'Đã gửi lời nhắn. Cảm ơn bạn!'; message.value = ''; }
        catch (error) { feedback.textContent = error.message; }
        finally { submit.disabled = false; }
      };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
