'use strict';
// Local da fazenda (sede.js): leitura das coordenadas coladas e a ordem de confiança do local usado no clima
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({Math, Date, Number, JSON, String, Object, Array, Error, console, document: {addEventListener() {}}, addEventListener() {},
  VIEWS: {}, ACTIONS: {}, TITLES: {}, db: {settings: {}, fields: []}, nv: null,
  localDaFazenda: null, solicitarLocalClima: null, controleLocalClima: () => '<div class="btn-row"><button>📍 Ativar localização</button></div><p></p>',
  num: (v, d = 0) => Number(v).toFixed(d), esc: s => String(s), showToast() {}, save() {}, safeStorage: {get() { return null; }, set() {}, del() {}}});
vm.runInContext('let climaLocalEstado = "", climaLocalMensagem = "";\n' + fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/sede.js'), 'utf8'), ctx);
const run = s => vm.runInContext(s, ctx);

test('sede: coordenadas coladas (ponto, vírgula decimal e link do Google Maps)', () => {
  assert.deepEqual(JSON.parse(run('JSON.stringify(sedeLerCoordenadas("-28.15, -52.47"))')), {lat: -28.15, lon: -52.47});
  assert.deepEqual(JSON.parse(run('JSON.stringify(sedeLerCoordenadas("-28,152 -52,471"))')), {lat: -28.152, lon: -52.471});
  assert.deepEqual(JSON.parse(run('JSON.stringify(sedeLerCoordenadas("https://www.google.com/maps/@-28.2601,-52.4005,15z"))')), {lat: -28.2601, lon: -52.4005});
  assert.equal(run('sedeLerCoordenadas("Passo Fundo")'), null);
  assert.equal(run('sedeLerCoordenadas("0, 0")'), null);
  assert.equal(run('sedeLerCoordenadas("-128.1, -52")'), null);
});
test('sede: o local do clima segue a ordem — servidor, aparelho com GPS bom, talhões, posição antiga', () => {
  run(`db.fields = [{contorno: {pontos: [[-28.2, -52.4], [-28.3, -52.4], [-28.3, -52.5], [-28.2, -52.5]]}}];
       db.settings.local = {lat: -30.03, lon: -51.23, origem: 'localização da sede'};`); // antiga, sem precisão (o “Porto Alegre” do computador)
  assert.equal(run('localDaFazenda().fonte'), 'talhoes');
  assert.equal(Math.round(run('localDaFazenda().lat') * 100) / 100, -28.25);
  run(`db.settings.local = {lat: -28.1, lon: -52.4, origem: 'x', precisao: 12};`);
  assert.equal(run('localDaFazenda().fonte'), 'aparelho');
  run(`db.settings.local = {lat: -30.03, lon: -51.23, origem: 'x', precisao: 25000};`); // imprecisa: ignorada
  assert.equal(run('localDaFazenda().fonte'), 'talhoes');
  run(`nv = {fazenda: {id: 'F'}, sede: {farm: 'F', lat: -28.15, lon: -52.47, origem: 'mapa', precisao: null}};`);
  assert.equal(run('localDaFazenda().fonte'), 'servidor');
  assert.equal(run('localDaFazenda().origem'), 'sede marcada no mapa');
  run(`nv = {fazenda: {id: 'OUTRA'}, sede: {farm: 'F', lat: -28.15, lon: -52.47, origem: 'mapa'}};`); // sede de outra fazenda: não vale
  assert.equal(run('localDaFazenda().fonte'), 'talhoes');
});
test('sede: o cartão do clima ganha “Marcar no mapa”', () => {
  assert.match(run('controleLocalClima()'), /data-id="sede"/);
});
