// MercaPlant — vigor da lavoura por satélite (NDVI).
// acao=ndvi (POST {talhoes:[{id, pontos:[[lat,lon],...]}]}): imagem mais recente com poucas nuvens e o NDVI médio de cada talhão.
// acao=tile (GET item, z, x, y): mosaico colorido do NDVI para o mapa do app.
// Imagens Sentinel-2 L2A do catálogo aberto do Planetary Computer; não precisa de chave. Só a chave pública do app entra.
import {caixa, escolherImagem, ITEM_OK, lerItens, lerTalhoes, NDVI, poligono, type Talhao} from './nucleo.ts';

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

async function ndvi(ts: Talhao[]) {
  const area = caixa(ts), chave = JSON.stringify(ts.map(t => [t.id, t.pontos.length, t.pontos[0]]));
  const c = cache.get(chave); if (c && Date.now() - c.em < VALIDADE) return c.r;
  // Últimos 90 dias: a imagem mais recente com até 20% de nuvens (se não houver, até 35%)
  const ate = new Date(), desde = new Date(ate.getTime() - 90 * 86400000);
  const busca = await pedir(`${PC}/api/stac/v1/search`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
    collections: ['sentinel-2-l2a'], bbox: area, datetime: `${desde.toISOString()}/${ate.toISOString()}`,
    query: {'eo:cloud_cover': {lt: 35}}, sortby: [{field: 'datetime', direction: 'desc'}], limit: 40})});
  if (!busca.ok) throw new Error(`busca ${busca.status}`);
  const itens = lerItens(await busca.json()), item = escolherImagem(itens, area, 20) || escolherImagem(itens, area, 35);
  if (!item) { const r = {data: null, item: null, talhoes: []}; cache.set(chave, {em: Date.now(), r}); return r; }
  const url = `${PC}/api/data/v1/item/statistics?${new URLSearchParams({collection: 'sentinel-2-l2a', item: item.id, expression: NDVI, asset_as_band: 'true'})}`;
  const talhoes: {id: string, ndvi: number | null, desvio: number | null, pixels: number}[] = [];
  for (let k = 0; k < ts.length; k += 4) {
    await Promise.all(ts.slice(k, k + 4).map(async t => {
      try {
        const r = await pedir(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({type: 'Feature', properties: {}, geometry: poligono(t)})}, 40000);
        if (!r.ok) throw new Error(String(r.status));
        const st = Object.values((await r.json())?.properties?.statistics || {})[0] as {mean?: number, std?: number, count?: number} | undefined;
        const ok = st && Number.isFinite(st.mean) && (st.count || 0) > 0;
        talhoes.push({id: t.id, ndvi: ok ? Math.round(st!.mean! * 1000) / 1000 : null, desvio: ok && Number.isFinite(st!.std) ? Math.round(st!.std! * 1000) / 1000 : null, pixels: st?.count || 0});
      } catch { talhoes.push({id: t.id, ndvi: null, desvio: null, pixels: 0}); }
    }));
  }
  const r = {data: item.data, item: item.id, nuvens: Math.round(item.nuvens), talhoes};
  cache.set(chave, {em: Date.now(), r});
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return r;
}

async function mosaico(q: URLSearchParams) {
  const item = q.get('item') || '', z = Number(q.get('z')), x = Number(q.get('x')), y = Number(q.get('y'));
  if (!ITEM_OK.test(item) || ![z, x, y].every(Number.isInteger) || z < 8 || z > 18 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return json({erro: 'pedido inválido'}, 400);
  const url = `${PC}/api/data/v1/item/tiles/WebMercatorQuad/${z}/${x}/${y}@1x.png?${new URLSearchParams({collection: 'sentinel-2-l2a', item, expression: NDVI, asset_as_band: 'true', rescale: '0.1,0.9', colormap_name: 'rdylgn'})}`;
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
