'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/app.js'), 'utf8');
test('relatório compartilha dados da tela e PDF e exclui registros fora do período', () => {
  const ctx = {reportDays: 7, daysAgo: () => '2026-10-10', today: () => '2026-10-16', OP_TYPES: ['Aplicação'], opTemArea: () => true,
    lancamentosCusto: () => [], somaValor: () => 0,
    db: {operations: [{date:'2026-10-10',status:'Concluída',type:'Aplicação',area:60}, {date:'2026-10-16',status:'Cancelada'}, {date:'2026-10-17',status:'Concluída'}, {date:'2026-10-09',status:'Concluída'}],
      machines: [], hourLogs: [], stock: [{id:'s',qty:10}], movements: [
        {itemId:'s',kind:'Saída',date:'2026-10-10',qty:2}, {itemId:'s',kind:'Saída',date:'2026-10-16',qty:3},
        {itemId:'s',kind:'Saída',date:'2026-10-17',qty:100}, {itemId:'s',kind:'Saída',date:'2026-10-09',qty:100}]} };
  vm.createContext(ctx);
  vm.runInContext(src.slice(src.indexOf('function dadosRelatorio()'), src.indexOf('VIEWS.relatorios =')) + '\nresultado = dadosRelatorio();', ctx);
  assert.equal(ctx.resultado.ops.length, 1);
  assert.equal(ctx.resultado.area, 60);
  assert.equal(ctx.resultado.consumption[0][1], 5);
});
