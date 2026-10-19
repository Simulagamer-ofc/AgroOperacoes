'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/grupo.js'), 'utf8');
const ctx = vm.createContext({VIEWS: {}, TITLES: {}, ACTIONS: {}, SERVICE_WARN_HOURS: 25, KG_SACA_GRAO: 60, opTemArea: o => o.type !== 'Transporte',
  nv: {}, safeStorage: {get: () => null, set() {}}, addEventListener() {}, document: {querySelector: () => null}});
vm.runInContext(src, ctx);
test('visão do grupo: resumo de uma fazenda no período', () => {
  const d = {
    fields: [{id: 'f1', area: 100}, {id: 'f2', area: 50}],
    operations: [{date: '2026-10-10', status: 'Concluída', type: 'Plantio', area: 100}, {date: '2026-10-11', status: 'Concluída', type: 'Transporte', area: 999},
      {date: '2026-10-01', status: 'Programada', type: 'Aplicação'}, {date: '2026-08-01', status: 'Concluída', type: 'Plantio', area: 50}, {date: '2026-10-12', status: 'Cancelada', type: 'Plantio'}],
    machines: [{id: 'm1', hours: 990, nextService: 1000}, {id: 'm2', hours: 10, nextService: 500}, {id: 'm3', state: 'Inativa', hours: 1, nextService: 2}],
    maintenances: [{machineId: 'm2', status: 'Aberta'}, {machineId: 'm1', status: 'Concluída', doneDate: '2026-10-05', cost: 700}],
    stock: [{qty: 5, min: 10}, {qty: 50, min: 10}],
    chuvas: [{date: '2026-10-02', mm: 30, fieldId: 'f1'}, {date: '2026-10-03', mm: 10, fieldId: 'f2'}],
    colheitas: [{date: '2026-10-09', kg: 6000}], expenses: [{date: '2026-10-04', value: 300}, {date: '2025-01-01', value: 99999}], vendas: [{date: '2026-10-15', valor: 1500}]
  };
  const r = vm.runInContext('grupoResumo', ctx)(d, '2026-09-20', '2026-10-19');
  assert.equal(r.talhoes, 2); assert.equal(r.area, 150);
  assert.equal(r.ops, 3, 'cancelada e fora do período não contam'); assert.equal(r.concl, 2);
  assert.equal(r.areaTrab, 100, 'transporte não soma área');
  assert.equal(r.atrasadas, 1); assert.equal(r.revisoes, 1); assert.equal(r.emManut, 1); assert.equal(r.estoqueBaixo, 1);
  assert.equal(r.chuva, 20, 'média entre pluviômetros'); assert.equal(r.sacas, 100);
  assert.equal(r.custos, 1000); assert.equal(r.vendas, 1500);
});
