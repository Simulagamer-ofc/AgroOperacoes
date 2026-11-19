// MercaPlant — Notas da SEFAZ.
// Ações (POST, com o login do usuário):
//   certificado  (ADM)  guarda o certificado A1 (.pfx + senha) no Vault e configura a fazenda
//   remover      (ADM)  apaga o certificado
//   status              situação da configuração (sem o certificado)
//   buscar              baixa as notas novas da SEFAZ (Distribuição de DF-e) respeitando as regras de uso
//                       e faz a Ciência da Operação nas notas que chegaram só em resumo (libera o XML completo)
//   modo-a3      (ADM)  usa certificado A3 (token ou cartão): quem fala com a SEFAZ é o MercaPlant Conecta,
//                       no computador da fazenda (função sefaz-conecta); o servidor só prepara e processa
//   conecta-codigo (ADM) gera o código de ligação do Conecta (vale 15 minutos)
//   conecta-desligar (ADM) desliga o Conecta (o computador deixa de ter acesso)
// A conexão com a SEFAZ passa pela ponte no Google Cloud Run (servicos/sefaz-ponte), porque a SEFAZ pede o
// certificado por renegociação TLS e este servidor (Deno) não renegocia. Segredos: SEFAZ_PONTE_URL e SEFAZ_PONTE_CHAVE.
// Publicar com verify_jwt = true.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { lerCertificado, soapDist, envEventoCiencia, soapEvento, faultSoap, type Certificado } from './nucleo.ts';
import { processarDist, pendentesCiencia, processarEvento, contagemVazia, podeConsultar, sha256, type Config } from './processar.ts';

const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS'};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), {status, headers: {...cors, 'Content-Type': 'application/json'}});
const erro = (status: number, message: string) => resposta(status, {message});
const CHAVE_APP = 'sb_publishable_BxbOeMIvyAlyTkCMy3sUWg__PpRKnYK'; // chave pública do app (mesma do nuvem.js)
const UFS = ['11', '12', '13', '14', '15', '16', '17', '21', '22', '23', '24', '25', '26', '27', '28', '29', '31', '32', '33', '35', '41', '42', '43', '50', '51', '52', '53'];
const LIMITE_TEMPO_MS = 100_000;   // para antes do limite da função
const MAX_CONSULTAS = 15;          // lotes de até 50 documentos por chamada

function chaveSecreta() {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default; if (k) return k; } catch { /* chave antiga */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

// Envia à SEFAZ pela ponte
async function ponte(servico: 'dist' | 'evento', ambiente: number, soap: string, cert: {pfx: string; senha: string}): Promise<string> {
  const url = (Deno.env.get('SEFAZ_PONTE_URL') || '').trim(), chave = (Deno.env.get('SEFAZ_PONTE_CHAVE') || '').trim();
  if (!url || !chave) throw Object.assign(new Error('A conexão com a SEFAZ ainda não foi ligada no servidor.'), {status: 503});
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 75000);
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/enviar', {method: 'POST', signal: ctl.signal, headers: {'Content-Type': 'application/json', 'x-ponte-chave': chave},
      body: JSON.stringify({servico, ambiente, soap, pfx: cert.pfx, senha: cert.senha})});
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw Object.assign(new Error('A chave da ponte (SEFAZ_PONTE_CHAVE) não confere com a do Netlify (PONTE_CHAVE).'), {status: 502});
    if (!r.ok) throw Object.assign(new Error(j.erro || `Falha na ponte (${r.status}).`), {status: 502});
    if (j.status === 403) throw Object.assign(new Error('A SEFAZ recusou o certificado (acesso negado). Confira se é o certificado A1 ICP-Brasil válido do CNPJ/CPF da fazenda.'), {status: 502});
    if (j.status !== 200) throw Object.assign(new Error(faultSoap(j.corpo || '') || `A SEFAZ respondeu com erro ${j.status}.`), {status: 502});
    return j.corpo as string;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw Object.assign(new Error('A SEFAZ demorou demais para responder. Tente mais tarde.'), {status: 504});
    throw e;
  } finally { clearTimeout(t); }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  if (req.method !== 'POST') return erro(405, 'Use POST.');
  try {
    const b = await req.json().catch(() => ({}));
    const fazenda = String(b.farm_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(fazenda)) return erro(400, 'Fazenda inválida.');
    const auth = req.headers.get('Authorization') || '';
    const eu = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') || CHAVE_APP, {global: {headers: {Authorization: auth}}, auth: {persistSession: false}});
    const adm = createClient(Deno.env.get('SUPABASE_URL')!, chaveSecreta(), {auth: {persistSession: false, autoRefreshToken: false}});
    const [{data: papel}, {data: ve}, {data: quem}] = await Promise.all([eu.rpc('farm_role', {p_farm: fazenda}), eu.rpc('ve_notas_sefaz', {p_farm: fazenda}), eu.auth.getUser()]);
    if (!ve) return erro(403, 'Sem acesso às notas desta fazenda.');
    const email = quem?.user?.email || '';
    const status = async () => {
      const cfg = (await adm.from('sefaz_config').select('modo, doc, tipo_doc, nome, validade, uf, ambiente, prox_consulta, ult_consulta, ult_cstat, ult_motivo, atualizado_em').eq('farm_id', fazenda).maybeSingle()).data;
      if (cfg?.modo !== 'a3') return cfg;
      const c = (await adm.from('sefaz_conecta').select('token_hash, visto_em, computador, versao, ult_erro, ult_erro_em, ligado_em').eq('farm_id', fazenda).maybeSingle()).data;
      return {...cfg, conecta: {ligado: !!c?.token_hash, visto_em: c?.visto_em || null, computador: c?.computador || null, versao: c?.versao || null, ult_erro: c?.ult_erro || null, ult_erro_em: c?.ult_erro_em || null, ligado_em: c?.ligado_em || null}};
    };

    // ---------- Certificado (só o ADM) ----------
    if (b.acao === 'certificado') {
      if (papel !== 'admin') return erro(403, 'Só o ADM da fazenda cadastra o certificado.');
      const pfx = String(b.pfx || ''), senha = String(b.senha || ''), uf = String(b.uf || '43');
      if (!pfx || pfx.length > 200_000) return erro(400, 'Escolha o arquivo .pfx do certificado A1.');
      if (!UFS.includes(uf)) return erro(400, 'Estado inválido.');
      let c: Certificado;
      try { c = lerCertificado(pfx, senha); } catch (e) { return erro(400, (e as Error).message); }
      if (new Date(c.validade) < new Date()) return erro(400, `Este certificado venceu em ${new Date(c.validade).toLocaleDateString('pt-BR')}. Renove o certificado A1 e envie o novo.`);
      const ant = await status();
      const {error: eV} = await adm.rpc('sefaz_cert_salvar', {p_farm: fazenda, p_valor: JSON.stringify({pfx, senha})});
      if (eV) return erro(500, 'Não foi possível guardar o certificado.');
      const novoDoc = !ant || ant.doc !== c.doc;
      const {error: eC} = await adm.from('sefaz_config').upsert({farm_id: fazenda, doc: c.doc, tipo_doc: c.tipoDoc, nome: c.nome, validade: c.validade, uf, ambiente: Number(b.ambiente) === 2 ? 2 : 1,
        modo: 'a1', ...(novoDoc ? {ult_nsu: '0', max_nsu: null, prox_consulta: null, ult_cstat: null, ult_motivo: null} : {}), atualizado_por: email, atualizado_em: new Date().toISOString()});
      if (eC) return erro(500, 'Não foi possível salvar a configuração.');
      await adm.from('sefaz_conecta').delete().eq('farm_id', fazenda); // trocou para A1: o Conecta perde o acesso
      return resposta(200, {config: await status()});
    }
    // ---------- A3 (token ou cartão): o MercaPlant Conecta faz a parte do certificado ----------
    if (b.acao === 'modo-a3') {
      if (papel !== 'admin') return erro(403, 'Só o ADM da fazenda configura o certificado.');
      const uf = String(b.uf || '43');
      if (!UFS.includes(uf)) return erro(400, 'Estado inválido.');
      const ant = await status();
      await adm.rpc('sefaz_cert_apagar', {p_farm: fazenda}); // o A1 guardado (se havia) deixa de ser usado
      const {error} = await adm.from('sefaz_config').upsert({farm_id: fazenda, modo: 'a3', uf, ambiente: Number(b.ambiente) === 2 ? 2 : 1,
        ...(ant?.modo === 'a3' ? {} : {doc: null, tipo_doc: null, nome: null, validade: null}), atualizado_por: email, atualizado_em: new Date().toISOString()});
      if (error) return erro(500, 'Não foi possível salvar a configuração.');
      return resposta(200, {config: await status()});
    }
    if (b.acao === 'conecta-codigo') {
      if (papel !== 'admin') return erro(403, 'Só o ADM da fazenda liga o MercaPlant Conecta.');
      const cfg = await status();
      if (cfg?.modo !== 'a3') return erro(400, 'Escolha primeiro o certificado A3 (token ou cartão).');
      // 8 letras e números sem os que confundem (0/O, 1/I/L)
      const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', aleat = crypto.getRandomValues(new Uint8Array(8));
      const codigo = [...aleat].map(n => letras[n % letras.length]).join('');
      const expira = new Date(Date.now() + 15 * 60_000).toISOString();
      const {error} = await adm.from('sefaz_conecta').upsert({farm_id: fazenda, codigo_hash: await sha256(codigo), codigo_expira: expira, atualizado_em: new Date().toISOString()});
      if (error) return erro(500, 'Não foi possível gerar o código.');
      return resposta(200, {codigo: `${codigo.slice(0, 4)}-${codigo.slice(4)}`, expira});
    }
    if (b.acao === 'conecta-desligar') {
      if (papel !== 'admin') return erro(403, 'Só o ADM da fazenda desliga o MercaPlant Conecta.');
      await adm.from('sefaz_conecta').update({token_hash: null, codigo_hash: null, codigo_expira: null, atualizado_em: new Date().toISOString()}).eq('farm_id', fazenda);
      return resposta(200, {config: await status()});
    }
    if (b.acao === 'remover') {
      if (papel !== 'admin') return erro(403, 'Só o ADM da fazenda remove o certificado.');
      await adm.rpc('sefaz_cert_apagar', {p_farm: fazenda});
      await adm.from('sefaz_conecta').delete().eq('farm_id', fazenda);
      await adm.from('sefaz_config').delete().eq('farm_id', fazenda);
      return resposta(200, {ok: true});
    }
    if (b.acao === 'status') return resposta(200, {config: await status()});

    // ---------- Buscar notas ----------
    if (b.acao !== 'buscar') return erro(400, 'Ação inválida.');
    const {data: cfg} = await adm.from('sefaz_config').select('*').eq('farm_id', fazenda).maybeSingle();
    if (!cfg) return erro(400, 'O ADM ainda não cadastrou o certificado digital da fazenda.');
    // A3: a busca é feita pelo MercaPlant Conecta no computador da fazenda (sozinho, a cada poucos minutos)
    if (cfg.modo === 'a3') return resposta(200, {...contagemVazia(), a3: true, aguardar: cfg.prox_consulta, config: await status()});
    if (cfg.validade && new Date(cfg.validade) < new Date()) return erro(400, 'O certificado A1 venceu. O ADM precisa enviar o certificado renovado.');
    const {data: bruto} = await adm.rpc('sefaz_cert_ler', {p_farm: fazenda});
    if (!bruto) return erro(400, 'Certificado não encontrado. O ADM precisa enviar o certificado de novo.');
    const certArq = JSON.parse(bruto) as {pfx: string; senha: string};
    const cert = lerCertificado(certArq.pfx, certArq.senha);
    const amb = Number(cfg.ambiente) || 1, inicio = Date.now();
    const res = contagemVazia();

    // 1) Distribuição: lote a lote até alcançar o maxNSU (ou a SEFAZ dizer que não há nada)
    if (!podeConsultar(cfg)) {
      res.aguardar = cfg.prox_consulta; res.motivo = 'A SEFAZ só permite consultar de novo depois de 1 hora sem novidades.';
    } else {
      for (let i = 0; i < MAX_CONSULTAS && Date.now() - inicio < LIMITE_TEMPO_MS; i++) {
        const xml = await ponte('dist', amb, soapDist({tpAmb: amb, cUF: cfg.uf, doc: cfg.doc, tipoDoc: cfg.tipo_doc, ultNSU: cfg.ult_nsu || '0'}), certArq);
        const {continuar} = await processarDist(adm, fazenda, cfg as Config, xml, res);
        if (!continuar) break;
      }
    }

    // 2) Ciência da Operação nas notas que só vieram em resumo (até 20 por lote; libera o XML completo na próxima busca)
    if (Date.now() - inicio < LIMITE_TEMPO_MS) {
      const pend = await pendentesCiencia(adm, fazenda);
      if (pend.length) {
        try { await processarEvento(adm, fazenda, await ponte('evento', amb, soapEvento(envEventoCiencia(pend, cert, amb)), certArq), res); }
        catch (e) { res.cienciaFalhas.push((e as Error).message); }
      }
    }
    return resposta(200, {...res, config: await status()});
  } catch (e) {
    console.error('sefaz', (e as Error).message);
    return erro((e as {status?: number}).status || 500, (e as Error).message || 'Erro inesperado.');
  }
});
