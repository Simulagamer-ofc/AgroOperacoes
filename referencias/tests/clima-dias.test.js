'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Previsão falsa de 7 dias: só o 3º dia (índice 2) tem chuva forte
function dados() {
  const dias = [...Array(7)].map((_, i) => `2026-10-${String(18 + i).padStart(2, '0')}`);
  const hourly = {time: [], temperature_2m: [], precipitation_probability: [], precipitation: [], cloud_cover: [], relative_humidity_2m: [], wind_speed_10m: [], wind_gusts_10m: [], trovoada: []};
  dias.forEach((d, i) => { for (let h = 0; h < 24; h++) {
    hourly.time.push(`${d}T${String(h).padStart(2, '0')}:00`); hourly.temperature_2m.push(15 + i + (h > 11 && h < 18 ? 8 : 0));
    hourly.precipitation_probability.push(i === 2 ? 90 : 5); hourly.precipitation.push(i === 2 ? 2 : 0); hourly.cloud_cover.push(i === 2 ? 95 : 10);
    hourly.relative_humidity_2m.push(70); hourly.wind_speed_10m.push(6); hourly.wind_gusts_10m.push(10); hourly.trovoada.push(0);
  } });
  const daily = {time: dias, temperature_2m_max: dias.map((_, i) => 23 + i), temperature_2m_min: dias.map((_, i) => 15 + i),
    precipitation_sum: dias.map((_, i) => i === 2 ? 48 : 0), precipitation_probability_max: dias.map((_, i) => i === 2 ? 90 : 5),
    wind_speed_10m_max: dias.map(() => 12), sunshine_duration: dias.map(() => 36000)};
  return {daily, hourly};
}
function app() {
  let html = '';
  const el = {get outerHTML() { return html; }, set outerHTML(v) { html = v; }, querySelector: () => ({scrollLeft: 0})};
  const ctx = vm.createContext({navigator: {onLine: true}, isSecureContext: true, Date, Math,
    db: {settings: {local: {lat: -28, lon: -52, origem: 'sede'}}, fields: []}, ACTIONS: {}, TITLES: {}, VIEWS: {inicio() {}}, alerts() {},
    document: {getElementById: () => el, querySelector: () => null, addEventListener() {}},
    esc: s => String(s), num: (v, c = 1) => Number(v).toFixed(c), fmtDate: d => d.split('-').reverse().join('/'), today: () => '2026-10-18',
    safeStorage: {get: k => k === 'agro-clima-aberto' ? '1' : JSON.stringify({dados: dados(), em: Date.now()}), set() {}}, save() {}, render() {}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/automacao.js'), 'utf8'), ctx);
  return {ctx, run: s => vm.runInContext(s, ctx), html: () => html};
}
test('clima: os 7 dias são botões e o dia tocado mostra os detalhes dele', () => {
  const a = app();
  const inicial = a.run('cartaoClima()');
  assert.equal((inicial.match(/data-act="clima-dia"/g) || []).length, 7);
  assert.match(inicial, /aria-pressed="true"/);
  a.run("ACTIONS['clima-dia']('2')");
  const h = a.html();
  assert.match(h, /voltar para hoje/);
  assert.match(h, /48 mm previstos neste dia/);
  assert.match(h, /Sem janela boa para pulverizar neste dia/);
  assert.match(h, /data-id="2" aria-pressed="true"/);
  a.run("ACTIONS['clima-dia']('0')");
  assert.doesNotMatch(a.html(), /voltar para hoje/);
  assert.match(a.html(), /pulverizar hoje/);
});
