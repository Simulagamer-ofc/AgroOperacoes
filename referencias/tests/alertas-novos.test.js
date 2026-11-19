'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/alertas.js'), 'utf8');
const addDias = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
// Relógio fixo (19/10/2026, 10h no fuso local)
const AGORA = new Date('2026-10-19T10:00:00').getTime();
class DataFixa extends Date { constructor(...a) { if (a.length) super(...a); else super(AGORA); } static now() { return AGORA; } }
const dias = [0, 1, 2, 3].map(i => addDias('2026-10-19', i));
// Previsão por hora de 4 dias: chuva forte no dia 21 das 14h às 18h, madrugada fria no dia 20
const hourly = {time: [], precipitation: [], temperature_2m: [], wind_speed_10m: [], wind_gusts_10m: [], trovoada: []};
dias.forEach(d => { for (let h = 0; h < 24; h++) {
  hourly.time.push(`${d}T${String(h).padStart(2, '0')}:00`);
  hourly.precipitation.push(d === dias[2] && h >= 14 && h <= 18 ? 8 : 0);
  hourly.temperature_2m.push(d === dias[1] && h === 5 ? -1 : 15);
  hourly.wind_speed_10m.push(3); hourly.wind_gusts_10m.push(d === dias[2] && h === 15 ? 55 : 10); hourly.trovoada.push(d === dias[2] && h === 15 ? 0.4 : 0);
} });
function app({comum = false, extra = {}} = {}) {
  const mem = {};
  const ctx = vm.createContext({
    window: {}, ACTIONS: {}, Date: DataFixa, Math, JSON, Number, String, Object, Array, console,
    safeStorage: {get: k => mem[k] ?? null, set: (k, v) => { mem[k] = v; }},
    today: () => '2026-10-19', addDias, isoLocal: dt => dt.toISOString().slice(0, 10), hh: n => String(n).padStart(2, '0') + 'h',
    num: (v, c = 0) => Number(v).toFixed(c), fmtDate: d => d.split('-').reverse().join('/'), esc: s => String(s), btn: (l, a) => `<button data-act="${a}">${l}</button>`,
    showToast() {}, opPlace: () => 'Talhão 1', isInactive: () => false, SERVICE_WARN_HOURS: 25,
    hoursToService: m => m.nextService - m.hours, previsaoRevisao: () => null, previsaoEstoque: () => null, stockLow: s => s.qty <= s.min,
    lerClima: () => ({dados: {hourly, daily: {time: dias, precipitation_sum: [0, 0, 40, 0], precipitation_probability_max: [10, 10, 90, 10], temperature_2m_min: [10, -1, 12, 12], temperature_2m_max: [25, 20, 22, 26]}}}),
    janelasDoDia: () => ({janelas: [], principal: ''}),
    nvComum: () => comum, nvPodeRota: () => true, cprDecide: () => !comum,
    liberacaoColheita: id => id === 'f1' ? {a: {produto: 'Fungicida', date: '2026-09-20', carencia: 30}, libera: '2026-10-20'} : null,
    lotesVencendo: () => [{s: {id: 's9', name: 'Inseticida', unit: 'L'}, lote: 'L1', saldo: 40, validade: '2026-11-03', dias: 15}],
    db: {settings: {farm: 'Fazenda Zamadei'}, machines: [], stock: [], operations: [{id: 'o1', type: 'Plantio', status: 'Programada', date: dias[2]}],
      fields: [{id: 'f1', name: 'Talhão 4'}],
      contas: [{id: 'c1', tipo: 'pagar', status: 'aberta', descricao: 'Adubo', valor: 48000, vencimento: dias[1]}, {id: 'c2', tipo: 'receber', status: 'aberta', descricao: 'Soja', valor: 9e5, vencimento: dias[1]}],
      pedidosCompra: [{id: 'p1', status: 'solicitado', por: 'João', descricao: 'Peças da colheitadeira', numero: 127}]},
    document: {addEventListener() {}, getElementById: () => null, visibilityState: 'visible'}, addEventListener() {}, setInterval() {}, setTimeout() {}, ...extra
  });
  vm.runInContext(src, ctx);
  return {ctx, mem, run: s => vm.runInContext(s, ctx)};
}
const calcular = a => a.run(`calcularAlertas({...alertaCfg(), ativo: true}, ${AGORA})`);

test('alertas novos: geada na véspera às 18h, carência, lote, contas e compra', () => {
  const lista = calcular(app());
  const tipos = lista.map(x => x.tipo);
  for (const t of ['chuva', 'geada', 'carencia', 'validade', 'contas', 'compras']) assert.ok(tipos.includes(t), 'faltou ' + t);
  const geada = lista.find(x => x.tipo === 'geada');
  assert.equal(geada.quando, new Date('2026-10-19T18:00:00').getTime(), 'geada avisa às 18h da véspera');
  assert.equal(geada.valor, '-1°'); assert.match(geada.selo, /GEADA FORTE/); assert.match(geada.sub, /5h/);
  const car = lista.find(x => x.tipo === 'carencia');
  assert.equal(car.quando, new Date('2026-10-20T07:00:00').getTime(), 'colheita liberada avisa às 7h do dia');
  const contas = lista.find(x => x.tipo === 'contas');
  assert.equal(contas.valor, 'R$ 48 mil', 'só contas a pagar'); assert.equal(contas.cat, 'financeiro');
  assert.equal(lista.find(x => x.tipo === 'compras').valor, '#127');
});
test('alertas novos: chuva leva gráfico hora a hora, quadros e operação afetada', () => {
  const chuva = calcular(app()).find(x => x.tipo === 'chuva');
  assert.equal(chuva.valor, '40'); assert.equal(chuva.unid, 'mm'); assert.equal(chuva.cor, '#F59E0B', 'forte = laranja');
  assert.equal(chuva.barras[0].h, '12h'); assert.equal(chuva.barras.at(-1).h, '19h'); assert.ok(chuva.barras.length <= 12);
  assert.deepEqual(JSON.parse(JSON.stringify(chuva.quadros[0])), ['Rajadas', '55 km/h', true]);
  assert.match(chuva.aviso, /Plantio/); assert.equal(chuva.fazenda, 'Fazenda Zamadei');
  assert.equal(chuva.acoes[0].rota, 'clima');
});
test('alertas novos: usuário comum não recebe contas nem pedidos para aprovar', () => {
  const tipos = calcular(app({comum: true})).map(x => x.tipo);
  assert.ok(!tipos.includes('contas') && !tipos.includes('compras'));
});
test('alertas novos: o Android recebe o cartão completo com o canal da área', () => {
  let enviado = null;
  const a = app({extra: {window: {AndroidBridge: {agendarAlertas: j => { enviado = JSON.parse(j); }}}}});
  a.mem['agro-alertas'] = JSON.stringify({ativo: true});
  a.run('entregarAlertas()');
  const chuva = enviado.find(x => x.id.startsWith('chuva-'));
  assert.equal(chuva.canal, 'clima'); assert.ok(chuva.barras.length && chuva.curto && chuva.cor && chuva.acoes.length);
  assert.equal(chuva.tipo, undefined);
  assert.equal(enviado.find(x => x.id === 'compra-p1').canal, 'compras');
});
