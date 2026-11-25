'use strict';
// Alertas de tempo só no perímetro da fazenda (clima-fazenda.js): distância aos talhões, radar e avisos da região
process.env.TZ = 'America/Sao_Paulo';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const www = path.join(__dirname, '../../app/src/main/assets/www');
// Talhão de ~1 km x 1 km perto de -28,15 / -52,30
const TALHAO = [[-28.145, -52.305], [-28.145, -52.295], [-28.154, -52.295], [-28.154, -52.305]];
function app(fields = [{id: 'f1', contorno: {pontos: TALHAO}}]) {
  const ctx = vm.createContext({Math, Date, JSON, Number, String, Array, Object, Infinity, db: {fields}, num: (v, c = 0) => Number(v).toFixed(c).replace('.', ','), nomeDiaCurto: d => d});
  vm.runInContext(fs.readFileSync(path.join(www, 'clima-fazenda.js'), 'utf8') + '\nthis.f = {distFazendaKm, tempestadeDaFazenda, confirmaAviso, dividirAvisos};', ctx);
  return ctx.f;
}
const LOC = {lat: -28.1495, lon: -52.30};
// Previsão horária de 25 e 26/11 (horas locais), como a do Open-Meteo
function previsao(mod = () => ({})) {
  const h = {time: [], precipitation: [], precipitation_probability: [], wind_gusts_10m: [], temperature_2m: [], relative_humidity_2m: []};
  for (const dia of ['2026-11-25', '2026-11-26']) for (let x = 0; x < 24; x++) {
    const t = `${dia}T${String(x).padStart(2, '0')}:00`, m = {mm: 0, p: 8, raj: 20, temp: 22, ur: 70, ...mod(t, x)};
    h.time.push(t); h.precipitation.push(m.mm); h.precipitation_probability.push(m.p); h.wind_gusts_10m.push(m.raj); h.temperature_2m.push(m.temp); h.relative_humidity_2m.push(m.ur);
  }
  return h;
}
const AVISO = {id: '56499', evento: 'Tempestade', nivel: 'amarelo', inicio: '2026-11-25T03:00:00.000Z', fim: '2026-11-26T02:59:00.000Z'};
const AGORA = new Date('2026-11-25T16:00:00-03:00').getTime();

test('distância ao perímetro: dentro do talhão é zero; fora, até o lado mais perto', () => {
  const {distFazendaKm: d} = app();
  assert.equal(d(-28.150, -52.300, LOC), 0);
  const fora = d(-28.150, -52.2441, LOC); // ~5 km a leste do lado leste
  assert.ok(fora > 4.5 && fora < 5.5, String(fora));
  const semContorno = app([]).distFazendaKm(-28.150, -52.2441, LOC);
  assert.ok(semContorno > fora, 'sem contorno mede do ponto da fazenda');
});

test('radar: tempestade a 8 km do limite (11 km do centro) conta; chegando quando se aproximou', () => {
  const {tempestadeDaFazenda: t} = app();
  const q = (min, pontos) => ({t: new Date(AGORA - min * 60000), pontos});
  const r = t([q(30, [[-28.150, -52.15]]), q(0, [[-28.150, -52.213]])], LOC);
  assert.ok(r.d > 7.5 && r.d < 8.5, String(r.d)); assert.equal(r.chegando, true); assert.equal(r.rumo, 'a leste'); assert.equal(r.perimetro, true);
  assert.equal(t([q(0, [[-28.150, -52.300]])], LOC).d, 0);
  assert.equal(t([q(0, [])], LOC).nenhuma, true);
});

test('aviso de tempestade da região sem chuva na previsão da fazenda: fica só como aviso da região', () => {
  const {confirmaAviso: c, dividirAvisos: dv} = app();
  const h = previsao((t, x) => (t.startsWith('2026-11-25') ? {p: x === 6 ? 12 : 5} : {}));
  const r = c(AVISO, h, null, AGORA);
  assert.equal(r.ok, false); assert.match(r.txt, /0 mm, chance de até \d+%/);
  const {fazenda, regiao} = dv([AVISO], h, null, AGORA);
  assert.equal(fazenda.length, 0); assert.equal(regiao.length, 1);
});

test('aviso se confirma pela previsão (horário da chuva) ou pelo radar perto dos talhões', () => {
  const {confirmaAviso: c} = app();
  const chuva = previsao((t, x) => (t.startsWith('2026-11-25') && x >= 17 && x <= 19 ? {mm: 4, p: 80} : {}));
  const r = c(AVISO, chuva, null, AGORA);
  assert.equal(r.ok, true); assert.match(r.txt, /12 mm entre 17h e 20h, chance de até 80%/);
  const seco = previsao();
  assert.equal(c(AVISO, seco, {d: 3, chegando: true}, AGORA).ok, true);
  assert.equal(c(AVISO, seco, {d: 25}, AGORA).ok, false);
  // Chuva só fora do período do aviso não confirma
  const depois = previsao((t, x) => (t.startsWith('2026-11-26') && x >= 10 ? {mm: 6, p: 90} : {}));
  assert.equal(c(AVISO, depois, null, AGORA).ok, false);
});

test('vento, geada e umidade também se confirmam pela previsão da fazenda', () => {
  const {confirmaAviso: c} = app(), h = previsao((t, x) => (x === 15 ? {raj: 62, ur: 25} : x === 5 ? {temp: 2} : {}));
  assert.equal(c({...AVISO, evento: 'Vendaval'}, h, null, AGORA).ok, true);
  assert.equal(c({...AVISO, evento: 'Geada', inicio: '2026-11-26T03:00:00.000Z', fim: '2026-11-27T02:59:00.000Z'}, h, null, AGORA).ok, true);
  assert.equal(c({...AVISO, evento: 'Baixa Umidade'}, h, null, AGORA).ok, true);
  assert.equal(c({...AVISO, evento: 'Onda de Calor'}, h, null, AGORA).ok, false);
});
