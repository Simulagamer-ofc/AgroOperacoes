'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({Math, Date, Number, JSON, String, VIEWS: {}, ACTIONS: {}, TITLES: {}, db: {settings: {}}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/mapa-tempo.js'), 'utf8'), ctx);
const run = s => vm.runInContext(s, ctx);
test('mapa do tempo: escala de chuva por mm/h', () => {
  assert.equal(run('corChuva(0.1)'), null);
  assert.equal(run('corChuva(0.2)'), '#a9d8f7');
  assert.equal(run('corChuva(6)'), '#f2d43f');
  assert.equal(run('corChuva(35)'), '#e0443f');
});
test('mapa do tempo: radares do DECEA que cobrem Passo Fundo (até ~420 km), do mais perto ao mais longe', () => {
  const r = run('radaresPerto(-28.26, -52.41).map(x => x.k).join(",")');
  assert.equal(r, 'sg,mi,cn');
});
test('mapa do tempo: horários do STSC em UTC no dia da última ocorrência, voltando um dia depois da meia-noite', () => {
  const h = run("horariosStsc({ultima: '2026-10-21 00:04:59', quadros: [{hora: '23:58', pontos: [[-28, -52]]}, {hora: '00:04', pontos: []}]}).map(x => x.t.toISOString())");
  assert.equal(JSON.stringify(h), JSON.stringify(['2026-10-20T23:58:00.000Z', '2026-10-21T00:04:00.000Z']));
  assert.equal(run("dataUTC('2026-10-21 14:40:00').toISOString()"), '2026-10-21T14:40:00.000Z');
});
