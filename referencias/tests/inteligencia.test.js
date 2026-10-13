'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../../app/src/main/assets/www/inteligencia.js');
const quase = (a, b, tol = 1e-2) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const titulos = itens => itens.map(i => i.titulo).join(' | ');

test('ponta nova: compara cada bico com a ponta nova (±10%)', () => {
  const r = I.bicosPontaNova({vazoes: [0.80, 0.81, 0.90, 0.70], vazaoPontaNova: 0.80, mesmaCondicao: true});
  assert.equal(r.status, 'FORA_DO_PADRAO');
  assert.equal(r.referencia, 'ponta_nova');
  assert.deepEqual(r.bicos.map(b => b.status), ['OK', 'OK', 'FORA_DO_PADRAO', 'FORA_DO_PADRAO']);
  quase(r.bicos[2].desvioRef, 12.5);
  assert.equal(I.bicosPontaNova({vazoes: [0.8, 0.82], vazaoPontaNova: 0.8, mesmaCondicao: true}).status, 'OK');
});

test('ponta nova: exige a vazão da ponta nova e a mesma condição de coleta', () => {
  assert.equal(I.bicosPontaNova({vazoes: [0.8, 0.8], mesmaCondicao: true}).status, 'DADOS_INSUFICIENTES');
  assert.equal(I.bicosPontaNova({vazoes: [0.8, 0.8], vazaoPontaNova: 0.8, mesmaCondicao: false}).status, 'DADOS_INSUFICIENTES');
  assert.equal(I.bicosPontaNova({vazoes: [0.8], vazaoPontaNova: 0.8, mesmaCondicao: true}).status, 'DADOS_INSUFICIENTES');
});

test('diagnóstico de bicos: trecho seguido abaixo aponta a linha da barra, não as pontas', () => {
  const desv = [1, 2, -1, -15, -18, -14, 0, 3];
  const d = I.diagnosticoBicos({bicos: desv.map((x, i) => ({bico: i + 1, vazao: 0.8 * (1 + x / 100), desvio: x}))});
  assert.match(titulos(d), /Trecho da barra com vazão baixa \(bicos 4 a 6\)/);
  assert.doesNotMatch(titulos(d), /entupimento|vazão abaixo/, 'bicos do trecho não são repetidos como problema de ponta');
});

test('diagnóstico de bicos: entupido isolado e pontas gastas', () => {
  const desv = [0, 2, -60, 12, 1, 0, 3, 1, 0];
  const d = I.diagnosticoBicos({bicos: desv.map((x, i) => ({bico: i + 1, vazao: x === -60 ? 0.3 : 0.8, desvio: x}))});
  assert.match(titulos(d), /Bico 3: provável entupimento/);
  assert.match(titulos(d), /Bico 4: ponta gasta/);
  assert.doesNotMatch(d.find(i => /gasta/.test(i.titulo)).texto, /jogo completo/);
});

test('diagnóstico de bicos: muitos gastos → trocar o jogo; barra toda acima', () => {
  const desv = [12, 14, 8, 11, 9, 13];
  const d = I.diagnosticoBicos({bicos: desv.map((x, i) => ({bico: i + 1, vazao: 1, desvio: x}))});
  assert.match(d.find(i => /gasta/.test(i.titulo)).texto, /trocar o jogo completo/);
  assert.match(titulos(d), /A barra toda está acima/);
  assert.match(titulos(d), /Bicos 1, 2, 4 e 6: ponta gasta/);
});

test('diagnóstico de bicos: tudo bem → pontas em bom estado', () => {
  const d = I.diagnosticoBicos({bicos: [1, -2, 3].map((x, i) => ({bico: i + 1, vazao: 1, desvio: x}))});
  assert.equal(d.length, 1); assert.equal(d[0].nivel, 'ok');
  assert.match(d[0].texto, /bico 3 \(\+3%/);
});

test('taxa: calcula velocidade, pressão e ponta para acertar', () => {
  const iso = [{tamanho: '02', cor: 'amarelo', vazao: 0.79}, {tamanho: '025', cor: 'lilás', vazao: 0.98}, {tamanho: '03', cor: 'azul', vazao: 1.18}];
  const d = I.ajusteTaxa({taxaLHa: 110, taxaPlanejada: 100, vazaoMediaBico: 0.8, velocidadeKmH: 6, espacamentoBicosM: 0.5, pressaoBar: 3, isoClasses: iso});
  const vel = d.find(i => /velocidade/.test(i.titulo)), pres = d.find(i => /pressão/.test(i.titulo)), ponta = d.find(i => /trocar a ponta/.test(i.titulo));
  assert.match(vel.titulo, /6,6 km\/h/);
  assert.match(pres.titulo, /2,5 bar/); assert.match(pres.texto, /de 3 para 2,5 bar/);
  assert.match(ponta.texto, /ponta 02 \(amarelo\)/);
  assert.equal(I.ajusteTaxa({taxaLHa: 102, taxaPlanejada: 100, vazaoMediaBico: 0.8, velocidadeKmH: 6, espacamentoBicosM: 0.5})[0].nivel, 'ok');
});

test('taxa: velocidade fora da faixa da máquina é sinalizada', () => {
  const d = I.ajusteTaxa({taxaLHa: 80, taxaPlanejada: 100, vazaoMediaBico: 0.8, velocidadeKmH: 6, espacamentoBicosM: 0.5, faixaVelocidade: [5, 8]});
  assert.match(d.find(i => /velocidade/.test(i.titulo)).texto, /fora da velocidade de trabalho/);
});

test('sensor: novo fator de calibração nos dois tipos', () => {
  const p = I.ajusteSensor({leitura: 105, referencia: 100, fatorAtual: 400, tipoFator: 'pulsos_por', ponto: 'fluxometro'});
  assert.match(p.find(i => /Novo fator/.test(i.titulo)).titulo, /420/);
  assert.match(p[0].texto, /aplicar MENOS/);
  const c = I.ajusteSensor({leitura: 105, referencia: 100, fatorAtual: 10, tipoFator: 'por_pulso', ponto: 'sensor_velocidade'});
  assert.match(c.find(i => /Novo fator/.test(i.titulo)).titulo, /9,524/);
  assert.match(c[0].texto, /aplicar MAIS/);
  assert.equal(I.ajusteSensor({leitura: 101, referencia: 100})[0].nivel, 'ok');
});

test('dose: quanto mudar a regulagem', () => {
  const d = I.ajusteDose({doseKgHa: 110, dosePlanejada: 100});
  assert.match(d[1].titulo, /reduzir a regulagem em 9,1%/);
  assert.match(d[1].texto, /0,909/);
  assert.match(I.ajusteDose({doseKgHa: 90, dosePlanejada: 100})[1].titulo, /aumentar a regulagem em 11,1%/);
});

test('plantio: duplos, falhas e população', () => {
  assert.match(titulos(I.diagnosticoLongitudinal({pctDuplos: 15, pctFalhos: 3, pctAceitaveis: 82})), /Muitos duplos/);
  assert.match(titulos(I.diagnosticoLongitudinal({pctDuplos: 12, pctFalhos: 12, pctAceitaveis: 76})), /ao mesmo tempo/);
  const pop = I.diagnosticoLongitudinal({pctDuplos: 2, pctFalhos: 2, pctAceitaveis: 96, espacamentos: [5, 5, 5, 5], sementesPorMetro: 16});
  assert.match(titulos(pop), /População acima do planejado/);
});

test('lanço: lado e bordas', () => {
  assert.match(titulos(I.diagnosticoTransversal({valores: [10, 10, 10, 10, 6, 6, 6, 6], cv: 25})), /Lado esquerdo recebe mais/);
  assert.match(titulos(I.diagnosticoTransversal({valores: [4, 10, 10, 10, 10, 4], cv: 30})), /Bordas da faixa com pouco produto/);
});

test('perdas: separa plataforma e internas', () => {
  assert.match(titulos(I.diagnosticoPerdas({pttKgHa: 80, ppcKgHa: 50, pmiKgHa: 30, pttSc60Ha: 1.33, foraDoLimite: true})), /na plataforma \(63%\)/);
  assert.match(titulos(I.diagnosticoPerdas({pttKgHa: 80, ppcKgHa: 20, pmiKgHa: 60})), /interna \(75%\)/);
  assert.match(titulos(I.diagnosticoPerdas({pttKgHa: 30})), /Separar a origem/);
});

test('tendência: prevê quando as pontas passam do limite (por horas)', () => {
  const t = I.tendenciaBicos([{data: '2026-08-01', horas: 100, desvioMedio: 2}, {data: '2026-08-31', horas: 300, desvioMedio: 5}], 10);
  assert.equal(t.situacao, 'desgastando'); assert.equal(t.base, 'horas');
  quase(t.porCem, 1.5); assert.equal(t.faltamHoras, 333); assert.equal(t.faltamDias, 50);
  assert.equal(t.dataPrevista, '2026-10-20');
  assert.match(I.textoTendencia(t).titulo, /333 horas/);
});

test('tendência: por dias, troca de pontas reinicia e estável', () => {
  const t = I.tendenciaBicos([{data: '2026-06-01', desvioMedio: 9}, {data: '2026-07-01', desvioMedio: 0}, {data: '2026-08-01', desvioMedio: 3}], 10);
  assert.equal(t.trocaDetectada, true); assert.equal(t.base, 'dias'); assert.equal(t.desde, '2026-07-01');
  assert.match(I.textoTendencia(t).texto, /desde a última troca/);
  assert.equal(I.tendenciaBicos([{data: '2026-06-01', desvioMedio: 3}, {data: '2026-07-01', desvioMedio: 2.5}]).situacao, 'estavel');
  assert.equal(I.tendenciaBicos([{data: '2026-06-01', desvioMedio: 3}]).situacao, 'poucos');
  assert.equal(I.tendenciaBicos([{data: '2026-06-01', desvioMedio: 12}]).situacao, 'passou');
});
