'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({Math, Number, VIEWS: {}, ACTIONS: {}, db: {avaliacoes: []}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/lavoura.js'), 'utf8'), ctx);
const run = s => vm.runInContext(s, ctx);
const perto = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('estande: plantas por metro, por m², por hectare, variação e % da meta', () => {
  // 5 m de linha, espaçamento 0,45 m: 60, 66, 54 plantas → 12 pl/m → 266.666 pl/ha
  const r = run('calcEstande({contagens: [60, 66, 54], metros: 5, espacamento: 0.45, meta: 280000})');
  perto(r.porMetro, 12); perto(r.porM2, 12 / 0.45); perto(r.porHa, 12 * 10000 / 0.45);
  perto(r.cv, 6 / 60 * 100, 1e-9); perto(r.pctMeta, (12 * 10000 / 0.45) / 280000 * 100);
  assert.equal(run('calcEstande({contagens: [], metros: 5, espacamento: 0.45})'), null);
});
test('produtividade da soja pelos componentes: pl/m² × vagens × grãos × PMG ÷ 100', () => {
  // 30 pl/m² × 40 vagens × 2,3 grãos = 2.760 grãos/m² × 0,160 g = 441,6 g/m² = 4.416 kg/ha = 73,6 sc/ha
  const r = run("calcProdutividade('soja', {plantasM2: 30, vagens: 40, graosVagem: 2.3, pmg: 160})");
  perto(r.kgHa, 4416, 1e-6); perto(r.scHa, 73.6, 1e-9);
  const p = run("calcProdutividade('soja', {plantasM2: 30, vagens: 40, graosVagem: 2.3, pmg: 160, perdas: 5})");
  perto(p.kgHaLiq, 4416 * 0.95, 1e-6);
});
test('produtividade do milho: espigas/ha × fileiras × grãos × PMG ÷ 1.000.000', () => {
  // 70.000 × 16 × 35 × 350 g / 1e6 = 13.720 kg/ha = 228,67 sc/ha
  const r = run("calcProdutividade('milho', {espigasHa: 70000, fileiras: 16, graosFileira: 35, pmg: 350})");
  perto(r.kgHa, 13720, 1e-6); perto(r.scHa, 13720 / 60, 1e-9);
  assert.equal(run("calcProdutividade('milho', {espigasHa: 70000, fileiras: 16, pmg: 350})"), null);
});
