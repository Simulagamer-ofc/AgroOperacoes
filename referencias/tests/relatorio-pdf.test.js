'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/relatorio-pdf.js'), 'utf8');
// jsPDF falso: registra textos e barras desenhadas
class Doc {
  constructor() { this.textos = []; this.barras = 0; this.pags = 1; }
  setProperties() {} setFont() {} setFontSize() {} setTextColor() {} setFillColor() {} setDrawColor() {} setLineWidth() {} setCharSpace() {}
  text(t) { this.textos.push(String(t)); } rect() {} line() {} roundedRect() { this.barras++; }
  getTextWidth(t) { return String(t).length * 2; } splitTextToSize(t) { return [String(t)]; }
  addPage() { this.pags++; } getNumberOfPages() { return this.pags; } setPage() {} output(t) { return t === 'datauristring' ? 'data:application/pdf;base64,QUJD' : new ArrayBuffer(4); }
}
function gerar({financeiro, tipos, enviar = false, ponte}) {
  const ops = tipos.map((t, i) => ({date: '2026-10-1' + i, type: t, status: 'Concluída', area: 10, machineId: 'm1'}));
  const ctx = vm.createContext({window: {jspdf: {jsPDF: Doc}, AndroidBridge: ponte}, ACTIONS: {}, db: {settings: {farm: 'Fazenda Teste', owner: 'Edson'}},
    reportDays: 30, today: () => '2026-10-19', fmtDate: d => d, num: v => String(v), byDateDesc: () => 0, opPlace: () => 'Talhão 1',
    machineName: () => 'Trator', opTemArea: () => true, showToast() {}, downloadFile() {},
    relVerCustos: () => financeiro, lancamentosCusto: () => [{value: 100, category: 'Combustível'}, {value: 50, category: 'Peças'}],
    agrupar: (l, k) => Object.entries(l.reduce((g, x) => (g[k(x)] = (g[k(x)] || 0) + x.value, g), {})).sort((a, b) => b[1] - a[1]),
    dadosRelatorio: () => ({from: '2026-09-20', ops, byType: [...new Set(tipos)].map(t => [t, ops.filter(o => o.type === t)]),
      hoursBy: [[{name: 'Trator'}, 12]], consumption: [], custosManut: [], maintCost: 0, outrosGastos: 150, area: 20})});
  vm.runInContext(src, ctx);
  return ctx.ACTIONS[enviar ? 'relatorio-pdf-enviar' : 'relatorio-pdf']();
}
test('PDF: gráfico só quando há o que comparar e custos só para quem vê o Financeiro', () => {
  const com = gerar({financeiro: true, tipos: ['Plantio', 'Colheita', 'Colheita']});
  const tudo = com.textos.join('\n');
  assert.match(tudo, /MERCA/); assert.match(tudo, /PLANT/); assert.match(tudo, /Custos por categoria/); assert.match(tudo, /R\$ 150/);
  assert.match(tudo, /Página 1 de/);
  const sem = gerar({financeiro: false, tipos: ['Plantio']});
  assert.doesNotMatch(sem.textos.join('\n'), /R\$|Custos por categoria|Manutenção/);
  assert.ok(com.barras > sem.barras, 'com 2 tipos de operação deve desenhar o gráfico');
});

test('PDF: "Enviar" abre o compartilhar do Android com o arquivo; "Baixar" salva', () => {
  const chamadas = [];
  const ponte = {sharePdf: (n, b64, txt) => chamadas.push(['enviar', n, b64, txt]), savePdf: (n, b64) => chamadas.push(['salvar', n, b64])};
  gerar({financeiro: true, tipos: ['Plantio'], enviar: true, ponte});
  gerar({financeiro: true, tipos: ['Plantio'], enviar: false, ponte});
  assert.equal(chamadas[0][0], 'enviar'); assert.match(chamadas[0][1], /^mercaplant-relatorio-.*\.pdf$/); assert.equal(chamadas[0][2], 'QUJD');
  assert.match(chamadas[0][3], /Fazenda Teste/);
  assert.equal(chamadas[1][0], 'salvar');
});
test('PDF da safra do talhão: resumo, planejado x realizado, chuva por mês e tabelas', () => {
  const f = {id: 't1', name: 'Talhão 7', area: 10, season: '2026/27', crop: 'Soja'};
  const db = {settings: {farm: 'Fazenda Teste'}, fields: [f],
    operations: [{fieldId: 't1', date: '2026-09-01', type: 'Plantio', status: 'Concluída', area: 10}], aplicacoes: [], monitoramentos: [],
    chuvas: [{fieldId: 't1', date: '2026-08-05', mm: 30}, {date: '2026-09-10', mm: 50}], colheitas: []};
  const salvos = [];
  const ctx = vm.createContext({window: {jspdf: {jsPDF: Doc}}, ACTIONS: {}, db, today: () => '2026-10-19', fmtDate: d => d, num: v => String(v), um1: v => String(v),
    find: (c, id) => db[c === 'fields' ? 'fields' : c].find(x => x.id === id), periodoSafra: () => ({ini: '2026-07-01', fim: '2027-06-30', nome: 'Safra 2026/27'}),
    analiseSafra: () => ({linhas: [{id: 't1', custo: 5000, custoHa: 500, custoSc: null, margem: null, margemHa: null, equilibrio: null}]}),
    liberacaoColheita: () => null, machineName: () => 'Trator', opTemArea: () => true, addDias: d => d, semAcentoApp: s => s.toLowerCase(), showToast() {},
    ORC_CATS: ['Sementes', 'Fertilizantes'], planejamentoSafra: () => ({linhas: [{id: 't1', area: 10, plan: 3000, real: 5000, pct: 166, o: {valores: {Sementes: 100, Fertilizantes: 200}}, porCat: {Sementes: 1500, Fertilizantes: 3500}}]}),
    downloadFile: n => salvos.push(n)});
  vm.runInContext(src, ctx);
  const doc = ctx.ACTIONS['safra-pdf']('t1'), tudo = doc.textos.join('\n');
  assert.match(tudo, /Relatório da safra - Talhão 7/);
  assert.match(tudo, /Planejado x realizado/); assert.match(tudo, /Chuva por mês/); assert.match(tudo, /ago\/26/);
  assert.match(tudo, /R\$ 5000/);
  assert.match(salvos[0], /^mercaplant-safra-talhão-7-2026-07-01-a-2027-06-30\.pdf$|^mercaplant-safra-talh.o-7-/);
});
