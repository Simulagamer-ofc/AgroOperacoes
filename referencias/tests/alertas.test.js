'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/alertas.js'), 'utf8');
const addDias = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
function app({ponte, chuva = [0, 0, 35, 0], janelasAmanha = [[6, 10]]} = {}) {
  const mem = {};
  const dias = [0, 1, 2, 3].map(i => addDias('2026-10-19', i));
  const ctx = vm.createContext({
    window: {AndroidBridge: ponte}, ACTIONS: {}, Date, Math, JSON, Number, String, Object, console,
    safeStorage: {get: k => mem[k] ?? null, set: (k, v) => { mem[k] = v; }},
    today: () => '2026-10-19', addDias, isoLocal: dt => dt.toISOString().slice(0, 10), hh: n => String(n).padStart(2, '0') + 'h',
    num: (v, c = 0) => Number(v).toFixed(c), fmtDate: d => d.split('-').reverse().join('/'), esc: s => String(s), btn: (l, a) => `<button data-act="${a}">${l}</button>`,
    showToast() {}, opPlace: () => 'Talhão 1', isInactive: () => false, SERVICE_WARN_HOURS: 25,
    hoursToService: m => m.nextService - m.hours, previsaoRevisao: () => null, previsaoEstoque: () => null, stockLow: s => s.qty <= s.min,
    lerClima: () => ({dados: {daily: {time: dias, precipitation_sum: chuva, precipitation_probability_max: [10, 10, 90, 10]}}}),
    janelasDoDia: (dados, dia) => ({janelas: dia === dias[1] ? janelasAmanha : [], principal: 'vento forte'}),
    db: {machines: [{id: 'm1', name: 'Trator', hours: 990, nextService: 1000}], stock: [{id: 's1', name: 'Diesel', qty: 50, min: 100, unit: 'L'}],
      operations: [{id: 'o1', type: 'Aplicação', status: 'Programada', date: dias[1]}]},
    document: {addEventListener() {}, getElementById: () => null, visibilityState: 'visible'}, addEventListener() {}, setInterval() {}, setTimeout() {}
  });
  vm.runInContext(src, ctx);
  return {ctx, mem, run: s => vm.runInContext(s, ctx)};
}
test('alertas: calcula chuva forte, janela de amanhã, revisão e estoque com ids estáveis', () => {
  const a = app();
  const agora = new Date('2026-10-19T10:00:00').getTime();
  const lista = a.run(`calcularAlertas({...alertaCfg(), ativo: true}, ${agora})`);
  const ids = [...lista.map(x => x.id)].sort();
  assert.equal(JSON.stringify(ids), JSON.stringify(['chuva-2026-10-21', 'estoque-s1-baixo-50', 'pulverizar-2026-10-20', 'revisao-m1-1000']));
  const chuva = lista.find(x => x.tipo === 'chuva');
  assert.equal(chuva.quando, new Date('2026-10-20T07:00:00').getTime(), 'chuva avisa na véspera às 7h');
  assert.match(chuva.titulo, /35 mm amanhã/);
  const pulv = lista.find(x => x.tipo === 'pulverizar');
  assert.equal(pulv.quando, new Date('2026-10-19T18:00:00').getTime(), 'janela avisa às 18h da véspera');
  assert.match(pulv.titulo, /06h–10h/);
});
test('alertas: sem janela e com aplicação programada avisa; desligado não agenda nada', () => {
  const a = app({janelasAmanha: []});
  const lista = a.run(`calcularAlertas({...alertaCfg(), ativo: true}, ${new Date('2026-10-19T10:00:00').getTime()})`);
  assert.match(lista.find(x => x.tipo === 'pulverizar').titulo, /sem boa janela/);
  let agendado = null;
  const b = app({ponte: {agendarAlertas: j => { agendado = j; }}});
  b.run('entregarAlertas()');
  assert.equal(agendado, '[]');
});
test('alertas: no APK agenda no Android e não repete o que já foi entregue', () => {
  const chamadas = [];
  const a = app({ponte: {agendarAlertas: j => chamadas.push(JSON.parse(j))}});
  a.mem['agro-alertas'] = JSON.stringify({ativo: true});
  a.run('entregarAlertas()');
  const primeira = chamadas[0].map(x => x.id);
  assert.ok(primeira.includes('revisao-m1-1000') && primeira.includes('estoque-s1-baixo-50'));
  a.run('entregarAlertas()');
  const segunda = chamadas[1].map(x => x.id);
  assert.ok(!segunda.includes('revisao-m1-1000'), 'aviso imediato já entregue não volta');
  assert.ok(segunda.includes('chuva-2026-10-21'), 'aviso futuro continua agendado (texto atualizado)');
});
