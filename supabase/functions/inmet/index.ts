// MercaPlant — ponte para os avisos meteorológicos do INMET (Alert-AS).
// Busca a lista de avisos ativos (RSS) e o CAP de cada um (com o desenho da área), guarda em memória
// e devolve só os avisos que pegam o ponto da fazenda. Não precisa de chave do INMET.
import {type Aviso, avisosDoPonto, lerCap, lerRss} from './nucleo.ts';

const CHAVE_APP = 'sb_publishable_BxbOeMIvyAlyTkCMy3sUWg__PpRKnYK'; // chave pública do app (mesma do nuvem.js)
const RSS = 'https://apiprevmet3.inmet.gov.br/avisos/rss';
const CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS'};
const json = (corpo: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(corpo), {status, headers: {...CORS, 'Content-Type': 'application/json', ...extra}});

async function baixar(url: string, ms = 15000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, {signal: ctl.signal, headers: {'User-Agent': 'MercaPlant/1 (avisos para fazendas)'}});
    if (!r.ok) throw new Error(`INMET ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

let lista: {em: number, avisos: Aviso[]} | null = null;
const caps = new Map<string, Aviso | null>(); // o CAP de um aviso não muda: guarda pelo número
let buscando: Promise<Aviso[]> | null = null;

async function atualizar(): Promise<Aviso[]> {
  const itens = lerRss(await baixar(RSS));
  const faltam = itens.filter(i => !caps.has(i.id));
  for (let k = 0; k < faltam.length; k += 8) { // até 8 de cada vez
    await Promise.all(faltam.slice(k, k + 8).map(async i => {
      try { caps.set(i.id, lerCap(await baixar(i.link.startsWith('https://apiprevmet3.inmet.gov.br/') ? i.link : `${RSS}/${i.id}`), i.id, i.link)); } catch { /* tenta de novo na próxima */ }
    }));
  }
  const ids = new Set(itens.map(i => i.id));
  for (const id of [...caps.keys()]) if (!ids.has(id)) caps.delete(id);
  const avisos = itens.map(i => caps.get(i.id)).filter((a): a is Aviso => !!a);
  lista = {em: Date.now(), avisos};
  return avisos;
}
async function avisosAtivos(): Promise<{avisos: Aviso[], em: number, velho: boolean}> {
  if (lista && Date.now() - lista.em < 5 * 60000) return {...lista, velho: false};
  try { buscando ??= atualizar().finally(() => { buscando = null; }); await buscando; return {...lista!, velho: false}; }
  catch (e) { if (lista) return {...lista, velho: true}; throw e; }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: CORS});
  const q = new URL(req.url).searchParams;
  if ((req.headers.get('apikey') || q.get('apikey')) !== CHAVE_APP) return json({erro: 'não autorizado'}, 401);
  const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({erro: 'informe lat e lon'}, 400);
  try {
    const {avisos, em, velho} = await avisosAtivos();
    return json({fonte: 'INMET', atualizado: new Date(em).toISOString(), velho, total: avisos.length, avisos: avisosDoPonto(avisos, lat, lon)},
      200, {'Cache-Control': 'public, max-age=300'});
  } catch (e) {
    return json({erro: String((e as Error).message || e)}, 502);
  }
});
