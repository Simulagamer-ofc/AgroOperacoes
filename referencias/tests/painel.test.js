'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const www = path.join(__dirname, '../../app/src/main/assets/www');

function painel(dados = {}, salvo = '30', hoje = '2026-10-10') {
  const db = {settings: {}, operations: [], expenses: [], maintenances: [], stock: [], hourLogs: [], ...dados};
  const el = () => ({setAttribute() {}, append() {}, classList: {add() {}, remove() {}}, style: {}});
  const ctx = vm.createContext({db, Number, Date, Math, String, Object, Array,
    today: () => hoje,
    isoDate: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    fmtDate: d => d.split('-').reverse().join('/'),
    num: (v, dec = 0) => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits: dec, maximumFractionDigits: Math.max(dec, 2)}),
    esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c])),
    OP_STATUS: ['Programada', 'Em andamento', 'Concluída', 'Cancelada'],
    stockLow: s => Number(s.min) > 0 && Number(s.qty) <= Number(s.min),
    estoquePerto: s => Number(s.min) > 0 && Number(s.qty) > Number(s.min) && Number(s.qty) <= Number(s.min) * 1.5,
    machineName: id => id,
    safeStorage: {get: () => salvo, set() {}}, render() {}, VIEWS: {}, TITLES: {}, ACTIONS: {},
    document: {createElement: el, body: {appendChild() {}}, addEventListener() {}}, addEventListener() {}
  });
  for (const file of ['gastos.js', 'graficos.js']) vm.runInContext(fs.readFileSync(path.join(www, file), 'utf8'), ctx);
  return {ctx, run: s => vm.runInContext(s, ctx)};
}

test('painel: custos usam período e conclusão da manutenção; filtros não modificam registros', () => {
  const dados = {expenses: [{date:'2026-10-09', value:8200, category:'Combustível'}, {date:'2026-09-20', value:3100, category:'Insumos'}, {date:'2026-07-01', value:99999}],
    maintenances: [{date:'2026-08-01', doneDate:'2026-10-08', cost:5400, status:'Concluída'}, {date:'2026-10-09', cost:999, status:'Aberta'}, {date:'2026-10-09', cost:999, status:'Cancelada'}],
    operations: [{date:'2026-10-09', status:'Concluída'}, {date:'2026-09-20', status:'Concluída'}, {date:'2026-07-01', status:'Concluída'}]};
  const {run} = painel(dados); const snapshot = JSON.stringify(dados);
  assert.equal(run('somaValor(lancamentosCusto(periodoPainel().ini, periodoPainel().fim))'), 16700);
  assert.match(run('painelNexus()'), /nx-metric">2<\/div>/);
  run("ACTIONS['graf-periodo']('7')");
  assert.equal(run('somaValor(lancamentosCusto(periodoPainel().ini, periodoPainel().fim))'), 13600);
  assert.match(run('painelNexus()'), /nx-metric">1<\/div>/);
  assert.equal(JSON.stringify(dados), snapshot);
  run("ACTIONS['graf-periodo']('999')"); assert.equal(run('periodoGraf'), 7);
});

test('painel: nenhuma máquina ou dados fictícios em banco vazio; período inválido volta a 30', () => {
  const {run} = painel({}, '-1'); assert.equal(run('periodoGraf'), 30);
  const html = run('painelNexus()');
  assert.match(html, /Nenhum custo registrado no período/);
  assert.match(html, /Nenhuma operação com data no período/);
  assert.match(html, /Nenhum insumo cadastrado/);
  assert.doesNotMatch(html, /NaN|Infinity|Diesel|Semente de soja|18\.450/);
});

test('painel: custos mensais preservam meses sem gasto, virada do ano e mês parcial', () => {
  const {run} = painel({expenses: [{date:'2025-12-25', value:2500}, {date:'2026-01-03', value:200}, {date:'2026-01-25', value:999}]}, '30', '2026-01-10');
  const html = run('custosMes()');
  assert.match(html, /dez\/2025: R\$ 2\.500/);
  assert.match(html, /jan\/2026: R\$ 200, mês em andamento/);
  assert.match(html, /ago\/2025: R\$ 0/);
  assert.match(html, /até 10\/01\/2026/);
  assert.doesNotMatch(html, /R\$ 999/);
});

test('painel: estoque no mínimo tem texto exato e o saldo independe do filtro', () => {
  const stock = [{name:'Diesel', qty:300, min:500, unit:'L'}, {name:'Soja', qty:1100, min:1000, unit:'kg'}, {name:'No limite', qty:500, min:500, unit:'L'}, {name:'Sem mínimo', qty:0, min:0}];
  const {run} = painel({stock});
  assert.equal(run('insumosAtencao().length'), 3);
  const html = run('estoqueInsumos()');
  assert.match(html, /faltam 200 L/); assert.match(html, /No mínimo de 500 L/);
  assert.match(html, /3 em atenção/); assert.doesNotMatch(html, /Sem mínimo/);
  run("ACTIONS['graf-periodo']('7')"); assert.equal(run('estoqueInsumos()'), html);
});

test('painel: categoria agrupada e Outras das horas nunca ultrapassam 100% da largura', () => {
  const {run} = painel({expenses: Array.from({length:8}, (_, i) => ({date:'2026-10-09', category:'Cat '+i, value:100-i})),
    hourLogs: Array.from({length:10}, (_, i) => ({date:'2026-10-09', machineId:'M'+i, previous:0, hours:100-i}))});
  const custos = run("custosCategorias('2026-10-01', '2026-10-10')"), horas = run("graficoHoras('2026-10-01', '2026-10-10')");
  assert.match(custos, /Outras despesas/); assert.match(horas, /Outras/);
  for (const html of [custos, horas]) for (const [, pct] of html.matchAll(/width:([\d.]+)%/g)) assert.ok(Number(pct) <= 100);
});

test('painel: texto cadastrado é escapado nos rótulos e a área informa passagens repetidas', () => {
  const {run} = painel({settings:{farm:'<img src=x onerror=alert(1)>'}, expenses:[{date:'2026-10-09', value:10, category:'<script>x</script>'}], operations:[{date:'2026-10-09', status:'Concluída', area:10}]});
  const html = run('painelNexus()'); assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(run("graficoArea('2026-10-01','2026-10-10')"), /inclui passagens no mesmo talhão/);
});
