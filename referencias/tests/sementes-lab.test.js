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
    db: {padroesSementes: padroesFazenda, analisesSementes: [], lots: [], lotEvents: [], ubs: [], settings: {}}, window: {}, chip: (t, c) => `[${c}:${t}]`,
    semAcentoApp: s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),
    num: (v, c = 0) => Number(v).toFixed(c), esc: s => String(s), btn: (l, a) => `<button data-act="${a}">${l}</button>`,
    today: () => '2026-11-25', addDias: (d, n) => d, isoLocal: d => d.toISOString().slice(0, 10), fmtDate: d => d, find: () => null
  });
  vm.runInContext(ler('padroes-sementes.js') + '\n' + ler('laboratorio.js') + '\n' + ler('termo-sementes.js') + '\nthis.P = PADROES_SEMENTES_APP; this.cl = labClassificar; this.ve = labVeredito; this.pad = labPadrao; this.lab = {labMesesReanalise, labValidadeLote, labConfere, labChipValidade, labPodeVender, labValidade};', ctx);
  return ctx;
}
const classe = (c, especie, cat, a) => { const cl = c.cl(a, especie); return c.ve(cl, cat); };

test('padrões do app: limites não diminuem de Básica para S2 e toda categoria tem limite', () => {
  const {P} = app();
  assert.ok(P.length >= 60, `só ${P.length} espécies`);
  for (const p of P) {
    if (p.semContagem) { assert.ok(p.grupos.every(g => !Object.keys(g.lim).length) && p.germ.C1 > 0, p.especie); continue; }
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

test('hortaliças (IN 42/2019): alface conta cultivadas em 3 g e nocivas em 30 g; tomate não tem contagem', () => {
  const c = app();
  const alface = c.pad('Alface');
  assert.deepEqual([alface.amostraCS, alface.amostraG, alface.validadeMeses], [3, 30, 12]);
  assert.equal(classe(c, 'Alface', 'C1', {amostraCS: 3, amostraG: 30, encontradas: [{grupo: 'cultivada', n: 2}, {grupo: 'tolerada', n: 3}]}).tipo, 'mantem');
  assert.equal(classe(c, 'Alface', 'C1', {amostraCS: 3, amostraG: 30, encontradas: [{grupo: 'cultivada', n: 3}]}).cat, 'C2');
  assert.equal(classe(c, 'Cenoura', 'S1', {amostraCS: 3, amostraG: 30, encontradas: [{grupo: 'tolerada', n: 16}]}).tipo, 'reprovado');
  assert.equal(c.pad('Tomate').semContagem, true);
  assert.equal(c.cl({amostraG: 7, encontradas: [{grupo: 'cultivada', n: 5}]}, 'Tomate'), null);
  assert.equal(c.pad('Chicória').cientifico, 'Cichorium endivia');
  assert.equal(c.pad('pimentão').especie, 'Pimentão');
});

test('validade do teste: reanálise pelo padrão (ou 6 meses), vencendo/vencido e reanálise renovando', () => {
  const c = app(), {labMesesReanalise: mr, labValidadeLote: vl, labChipValidade: chipV, labPodeVender: pode, labValidade} = c.lab;
  assert.deepEqual(['Trigo', 'Soja', 'Braquiária brizantha', 'Crotalária juncea', 'Alface'].map(e => mr(c.pad(e))), [6, 6, 6, 4, 12]);
  assert.deepEqual([c.pad('Aveia preta').validadeMeses, mr(c.pad('Aveia preta')), c.pad('Ervilhaca').validadeMeses, mr(c.pad('Ervilhaca'))], [8, 6, 6, 4]); // IN 44/2016, art. 7º
  assert.equal(labValidade('2026-03-10', 8), '2026-11-30'); // excluído o mês do teste: até o fim do mês
  const l = {id: 'L1', code: 'TR-1', species: 'Trigo', category: 'C1', status: 'Aprovado'};
  c.db.lots.push(l);
  c.db.analisesSementes.push({id: 'a1', lotId: 'L1', data: '2026-03-10', germinacao: 90, validade: '2026-11-30', encontradas: []});
  assert.equal(vl(l).estado, 'vence'); assert.equal(vl(l).dias, 5); assert.match(chipV(l), /vence em 5 dias/);
  c.db.analisesSementes[0].validade = '2026-10-31';
  assert.equal(vl(l).estado, 'vencido'); assert.equal(pode(l), false); assert.match(chipV(l), /red/);
  assert.equal(chipV({...l, status: 'Expedido'}), '');
  c.db.analisesSementes.push({id: 'r1', lotId: 'L1', tipo: 'reanalise', data: '2026-11-20', germinacao: 86, validade: '2027-05-31', encontradas: []});
  assert.equal(vl(l).estado, 'ok'); assert.equal(pode(l), true); assert.equal(chipV(l), '');
});

test('germinação e pureza x mínimo da norma: aviso com a categoria que atinge', () => {
  const c = app(), {labConfere: cf} = c.lab;
  const g = cf({germinacao: 72}, c.pad('Girassol'), 'C1')[0];
  assert.deepEqual([g.ok, g.min, g.atende], [false, 75, 'S1']);
  assert.equal(cf({germinacao: 90}, c.pad('Trigo'), 'C1')[0].ok, true);
  const al = cf({germinacao: 85, pureza: 97}, c.pad('Alface'), 'C1');
  assert.deepEqual([...al].map(x => x.ok), [true, false]);
  assert.equal(cf({germinacao: 50}, c.pad('Braquiária brizantha'), 'S1')[0].atende, null);
  assert.equal(cf({pureza: 70}, c.pad('Braquiária brizantha'), 'S1')[0].ok, true); // pureza S1 60% nas braquiárias
  assert.equal(cf({germinacao: 90}, c.pad('Trigo'), 'Genética').length, 0);
});

test('termo de conformidade: só emite com análise que sustenta a declaração', () => {
  const c = app(), t = c.window.dadosTermo;
  const l = {id: 'L2', code: 'AP-1', species: 'Aveia preta', category: 'S1', status: 'Aprovado', weight: 20000};
  c.db.lots.push(l);
  assert.match(t(l).erro, /Registre a análise/);
  c.db.analisesSementes.push({id: 'a2', lotId: 'L2', data: '2026-11-10', amostraG: 500, amostraCS: 50, germinacao: 85, encontradas: [{grupo: 'tolerada', n: 4}]});
  assert.deepEqual([...t(l).faltaDados], ['RENASEM do produtor', 'responsável técnico', 'RENASEM do responsável técnico']);
  Object.assign(c.db.settings, {renasemProdutor: 'RS-1', respTecnico: 'Fulano', renasemRT: 'RS-2'});
  assert.equal(t(l).cat, 'S1');
  assert.match(t({...l, category: 'C1'}).erro, /não atende C1/);
  assert.match(t({...l, category: 'Genética'}).erro, /categoria/);
  c.db.analisesSementes[0].germinacao = 60;
  assert.match(t(l).erro, /Germinação 60% abaixo do mínimo do S1/);
  c.db.analisesSementes[0].germinacao = 85; c.db.analisesSementes[0].amostraG = 300;
  assert.match(t(l).erro, /provisória/);
});
