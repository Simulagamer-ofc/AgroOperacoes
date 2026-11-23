'use strict';
// Camada técnica: calagem e adubação (CQFS-RS/SC 2016), estádio da lavoura e balanço hídrico
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/www/tecnico.js'), 'utf8');
const HOJE = '2026-11-23';
const addDias = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const diasEntreAuto = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);

function app(db, mem = {}) {
  const ctx = vm.createContext({
    window: {}, VIEWS: {}, ACTIONS: {}, Math, JSON, Number, String, Object, Array, Set, Map, Date, Promise, console,
    document: {addEventListener() {}, querySelectorAll: () => []}, navigator: {onLine: false},
    db: {fields: [], chuvas: [], monitoramentos: [], operations: [], aplicacoes: [], analisesSolo: [], settings: {}, ...db},
    safeStorage: {get: k => mem[k] ?? null, set: (k, v) => { mem[k] = v; }},
    today: () => HOJE, addDias, diasEntreAuto, fmtDate: d => String(d).split('-').reverse().join('/'), num: (v, c = 0) => Number(v).toFixed(c), esc: s => String(s),
    byDateDesc: (a, b) => String(b.date).localeCompare(String(a.date)), find: () => null, culturaNorm: t => String(t || '').toLowerCase(), emCiclo: () => true
  });
  return vm.runInContext(src + '\n;({tecSmpDose, recomendacaoSolo, estadioTalhao, balancoHidrico, TEC_CLASSES, TEC_HIST})', ctx);
}

test('calagem: tabela SMP para pH 6,0 (CQFS 2016)', () => {
  const t = app({});
  assert.equal(t.tecSmpDose(5.8), 4.2);
  assert.equal(t.tecSmpDose(4.2), 21);
  assert.equal(t.tecSmpDose(7.1), 0);
  assert.equal(t.tecSmpDose(''), null);
});

test('calagem: critérios do plantio direto consolidado e do preparo convencional', () => {
  const t = app({});
  // pH < 5,5: SMP 5,8 → 4,2 t/ha (PRNT 100%); PRNT 80% → 5,3 t/ha, na superfície
  const a = t.recomendacaoSolo({phAgua: 5.2, smp: 5.8, v: 58, mAl: 6, prnt: 80, sistema: 'consolidado'});
  assert.equal(a.cal.dose, 5.3); assert.match(a.cal.como, /superfície/);
  // V ≥ 65% e Al < 10%: não aplica, mesmo com pH < 5,5
  assert.equal(t.recomendacaoSolo({phAgua: 5.3, smp: 5.8, v: 70, mAl: 5, sistema: 'consolidado'}).cal.dose, 0);
  // Na superfície no máximo 5 t/ha (PRNT 100%); incorporado vale a dose cheia
  assert.equal(t.recomendacaoSolo({phAgua: 4.9, smp: 4.8, v: 40, mAl: 20, prnt: 100, sistema: 'consolidado'}).cal.dose, 5);
  assert.equal(t.recomendacaoSolo({phAgua: 4.9, smp: 4.8, prnt: 100, sistema: 'convencional'}).cal.dose, 11.9);
  assert.equal(t.recomendacaoSolo({phAgua: 5.8, smp: 6.2, sistema: 'convencional'}).cal.dose, 0);
});

test('P pela classe de argila e K pela CTC; adubação do trigo com N', () => {
  const t = app({});
  const r = t.recomendacaoSolo({phAgua: 6, argila: 48, p: 7.5, k: 140, ctc: 14.2, mo: 3.4, cultura: 'Trigo', cultivo: '1', expectativa: 4, precedente: 'Soja'});
  assert.equal(t.TEC_CLASSES[r.p.i], 'Baixo');
  assert.equal(t.TEC_CLASSES[r.k.i], 'Alto');
  assert.deepEqual([r.adubo.P, r.adubo.K, r.adubo.N], [110, 40, 60]);
  // Argila 15% (classe 4): P 25 é médio; CTC 20 (classe 15,1–30): K 85 é médio
  const r2 = t.recomendacaoSolo({phAgua: 6, argila: 15, p: 25, k: 85, ctc: 20});
  assert.equal(t.TEC_CLASSES[r2.p.i], 'Médio'); assert.equal(t.TEC_CLASSES[r2.k.i], 'Médio');
  // Soja sem a tabela preenchida: pede a tabela (não inventa dose)
  assert.equal(t.recomendacaoSolo({phAgua: 6, argila: 48, p: 7.5, k: 140, ctc: 14.2, cultura: 'Soja'}).adubo.falta, true);
});

test('estádio: soja pelo ciclo e milho pela soma térmica; o monitoramento vale mais', () => {
  const soja = {id: 's', crop: 'Soja', plantingDate: addDias(HOJE, -50), ciclo: 125};
  const milho = {id: 'm', crop: 'Milho', plantingDate: addDias(HOJE, -54)};
  const dias = {}; for (let k = 1; k <= 60; k++) dias[addDias(HOJE, -k)] = {tmax: 30, tmin: 20, chuva: 0, et0: 4};
  const mem = {'agro-clima-hist': JSON.stringify({em: Date.now(), lat: 0, lon: 0, desde: addDias(HOJE, -60), dias})};
  const t = app({fields: [soja, milho], monitoramentos: [{fieldId: 's', date: addDias(HOJE, -2), estadio: 'R2'}]}, mem);
  const s = t.estadioTalhao(soja);
  assert.equal(s.cod, 'R1'); assert.equal(s.prox.cod, 'R2'); assert.equal(s.observado.estadio, 'R2');
  const m = t.estadioTalhao(milho); // 15 °C·dia por dia × 54 dias = 810
  assert.equal(m.gdd, 810); assert.equal(m.cod, 'R1'); assert.equal(m.prox.cod, 'R2');
});

test('balanço hídrico: seca esvazia o solo; leitura do pluviômetro vale mais que a estimativa', () => {
  const dias = {}; for (let k = 1; k <= 40; k++) dias[addDias(HOJE, -k)] = {tmax: 30, tmin: 18, chuva: 0, et0: 5};
  const mem = {'agro-clima-hist': JSON.stringify({em: Date.now(), dias})};
  const seco = app({}, mem).balancoHidrico(null);
  assert.equal(seco.nivel, 'deficit'); assert.ok(seco.diasDeficit > 5);
  const molhado = app({chuvas: [{date: addDias(HOJE, -1), mm: 80, fieldId: ''}]}, mem).balancoHidrico(null);
  assert.equal(molhado.nivel, 'boa'); assert.equal(molhado.lidos7, 1);
  // Chuva marcada como estimativa não conta como leitura
  assert.equal(app({chuvas: [{date: addDias(HOJE, -1), mm: 80, fieldId: '', fonte: 'estimativa'}]}, mem).balancoHidrico(null).nivel, 'deficit');
});
