'use strict';
// Os scripts do app compartilham o mesmo escopo global: o mesmo nome declarado em dois arquivos quebra o segundo arquivo inteiro.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WWW = path.join(__dirname, '../../app/src/main/assets/www');

test('nenhum nome global declarado em dois scripts', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !s.startsWith('http'));
  const onde = new Map();
  for (const s of scripts) {
    for (const linha of fs.readFileSync(path.join(WWW, s), 'utf8').split('\n')) {
      const m = linha.match(/^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/);
      if (m) onde.set(m[1], [...(onde.get(m[1]) || []), s]);
    }
  }
  const repetidos = [...onde].filter(([, fs]) => new Set(fs).size > 1).map(([n, fs]) => `${n}: ${[...new Set(fs)].join(', ')}`);
  assert.deepEqual(repetidos, []);
});
