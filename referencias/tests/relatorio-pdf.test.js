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
