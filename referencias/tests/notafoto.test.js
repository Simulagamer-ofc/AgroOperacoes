'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({Math, Number, String, Array, Date, JSON, VIEWS: {}, ACTIONS: {}, db: {}, today: () => '2026-11-09',
  num: (v, d = 0) => Number(v).toFixed(d)});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/notafoto.js'), 'utf8'), ctx);
const run = s => vm.runInContext(s, ctx);

// Monta uma chave com o dígito verificador certo (módulo 11)
function comDv(c43) { let s = 0, p = 2; for (let i = 42; i >= 0; i--) { s += Number(c43[i]) * p; p = p === 9 ? 2 : p + 1; } const r = s % 11; return c43 + (r < 2 ? 0 : 11 - r); }
// 43 = RS, 2611 = nov/2026, CNPJ 12345678000195, modelo 55, série 001, número 000004521, emissão 1, código 12345678
const CHAVE = comDv('43' + '2611' + '12345678000195' + '55' + '001' + '000004521' + '1' + '12345678');

test('chave de acesso: 44 dígitos e dígito verificador', () => {
  assert.equal(CHAVE.length, 44);
  assert.equal(run(`chaveNfeValida(${JSON.stringify(CHAVE)})`), true);
  const errada = CHAVE.slice(0, 43) + ((Number(CHAVE[43]) + 1) % 10);
  assert.equal(run(`chaveNfeValida(${JSON.stringify(errada)})`), false);
  assert.equal(run(`chaveNfeValida('123')`), false);
  // Com espaços como impressa no DANFE
  assert.equal(run(`chaveNfeValida(${JSON.stringify(CHAVE.replace(/(\d{4})/g, '$1 '))})`), true);
  assert.deepEqual({...run(`nfDaChave(${JSON.stringify(CHAVE)})`)}, {cnpj: '12345678000195', serie: '1', numero: '4521'});
});

test('foto → nota: número e CNPJ saem da chave, item com conta errada fica duvidoso, soma confere com o total', () => {
  ctx.r = {eh_nota: true, chave: CHAVE, numero: '4512', serie: '1', data_emissao: '2026-11-05', emitente: 'Agro Sul', cnpj_emitente: '12345678000195',
    total_produtos: 1500, total_nota: 1500,
    itens: [
      {codigo: 'A1', descricao: 'GLIFOSATO 20L', ncm: '3808.93.24', unidade: 'GL', quantidade: 5, valor_unitario: 200, valor_total: 1000, duvida: false},
      {codigo: 'B2', descricao: 'UREIA 50KG', unidade: 'SC', quantidade: 4, valor_unitario: 150, valor_total: 500, duvida: false},
    ],
    duplicatas: [{numero: '001', vencimento: '2026-12-05', valor: 1500}]};
  const n = run('nfDaFotoParaNota(r)');
  assert.equal(n.origem, 'foto');
  assert.equal(n.chave, CHAVE);
  assert.equal(n.numero, '4521'); // o lido era 4512: vale a chave
  assert.ok(n.avisos.some(a => /não batiam com a chave/.test(a)));
  assert.equal(n.itens[0].duvida, false);
  assert.equal(n.itens[0].ncm, '38089324');
  assert.equal(n.itens[1].duvida, true); // 4 × 150 = 600, não 500
  assert.ok(n.avisos.some(a => /1 item ficou/.test(a)));
  assert.equal(n.total, 1500);
  assert.equal(n.dups.length, 1);
});

test('foto → nota: sem chave usa número + CNPJ; valor não lido fica em branco para corrigir; soma diferente do total avisa', () => {
  ctx.r = {eh_nota: true, chave: null, numero: '000123', cnpj_emitente: '12.345.678/0001-95', emitente: 'Loja', data_emissao: 'ontem',
    total_produtos: 900, total_nota: null,
    itens: [{descricao: 'FILTRO', quantidade: 2, valor_unitario: null, valor_total: null, duvida: true}, {descricao: 'OLEO', quantidade: null, valor_total: 300, duvida: false}]};
  const n = run('nfDaFotoParaNota(r)');
  assert.equal(n.chave, 'foto-12345678000195-123');
  assert.equal(n.numero, '123');
  assert.equal(n.cnpj, '12345678000195');
  assert.equal(n.itens[0].valorEd, '');
  assert.equal(n.itens[1].qtdEst, '');
  assert.ok(n.itens.every(it => it.duvida));
  assert.equal(n.data, '');
  assert.equal(n.total, 300); // total da nota não lido: soma dos itens
  assert.ok(n.avisos.some(a => /chave de acesso não foi lida/.test(a)));
  assert.ok(n.avisos.some(a => /não bate com o total dos produtos/.test(a)));
  assert.ok(n.avisos.some(a => /data de emissão não foi lida/.test(a)));
});
