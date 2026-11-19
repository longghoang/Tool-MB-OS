const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createCsrfTestApp } = require('../csrf-test-server');

let server;
let baseUrl;

before(async () => {
  const { app } = createCsrfTestApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('GET /test-csrf changes the selected user password', async () => {
  const response = await fetch(`${baseUrl}/test-csrf?user-name=long&new-pass=Long%40123`, {
    headers: { Origin: 'http://127.0.0.1:8800' }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.user.password, 'Long@123');
  assert.equal(response.headers.get('access-control-allow-origin'), null);

  const users = await (await fetch(`${baseUrl}/api/users`)).json();
  assert.equal(users.long, 'Long@123');
});

test('GET /test-csrf rejects missing fields and unknown users', async () => {
  assert.equal((await fetch(`${baseUrl}/test-csrf?user-name=long`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/test-csrf?user-name=nobody&new-pass=x`)).status, 404);
});
