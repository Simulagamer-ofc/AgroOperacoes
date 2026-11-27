// MercaPlant — IA do sistema (Gemini, do Google).
// Ações (POST, com o login do usuário e a fazenda):
//   status    a IA está ligada no servidor? (não gasta)
//   boletim   lê a foto ou o PDF do boletim de análise de sementes e devolve os campos para o formulário do app
//             {farm_id, acao, especie, cientifico, grupos:[{id, rot}], arquivo:{tipo, dados(base64)}}
//   perguntar Edy, o assistente: responde a pergunta com os dados da fazenda que o app manda (o app só manda o que a pessoa vê)
//             {farm_id, acao, pergunta, historico:[{de:'pessoa'|'ia', texto}], contexto(JSON em texto), modo?:'tecnica'}
//             → {resposta, acoes:[registros prontos para a pessoa conferir], fontes:[{titulo, url}]}
//             modo 'tecnica': agrônomo com busca no Google (Embrapa, MAPA/ZARC, CQFS-RS/SC…) e as fontes da resposta
// A chave fica só aqui (segredo GEMINI_API_KEY); o app nunca vê. Modelo: GEMINI_MODELO (padrão gemini-3.1-flash-lite);
// GEMINI_MODELO_CHAT troca o modelo só da conversa; GEMINI_MODELO_TECNICA, o do modo técnico (padrão gemini-3.5-flash-lite, que faz a busca).
// Limite por pessoa por dia (IA_LIMITE_DIA, padrão 50), contado na tabela ia_uso (só o servidor acessa).
// A IA só sugere: o app mostra o que leu para a pessoa conferir antes de salvar.
// Publicar com verify_jwt = false: a própria função confere o login (getUser + farm_role) e o teste (ia_teste).
import {createClient} from 'npm:@supabase/supabase-js@2';
import {acoesQuebradas, conversa, erroGemini, esquemaBoletim, esquemaChat, fontesDaResposta, type Grupo, instrucaoAssistente, instrucaoTecnica, lerChat, MAX_BASE64, MAX_CONTEXTO, MAX_PERGUNTA, normalizarBoletim, promptBoletim, textoDaResposta, TIPOS_ARQUIVO, type Turno} from './nucleo.ts';

const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-ia-teste', 'Access-Control-Allow-Methods': 'POST, OPTIONS'};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), {status, headers: {...cors, 'Content-Type': 'application/json'}});
const erro = (status: number, message: string) => resposta(status, {message});
const CHAVE_APP = 'sb_publishable_BxbOeMIvyAlyTkCMy3sUWg__PpRKnYK'; // chave pública do app (mesma do nuvem.js)
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

function chaveSecreta() {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default; if (k) return k; } catch { /* chave antiga */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const MODELO_PADRAO = 'gemini-3.1-flash-lite'; // leu o boletim de teste igual ao 3.5 Flash, por ~1/25 do custo
const MODELO_TECNICA = 'gemini-3.5-flash-lite'; // o 3.1 Flash-Lite não faz a busca no Google; o 3.5 Flash-Lite faz e cita as fontes
async function gemini(partes: unknown[], esquema: unknown, outroModelo = '') {
  const r = await chamarGemini({contents: [{role: 'user', parts: partes}], generationConfig: {temperature: 0, responseMimeType: 'application/json', responseSchema: esquema}}, outroModelo);
  return {...r, dados: JSON.parse(r.texto) as Record<string, unknown>};
}
async function chamarGemini(pedido: unknown, outroModelo = '', espera = 90000) {
  const chave = (Deno.env.get('GEMINI_API_KEY') || '').trim(), modelo = (outroModelo || Deno.env.get('GEMINI_MODELO') || MODELO_PADRAO).trim();
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), espera);
  try {
    const r = await fetch(`${GEMINI}/${encodeURIComponent(modelo)}:generateContent`, {method: 'POST', signal: ctl.signal,
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': chave},
      body: JSON.stringify(pedido)});
    const corpo = await r.text();
    if (!r.ok) { console.warn('gemini', r.status, corpo.slice(0, 400)); throw Object.assign(new Error(erroGemini(r.status, corpo).msg), {status: erroGemini(r.status, corpo).status}); }
    const j = JSON.parse(corpo), uso = j.usageMetadata || {};
    const texto = textoDaResposta(j);
    if (!texto) throw Object.assign(new Error('A IA não devolveu resposta. Tente de novo (ou uma foto mais nítida).'), {status: 502});
    const gm = j.candidates?.[0]?.groundingMetadata; // só para o teste do servidor: a busca aconteceu?
    const busca = gm ? {consultas: gm.webSearchQueries || [], pedacos: (gm.groundingChunks || []).length, chaves: Object.keys(gm)} : null;
    return {texto, fontes: fontesDaResposta(j), busca, entrada: Number(uso.promptTokenCount) || 0, saida: (Number(uso.candidatesTokenCount) || 0) + (Number(uso.thoughtsTokenCount) || 0), modelo};
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw Object.assign(new Error('A IA demorou demais para responder. Tente de novo.'), {status: 504});
    throw e;
  } finally { clearTimeout(t); }
}

const hojeBR = () => new Date().toLocaleDateString('pt-BR', {timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'});
const hojeIso = () => new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
async function perguntar(b: Record<string, unknown>, outroModelo = '') {
  const pergunta = String(b.pergunta || '').trim(), contexto = String(b.contexto || '{}'), tecnica = b.modo === 'tecnica';
  if (!pergunta) throw Object.assign(new Error('Escreva a pergunta.'), {status: 400});
  if (pergunta.length > MAX_PERGUNTA) throw Object.assign(new Error(`Pergunta longa demais (até ${MAX_PERGUNTA} letras).`), {status: 400});
  if (contexto.length > MAX_CONTEXTO * 1.2) throw Object.assign(new Error('Dados da fazenda grandes demais para a IA.'), {status: 400});
  const modelo = outroModelo || (Deno.env.get('GEMINI_MODELO_CHAT') || '').trim(), contents = conversa(b.historico as Turno[], pergunta, contexto);
  if (tecnica) {
    // Agrônomo com fontes: busca no Google (a busca não combina com resposta em JSON: volta texto + fontes)
    const r = await chamarGemini({systemInstruction: {parts: [{text: instrucaoTecnica(hojeBR())}]}, contents, tools: [{google_search: {}}],
      generationConfig: {temperature: 0.2, maxOutputTokens: 3072}}, outroModelo || (Deno.env.get('GEMINI_MODELO_TECNICA') || '').trim() || MODELO_TECNICA, 120000);
    return {...r, resposta: r.texto, acoes: []};
  }
  const pedido = (temperature: number) => ({systemInstruction: {parts: [{text: instrucaoAssistente(hojeBR())}]}, contents,
    generationConfig: {temperature, maxOutputTokens: 2048, responseMimeType: 'application/json', responseSchema: esquemaChat()}});
  let r = await chamarGemini(pedido(0.2), modelo);
  if (acoesQuebradas(r.texto)) { // registro quebrado: pede de novo uma vez
    const r2 = await chamarGemini(pedido(0), modelo).catch(() => null);
    if (r2) r = {...r2, entrada: r.entrada + r2.entrada, saida: r.saida + r2.saida};
  }
  return {...r, ...lerChat(r.texto, hojeIso()), fontes: []};
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return erro(405, 'Use POST.');
  try {
    const b = await req.json().catch(() => ({}));
    const ligada = !!(Deno.env.get('GEMINI_API_KEY') || '').trim();
    // Teste do servidor (sem usuário): código de teste temporário na tabela ia_teste (só o servidor lê; vence sozinho)
    const codTeste = req.headers.get('x-ia-teste') || '';
    const modoTeste = codTeste.length >= 32 && !!(await createClient(Deno.env.get('SUPABASE_URL')!, chaveSecreta(), {auth: {persistSession: false, autoRefreshToken: false}})
      .from('ia_teste').select('token').eq('token', codTeste).gt('expira', new Date().toISOString()).maybeSingle()).data;
    if (codTeste && !modoTeste) return erro(403, 'Código de teste inválido ou vencido.');
    if (modoTeste && !ligada) return erro(503, 'A IA ainda não foi ligada no servidor (falta a GEMINI_API_KEY).');
    if (modoTeste && b.acao === 'boletim') {
      // No teste, o arquivo pode vir por endereço do repositório do MercaPlant (boletim fictício de referencias/ia)
      let dadosTeste = String(b.arquivo?.dados || '');
      const urlTeste = String(b.arquivo?.url || '');
      if (!dadosTeste && /^https:\/\/raw\.githubusercontent\.com\/Simulagamer-ofc\/AgroOperacoes\//.test(urlTeste)) {
        const bytes = new Uint8Array(await (await fetch(urlTeste)).arrayBuffer());
        let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        dadosTeste = btoa(bin);
      }
      const r = await gemini([{inline_data: {mime_type: String(b.arquivo?.tipo || 'image/jpeg'), data: dadosTeste}}, {text: promptBoletim(String(b.especie || ''), String(b.cientifico || ''), b.grupos || [])}], esquemaBoletim(b.grupos || []), /^gemini-[\w.-]+$/.test(String(b.modelo || '')) ? String(b.modelo) : '');
      return resposta(200, {ok: true, teste: true, modelo: r.modelo, entrada: r.entrada, saida: r.saida, dados: normalizarBoletim(r.dados, b.grupos || [])});
    }
    if (modoTeste && b.acao === 'perguntar') {
      const r = await perguntar(b, /^gemini-[\w.-]+$/.test(String(b.modelo || '')) ? String(b.modelo) : '');
      return resposta(200, {ok: true, teste: true, modelo: r.modelo, entrada: r.entrada, saida: r.saida, resposta: r.resposta, acoes: r.acoes, fontes: r.fontes, busca: r.busca, bruto: r.texto.slice(0, 1500)});
    }
    const fazenda = String(b.farm_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(fazenda)) return erro(400, 'Fazenda inválida.');
    const auth = req.headers.get('Authorization') || '';
    const eu = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') || CHAVE_APP, {global: {headers: {Authorization: auth}}, auth: {persistSession: false}});
    const [{data: papel}, {data: quem}] = await Promise.all([eu.rpc('farm_role', {p_farm: fazenda}), eu.auth.getUser()]);
    if (!papel || !quem?.user?.id) return erro(403, 'Sem acesso a esta fazenda.');
    if (b.acao === 'status') return resposta(200, {ligada, modelo: (Deno.env.get('GEMINI_MODELO') || MODELO_PADRAO).trim()});
    if (!ligada) return erro(503, 'A IA ainda não foi ligada no servidor (falta a GEMINI_API_KEY).');

    if (b.acao === 'boletim') {
      const tipo = String(b.arquivo?.tipo || ''), dados = String(b.arquivo?.dados || '');
      if (!TIPOS_ARQUIVO.includes(tipo)) return erro(400, 'Envie uma foto (JPG, PNG) ou o PDF do boletim.');
      if (!dados || dados.length > MAX_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(dados.slice(0, 200))) return erro(400, 'Arquivo grande demais ou inválido (até 5 MB).');
      const grupos: Grupo[] = (Array.isArray(b.grupos) ? b.grupos : []).map((g: Grupo) => ({id: String(g?.id || '').slice(0, 30), rot: String(g?.rot || '').slice(0, 80)})).filter((g: Grupo) => g.id).slice(0, 40);
      // Limite do dia (conta antes de chamar, para não passar do limite com pedidos ao mesmo tempo)
      const adm = createClient(Deno.env.get('SUPABASE_URL')!, chaveSecreta(), {auth: {persistSession: false, autoRefreshToken: false}});
      const limite = Number(Deno.env.get('IA_LIMITE_DIA')) || 50;
      const {data: usados, error: eUso} = await adm.rpc('ia_contar', {p_user: quem.user.id, p_farm: fazenda, p_limite: limite});
      if (eUso) { console.warn('ia_contar', eUso.message); return erro(500, 'Não foi possível conferir o limite de uso da IA.'); }
      if (Number(usados) < 0) return erro(429, `Você chegou ao limite de ${limite} leituras com IA hoje. Amanhã libera de novo.`);
      const r = await gemini([{inline_data: {mime_type: tipo, data: dados}}, {text: promptBoletim(String(b.especie || '').slice(0, 80), String(b.cientifico || '').slice(0, 80), grupos)}], esquemaBoletim(grupos));
      await adm.rpc('ia_tokens', {p_user: quem.user.id, p_entrada: r.entrada, p_saida: r.saida}).then(() => {}, () => {});
      return resposta(200, {ok: true, modelo: r.modelo, dados: normalizarBoletim(r.dados, grupos), usados: Number(usados), limite});
    }
    if (b.acao === 'perguntar') {
      const adm = createClient(Deno.env.get('SUPABASE_URL')!, chaveSecreta(), {auth: {persistSession: false, autoRefreshToken: false}});
      const limite = Number(Deno.env.get('IA_LIMITE_DIA')) || 50;
      const {data: usados, error: eUso} = await adm.rpc('ia_contar', {p_user: quem.user.id, p_farm: fazenda, p_limite: limite});
      if (eUso) { console.warn('ia_contar', eUso.message); return erro(500, 'Não foi possível conferir o limite de uso da IA.'); }
      if (Number(usados) < 0) return erro(429, `Você chegou ao limite de ${limite} usos da IA hoje. Amanhã libera de novo.`);
      const r = await perguntar(b);
      await adm.rpc('ia_tokens', {p_user: quem.user.id, p_entrada: r.entrada, p_saida: r.saida}).then(() => {}, () => {});
      return resposta(200, {ok: true, modelo: r.modelo, resposta: r.resposta, acoes: r.acoes, fontes: r.fontes, usados: Number(usados), limite});
    }
    return erro(400, 'Ação desconhecida.');
  } catch (e) {
    const st = (e as {status?: number}).status;
    if (!st) console.error(e);
    return erro(st || 500, st ? (e as Error).message : 'Erro na IA. Tente de novo.');
  }
});
