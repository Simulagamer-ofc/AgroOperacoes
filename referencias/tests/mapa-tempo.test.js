'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({Math, Date, Number, JSON, String, VIEWS: {}, ACTIONS: {}, TITLES: {}, db: {settings: {}}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/mapa-tempo.js'), 'utf8'), ctx);
const run = s => vm.runInContext(s, ctx);
test('mapa do tempo: escala de chuva por mm/h', () => {
  assert.equal(run('corChuva(0.1)'), null);
  assert.equal(run('corChuva(0.2)'), '#a9d8f7');
  assert.equal(run('corChuva(6)'), '#f2d43f');
  assert.equal(run('corChuva(35)'), '#e0443f');
});
test('mapa do tempo: radares do DECEA que cobrem Passo Fundo (até ~420 km), do mais perto ao mais longe', () => {
  const r = run('radaresPerto(-28.26, -52.41).map(x => x.k).join(",")');
  assert.equal(r, 'sg,mi,cn');
});
test('mapa do tempo: horários do STSC em UTC no dia da última ocorrência, voltando um dia depois da meia-noite', () => {
  const h = run("horariosStsc({ultima: '2026-10-21 00:04:59', quadros: [{hora: '23:58', pontos: [[-28, -52]]}, {hora: '00:04', pontos: []}]}).map(x => x.t.toISOString())");
  assert.equal(JSON.stringify(h), JSON.stringify(['2026-10-20T23:58:00.000Z', '2026-10-21T00:04:00.000Z']));
  assert.equal(run("dataUTC('2026-10-21 14:40:00').toISOString()"), '2026-10-21T14:40:00.000Z');
});
test('mapa do tempo: chuva prevista em blocos — área visível vira blocos, do centro para fora, e o nível acompanha o zoom', () => {
  assert.equal(run('nivelDoZoom(8)'), 0); assert.equal(run('nivelDoZoom(6)'), 1); assert.equal(run('nivelDoZoom(4)'), 2);
  const b = run('JSON.stringify(blocosDaArea(0, -29.5, -53.5, -27, -51))');
  assert.deepEqual(JSON.parse(b)[0], [-10, -18]); // Passo Fundo fica no bloco de -30..-27 / -54..-51
  assert.equal(JSON.parse(b).length, 4);
});
test('mapa do tempo: chuva interpolada entre os pontos do bloco e, onde falta o bloco, usa a grade mais aberta', () => {
  run(`blocosChuva.clear();
    blocosChuva.set(chaveBloco(0, -10, -18), {em: Date.now(), horas: ['2026-10-22T18:00'], mm: Array.from({length: 25}, (_, k) => [k === 12 ? 10 : 0]), prob: Array.from({length: 25}, () => [80])});
    blocosChuva.set(chaveBloco(1, -5, -9), {em: Date.now(), horas: ['2026-10-22T18:00'], mm: Array.from({length: 25}, () => [3]), prob: Array.from({length: 25}, () => [50])});`);
  // ponto central do bloco (i=2, j=2): lat -30 + 2,5×0,6 = -28,5; lon -54 + 2,5×0,6 = -52,5
  assert.equal(run("chuvaEm(-28.5, -52.5, '2026-10-22T18:00').mm"), 10);
  assert.equal(run("Math.round(chuvaEm(-28.2, -52.5, '2026-10-22T18:00').mm * 10) / 10"), 5); // meio caminho até o vizinho (0 mm)
  assert.equal(run("chuvaEm(-25.5, -40, '2026-10-22T18:00')"), null);
  assert.equal(run("Math.round(chuvaEm(-26, -50, '2026-10-22T18:00').mm * 10) / 10"), 3); // sem bloco fino ali: usa o nível de 1,2°
  assert.equal(run("chuvaNoPonto(-28.5, -52.5, '2026-10-22T18:00').prob"), 80);
});
