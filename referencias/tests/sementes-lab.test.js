'use strict';
// Padrões de sementes (padroes-sementes.js) e classificação da análise de lote (laboratorio.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const www = path.join(__dirname, '../../app/src/main/assets/www');
const ler = f => fs.readFileSync(path.join(www, f), 'utf8');
function app(padroesFazenda = []) {
  const ctx = vm.createContext({
    ACTIONS: {}, Math, JSON, Number, String, Object, Array, Set, Map, console, Date,
    db: {padroesSementes: padroesFazenda, analisesSementes: [], lots: [], lotEvents: []},
    semAcentoApp: s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),
    num: (v, c = 0) => Number(v).toFixed(c), esc: s => String(s), btn: (l, a) => `<button data-act="${a}">${l}</button>`,
    today: () => '2026-11-25', addDias: (d, n) => d, isoLocal: d => d.toISOString().slice(0, 10), fmtDate: d => d, find: () => null
  });
  vm.runInContext(ler('padroes-sementes.js') + '\n' + ler('laboratorio.js') + '\nthis.P = PADROES_SEMENTES_APP; this.cl = labClassificar; this.ve = labVeredito; this.pad = labPadrao;', ctx);
  return ctx;
}
const classe = (c, especie, cat, a) => { const cl = c.cl(a, especie); return c.ve(cl, cat); };

test('padrões do app: limites não diminuem de Básica para S2 e toda categoria tem limite', () => {
  const {P} = app();
  assert.ok(P.length >= 60, `só ${P.length} espécies`);
  for (const p of P) {
    assert.ok(p.amostraG > 0 && p.amostraCS > 0, p.especie);
    for (const g of p.grupos) {
      const v = p.cats.map(c => g.lim[c]);
      v.forEach((x, i) => { assert.ok(Number.isFinite(x), `${p.especie} ${g.rot} ${p.cats[i]}`); if (i) assert.ok(x >= v[i - 1], `${p.especie} ${g.rot}: ${v.join('/')}`); });
    }
  }
});

test('aveia preta: 3 azevém em 500 g fica C1; 400 g é provisório; 5 cai para S1; silvestres contadas em 50 g', () => {
  const c = app();
  const base = {amostraG: 500, amostraCS: 50};
  assert.equal(classe(c, 'Aveia preta', 'C1', {...base, encontradas: [{grupo: 'tolerada', n: 3}]}).tipo, 'mantem');
  const cl = c.cl({amostraG: 400, amostraCS: 50, encontradas: [{grupo: 'tolerada', n: 3}]}, 'Aveia preta');
  assert.ok(cl.abaixo.length); assert.equal(c.ve(cl, 'C1').cat, 'S1'); assert.equal(cl.semProp, 'C1');
  assert.equal(classe(c, 'Aveia preta', 'C1', {...base, encontradas: [{grupo: 'tolerada', n: 5}]}).cat, 'S1');
  // 2 silvestres em 50 g: passa do C1 (1), fica S1 (2)
  assert.equal(classe(c, 'Aveia preta', 'C1', {...base, encontradas: [{grupo: 'silvestre', n: 2}]}).cat, 'S1');
  // a mesma contagem em 500 g examinados para silvestres vira 0,2 em 50 g: fica C1
  assert.equal(classe(c, 'Aveia preta', 'C1', {amostraG: 500, amostraCS: 500, encontradas: [{grupo: 'silvestre', n: 2}]}).tipo, 'mantem');
  assert.equal(classe(c, 'Aveia preta', 'C1', {...base, encontradas: [{grupo: 'tolerada', n: 13}]}).tipo, 'reprovado');
  assert.equal(classe(c, 'Aveia preta', 'C1', {...base, encontradas: [{grupo: 'proibida', n: 1}]}).tipo, 'reprovado');
});

test('trigo: 1 semente de aveia não cabe no C1, cabe no C2; híbrido de milho não tem C2', () => {
  const c = app();
  assert.equal(classe(c, 'Trigo', 'C1', {amostraG: 1000, encontradas: [{grupo: 'x0', n: 1}]}).cat, 'C2');
  assert.deepEqual([...c.pad('Milho híbrido').cats], ['Básica', 'C1', 'S1']);
  assert.equal(classe(c, 'Milho híbrido', 'C1', {amostraG: 1000, encontradas: [{grupo: 'cultivada', n: 2}]}).cat, 'S1');
});

test('padrão da fazenda tem prioridade e o formato antigo (1.2.5) ainda funciona', () => {
  const antigo = {id: 'p1', especie: 'Aveia preta', amostraG: 500, lim: {tolerada: {'Básica': 1, C1: 5, C2: 5, S1: 6, S2: 12}, proibida: {'Básica': 0, C1: 0, C2: 0, S1: 0, S2: 0}}, grupos: {azevem: 'tolerada'}};
  const c = app([antigo]);
  assert.equal(c.pad('aveia-preta').id, 'p1');
  assert.equal(classe(c, 'Aveia preta', 'C1', {amostraG: 500, encontradas: [{grupo: 'tolerada', n: 5}]}).tipo, 'mantem');
  assert.equal(c.pad('Avena strigosa').id, 'p1');
});

test('forrageiras tropicais: braquiária pelo nome da cultivar; 7 outras cultivadas em 180 g tira do C1; milheto existe', () => {
  const c = app();
  assert.equal(c.pad('Marandu').especie, 'Braquiária brizantha');
  assert.equal(c.pad('mombaça').especie, 'Capim-colonião (Panicum)');
  assert.equal(c.pad('Milheto').amostraG, 75);
  assert.equal(classe(c, 'Braquiária brizantha', 'C1', {amostraG: 180, encontradas: [{grupo: 'cultivada', n: 6}]}).tipo, 'mantem');
  assert.equal(classe(c, 'Braquiária brizantha', 'C1', {amostraG: 180, encontradas: [{grupo: 'cultivada', n: 7}]}).cat, 'C2');
  assert.equal(classe(c, 'Crotalária juncea', 'S1', {amostraG: 350, encontradas: [{grupo: 'proibida', n: 1}]}).tipo, 'reprovado');
  assert.equal(new Set(c.P.map(p => p.especie)).size, c.P.length);
});
