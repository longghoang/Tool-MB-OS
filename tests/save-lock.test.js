const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

test('scope review route can write the same job repeatedly on Windows', async () => {
  const file = path.join(__dirname, '..', 'routes', 'scope-review.js');
  const source = await fs.readFile(file, 'utf8');
  assert.match(source, /saveLocks/);
  assert.match(source, /fs\.rm\(file, \{ force: true \}\)/);
  assert.match(source, /EBUSY/);
});
