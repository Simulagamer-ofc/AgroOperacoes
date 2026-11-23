import assert from 'node:assert/strict';
import {caixa, escolherImagem, ITEM_OK, lerItens, lerTalhoes, poligono} from './nucleo.ts';

Deno.test('talhões: aceita só contornos válidos', () => {
  const ts = lerTalhoes({talhoes: [
    {id: 'a1', pontos: [[-28.3, -52.4], [-28.31, -52.4], [-28.31, -52.39]]},
    {id: 'b"; drop', pontos: [[-28.3, -52.4], [-28.31, -52.4], [-28.31, -52.39]]},
    {id: 'c', pontos: [[-28.3, -52.4], [-28.31, -52.4]]},
    {id: 'd', pontos: [[0, 0], [1, 1], [2, 2]]}]});
  assert.deepEqual(ts.map(t => t.id), ['a1']);
  assert.deepEqual(lerTalhoes(null), []);
});

Deno.test('caixa e polígono em lon/lat, fechado', () => {
  const t = {id: 'a', pontos: [[-28.3, -52.4], [-28.31, -52.41], [-28.29, -52.39]] as [number, number][]};
  assert.deepEqual(caixa([t]), [-52.41, -28.31, -52.39, -28.29]);
  const p = poligono(t);
  assert.deepEqual(p.coordinates[0][0], [-52.4, -28.3]);
  assert.deepEqual(p.coordinates[0].at(-1), [-52.4, -28.3]);
});

Deno.test('imagem: mais recente que cobre a fazenda e tem poucas nuvens', () => {
  const itens = lerItens({features: [
    {id: 'S2A_MSIL2A_20261109T133231_R081_T22JCP_20261109T194651', bbox: [-53, -29, -52, -28], properties: {datetime: '2026-11-09T13:32:31Z', 'eo:cloud_cover': 5}},
    {id: 'S2B_MSIL2A_20261114T133229_R081_T22JCP_20261114T180000', bbox: [-53, -29, -52, -28], properties: {datetime: '2026-11-14T13:32:29Z', 'eo:cloud_cover': 80}},
    {id: 'S2C_MSIL2A_20261112T133229_R081_T22JBP_20261112T180000', bbox: [-54, -29, -52.5, -28], properties: {datetime: '2026-11-12T13:32:29Z', 'eo:cloud_cover': 2}},
    {id: '../../etc', bbox: [-53, -29, -52, -28], properties: {datetime: '2026-11-20', 'eo:cloud_cover': 0}}]});
  assert.equal(itens.length, 3);
  assert.equal(escolherImagem(itens, [-52.41, -28.31, -52.39, -28.29])?.id, 'S2A_MSIL2A_20261109T133231_R081_T22JCP_20261109T194651');
  assert.equal(escolherImagem(itens, [-52.41, -28.31, -52.39, -28.29], 1), null);
  assert.ok(ITEM_OK.test('S2A_MSIL2A_20261109T133231_R081_T22JCP_20261109T194651'));
  assert.ok(!ITEM_OK.test('S2A_MSIL2A_x&y=1'));
});

Deno.test('Landsat 8/9 e Sentinel-2: coleção pelo nome; candidatas cobrem a fazenda, mais recentes primeiro', async () => {
  const {candidatas, colecaoDe} = await import('./nucleo.ts');
  assert.equal(colecaoDe('LC09_L2SP_222080_20261020_02_T1'), 'ls');
  assert.equal(colecaoDe('LE07_L2SP_222080_20201020_02_T1'), null);
  assert.equal(colecaoDe('S2B_MSIL2A_20261112T133149_R081_T22JCP_20261112T184116'), 's2');
  const itens = lerItens({features: [
    {id: 'S2B_MSIL2A_20261122T133149_R081_T22JCP_20261122T165328', bbox: [-53, -29, -52, -28], properties: {datetime: '2026-11-22T13:31:49Z', 'eo:cloud_cover': 64}},
    {id: 'S2C_MSIL2A_20261107T133141_R081_T22JCP_20261107T155508', bbox: [-53, -29, -52, -28], properties: {datetime: '2026-11-07T13:31:41Z', 'eo:cloud_cover': 97.8}},
    {id: 'LC09_L2SP_222080_20261105_02_T1', bbox: [-53.8, -29.9, -51.4, -27.8], properties: {datetime: '2026-11-05T13:24:37Z', 'eo:cloud_cover': 21}},
    {id: 'LC08_L2SP_222080_20261028_02_T1', bbox: [-53.8, -29.9, -51.4, -27.8], properties: {datetime: '2026-10-28T13:24:35Z', 'eo:cloud_cover': 75}},
    {id: 'S2A_MSIL2A_20261109T133231_R081_T22JBP_20261109T194651', bbox: [-54, -29, -52.5, -28], properties: {datetime: '2026-11-09T13:32:31Z', 'eo:cloud_cover': 1}}]});
  const c = candidatas(itens, [-52.41, -28.31, -52.39, -28.29]);
  // a de 64% entra (a fazenda pode estar limpa); 97,8% e Landsat 75% ficam fora; a que não cobre a fazenda também
  assert.deepEqual(c.map(i => i.id.slice(0, 19)), ['S2B_MSIL2A_20261122', 'LC09_L2SP_222080_20']);
  assert.deepEqual(c.map(i => i.col), ['s2', 'ls']);
});
