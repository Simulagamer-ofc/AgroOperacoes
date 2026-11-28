'use strict';
// Globo do Edy (edy-globo.js): coordenadas da sede no anel, recorte do globo e botão da barra de baixo
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const www = path.join(__dirname, '../../app/src/main/assets/www');
const ctx = vm.createContext({Math, Number, String, Array, Object});
vm.runInContext(fs.readFileSync(path.join(www, 'edy-globo.js'), 'utf8') + '\nthis.f = {edyCoordTexto, edyCenaHtml, edyGloboFoto};', ctx);
const {edyCoordTexto, edyCenaHtml, edyGloboFoto} = ctx.f;

test('coordenadas da sede no anel (vazio sem sede marcada)', () => {
  assert.equal(edyCoordTexto({lat: -28.2612, lon: -52.4083}), 'SEDE 28,26° S · 52,41° O');
  assert.equal(edyCoordTexto(null), '');
  assert.equal(edyCoordTexto({lat: NaN, lon: 1}), '');
  assert.match(edyCenaHtml({lat: -28.26, lon: -52.4}), /SEDE 28,26° S · 52,40° O/);
  assert.doesNotMatch(edyCenaHtml(undefined), /SEDE/);
});

test('vídeo mudo, sem tela cheia, com imagem parada; recorte do globo da tela de entrada', () => {
  const h = edyCenaHtml();
  assert.match(h, /<video muted loop playsinline[^>]*poster="img\/edy-globo\.jpg"/);
  assert.match(h, /src="img\/edy-globo\.mp4"/);
  assert.match(h, /aria-hidden="true"/);
  assert.match(edyGloboFoto(58), /url\(img\/nexus-globo\.jpg\).*background-size:203\.7px 114\.7px/);
});

test('barra de baixo: Edy no centro, Estoque no menu; arquivos guardados para funcionar sem internet', () => {
  const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8'), sw = fs.readFileSync(path.join(www, 'sw.js'), 'utf8');
  const nav = html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-route="(\w+)"/g)].map(m => m[1]), ['inicio', 'operacoes', 'assistente', 'talhoes']);
  assert.match(html, /<button data-route="estoque">/); // continua no menu lateral
  for (const a of ['edy-globo.js', 'img/edy-globo.mp4', 'img/edy-globo.jpg']) assert.ok(sw.includes(`"${a}"`), a);
  assert.ok(fs.statSync(path.join(www, 'img/edy-globo.mp4')).size < 1.2e6);
});
