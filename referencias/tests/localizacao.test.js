'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function app(geolocation, secure = true) {
  const el = {innerHTML: ''};
  const ctx = vm.createContext({navigator: {geolocation, onLine: false}, isSecureContext: secure,
    db: {settings: {}, fields: []}, ACTIONS: {}, TITLES: {}, VIEWS: {inicio() {}}, alerts() {},
    document: {getElementById: () => el, addEventListener() {}},
    esc: s => String(s), safeStorage: {get() { return null; }}, save() {}, render() {}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/automacao.js'), 'utf8'), ctx);
  return {ctx, el, run: s => vm.runInContext(s, ctx)};
}
test('localização: botão chama a API diretamente, sem Permissions API e sem pedidos duplicados', () => {
  let calls = 0, success;
  const a = app({getCurrentPosition(ok) { calls++; success = ok; }});
  assert.match(a.run('cartaoClima()'), /Ativar localização/);
  a.run("ACTIONS['clima-local']()");
  assert.equal(calls, 1);
  assert.match(a.el.innerHTML, / disabled/);
  a.run("ACTIONS['clima-local']()"); assert.equal(calls, 1);
  success({coords: {latitude: -27.7, longitude: -52.6}});
  assert.equal(a.ctx.db.settings.local.lat, -27.7);
  assert.equal(a.ctx.db.settings.local.lon, -52.6);
  assert.equal(a.run('climaLocalEstado'), '');
});
test('localização: bloqueio mostra orientação do Safari e permite nova tentativa', () => {
  let calls = 0;
  const a = app({getCurrentPosition(ok, error) { calls++; error({code: 1}); }});
  a.run("ACTIONS['clima-local']()");
  assert.match(a.el.innerHTML, /Como liberar no Safari do iPhone/);
  assert.doesNotMatch(a.el.innerHTML, / disabled/);
  a.run("ACTIONS['clima-local']()"); assert.equal(calls, 2);
});
for (const code of [2, 3]) test(`localização: erro ${code} não é apresentado como permissão negada`, () => {
  const a = app({getCurrentPosition(ok, error) { error({code}); }});
  a.run("ACTIONS['clima-local']()");
  assert.doesNotMatch(a.el.innerHTML, /negado|Como liberar no Safari| disabled/);
  assert.match(a.el.innerHTML, code === 3 ? /demorou/ : /indisponível/);
});
test('localização: navegador sem suporte e HTTP recebem orientação sem lançar erro', () => {
  const a = app(undefined); a.run("ACTIONS['clima-local']()");
  assert.match(a.el.innerHTML, /não disponibiliza/);
  const b = app({getCurrentPosition() { throw Error('não deve chamar'); }}, false);
  b.run("ACTIONS['clima-local']()"); assert.match(b.el.innerHTML, /HTTPS/);
});
