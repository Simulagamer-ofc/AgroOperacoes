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
