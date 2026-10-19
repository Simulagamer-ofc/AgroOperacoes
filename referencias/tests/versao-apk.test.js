'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/app.js'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(src.slice(src.indexOf('const versaoNums'), src.indexOf('function avisoApk')), ctx);
test('versão do APK: compara números, inclusive o beta', () => {
  const maior = (a, b) => vm.runInContext(`versaoMaior(${JSON.stringify(a)}, ${JSON.stringify(b)})`, ctx);
  assert.equal(maior('0.40.1-beta1', '0.40.0-beta1'), true);
  assert.equal(maior('0.40.0-beta2', '0.40.0-beta1'), true);
  assert.equal(maior('0.41.0-beta1', '0.40.9-beta3'), true);
  assert.equal(maior('0.40.0-beta1', '0.40.0-beta1'), false);
  assert.equal(maior('0.39.4-beta1', '0.40.0-beta1'), false);
});
test('versão do app e da publicação: build.gradle é a referência do aviso', () => {
  const gradle = fs.readFileSync(path.join(__dirname, '../../app/build.gradle.kts'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/index.html'), 'utf8');
  const v = gradle.match(/versionName = "(.*)"/)[1];
  assert.match(html, new RegExp(`>v${v.replace(/\./g, '\\.')}<`), 'a versão mostrada no menu deve ser a mesma do APK');
});
