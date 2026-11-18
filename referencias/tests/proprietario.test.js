'use strict';
// Proprietário (proprietario.js): cadastro sem nuvem, validações do formulário e o declarante do LCDPR
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let form = null;
const ctx = vm.createContext({Math, Date, Number, JSON, String, Object, Array, Set, Promise, Error, console, document: {head: {insertAdjacentHTML() {}}},
  VIEWS: {cadastros: Object.assign(() => '<section><article class="card panel"><h3>Registros no dispositivo</h3></article></section>', {after() {}})},
  ACTIONS: {}, db: {settings: {owner: ''}}, UFS: ['RS', 'SC'], esc: s => String(s), btn: (t, a) => `<button data-act="${a}">${t}</button>`,
  save() {}, render() {}, showToast() {}, applySettings() {}, $: () => null, openForm: c => { form = c; },
  docValido: d => d === '12345678909' || d === '11222333000181'});
vm.runInContext(`var lcProdutor = {}; function lcCfg() { return {produtor: lcProdutor}; } ACTIONS['lc-produtor'] = () => 'aberto';\n`
  + fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/proprietario.js'), 'utf8'), ctx);
const run = s => vm.runInContext(s, ctx);

test('proprietário: sem nuvem, o cartão aparece em Cadastros e o cadastro fica no aparelho', async () => {
  assert.match(run('VIEWS.cadastros()'), /<h3>Proprietário<\/h3>[\s\S]*Registros no dispositivo/);
  run(`ACTIONS['pr-editar']()`);
  assert.equal(form.onSubmit({nome: 'A', doc: ''}), 'Digite o nome do proprietário');
  assert.equal(form.onSubmit({nome: 'Ederson', doc: '123'}), 'CPF tem 11 números e CNPJ tem 14');
  assert.equal(form.onSubmit({nome: 'Ederson', doc: '111.111.111-11'}), 'CPF inválido');
  assert.equal(form.onSubmit({nome: 'Ederson', doc: '', cep: '9914'}), 'CEP tem 8 números');
  assert.equal(form.onSubmit({nome: 'Ederson', email: 'x@'}), 'E-mail inválido');
  assert.equal(form.onSubmit({nome: ' Ederson Z ', doc: '123.456.789-09', cep: '99145-000', uf: 'RS', telefone: '(54) 9999', email: 'e@x.com'}), undefined);
  await new Promise(r => setTimeout(r, 0));
  const d = JSON.parse(run('JSON.stringify(db.settings.proprietarioDados)'));
  assert.equal(d.nome, 'Ederson Z'); assert.equal(d.doc, '12345678909'); assert.equal(d.cep, '99145000');
  assert.equal(run('db.settings.owner'), 'Ederson Z'); // vira o responsável dos impressos, se estava vazio
  assert.match(run('VIEWS.cadastros()'), /123\.456\.789-09[\s\S]*99145-000/);
});
test('proprietário: o declarante do LCDPR começa com o cadastro, sem apagar o que já foi digitado', () => {
  run(`lcProdutor = {email: 'meu@x.com'}`);
  assert.equal(run(`ACTIONS['lc-produtor']()`), 'aberto');
  const p = JSON.parse(run('JSON.stringify(lcProdutor)'));
  assert.equal(p.nome, 'Ederson Z'); assert.equal(p.cpf, '12345678909'); assert.equal(p.uf, 'RS'); assert.equal(p.email, 'meu@x.com');
});
