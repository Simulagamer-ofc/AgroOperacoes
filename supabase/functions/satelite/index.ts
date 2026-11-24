// MercaPlant — vigor da lavoura por satélite (NDVI).
// acao=ndvi (POST {talhoes:[{id, pontos:[[lat,lon],...]}]}): a imagem mais recente com a fazenda limpa (Sentinel-2 ou Landsat 8/9)
//   e o NDVI médio de cada talhão. A nuvem é medida sobre a fazenda, não na cena inteira.
// acao=tile (GET item, z, x, y): mosaico colorido do NDVI para o mapa do app.
// acao=desenhar (GET lat, lon): contorno do talhão tocado, desenhado pelo NDVI de até 3 datas limpas (Sentinel-2, 10 m)
//   num quadro de 2,4 km em volta do toque.
// Imagens do catálogo aberto do Planetary Computer; não precisa de chave. Só a chave pública do app entra.
import {camadaDoPng, contornoDaMascara, lerPng, opcoesDoToque, rascunho, type Segmento, simplificarAnel} from './desenho.ts';
import {caixa, caixaDoPonto, candidatas, datasEspacadas, COLECAO, colecaoDe, DETALHE, type Item, LIMPA, lerItens, lerTalhoes, NDVI_DE, NUVEM_DE, poligono, type Talhao} from './nucleo.ts';

const CHAVE_APP = 'sb_publishable_BxbOeMIvyAlyTkCMy3sUWg__PpRKnYK'; // chave pública do app (mesma do nuvem.js)
const PC = 'https://planetarycomputer.microsoft.com';
const CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'};
const json = (corpo: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(corpo), {status, headers: {...CORS, 'Content-Type': 'application/json', ...extra}});

async function pedir(url: string, init: RequestInit = {}, ms = 30000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, {...init, signal: ctl.signal}); } finally { clearTimeout(t); }
}

const cache = new Map<string, {em: number, r: unknown}>();
const VALIDADE = 6 * 3600000;

const stats = (it: Item, expr: string, geom: unknown, ms = 40000) => pedir(`${PC}/api/data/v1/item/statistics?${new URLSearchParams({collection: COLECAO[it.col], item: it.id, expression: expr, asset_as_band: 'true'})}`,
  {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({type: 'Feature', properties: {}, geometry: geom})}, ms)
  .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
  .then(j => Object.values(j?.properties?.statistics || {})[0] as {mean?: number, std?: number, count?: number} | undefined);

async function buscar(col: 's2' | 'ls', area: number[], desde: Date, ate: Date) {
  const r = await pedir(`${PC}/api/stac/v1/search`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
    collections: [COLECAO[col]], bbox: area, datetime: `${desde.toISOString()}/${ate.toISOString()}`, limit: 30,
    query: col === 'ls' ? {'eo:cloud_cover': {lt: 70}, platform: {in: ['landsat-8', 'landsat-9']}} : {'eo:cloud_cover': {lt: 90}},
    sortby: [{field: 'datetime', direction: 'desc'}], fields: {include: ['id', 'bbox', 'properties.datetime', 'properties.eo:cloud_cover'], exclude: ['assets', 'links', 'geometry']}})});
  return r.ok ? lerItens(await r.json()) : [];
}

async function ndvi(ts: Talhao[]) {
  const area = caixa(ts), chave = JSON.stringify(ts.map(t => [t.id, t.pontos.length, t.pontos[0]]));
  const c = cache.get(chave); if (c && Date.now() - c.em < VALIDADE) return c.r;
  // Últimos 60 dias dos dois satélites; das mais recentes para trás, a primeira com a fazenda limpa
  const ate = new Date(), desde = new Date(ate.getTime() - 60 * 86400000);
  const itens = (await Promise.all([buscar('s2', area, desde, ate), buscar('ls', area, desde, ate)])).flat();
  const [o, s, l, n] = area, faz = {type: 'Polygon', coordinates: [[[o, s], [l, s], [l, n], [o, n], [o, s]]]};
  let item: Item | null = null, nuvem = 1;
  for (const it of candidatas(itens, area, 8)) {
    try { const st = await stats(it, NUVEM_DE[it.col], faz, 30000); if (st && (st.count || 0) > 0 && Number.isFinite(st.mean)) { nuvem = st.mean!; if (nuvem <= LIMPA) { item = it; break; } } } catch { /* próxima */ }
  }
  if (!item) { const r = {data: null, item: null, talhoes: [], conferidas: itens.length}; cache.set(chave, {em: Date.now(), r}); return r; }
  const talhoes: {id: string, ndvi: number | null, desvio: number | null, pixels: number}[] = [];
  for (let k = 0; k < ts.length; k += 4) {
    await Promise.all(ts.slice(k, k + 4).map(async t => {
      try {
        const st = await stats(item!, NDVI_DE[item!.col], poligono(t));
        const ok = st && Number.isFinite(st.mean) && (st.count || 0) > 0;
        talhoes.push({id: t.id, ndvi: ok ? Math.round(st!.mean! * 1000) / 1000 : null, desvio: ok && Number.isFinite(st!.std) ? Math.round(st!.std! * 1000) / 1000 : null, pixels: st?.count || 0});
      } catch { talhoes.push({id: t.id, ndvi: null, desvio: null, pixels: 0}); }
    }));
  }
  const r = {data: item.data, item: item.id, nuvens: Math.round(nuvem * 100), detalhe: DETALHE[item.col], talhoes};
  cache.set(chave, {em: Date.now(), r});
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return r;
}

const TAM = 240; // pontos por lado no quadro (10 m cada num quadro de 2,4 km)
async function desenhar(q: URLSearchParams) {
  const lat = Number(q.get('lat')), lon = Number(q.get('lon')), debug = q.get('debug') === '1';
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -40 || lat > 10 || lon < -80 || lon > -30) return json({erro: 'informe lat e lon'}, 400);
  const area = caixaDoPonto(lat, lon, TAM * 5), [o, s, l, n] = area, quadro = {type: 'Polygon', coordinates: [[[o, s], [l, s], [l, n], [o, n], [o, s]]]};
  // Só Sentinel-2 (10 m): o Landsat (30 m) é grosso demais para a divisa. Até 4 datas limpas nos últimos 180 dias, espaçadas.
  const chave = 'd:' + area.join(','), c = cache.get(chave);
  let datas = c && Date.now() - c.em < VALIDADE ? c.r as {data: string, id: string}[] : null;
  if (!datas) {
    const ate = new Date(), desde = new Date(ate.getTime() - 180 * 86400000), limpas: Item[] = [];
    for (const it of candidatas(await buscar('s2', area, desde, ate), area, 20)) {
      if (limpas.length >= 4) break;
      if (datasEspacadas([...limpas, it]).length <= limpas.length) continue;
      try { const st = await stats(it, NUVEM_DE.s2, quadro, 30000); if (st && (st.count || 0) > 0 && (st.mean ?? 1) <= 0.05) limpas.push(it); } catch { /* próxima */ }
    }
    datas = datasEspacadas(limpas, 4).map(i => ({data: i.data, id: i.id}));
    cache.set(chave, {em: Date.now(), r: datas});
  }
  if (!datas.length) return json({pontos: [], aviso: 'Sem imagem limpa desta área nos últimos meses. Desenhe tocando nos cantos.'});
  // Uma camada de NDVI por data e, da data mais recente, o vermelho (estrada, palha e solo preparado aparecem mesmo sem verde)
  const pedidos = [...datas.map(d => ({id: d.id, expr: NDVI_DE.s2, escala: '-0.2,1'})), {id: datas[0].id, expr: 'B04*1.0', escala: '500,3500'}];
  const camadas = (await Promise.all(pedidos.map(async d => {
    const url = `${PC}/api/data/v1/item/bbox/${o},${s},${l},${n}/${TAM}x${TAM}.png?${new URLSearchParams({collection: COLECAO.s2, item: d.id, expression: d.expr, asset_as_band: 'true', rescale: d.escala})}`;
    const r = await pedir(url, {}, 40000).catch(() => null);
    return r?.ok ? camadaDoPng(await lerPng(new Uint8Array(await r.arrayBuffer()))).slice(0, TAM * TAM) : null;
  }))).filter((x): x is Float32Array<ArrayBuffer> => !!x && x.length === TAM * TAM);
  if (!camadas.length) return json({erro: 'imagens indisponíveis agora'}, 502);
  const meio = TAM / 2, diag: number[][] = [], dif = debug && Number(q.get('dif')) > 0 ? Number(q.get('dif')) : 0.1;
  const {opcoes, padrao} = opcoesDoToque(camadas, TAM, TAM, meio, meio, diag, dif);
  if (!opcoes.length) return json({pontos: [], aviso: 'Não deu para separar este talhão dos vizinhos: nas imagens recentes a área em volta está toda parecida (por exemplo, solo e palha). Desenhe tocando nos cantos, ou tente de novo quando a lavoura estiver mais desenvolvida.', ...(debug ? {diag, rascunho: rascunho(camadas[camadas.length - 1], null, TAM, TAM)} : {})});
  // Cada opção: contorno em [lat, lon] e área. O app mostra a padrão e deixa trocar por "menor / maior".
  const desenho = (seg: Segmento) => ({
    pontos: simplificarAnel(contornoDaMascara(seg.mascara, TAM, TAM), 0.9).map(([x, y]) => [Math.round((n - y / TAM * (n - s)) * 1e7) / 1e7, Math.round((o + x / TAM * (l - o)) * 1e7) / 1e7]),
    hectares: Math.round(seg.n * 100 / 10000 * 10) / 10});
  const lista = opcoes.slice(0, 5).map(desenho), p = Math.min(padrao, lista.length - 1);
  return json({...lista[p], opcoes: lista, padrao: p, datas: datas.map(d => d.data.slice(0, 10)), aviso: '',
    ...(debug ? {diag, rascunho: rascunho(camadas[camadas.length - 1], opcoes[p].mascara, TAM, TAM)} : {})}, 200, {'Cache-Control': 'private, max-age=3600'});
}

async function mosaico(q: URLSearchParams) {
  const item = q.get('item') || '', col = colecaoDe(item), z = Number(q.get('z')), x = Number(q.get('x')), y = Number(q.get('y'));
  if (!col || ![z, x, y].every(Number.isInteger) || z < 8 || z > 18 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return json({erro: 'pedido inválido'}, 400);
  const url = `${PC}/api/data/v1/item/tiles/WebMercatorQuad/${z}/${x}/${y}@1x.png?${new URLSearchParams({collection: COLECAO[col], item, expression: NDVI_DE[col], asset_as_band: 'true', rescale: '0.1,0.9', colormap_name: 'rdylgn'})}`;
  const r = await pedir(url, {}, 30000);
  if (!r.ok) return new Response(null, {status: r.status === 404 ? 404 : 502, headers: CORS});
  return new Response(await r.arrayBuffer(), {headers: {...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800'}});
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: CORS});
  const q = new URL(req.url).searchParams;
  if ((req.headers.get('apikey') || q.get('apikey')) !== CHAVE_APP) return json({erro: 'não autorizado'}, 401);
  try {
    if (q.get('acao') === 'tile' && req.method === 'GET') return await mosaico(q);
    if (q.get('acao') === 'desenhar' && req.method === 'GET') return await desenhar(q);
    if (q.get('acao') === 'ndvi' && req.method === 'POST') {
      const ts = lerTalhoes(await req.json().catch(() => null));
      if (!ts.length) return json({erro: 'envie os talhões com o contorno'}, 400);
      return json(await ndvi(ts), 200, {'Cache-Control': 'private, max-age=3600'});
    }
    return json({erro: 'ação desconhecida'}, 400);
  } catch (e) {
    return json({erro: String((e as Error).message || e)}, 502);
  }
});
