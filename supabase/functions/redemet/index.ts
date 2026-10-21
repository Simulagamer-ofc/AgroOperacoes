// MercaPlant — ponte para a API REDEMET (DECEA): radar, satélite e STSC (tempestades/descargas).
// A chave fica no Vault do Supabase (nunca no aplicativo). Respostas guardadas em memória por 5 min
// para não sobrecarregar a REDEMET. As imagens (PNG) são carregadas pelo app direto do servidor estático da REDEMET.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CHAVE_APP = 'sb_publishable_BxbOeMIvyAlyTkCMy3sUWg__PpRKnYK'; // chave pública do app (mesma do nuvem.js)
const BASE = 'https://api-redemet.decea.mil.br';
const AREAS = ['al', 'be', 'bv', 'cn', 'cz', 'ga', 'jr', 'mq', 'mo', 'mn', 'mi', 'nt', 'pl', 'pc', 'pv', 'sv', 'sn', 'st', 'sg', 'sf', 'ua', 'sl', 'sr', 'tt', 'tf', 'tm'];
const TIPOS_RADAR = ['maxcappi', '10km', '07km', '05km', '03km'], TIPOS_SAT = ['realcada', 'ir', 'vis'];
const CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS'};
const json = (corpo: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(corpo), {status, headers: {...CORS, 'Content-Type': 'application/json', ...extra}});

let chave: string | null = null;
async function obterChave(): Promise<string> {
  if (chave) return chave;
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data, error} = await sb.rpc('redemet_chave');
  if (error || !data) throw new Error('chave REDEMET não configurada');
  chave = String(data);
  return chave;
}
const cache = new Map<string, {em: number, dados: any}>();
async function redemet(caminho: string, params: URLSearchParams, ttl = 300000) {
  const k = caminho + '?' + params.toString(), c = cache.get(k);
  if (c && Date.now() - c.em < ttl) return c.dados;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`${BASE}${caminho}?${params}`, {headers: {'X-Api-Key': await obterChave()}, signal: ctl.signal});
    if (!r.ok) throw new Error(`REDEMET ${r.status}`);
    const dados = await r.json();
    cache.set(k, {em: Date.now(), dados});
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    return dados;
  } finally { clearTimeout(t); }
}
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

async function radar(tipo: string, areas: string[], anima: number) {
  const quadros: any[] = [], radares: any[] = [];
  await Promise.all(areas.map(async a => {
    try {
      const d = await redemet(`/produtos/radar/${tipo}`, new URLSearchParams({area: a, anima: String(anima)}));
      const lista = (d?.data?.radar || []).flat().filter((x: any) => x && x.localidade === a);
      const info = lista[0];
      if (info) radares.push({area: a, nome: info.nome, lat: num(info.lat_center), lon: num(info.lon_center), raio: num(info.raio)});
      lista.filter((x: any) => x.path).forEach((x: any) => quadros.push({area: a, data: x.data, path: x.path,
        limites: [[num(x.lat_min), num(x.lon_min)], [num(x.lat_max), num(x.lon_max)]]}));
    } catch (e) { radares.push({area: a, erro: String((e as Error).message)}); }
  }));
  quadros.sort((x, y) => String(x.data).localeCompare(String(y.data)));
  return {tipo, radares, quadros};
}
async function satelite(tipo: string, anima: number) {
  const d = await redemet(`/produtos/satelite/${tipo}`, new URLSearchParams({anima: String(anima)}));
  const ll = d?.data?.lat_lon || {};
  return {tipo, limites: [[num(ll.lat_min), num(ll.lon_min)], [num(ll.lat_max), num(ll.lon_max)]],
    quadros: (d?.data?.satelite || []).filter((x: any) => x?.path).map((x: any) => ({data: x.data, path: x.path}))};
}
async function stsc(anima: number, lat: number | null, lon: number | null, graus: number) {
  const d = await redemet('/produtos/stsc', new URLSearchParams({anima: String(anima)}), 120000);
  const tempos: string[] = d?.data?.anima || [], listas: any[] = d?.data?.stsc || [];
  const perto = (p: any) => lat == null || lon == null || (Math.abs(Number(p.la) - lat) <= graus && Math.abs(Number(p.lo) - lon) <= graus);
  return {ultima: d?.data?.info?.ultima_ocorrencia || null, quadros: listas.map((l: any[], i: number) => ({hora: tempos[i] || null,
    pontos: (l || []).filter(perto).map((p: any) => [Number(p.la), Number(p.lo)])}))};
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: CORS});
  const u = new URL(req.url), q = u.searchParams;
  if ((req.headers.get('apikey') || q.get('apikey')) !== CHAVE_APP) return json({erro: 'não autorizado'}, 401);
  const produto = q.get('produto') || '', anima = Math.max(1, Math.min(produto === 'stsc' ? 60 : 15, Number(q.get('anima')) || 1));
  try {
    if (produto === 'radar') {
      const tipo = TIPOS_RADAR.includes(q.get('tipo') || '') ? q.get('tipo')! : 'maxcappi';
      const areas = (q.get('areas') || 'sg,cn,mi').split(',').filter(a => AREAS.includes(a)).slice(0, 6);
      return json(await radar(tipo, areas, anima), 200, {'Cache-Control': 'public, max-age=300'});
    }
    if (produto === 'satelite') {
      const tipo = TIPOS_SAT.includes(q.get('tipo') || '') ? q.get('tipo')! : 'realcada';
      return json(await satelite(tipo, anima), 200, {'Cache-Control': 'public, max-age=300'});
    }
    if (produto === 'stsc') return json(await stsc(anima, num(q.get('lat')), num(q.get('lon')), Math.min(15, num(q.get('graus')) ?? 6)), 200, {'Cache-Control': 'public, max-age=120'});
    if (produto === 'dims') {
      // Tamanho de uma imagem da REDEMET (cabeçalho do PNG): para conferir a projeção do georreferenciamento
      const url = q.get('url') || '';
      if (!url.startsWith('https://estatico-redemet.decea.mil.br/')) return json({erro: 'url inválida'}, 400);
      const r = await fetch(url, {headers: {Range: 'bytes=0-63'}}), b = new Uint8Array(await r.arrayBuffer()), dv = new DataView(b.buffer);
      return json({status: r.status, largura: dv.getUint32(16), altura: dv.getUint32(20), tipo: String.fromCharCode(...b.slice(12, 16))});
    }
    if (produto === 'diag') {
      // Situação de todos os radares (última imagem de cada tipo): para conferir quais estão no ar
      const tipos = (q.get('tipos') || 'maxcappi,07km').split(',').filter(t => TIPOS_RADAR.includes(t));
      const out: any[] = [];
      for (const t of tipos) { const r = await radar(t, AREAS, 1); r.radares.forEach((x: any) => out.push({tipo: t, ...x, imagem: r.quadros.find((y: any) => y.area === x.area)?.path || null})); }
      return json({radares: out});
    }
    return json({erro: 'produto inválido: radar, satelite, stsc ou diag'}, 400);
  } catch (e) {
    return json({erro: String((e as Error).message)}, 502);
  }
});
