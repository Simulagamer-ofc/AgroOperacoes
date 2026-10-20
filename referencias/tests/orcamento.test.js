'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/orcamento.js'), 'utf8');
function app() {
  const db = {
    fields: [{id: 't1', name: 'Talhão 1', area: 10, season: '2026/27', crop: 'Soja'}, {id: 't2', name: 'Talhão 2', area: 20, season: '2026/27'}],
    stock: [{id: 'adubo', category: 'Fertilizante'}, {id: 'semente', category: 'Semente'}],
    expenses: [{fieldId: 't1', season: '2026/27', category: 'Combustível', value: 500}, {fieldId: 't1', season: '2025/26', category: 'Combustível', value: 9999}, {fieldId: 't1', category: 'Energia', value: 100}],
    movements: [{kind: 'Saída', fieldId: 't1', itemId: 'adubo', value: 3000}, {kind: 'Saída', fieldId: 't1', itemId: 'semente', value: 1200}, {kind: 'Entrada', fieldId: 't1', itemId: 'adubo', value: 50000}],
    orcamentos: [{id: 'o1', season: '2026/27', fieldId: 't1', valores: {Fertilizantes: 250, Sementes: 150, 'Combustível': 40}}]
  };
  const ctx = vm.createContext({db, VIEWS: {}, TITLES: {}, ACTIONS: {}, prodSafra: '2026/27', num: (v, c = 0) => Number(v).toFixed(c),
    find: (c, id) => db[c].find(x => x.id === id), safraDoTalhao: id => db.fields.find(f => f.id === id)?.season || '', esc: s => String(s),
    safraDoLancamento: r => r.season || db.fields.find(f => f.id === r.fieldId)?.season || '', safraDoMovimento: m => db.fields.find(f => f.id === m.fieldId)?.season || '',
    btn: (l, a, id) => `<b data-act="${a}" data-id="${id}">${l}</b>`, mini: (l, a, id) => `<i data-act="${a}" data-id="${id}">${l}</i>`, head: t => t, empty: t => t});
  vm.runInContext(src, ctx);
  return {db, run: s => vm.runInContext(s, ctx)};
}
test('planejado x realizado: realizado por categoria vem de gastos e insumos do talhão na safra', () => {
  const a = app();
  const r = a.run("realizadoPorCategoria('2026/27', 't1')");
  assert.equal(r['Fertilizantes'], 3000); assert.equal(r['Sementes'], 1200); assert.equal(r['Combustível'], 500);
  assert.equal(r['Outros'], 100, 'gasto sem safra própria usa a safra do talhão; Energia vai para Outros');
  const p = a.run("planejamentoSafra('2026/27')");
  const t1 = p.linhas.find(l => l.id === 't1');
  assert.equal(t1.planHa, 440); assert.equal(t1.plan, 4400); assert.equal(t1.real, 4800);
  assert.ok(t1.pct > 100, 'talhão passou do planejado');
  assert.equal(p.semPlano, 1);
  assert.match(a.run("secaoOrcamento('2026/27')"), /passou<\/?\w*>? do planejado|passou do planejado/);
});
test('planejado x realizado: sem acesso ao financeiro a seção não aparece', () => {
  const a = app();
  a.run('nvVeFinanceiro = () => false');
  assert.equal(a.run("secaoOrcamento('2026/27')"), '');
});
test('safra do lançamento: saída sem safra vai para a safra da data, não para a safra atual do talhão', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/producao.js'), 'utf8');
  const fields = [{id: 't1', season: '2026/27'}, {id: 't2', season: '2026/2027'}, {id: 't3', season: 'Safrinha'}];
  const ctx = vm.createContext({find: (c, id) => fields.find(f => f.id === id)});
  vm.runInContext(src.slice(src.indexOf('const safraDoTalhao'), src.indexOf('function colheitaForm')), ctx);
  const s = r => vm.runInContext(`safraDoLancamento(${JSON.stringify(r)})`, ctx);
  assert.equal(s({fieldId: 't1', date: '2025-10-10'}), '2025/26');
  assert.equal(s({fieldId: 't1', date: '2026-03-01'}), '2025/26');
  assert.equal(s({fieldId: 't1', date: '2026-10-08'}), '2026/27');
  assert.equal(s({fieldId: 't1', date: '2025-10-10', season: '2024/25'}), '2024/25', 'safra informada vale');
  assert.equal(s({fieldId: 't2', date: '2025-10-10'}), '2025/2026', 'segue o formato da safra do talhão');
  assert.equal(s({fieldId: 't3', date: '2025-10-10'}), 'Safrinha', 'formato livre: mantém a do talhão');
});
