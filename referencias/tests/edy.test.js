'use strict';
// Edy proativo (edy.js): avisos que cruzam os dados, resumo da manhã, registros prontos e histórico do vigor
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const www = path.join(__dirname, '../../app/src/main/assets/www');
const HOJE = '2026-11-26';
const addDias = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

// Previsão: 58 mm amanhã; hoje com janela 7h–11h; sábado e domingo secos com janela
function clima({chuvaHoraria = {}} = {}) {
  const dias = [addDias(HOJE, -1), HOJE, addDias(HOJE, 1), addDias(HOJE, 2), addDias(HOJE, 3), addDias(HOJE, 4)];
  const hourly = {time: [], precipitation: []};
  dias.forEach(d => { for (let h = 0; h < 24; h++) { const t = `${d}T${String(h).padStart(2, '0')}:00`; hourly.time.push(t); hourly.precipitation.push(chuvaHoraria[t] || 0); } });
  return {em: Date.now(), dados: {hourly, daily: {time: dias, precipitation_sum: [0, 0.9, 58.2, 0, 0, 0], precipitation_probability_max: [5, 5, 99, 5, 5, 5],
    temperature_2m_min: [15, 15, 16, 14, 13, 13], temperature_2m_max: [27, 27, 22, 26, 28, 28]}}};
}
function app(db, {c = clima(), semJanela = [], hist = null} = {}) {
  const guardado = {'agro-ndvi-hist': hist ? JSON.stringify(hist) : null};
  const ctx = vm.createContext({Math, Date, JSON, Number, String, Array, Object, Set, console, db, ACTIONS: {}, today: () => HOJE, nowTime: () => '22:00',
    num: (v, dec = 0) => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits: dec, maximumFractionDigits: Math.max(dec, 2)}), // igual ao app.js
    safeStorage: {get: k => guardado[k] ?? null, set: (k, v) => { guardado[k] = v; }},
    fieldName: id => (db.fields.find(f => f.id === id) || {}).name || '', lerClima: () => c,
    janelasDoDia: (d, dia) => semJanela.includes(dia) ? {janelas: [], principal: 'vento forte'} : {janelas: [[7, 11]], principal: ''},
    liberacaoColheita: id => { const a = db.aplicacoes.filter(x => x.fieldId === id).sort((x, y) => y.date.localeCompare(x.date))[0]; return a ? {a, libera: addDias(a.date, a.carencia)} : null; },
    hoursToService: m => m.nextService - m.hours, emCiclo: f => !!f.plantingDate,
    alerts: () => [{title: 'Estoque baixo'}], esc: s => String(s)});
  vm.runInContext(fs.readFileSync(path.join(www, 'edy.js'), 'utf8') + '\nthis.f = {edyAvisos, edyResumo, edyNotificacoes, edyAcaoTxt, edyNdviGuardar, edyNdviTalhao, alerts};', ctx);
  return {...ctx.f, guardado};
}
const base = () => ({settings: {farm: 'Fazenda Teste'},
  fields: [{id: 't7', name: 'Talhão 07', area: 84.5, plantingDate: '2026-11-26'}, {id: 't8', name: 'Talhão 08', area: 62}, {id: 't12', name: 'Talhão 12', area: 110, plantingDate: '2026-07-09'}],
  machines: [{id: 'm1', name: 'Trator 7230J', hours: 1502, nextService: 1500}, {id: 'p1', name: 'Pulverizador 4730', hours: 860, nextService: 1000}],
  operations: [
    {id: 'o1', date: addDias(HOJE, 1), time: '07:00', type: 'Plantio', fieldId: 't8', machineId: 'm1', status: 'Programada'},
    {id: 'o2', date: addDias(HOJE, 2), time: '07:00', type: 'Colheita', fieldId: 't12', status: 'Programada'},
    {id: 'o3', date: HOJE, time: '06:30', type: 'Aplicação', fieldId: 't12', machineId: 'p1', status: 'Concluída'},
    {id: 'o4', date: addDias(HOJE, 2), time: '08:00', type: 'Aplicação', fieldId: 't7', machineId: 'p1', status: 'Programada'},
  ],
  aplicacoes: [{fieldId: 't12', date: addDias(HOJE, -3), produto: 'Fungicida X', carencia: 14}],
  chuvas: [], monitoramentos: []});

test('chuva forte + plantio programado: avisa e sugere o melhor dia seco', () => {
  const av = app(base()).edyAvisos(HOJE, new Date(`${HOJE}T22:00:00`).getTime());
  const a = av.find(x => x.tipo === 'chuva-op');
  assert.equal(a.titulo, '58 mm amanhã + plantio programado no Talhão 08');
  assert.match(a.texto, /^Reprogramar\? Melhor dia: sábado \(28\/11\)/);
  assert.deepEqual({...a.acao}, {act: 'edy-reprog', id: 'o1|2026-11-28', label: 'Reprogramar'});
});

test('aplicou e choveu depois (registrado) ou vem chuva nas 24 h (previsão): produto pode ter sido lavado', () => {
  const db = base(); db.chuvas = [{date: HOJE, hora: '15:00', mm: 18, fieldId: ''}];
  let a = app(db).edyAvisos(HOJE, new Date(`${HOJE}T22:00:00`).getTime()).find(x => x.tipo === 'lavagem');
  assert.equal(a.titulo, 'Aplicou hoje no Talhão 12 e choveu 18 mm depois');
  assert.match(a.texto, /pode ter sido lavado/); assert.doesNotMatch(a.texto, /dose|L\/ha/);
  // Chuva antes da aplicação não conta
  db.chuvas = [{date: HOJE, hora: '05:00', mm: 18, fieldId: ''}];
  assert.equal(app(db).edyAvisos(HOJE, new Date(`${HOJE}T22:00:00`).getTime()).find(x => x.tipo === 'lavagem'), undefined);
  // Previsão: 9 mm entre 23h e 1h
  db.chuvas = [];
  const c = clima({chuvaHoraria: {[`${HOJE}T23:00`]: 4, [`${addDias(HOJE, 1)}T00:00`]: 5}});
  a = app(db, {c}).edyAvisos(HOJE, new Date(`${HOJE}T22:00:00`).getTime()).find(x => x.tipo === 'lavagem');
  assert.equal(a.titulo, 'Aplicou hoje no Talhão 12 e vem 9 mm de chuva');
});

test('pulverização sem janela, colheita antes da carência e máquina com revisão vencida', () => {
  const av = app(base(), {semJanela: [addDias(HOJE, 2)]}).edyAvisos(HOJE);
  const j = av.find(x => x.tipo === 'sem-janela');
  assert.equal(j.titulo, 'Aplicação no Talhão 07 sábado (28/11) sem janela boa (vento forte)');
  assert.match(j.texto, /Melhor dia: domingo \(29\/11\), 7h–11h/);
  const car = av.find(x => x.tipo === 'carencia');
  assert.equal(car.titulo, 'Colheita do Talhão 12 marcada para 28/11, antes de acabar a carência');
  assert.equal(car.texto, 'Fungicida X libera a colheita só em 07/12.');
  assert.equal(car.acao.id, 'o2|2026-12-07');
  const rev = av.find(x => x.tipo === 'revisao');
  assert.equal(rev.titulo, 'Trator 7230J com revisão vencida e plantio amanhã');
  assert.equal(av[0].cor, 'red'); // urgentes primeiro
});

test('vigor do satélite: guarda o histórico e avisa a queda no talhão em ciclo', () => {
  const hist = [{data: '2026-11-08', v: {t12: 0.74, t7: 0.3}}];
  const e = app(base(), {hist});
  e.edyNdviGuardar({data: '2026-11-20T13:40:00Z', talhoes: [{id: 't12', ndvi: 0.581}, {id: 't7', ndvi: 0.32}, {id: 't8', ndvi: null}]});
  assert.deepEqual({...e.edyNdviTalhao('t12')}, {atual: 0.581, data: '2026-11-20', anterior: 0.74, dataAnterior: '2026-11-08', variacao: -0.159});
  assert.equal(e.edyNdviTalhao('t8'), null);
  const v = e.edyAvisos(HOJE).find(x => x.tipo === 'vigor');
  assert.equal(v.titulo, 'Vigor caiu no Talhão 12: 0,74 → 0,58');
  assert.equal(e.edyAvisos(HOJE).filter(x => x.tipo === 'vigor').length, 1);
});

test('resumo da manhã e notificações: hoje e amanhã às 6h30 + avisos', () => {
  const e = app(base());
  const r = e.edyResumo(addDias(HOJE, 1));
  assert.equal(r.titulo, 'Resumo de amanhã');
  assert.match(r.linhas[0], /^🌤 16–22 °C, 58 mm de chuva \(99%\); pulverizar: 7h–11h\.$/);
  assert.match(r.linhas[1], /Plantio no Talhão 08 às 07:00/);
  const n = e.edyNotificacoes(new Date(`${HOJE}T22:00:00`).getTime());
  assert.deepEqual([...n.filter(x => x.id.startsWith('edy-manha')).map(x => x.id)], [`edy-manha-${addDias(HOJE, 1)}`]); // hoje já passou das 10h
  assert.equal(new Date(n[0].quando).getHours(), 6);
  assert.ok(n.some(x => x.titulo.startsWith('Edy: 58 mm amanhã')));
});

test('registro preparado pela IA vira texto com nomes; sino recebe os avisos do Edy', () => {
  const e = app(base());
  assert.deepEqual({...e.edyAcaoTxt({tipo: 'operacao', tipoOperacao: 'Plantio', talhaoId: 't7', area: 30, status: 'Concluída', data: HOJE})}, {titulo: 'Plantio no Talhão 07', linha: '30 ha · Concluída · hoje'});
  assert.deepEqual({...e.edyAcaoTxt({tipo: 'abastecimento', maquinaId: 'm1', litros: 180})}, {titulo: 'Abastecimento — Trator 7230J', linha: '180 L'});
  assert.deepEqual({...e.edyAcaoTxt({tipo: 'reprogramar', operacaoId: 'o2', data: '2026-11-28'})}, {titulo: 'Passar colheita do Talhão 12', linha: 'de 28/11 07:00 para sábado (28/11)'});
  assert.equal(e.edyAcaoTxt({tipo: 'reprogramar', operacaoId: 'x', data: HOJE}).erro, true);
  const sino = e.alerts();
  assert.equal(sino[0].title, 'Estoque baixo');
  assert.ok(sino.some(a => a.title.startsWith('Edy: ')));
});
