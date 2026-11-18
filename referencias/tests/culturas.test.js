'use strict';
// Culturas dos talhões (culturas.js): grafia única, histórico ao trocar de safra e o salvar do "Definir culturas"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({Math, Date, Number, JSON, String, Object, Array, Set, Error, console, document: {addEventListener() {}},
  ACTIONS: {}, db: {settings: {}, fields: []}, I2_COR_CULT: {}, today: () => '2026-11-17', esc: s => String(s), num: v => String(v),
  i2CorCult: () => '#000', i2AtualizarFazenda() {}, render() {}, showToast() {}});
vm.runInContext('var i2TalSel = ""; var toasts = []; function find(c, id) { return db[c].find(x => x.id === id); } function upsert(c, it) { const i = db[c].findIndex(x => x.id === it.id); if (i >= 0) db[c][i] = it; else db[c].push(it); }\n'
  + fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/culturas.js'), 'utf8'), ctx);
const run = s => vm.runInContext(s, ctx);

test('culturas: o que se digita igual a uma cultura conhecida é gravado com a mesma grafia', () => {
  run(`db.fields = [{id: 'a', crop: 'Trigo Mourisco'}]`);
  assert.equal(run('culturaCanon("soja ")'), 'Soja');
  assert.equal(run('culturaCanon("FEIJAO")'), 'Feijão');
  assert.equal(run('culturaCanon("trigo mourisco")'), 'Trigo mourisco');
  assert.equal(run('culturaCanon("Girassol")'), 'Girassol');
  assert.equal(run('culturasUsadas().filter(c => c.toLowerCase() === "trigo mourisco").length'), 1);
});
test('culturas: mudar a safra guarda a cultura anterior; corrigir a cultura na mesma safra não', () => {
  const h1 = JSON.parse(run(`JSON.stringify(culturaHistorico({crop: 'Soja', season: '2025/26', cultivar: 'X', plantingDate: '2025-10-10'}, {crop: 'Trigo', season: '2026'}))`));
  assert.equal(h1.length, 1); assert.equal(h1[0].crop, 'Soja'); assert.equal(h1[0].season, '2025/26'); assert.equal(h1[0].plantingDate, '2025-10-10');
  assert.equal(run(`culturaHistorico({crop: 'Soja', season: '2026/27'}, {crop: 'Milho', season: '2026/27'}).length`), 0);
  assert.equal(run(`culturaHistorico({crop: '', season: '2025/26'}, {crop: 'Soja', season: '2026/27'}).length`), 0);
  assert.equal(run(`rotacaoTalhao({crop: 'Soja', season: '2026/27', historico: [{crop: 'Soja', season: '2025/26'}, {crop: 'Trigo', season: '2026'}]}).join(' → ')`), 'Soja 2025/26 → Trigo 2026 → Soja 2026/27');
});
test('culturas: "Definir culturas" pinta, desmarca e salva só os talhões marcados', () => {
  run(`db.fields = [{id: 't1', name: 'T1', crop: 'Soja', season: '2025/26', cultivar: 'BMX', plantingDate: '2025-10-01', ciclo: 120},
                    {id: 't2', name: 'T2', crop: 'Milho', season: '2025/26'}, {id: 't3', name: 'T3', crop: '', season: ''}];`);
  run(`ACTIONS['cu-pintar'](); cuPintar.safra = '2026'; ACTIONS['cu-sel']('Trigo'); ACTIONS['i2-tal']('t1'); ACTIONS['i2-tal']('t3'); ACTIONS['i2-tal']('t3');`);
  assert.deepEqual(JSON.parse(run('JSON.stringify(cuPintar.mud)')), {t1: 'Trigo'}); // tocar de novo desmarca
  run(`ACTIONS['cu-salvar']()`);
  const t1 = JSON.parse(run(`JSON.stringify(find('fields', 't1'))`));
  assert.equal(t1.crop, 'Trigo'); assert.equal(t1.season, '2026'); assert.equal(t1.plantingDate, ''); assert.equal(t1.cultivar, '');
  assert.equal(t1.historico.length, 1); assert.equal(t1.historico[0].crop, 'Soja'); assert.equal(t1.historico[0].cultivar, 'BMX');
  assert.equal(run(`find('fields', 't2').crop`), 'Milho');
  assert.equal(run('cuPintar'), null);
});
