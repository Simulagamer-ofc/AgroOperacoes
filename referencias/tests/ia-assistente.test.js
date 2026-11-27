'use strict';
// Assistente (ia-assistente.js): o resumo da fazenda que vai para a IA
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const www = path.join(__dirname, '../../app/src/main/assets/www');
function app(db) {
  const ctx = vm.createContext({Math, Date, JSON, Number, String, Array, Object, Set, Infinity, console, db, VIEWS: {}, TITLES: {}, ACTIONS: {},
    sessionStorage: {getItem: () => null, setItem() {}}, window: {}, today: () => '2026-11-27',
    fieldName: id => (db.fields.find(f => f.id === id) || {}).name || '', machineName: id => (db.machines.find(m => m.id === id) || {}).name || ''});
  vm.runInContext(fs.readFileSync(path.join(www, 'ia-assistente.js'), 'utf8') + '\nthis.f = {iaContexto, iaFormatar: typeof iaFormatar === "function" ? iaFormatar : null};', ctx);
  return ctx.f;
}
const base = () => ({settings: {farm: 'Fazenda Teste'}, machines: [{id: 'm1', name: 'Trator 7230J', type: 'Trator', hours: 1492, nextService: 1500}],
  fields: [{id: 't1', name: 'Talhão 3 A', area: 90.5, crop: 'Milho', season: '2026/27', plantingDate: '2026-11-10', parteDe: {nome: 'Talhão 3'}}],
  operations: [{id: 'o1', date: '2026-11-26', type: 'Plantio', fieldId: 't1', machineId: 'm1', status: 'Concluída', area: 30}, {id: 'o2', date: '2026-06-01', type: 'Colheita', fieldId: 't1', status: 'Concluída'}, {id: 'o3', date: '2026-12-02', type: 'Pulverização', fieldId: 't1', status: 'Programada'}],
  chuvas: [{date: '2026-11-25', mm: 18, fieldId: ''}, {date: '2026-11-25', mm: 20, fieldId: 't1'}, {date: '2026-11-12', mm: 7.5, fieldId: ''}, {date: '2026-10-01', mm: 40, fieldId: ''}],
  colheitas: [{fieldId: 't1', cultura: 'Ervilhaca', season: '2026', date: '2026-11-20', kg: 6000}], stock: [{name: 'Glifosato', qty: 10, min: 20, unit: 'L'}],
  lots: [], monitoramentos: [], aplicacoes: [], maintenances: [], romaneios: []});

test('resumo: operações recentes e programadas, sem as antigas; nomes no lugar dos códigos', () => {
  const {iaContexto} = app(base()), c = iaContexto('2026-11-27');
  assert.deepEqual(c.operacoes.map(o => o.tipo), ['Pulverização', 'Plantio']);
  assert.equal(c.operacoes[1].talhao, 'Talhão 3 A'); assert.equal(c.operacoes[1].maquina, 'Trator 7230J');
  assert.equal(c.talhoes[0].parteDe, 'Talhão 3');
  assert.equal(c.colheitas[0].sacas60, 100);
  assert.equal(c.estoque[0].abaixoDoMinimo, true);
});

test('chuva: somas prontas (um valor por dia, o maior dos locais) e desde o plantio', () => {
  const {iaContexto} = app(base()), c = iaContexto('2026-11-27');
  assert.equal(c.chuvas.somas.ultimos7dias, 20);
  assert.equal(c.chuvas.somas.ultimos30dias, 27.5);
  assert.equal(c.chuvas.somas.esteMes, 27.5);
  assert.equal(c.chuvas.somas.diasSemChuvaDesdeUltima, 2);
  assert.equal(c.chuvas.desdePlantio[0].mm, 27.5);
});

test('o financeiro não vai para a IA', () => {
  const db = base(); db.expenses = [{value: 9150}]; db.contas = [{valor: 18900}];
  const s = JSON.stringify(app(db).iaContexto('2026-11-27'));
  assert.ok(!s.includes('9150') && !s.includes('18900'));
});
