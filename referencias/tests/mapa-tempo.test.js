'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({Math, Date, Number, JSON, VIEWS: {}, ACTIONS: {}, TITLES: {}, db: {settings: {}}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/mapa-tempo.js'), 'utf8'), ctx);
const run = s => vm.runInContext(s, ctx);
test('mapa do tempo: escala de chuva por mm/h', () => {
  assert.equal(run('corChuva(0.1)'), null);
  assert.equal(run('corChuva(0.2)'), '#a9d8f7');
  assert.equal(run('corChuva(6)'), '#f2d43f');
  assert.equal(run('corChuva(35)'), '#e0443f');
});
test('mapa do tempo: 7 quadros do satélite a cada 20 min, o último ~40 min antes de agora, em minutos redondos', () => {
  const agora = Date.UTC(2026, 9, 21, 12, 7);
  const q = run(`quadrosSatelite(${agora}).map(d => d.toISOString())`);
  assert.equal(q.length, 7);
  assert.equal(q.at(-1), '2026-10-21T11:20:00.000Z');
  assert.equal(q[0], '2026-10-21T09:20:00.000Z');
});
