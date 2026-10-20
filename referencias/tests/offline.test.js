'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const www = path.join(__dirname, '../../app/src/main/assets/www');
test('offline: todo script da página está no cache do app (funciona sem internet)', () => {
  const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(www, 'sw.js'), 'utf8');
  const assets = sw.match(/const ASSETS = \[(.*?)\];/s)[1];
  const faltam = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !assets.includes(`"${s}"`));
  assert.deepEqual(faltam, []);
  for (const a of [...assets.matchAll(/"([^"]+)"/g)].map(m => m[1]).filter(a => a !== './')) assert.ok(fs.existsSync(path.join(www, a)), `arquivo do cache não existe: ${a}`);
});
