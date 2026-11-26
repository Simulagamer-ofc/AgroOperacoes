'use strict';
// Talhão dividido (divisao.js): corte do contorno pela linha da divisa
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const www = path.join(__dirname, '../../app/src/main/assets/www');
function app() {
  const ctx = vm.createContext({Math, Number, String, Array, Object, JSON, Infinity, document: {addEventListener() {}}, VIEWS: {}, TITLES: {}, ACTIONS: {}});
  vm.runInContext(fs.readFileSync(path.join(www, 'divisao.js'), 'utf8') + '\nthis.f = {tdvCortar};', ctx);
  return ctx.f;
}
// Área plana aproximada (m²) só para comparar as partes
const area = p => { const la0 = -28.15, kx = 111320 * Math.cos(la0 * Math.PI / 180), ky = 110574; let s = 0;
  for (let i = 0; i < p.length; i++) { const [a1, o1] = p[i], [a2, o2] = p[(i + 1) % p.length]; s += (o1 * kx) * (a2 * ky) - (o2 * kx) * (a1 * ky); } return Math.abs(s / 2); };
// Talhão de ~1 km x 1 km
const Q = [[-28.145, -52.305], [-28.145, -52.295], [-28.154, -52.295], [-28.154, -52.305]];

test('dois pontos dentro do talhão: a linha vai até a borda e corta em duas partes', () => {
  const {tdvCortar} = app();
  // Divisa norte-sul a 30% do lado oeste
  const x = -52.305 + 0.003, r = tdvCortar(Q, [[-28.147, x], [-28.152, x]]);
  assert.ok(r.partes, r.erro); const [a, b] = r.partes.map(area), tot = area(Q);
  assert.ok(Math.abs(a + b - tot) / tot < 1e-6, 'as partes somam o talhão');
  const menor = Math.min(a, b) / tot; assert.ok(Math.abs(menor - 0.3) < 0.002, String(menor));
});

test('pontos fora do talhão e divisa com curva (3 pontos)', () => {
  const {tdvCortar} = app();
  const r = tdvCortar(Q, [[-28.140, -52.300], [-28.150, -52.302], [-28.160, -52.300]]);
  assert.ok(r.partes, r.erro); const tot = area(Q), [a, b] = r.partes.map(area);
  assert.ok(Math.abs(a + b - tot) / tot < 1e-6);
  assert.ok(r.partes.some(p => p.some(([la, lo]) => Math.abs(la + 28.150) < 1e-6 && Math.abs(lo + 52.302) < 1e-6)), 'a curva entra no contorno');
});

test('linha fora do talhão, um ponto só ou talhão sem contorno: avisa', () => {
  const {tdvCortar} = app();
  assert.match(tdvCortar(Q, [[-28.10, -52.40], [-28.10, -52.39]]).erro, /não atravessa/);
  assert.match(tdvCortar(Q, [[-28.15, -52.30]]).erro, /dois pontos/);
  assert.match(tdvCortar([], [[0, 0], [1, 1]]).erro, /contorno/);
});

test('talhão em L (côncavo): linha que cruza a borda quatro vezes pede ajuste', () => {
  const {tdvCortar} = app();
  const L = [[-28.145, -52.305], [-28.145, -52.295], [-28.148, -52.295], [-28.148, -52.302], [-28.154, -52.302], [-28.154, -52.305]];
  assert.match(tdvCortar(L, [[-28.150, -52.310], [-28.146, -52.290]]).erro, /mais de duas vezes/);
  const ok = tdvCortar(L, [[-28.146, -52.299], [-28.147, -52.299]]); // corta o braço de cima
  assert.ok(ok.partes, ok.erro); const tot = area(L), [a, b] = ok.partes.map(area); assert.ok(Math.abs(a + b - tot) / tot < 1e-6);
});
