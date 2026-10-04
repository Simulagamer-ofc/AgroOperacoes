import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../app/src/main/assets/www/js/logic.js';
import { DATA_STORES } from '../app/src/main/assets/www/js/schemas.js';

const TODAY = '2026-10-04';
const empty = () => Object.fromEntries(DATA_STORES.map(s => [s, []]));
const sample = () => L.sampleData(TODAY);

test('datas locais e formatação', () => {
  assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(L.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(L.monthStart('2026-10-04'), '2026-10-01');
  assert.equal(L.fmtDate('2026-10-04'), '04/10/2026');
  assert.equal(L.isDate('2026-1-4'), false);
});

test('num aceita vírgula e ignora lixo', () => {
  assert.equal(L.num('1.234,5'), 1234.5);
  assert.equal(L.num('12.5'), 12.5);
  assert.equal(L.num(''), 0);
  assert.equal(L.num('abc'), 0);
});

test('saldo de estoque soma entradas e desconta saídas, consumo e ajuste com sinal', () => {
  const s = empty();
  s.stockItems = [{ id: 'i', name: 'Diesel', unit: 'L', minQty: 100 }];
  s.stockMoves = [
    { id: '1', itemId: 'i', kind: 'entrada', qty: 500 },
    { id: '2', itemId: 'i', kind: 'consumo', qty: 300 },
    { id: '3', itemId: 'i', kind: 'saida', qty: 50 },
    { id: '4', itemId: 'i', kind: 'ajuste', qty: -60 },
  ];
  assert.equal(L.stockQty(s, 'i'), 90);
  const alert = L.computeAlerts(s, TODAY).find(a => a.route === 'estoque');
  assert.match(alert.title, /Diesel/);
});

test('horímetro usa a maior leitura e avisa revisão próxima ou vencida', () => {
  const s = empty();
  s.machines = [{ id: 'm', name: 'Trator', hourmeter: 100, nextServiceAt: 150, status: 'ativa' }];
  s.hourmeterLogs = [{ id: 'h', machineId: 'm', date: TODAY, reading: 145 }];
  assert.equal(L.hourmeterOf(s, s.machines[0]), 145);
  let service = L.machineService(s, s.machines[0]);
  assert.equal(service.soon, true);
  assert.equal(service.left, 5);
  s.hourmeterLogs.push({ id: 'h2', machineId: 'm', date: TODAY, reading: 151 });
  service = L.machineService(s, s.machines[0]);
  assert.equal(service.due, true);
  assert.ok(L.computeAlerts(s, TODAY).some(a => a.title.startsWith('Revisão vencida')));
});

test('máquina inativa não gera alerta de revisão', () => {
  const s = empty();
  s.machines = [{ id: 'm', name: 'Velho', hourmeter: 200, nextServiceAt: 100, status: 'inativa' }];
  assert.equal(L.computeAlerts(s, TODAY).length, 0);
});

test('indicadores contam só operações de hoje e ignoram canceladas', () => {
  const s = empty();
  s.operations = [
    { id: '1', type: 'Plantio', date: TODAY, status: 'programada' },
    { id: '2', type: 'Plantio', date: TODAY, status: 'cancelada' },
    { id: '3', type: 'Aplicação', date: L.addDays(TODAY, -1), status: 'programada' },
    { id: '4', type: 'Colheita', date: L.addDays(TODAY, -2), status: 'andamento' },
  ];
  const k = L.computeKpis(s, TODAY);
  assert.equal(k.scheduled, 1);
  assert.equal(k.scheduledHint, '1 operação hoje');
  assert.equal(k.running, 1);
  assert.equal(k.runningHint, 'Colheita');
  // A operação de ontem ainda programada vira pendência.
  assert.ok(L.computeAlerts(s, TODAY).some(a => a.title.startsWith('Operação atrasada')));
});

test('máquina com manutenção aberta conta como em manutenção', () => {
  const s = empty();
  s.machines = [{ id: 'm', name: 'Colheitadeira', status: 'ativa' }];
  s.maintenance = [{ id: 'x', machineId: 'm', date: TODAY, description: 'Filtros', status: 'aberta' }];
  assert.equal(L.computeKpis(s, TODAY).maintenance, 1);
  s.maintenance[0].status = 'concluida';
  assert.equal(L.computeKpis(s, TODAY).maintenance, 0);
});

test('validação: obrigatórios, números, datas, referências e nomes repetidos', () => {
  const s = sample();
  assert.deepEqual(L.validateRecord('fields', { id: 'novo', name: 'Talhão 99', areaHa: 10 }, s), []);
  assert.match(L.validateRecord('fields', { id: 'novo', name: '' }, s)[0], /Preencha/);
  assert.match(L.validateRecord('fields', { id: 'novo', name: 'talhao 07' }, s)[0], /Já existe/);
  assert.equal(L.validateRecord('fields', { id: 'ex-t07', name: 'Talhão 07' }, s).length, 0, 'editar o próprio registro não é duplicidade');
  assert.match(L.validateRecord('fields', { id: 'novo', name: 'X', areaHa: -1 }, s)[0], /negativo/);
  assert.match(L.validateRecord('lots', { id: 'n', code: 'L1', status: 'em_analise', germination: 120 }, s)[0], /máximo 100/);
  assert.match(L.validateRecord('hourmeterLogs', { id: 'n', machineId: 'nao-existe', date: TODAY, reading: 1 }, s)[0], /não existe/);
  assert.match(L.validateRecord('operations', { id: 'n', type: 'Plantio', date: '04/10/2026', status: 'programada' }, s)[0], /data válida/);
  assert.match(L.validateRecord('stockMoves', { id: 'n', itemId: 'ex-e1', kind: 'entrada', date: TODAY, qty: 0 }, s)[0], /maior que zero/);
  assert.deepEqual(L.validateRecord('stockMoves', { id: 'n', itemId: 'ex-e1', kind: 'ajuste', date: TODAY, qty: -5 }, s), []);
});

test('normalizeRecord converte números e apara textos', () => {
  const r = L.normalizeRecord('fields', { name: '  Talhão 1 ', areaHa: '12,5', crop: '', notes: '' });
  assert.deepEqual(r, { name: 'Talhão 1', areaHa: 12.5, crop: '', notes: '' });
});

test('não deixa excluir registro em uso', () => {
  const s = sample();
  const refs = L.findReferences(s, 'machines', 'ex-m1');
  assert.ok(refs.some(r => r.store === 'hourmeterLogs'));
  assert.ok(refs.some(r => r.store === 'operations'));
  assert.deepEqual(L.findReferences(s, 'machines', 'ex-m4'), []);
});

test('busca ignora acentos e maiúsculas', () => {
  const s = sample();
  const results = L.searchAll(s, 'talhao 08');
  assert.ok(results.some(r => r.store === 'fields' && r.id === 'ex-t08'));
  assert.ok(L.searchAll(s, 'SM-024').some(r => r.store === 'lots'));
  assert.deepEqual(L.searchAll(s, '   '), []);
});

test('rastreabilidade liga talhão, campo de produção, lote e movimentações', () => {
  const t = L.lotTrace(sample(), 'ex-l2');
  assert.equal(t.field.id, 'ex-t07');
  assert.equal(t.production.id, 'ex-p1');
  assert.equal(t.cultivar, 'BRS 1003');
  assert.deepEqual(t.moves.map(m => m.id).sort(), ['ex-s5', 'ex-s6']);
  assert.equal(L.lotTrace(sample(), 'nao-existe'), null);
});

test('relatório do período', () => {
  const s = sample();
  const r = L.buildReport(s, L.addDays(TODAY, -5), TODAY);
  assert.equal(r.operations.total, 4);
  assert.equal(r.operations.byStatus.programada, 2);
  assert.deepEqual(r.hours.find(h => h.name === 'Trator 7230J'), { name: 'Trator 7230J', hours: 42 });
  assert.equal(r.maintenance.total, 1);
  assert.equal(r.maintenance.cost, 1850);
  const ts = r.stock.find(x => x.name === 'Tratamento TS-04');
  assert.equal(ts.saida, 85);
  assert.equal(ts.entrada, 0);
});

test('CSV usa ponto e vírgula, vírgula decimal e aspas quando preciso', () => {
  const csv = L.toCsv([{ label: 'Nome', value: r => r.n }, { label: 'Área', value: r => r.a }], [{ n: 'A; "B"', a: 1.5 }]);
  assert.equal(csv, 'Nome;Área\r\n"A; ""B""";1,5');
  const s = sample();
  const lines = L.toCsv(L.exportColumns('operations', s), s.operations).split('\r\n');
  assert.equal(lines.length, s.operations.length + 1);
  assert.match(lines[0], /^Tipo de operação;Data;/);
  assert.ok(lines.some(l => l.includes('Talhão 08') && l.includes('Em andamento')));
});

test('backup: ida e volta e rejeição de arquivos inválidos', () => {
  const s = sample();
  const backup = JSON.parse(JSON.stringify(L.makeBackup(s, { farmName: 'Faz', userName: 'Ana' }, 'x')));
  const result = L.validateBackup(backup);
  assert.equal(result.ok, true);
  assert.equal(result.count, DATA_STORES.reduce((n, k) => n + s[k].length, 0));
  assert.equal(result.settings.farmName, 'Faz');
  assert.equal(L.validateBackup({ app: 'outro' }).ok, false);
  assert.equal(L.validateBackup({ app: 'agro-operacoes', data: { fields: [{ name: 'sem id' }] } }).ok, false);
});

test('migra operações da versão 0.1', () => {
  const ops = L.migrateLegacy([{ type: 'Plantio', place: 'T1', time: '07:00', notes: '' }, { type: 'Colheita', place: 'T2', time: '', notes: '', date: '2026-10-01' }, null], TODAY);
  assert.equal(ops.length, 2);
  assert.equal(ops[0].date, TODAY);
  assert.equal(ops[0].status, 'programada');
  assert.equal(ops[1].date, '2026-10-01');
  assert.ok(ops.every(o => o.id));
});

test('dados de exemplo são consistentes com a validação', () => {
  const s = sample();
  for (const store of DATA_STORES) {
    for (const r of s[store]) assert.deepEqual(L.validateRecord(store, r, s), [], `${store}/${r.id}`);
  }
});

test('escapeHtml e iniciais', () => {
  assert.equal(L.escapeHtml('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
  assert.equal(L.initials('maria da silva'), 'MD');
  assert.equal(L.initials(''), 'AO');
});
