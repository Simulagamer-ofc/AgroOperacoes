'use strict';
// Chuva automática (campo-auto.js): chuva de cada dia e o que gravar/tirar
process.env.TZ = 'America/Sao_Paulo';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const www = path.join(__dirname, '../../app/src/main/assets/www');
function app() {
  const ctx = vm.createContext({Math, Date, JSON, Number, String, Array, Object, Set, Infinity, console, VIEWS: {}, ACTIONS: {}, db: {settings: {}}, setTimeout: () => 0, setInterval: () => 0, operationRow: () => ''});
  vm.runInContext(fs.readFileSync(path.join(www, 'campo-auto.js'), 'utf8') + '\nthis.f = {chuvaAutoDias, chaPlano, chaId};', ctx);
  return ctx.f;
}
// Previsão horária de ontem (25/11) e hoje (26/11)
function horas(fn) {
  const h = {time: [], precipitation: []};
  for (const d of ['2026-11-25', '2026-11-26']) for (let x = 0; x < 24; x++) { const t = `${d}T${String(x).padStart(2, '0')}:00`; h.time.push(t); h.precipitation.push(fn(d, x)); }
  return h;
}

test('hoje: soma só as horas que já passaram; ontem: pelo histórico (ou pelas 24 h da previsão)', () => {
  const {chuvaAutoDias} = app();
  const h = horas((d, x) => d === '2026-11-26' && x >= 13 && x <= 20 ? 2 : d === '2026-11-25' && x === 3 ? 4.4 : 0);
  const r = chuvaAutoDias({hist: {dias: {'2026-11-24': {chuva: 12.34}}}, hourly: h, agora: '2026-11-26T15:40', dias: 3});
  assert.equal(r.length, 3);
  assert.deepEqual({...r[0]}, {date: '2026-11-24', mm: 12.3, ate: ''});
  assert.equal(r[1].date, '2026-11-25'); assert.equal(r[1].mm, 4.4); // sem histórico: 24 h da previsão
  assert.equal(r[2].date, '2026-11-26'); assert.equal(r[2].mm, 6); assert.equal(r[2].ate, '15:00'); // 13h, 14h e 15h
});

test('grava a partir de 1 mm, um registro por dia (mesmo código em todos os aparelhos) e atualiza ao longo do dia', () => {
  const {chaPlano, chaId} = app();
  const dias = [{date: '2026-11-25', mm: 0.6, ate: ''}, {date: '2026-11-26', mm: 6, ate: '15:00'}];
  const p = chaPlano(dias, []);
  assert.equal(p.criar.length, 1); assert.equal(p.criar[0].id, chaId('2026-11-26')); assert.equal(p.criar[0].fonte, 'automática'); assert.equal(p.criar[0].fieldId, '');
  // Mais tarde choveu mais: atualiza o mesmo registro
  const r2 = chaPlano([{date: '2026-11-26', mm: 14, ate: '18:00'}], [{...p.criar[0]}]);
  assert.equal(r2.criar.length, 1); assert.equal(r2.criar[0].mm, 14); assert.equal(r2.criar[0].novo, false);
  // Igual: não mexe
  assert.equal(chaPlano([{date: '2026-11-26', mm: 6, ate: '15:00'}], [{...p.criar[0]}]).criar.length, 0);
});

test('não soma duas vezes: leitura do pluviômetro no dia ou na manhã seguinte tira a automática; editada e excluída não voltam', () => {
  const {chaPlano, chaId} = app();
  const auto = {id: chaId('2026-11-25'), date: '2026-11-25', mm: 8, fonte: 'automática', fieldId: ''};
  const dia = [{date: '2026-11-25', mm: 8, ate: ''}];
  assert.deepEqual([...chaPlano(dia, [auto, {id: 'p1', date: '2026-11-25', hora: '18:00', mm: 10, fonte: 'pluviômetro', fieldId: ''}]).tirar], [auto.id]);
  assert.deepEqual([...chaPlano(dia, [auto, {id: 'p2', date: '2026-11-26', hora: '07:00', mm: 10, fonte: 'pluviômetro', fieldId: 't1'}]).tirar], [auto.id]);
  assert.equal(chaPlano(dia, [auto, {id: 'p3', date: '2026-11-26', hora: '17:00', mm: 3, fonte: 'pluviômetro'}]).tirar.length, 0); // tarde do dia seguinte: é outra chuva
  const editada = {...auto, fonte: 'pluviômetro', editada: true, mm: 9};
  const r = chaPlano([{date: '2026-11-25', mm: 20, ate: ''}], [editada]); assert.equal(r.criar.length + r.tirar.length, 0);
  assert.equal(chaPlano(dia, [], ['2026-11-25']).criar.length, 0);
  // Previsão revista para menos de 1 mm: tira
  assert.deepEqual([...chaPlano([{date: '2026-11-25', mm: 0.4, ate: ''}], [auto]).tirar], [auto.id]);
});
