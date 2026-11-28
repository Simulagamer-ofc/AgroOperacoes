// MercaPlant — importa as bases oficiais do MAPA (Portal de Dados Abertos, sem chave) para o Edy:
//   agrofit  produtos formulados registrados (~400 MB): cultura × alvo × ingrediente ativo × classe × modo de ação
//   zarc     tábua de risco da safra atual (~260 MB): janelas de plantio dos municípios das UFs em ZARC_UFS (padrão RS)
// Os arquivos são grandes: cada chamada lê um pedaço (Range de 6 MB, aos poucos) e guarda; o pg_cron chama a cada minuto.
// Nova versão a cada 7 dias (Agrofit) ou 15 dias (ZARC); a versão antiga só sai quando a nova termina.
// Publicar com verify_jwt = false: a função confere a chave do agendador (tabela dados_oficiais_chave).
import {createClient, type SupabaseClient} from 'npm:@supabase/supabase-js@2';
import {campos, colunas, linhaAgrofit, linhasDoFluxo, linhaZarc} from './nucleo.ts';

const CKAN = 'https://dados.agricultura.gov.br/api/3/action/package_show?id=';
// A função do servidor tem pouca memória e pouco tempo de processamento: pedaços de 6 MB, lidos aos poucos
const PEDACO = 6 * 1024 * 1024, SOBRA = 256 * 1024;
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), {status, headers: {'Content-Type': 'application/json'}});

function chaveSecreta() {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default; if (k) return k; } catch { /* chave antiga */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const safraAtual = (d = new Date()) => { const a = d.getUTCFullYear(), m = d.getUTCMonth() + 1; return m >= 7 ? `${a}/${a + 1}` : `${a - 1}/${a}`; };
const FONTES: Record<string, {pacote: string, recurso: () => RegExp, dias: number}> = {
  agrofit: {pacote: 'sistema-de-agrotoxicos-fitossanitarios-agrofit', recurso: () => /produto formulado/i, dias: 7},
  zarc: {pacote: 'tabua-de-risco-zoneamento-agricola-de-risco-climatico', recurso: () => new RegExp(`safra ${safraAtual().replace('/', '\\/')}`, 'i'), dias: 15},
};

/** Endereço atual do arquivo (o portal troca o endereço quando republica) e o tamanho. */
async function localizar(fonte: string) {
  const f = FONTES[fonte], j = await (await fetch(CKAN + f.pacote)).json();
  const r = (j?.result?.resources || []).find((x: {name?: string}) => f.recurso().test(String(x.name || '')));
  if (!r?.url) throw new Error(`arquivo não encontrado no portal (${fonte})`);
  const h = await fetch(r.url, {headers: {Range: 'bytes=0-0'}}); await h.body?.cancel();
  const total = Number((h.headers.get('content-range') || '').split('/')[1]);
  if (!total) throw new Error(`tamanho desconhecido (${fonte}: ${h.status})`);
  return {url: String(r.url), total};
}

async function sha(txt: string) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(txt)));
  return Array.from(b.slice(0, 12), x => x.toString(16).padStart(2, '0')).join('');
}

/** Lê e guarda um pedaço do arquivo. */
async function pedaco(adm: SupabaseClient, fonte: string, st: Record<string, unknown>) {
  const ini = Number(st.proximo), total = Number(st.total), fim = Math.min(total, ini + PEDACO);
  const de = Math.max(0, ini - 1), ate = Math.min(total - 1, fim + SOBRA);
  const r = await fetch(String(st.url), {headers: {Range: `bytes=${de}-${ate}`}});
  if (r.status !== 206 && !(r.status === 200 && de === 0)) throw Object.assign(new Error(`portal respondeu ${r.status}`), {recomecar: r.status === 404});
  let cab = String(st.colunas || ''), col = cab ? colunas(cab) : null;
  const versao = String(st.versao);
  let guardadas = 0;
  const ufs = new Set((Deno.env.get('ZARC_UFS') || 'RS').split(',').map(x => x.trim().toUpperCase()).filter(Boolean));
  const soma = new Map<string, Record<string, unknown>>(), lista: Record<string, unknown>[] = [];
  for await (const l of linhasDoFluxo(r.body!, de, ini === 0, fim, fim >= total)) {
    if (!col) { cab = l; col = colunas(cab); continue; } // cabeçalho (primeiro pedaço)
    if (fonte === 'agrofit') {
      const a = linhaAgrofit(campos(l), col); if (!a) continue;
      const k = [a.cultura, a.alvo_comum, a.alvo_cientifico, a.ingrediente, a.classe, a.modo_acao].join('|');
      const x = soma.get(k); if (x) { (x.produtos as number)++; x.organico = x.organico || a.organico; } else soma.set(k, {...a, produtos: 1, k});
    } else {
      const z = linhaZarc(campos(l), col, ufs); if (!z) continue;
      lista.push({...z, versao, k: [z.safra, z.geocodigo, z.cultura, z.ciclo, z.solo, z.manejo, z.clima].join('|')});
    }
  }
  const linhas = fonte === 'agrofit' ? [...soma.values()] : lista;
  for (let i = 0; i < linhas.length; i += 1500) {
    const lote = await Promise.all(linhas.slice(i, i + 1500).map(async x => { const {k, ...resto} = x; return {...resto, versao, chave: await sha(String(k))}; }));
    const {error} = fonte === 'agrofit' ? await adm.rpc('agrofit_somar', {p_linhas: lote})
      : await adm.from('zarc').upsert(lote, {onConflict: 'versao,chave', ignoreDuplicates: true});
    if (error) throw new Error(`${fonte}: ${error.message}`);
    guardadas += lote.length;
  }
  const terminou = fim >= total;
  await adm.from('dados_oficiais').update({proximo: fim, linhas: Number(st.linhas || 0) + guardadas, colunas: cab, atualizado: new Date().toISOString(), erro: null,
    ...(terminou ? {atual: versao, concluido: new Date().toISOString()} : {})}).eq('fonte', fonte);
  if (terminou) { // a versão nova está completa: tira a antiga
    const {error} = await adm.from(fonte).delete().neq('versao', versao);
    if (error) console.warn('limpar', fonte, error.message);
  }
  return {fonte, de: ini, ate: fim, total, guardadas, terminou};
}

/** Um passo do agendador: continua uma importação em andamento ou começa a que venceu (uma fonte por vez). */
async function passo(adm: SupabaseClient, forcar = '') {
  const {data: lista} = await adm.from('dados_oficiais').select('*');
  const st = Object.fromEntries((lista || []).map(x => [x.fonte, x]));
  const agora = Date.now();
  for (const fonte of Object.keys(FONTES)) {
    const s = st[fonte];
    if (s?.rodando_ate && new Date(s.rodando_ate).getTime() > agora) return {ocupado: fonte};
    const andamento = s && s.versao && s.versao !== s.atual && Number(s.proximo) < Number(s.total);
    const vencida = !s || !s.concluido || agora - new Date(s.concluido).getTime() > FONTES[fonte].dias * 864e5 || forcar === fonte;
    if (!andamento && !vencida) continue;
    let atual = s;
    if (!andamento) { // começa uma versão nova
      const {url, total} = await localizar(fonte);
      atual = {fonte, url, total, proximo: 0, linhas: 0, versao: new Date().toISOString().slice(0, 16), atual: s?.atual || null, colunas: null, iniciado: new Date().toISOString(), erro: null};
      await adm.from('dados_oficiais').upsert(atual);
    }
    await adm.from('dados_oficiais').update({rodando_ate: new Date(agora + 140000).toISOString()}).eq('fonte', fonte);
    try {
      return await pedaco(adm, fonte, atual);
    } catch (e) {
      const msg = (e as Error).message;
      // o portal republicou o arquivo (endereço novo): recomeça na próxima vez
      await adm.from('dados_oficiais').update({erro: msg.slice(0, 300), ...((e as {recomecar?: boolean}).recomecar ? {versao: null, proximo: 0} : {})}).eq('fonte', fonte);
      throw e;
    } finally {
      await adm.from('dados_oficiais').update({rodando_ate: null}).eq('fonte', fonte);
    }
  }
  return {nada: true};
}

Deno.serve(async req => {
  if (req.method !== 'POST') return resposta(405, {message: 'Use POST.'});
  try {
    const adm = createClient(Deno.env.get('SUPABASE_URL')!, chaveSecreta(), {auth: {persistSession: false, autoRefreshToken: false}});
    const chave = req.headers.get('x-dados-chave') || '';
    const ok = chave.length >= 32 && !!(await adm.from('dados_oficiais_chave').select('token').eq('token', chave).maybeSingle()).data;
    if (!ok) return resposta(403, {message: 'Sem acesso.'});
    const b = await req.json().catch(() => ({}));
    if (b.acao === 'estado') return resposta(200, {fontes: (await adm.from('dados_oficiais').select('fonte,total,proximo,linhas,versao,atual,concluido,erro')).data});
    return resposta(200, await passo(adm, String(b.forcar || '')));
  } catch (e) {
    console.error(e);
    return resposta(500, {message: (e as Error).message});
  }
});
