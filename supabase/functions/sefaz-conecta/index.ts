// MercaPlant — Notas da SEFAZ com certificado A3 (token USB ou cartão): conversa com o MercaPlant Conecta.
// O Conecta roda no computador da fazenda onde o token/cartão está. Ele só faz o que exige a chave do aparelho:
//   1) conectar na SEFAZ com o certificado (TLS) e enviar a mensagem que o servidor preparou
//   2) assinar o SignedInfo da Ciência da Operação (RSA-SHA1)
// O resto (montar mensagens, ler respostas, gravar notas, regras de uso da SEFAZ) é o mesmo código do A1.
//
// Ações (POST, JSON). Sem login de usuário: publicar com verify_jwt = false.
//   ligar        {codigo, computador, versao}       troca o código de ligação (gerado pelo ADM) pela chave do computador
//   (as demais exigem o cabeçalho x-conecta-token com essa chave)
//   certificado  {cert}                             certificado escolhido no Windows (só a parte pública, DER base64)
//   tarefa       {}                                 o que fazer agora: enviar | assinar | certificado | aguardar | desligado
//   resposta     {servico, status, corpo}           resposta da SEFAZ ao que foi enviado → processa e devolve a próxima tarefa
//   assinado     {lote, assinaturas, cert}          assinaturas do lote de ciência → devolve a mensagem para enviar
//   erro         {mensagem}                         problema no computador (token sem PIN, sem internet…) para mostrar no app
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { lerCertificadoPublico, soapDist, soapEvento, prepararCiencia, montarEnvEvento, faultSoap, type ItemCiencia } from '../sefaz/nucleo.ts';
import { processarDist, pendentesCiencia, processarEvento, contagemVazia, podeConsultar, sha256, type Config } from '../sefaz/processar.ts';

const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-conecta-token', 'Access-Control-Allow-Methods': 'POST, OPTIONS'};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), {status, headers: {...cors, 'Content-Type': 'application/json'}});
const erro = (status: number, message: string) => resposta(status, {message});
const INTERVALO_CIENCIA_MS = 30 * 60_000; // não insiste na ciência mais que a cada 30 min (evita repetir lote com erro)
const ESPERA_MAX_S = 900;                 // o Conecta volta a perguntar em no máximo 15 min (pega mudanças do ADM)

function chaveSecreta() {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default; if (k) return k; } catch { /* chave antiga */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

type Ligacao = {farm_id: string; ult_ciencia_em: string | null};

/** Próxima tarefa do Conecta para esta fazenda. */
async function proxima(adm: SupabaseClient, lig: Ligacao) {
  const {data: cfg} = await adm.from('sefaz_config').select('*').eq('farm_id', lig.farm_id).maybeSingle();
  if (!cfg || cfg.modo !== 'a3') return {tipo: 'desligado', mensagem: 'A fazenda não está mais configurada para certificado A3.'};
  if (!cfg.doc) return {tipo: 'certificado', mensagem: 'Escolha o certificado A3 (token ou cartão) no MercaPlant Conecta.'};
  if (cfg.validade && new Date(cfg.validade) < new Date()) return {tipo: 'certificado', mensagem: `O certificado venceu em ${new Date(cfg.validade).toLocaleDateString('pt-BR')}. Escolha o certificado renovado.`};
  const amb = Number(cfg.ambiente) || 1;
  if (podeConsultar(cfg)) {
    return {tipo: 'enviar', servico: 'dist', ambiente: amb, soap: soapDist({tpAmb: amb, cUF: cfg.uf, doc: cfg.doc, tipoDoc: cfg.tipo_doc, ultNSU: cfg.ult_nsu || '0'})};
  }
  const recente = lig.ult_ciencia_em && Date.now() - new Date(lig.ult_ciencia_em).getTime() < INTERVALO_CIENCIA_MS;
  if (!recente) {
    const pend = await pendentesCiencia(adm, lig.farm_id);
    if (pend.length) return {tipo: 'assinar', ambiente: amb, lote: {itens: prepararCiencia(pend, cfg.doc, cfg.tipo_doc, amb)}};
  }
  const falta = cfg.prox_consulta ? Math.ceil((new Date(cfg.prox_consulta).getTime() - Date.now()) / 1000) : ESPERA_MAX_S;
  return {tipo: 'aguardar', ate: cfg.prox_consulta, segundos: Math.max(60, Math.min(ESPERA_MAX_S, falta))};
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return erro(405, 'Use POST.');
  try {
    const b = await req.json().catch(() => ({}));
    const adm = createClient(Deno.env.get('SUPABASE_URL')!, chaveSecreta(), {auth: {persistSession: false, autoRefreshToken: false}});
    const agora = new Date().toISOString();
    const computador = String(b.computador || '').slice(0, 80), versao = String(b.versao || '').slice(0, 20);

    // ---------- Ligar: código de ligação → chave do computador ----------
    if (b.acao === 'ligar') {
      const codigo = String(b.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (codigo.length !== 8) return erro(400, 'Código inválido. Ele tem 8 letras e números, como ABCD-2345.');
      const {data: l} = await adm.from('sefaz_conecta').select('farm_id, codigo_expira').eq('codigo_hash', await sha256(codigo)).maybeSingle();
      if (!l || !l.codigo_expira || new Date(l.codigo_expira) < new Date()) return erro(400, 'Código inválido ou vencido. Gere um novo no MercaPlant (Notas da SEFAZ → Certificado A3).');
      const token = 'mpc_' + b64url(crypto.getRandomValues(new Uint8Array(32)));
      await adm.from('sefaz_conecta').update({token_hash: await sha256(token), codigo_hash: null, codigo_expira: null, ligado_em: agora, visto_em: agora, computador, versao, ult_erro: null, ult_erro_em: null, atualizado_em: agora}).eq('farm_id', l.farm_id);
      const {data: f} = await adm.from('farms').select('name').eq('id', l.farm_id).maybeSingle();
      return resposta(200, {token, farm_id: l.farm_id, fazenda: f?.name || ''});
    }

    // ---------- Demais ações: chave do computador ----------
    const token = req.headers.get('x-conecta-token') || '';
    if (!/^mpc_[A-Za-z0-9_-]{40,}$/.test(token)) return erro(401, 'Este computador não está ligado. Use o código de ligação.');
    const {data: lig} = await adm.from('sefaz_conecta').select('farm_id, ult_ciencia_em').eq('token_hash', await sha256(token)).maybeSingle();
    if (!lig) return erro(401, 'Este computador foi desligado no MercaPlant. Ligue de novo com um código novo.');
    const fazenda = lig.farm_id as string;
    await adm.from('sefaz_conecta').update({visto_em: agora, ...(computador ? {computador} : {}), ...(versao ? {versao} : {})}).eq('farm_id', fazenda);

    if (b.acao === 'tarefa') return resposta(200, await proxima(adm, lig));

    if (b.acao === 'erro') {
      await adm.from('sefaz_conecta').update({ult_erro: String(b.mensagem || 'Erro sem descrição').slice(0, 300), ult_erro_em: agora}).eq('farm_id', fazenda);
      return resposta(200, {ok: true});
    }

    if (b.acao === 'certificado') {
      let c;
      try { c = lerCertificadoPublico(String(b.cert || '')); } catch (e) { return erro(400, (e as Error).message); }
      if (new Date(c.validade) < new Date()) return erro(400, `Este certificado venceu em ${new Date(c.validade).toLocaleDateString('pt-BR')}. Escolha o certificado renovado.`);
      const {data: ant} = await adm.from('sefaz_config').select('doc, modo').eq('farm_id', fazenda).maybeSingle();
      if (ant?.modo !== 'a3') return erro(400, 'A fazenda não está configurada para certificado A3.');
      const novoDoc = ant.doc !== c.doc;
      await adm.from('sefaz_config').update({doc: c.doc, tipo_doc: c.tipoDoc, nome: c.nome, validade: c.validade,
        ...(novoDoc ? {ult_nsu: '0', max_nsu: null, prox_consulta: null, ult_cstat: null, ult_motivo: null} : {}), atualizado_por: `MercaPlant Conecta (${computador || 'computador'})`, atualizado_em: agora}).eq('farm_id', fazenda);
      await adm.from('sefaz_conecta').update({ult_erro: null, ult_erro_em: null}).eq('farm_id', fazenda);
      return resposta(200, {titular: c.nome, doc: c.doc, tipo: c.tipoDoc, validade: c.validade, proxima: await proxima(adm, lig)});
    }

    if (b.acao === 'assinado') {
      const itens = (b.lote?.itens || []) as ItemCiencia[];
      if (!Array.isArray(itens) || !itens.length || itens.length > 20 || itens.some(it => !/^ID210210\d{44}01$/.test(String(it?.id)) || typeof it.corpo !== 'string' || typeof it.signedInfo !== 'string'))
        return erro(400, 'Lote de ciência inválido.');
      const {data: cfg} = await adm.from('sefaz_config').select('doc, ambiente').eq('farm_id', fazenda).maybeSingle();
      if (!cfg?.doc || itens.some(it => !it.corpo.includes(`>${cfg.doc}<`))) return erro(400, 'O lote não é desta fazenda.');
      let env;
      try { env = montarEnvEvento(itens, (b.assinaturas || []).map(String), String(b.cert || '')); } catch (e) { return erro(400, (e as Error).message); }
      return resposta(200, {tipo: 'enviar', servico: 'evento', ambiente: Number(cfg.ambiente) || 1, soap: soapEvento(env)});
    }

    if (b.acao === 'resposta') {
      const servico = b.servico === 'evento' ? 'evento' : 'dist', st = Number(b.status), corpo = String(b.corpo || '');
      const res = contagemVazia();
      if (st !== 200) {
        const msg = st === 403 ? 'A SEFAZ recusou o certificado (acesso negado). Confira se é o certificado ICP-Brasil válido do CNPJ/CPF da fazenda.'
          : faultSoap(corpo) || `A SEFAZ respondeu com erro ${st || 'de conexão'}.`;
        await adm.from('sefaz_conecta').update({ult_erro: msg.slice(0, 300), ult_erro_em: agora, ...(servico === 'evento' ? {ult_ciencia_em: agora} : {})}).eq('farm_id', fazenda);
        if (servico === 'dist') { // erro na consulta: espera 1 hora, como no A1
          await adm.from('sefaz_config').update({ult_consulta: agora, ult_cstat: String(st || ''), ult_motivo: msg.slice(0, 200), prox_consulta: new Date(Date.now() + 61 * 60_000).toISOString()}).eq('farm_id', fazenda);
        }
        return resposta(200, {...res, erro: msg, proxima: await proxima(adm, {...lig, ult_ciencia_em: servico === 'evento' ? agora : lig.ult_ciencia_em})});
      }
      if (servico === 'dist') {
        const {data: cfg} = await adm.from('sefaz_config').select('*').eq('farm_id', fazenda).maybeSingle();
        if (!cfg) return erro(400, 'Configuração não encontrada.');
        await processarDist(adm, fazenda, cfg as Config, corpo, res);
      } else {
        await processarEvento(adm, fazenda, corpo, res);
        await adm.from('sefaz_conecta').update({ult_ciencia_em: agora}).eq('farm_id', fazenda);
        lig.ult_ciencia_em = agora;
      }
      await adm.from('sefaz_conecta').update({ult_erro: null, ult_erro_em: null}).eq('farm_id', fazenda);
      return resposta(200, {...res, proxima: await proxima(adm, lig)});
    }
    return erro(400, 'Ação inválida.');
  } catch (e) {
    console.error('sefaz-conecta', (e as Error).message);
    return erro(500, (e as Error).message || 'Erro inesperado.');
  }
});
