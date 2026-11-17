// MercaPlant — Notas da SEFAZ.
// Ações (POST, com o login do usuário):
//   certificado  (ADM)  guarda o certificado A1 (.pfx + senha) no Vault e configura a fazenda
//   remover      (ADM)  apaga o certificado
//   status              situação da configuração (sem o certificado)
//   buscar              baixa as notas novas da SEFAZ (Distribuição de DF-e) respeitando as regras de uso
//                       e faz a Ciência da Operação nas notas que chegaram só em resumo (libera o XML completo)
// A conexão com a SEFAZ passa pela ponte no Google Cloud Run (servicos/sefaz-ponte), porque a SEFAZ pede o
// certificado por renegociação TLS e este servidor (Deno) não renegocia. Segredos: SEFAZ_PONTE_URL e SEFAZ_PONTE_CHAVE.
// Publicar com verify_jwt = true.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { lerCertificado, soapDist, lerRetDist, descompactar, lerDocumento, envEventoCiencia, soapEvento, lerRetEvento, cienciaOk, faultSoap, type Certificado } from './nucleo.ts';

const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS'};
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), {status, headers: {...cors, 'Content-Type': 'application/json'}});
const erro = (status: number, message: string) => resposta(status, {message});
const CHAVE_APP = 'sb_publishable_BxbOeMIvyAlyTkCMy3sUWg__PpRKnYK'; // chave pública do app (mesma do nuvem.js)
const UFS = ['11', '12', '13', '14', '15', '16', '17', '21', '22', '23', '24', '25', '26', '27', '28', '29', '31', '32', '33', '35', '41', '42', '43', '50', '51', '52', '53'];
const ESPERA_MS = 61 * 60 * 1000; // a SEFAZ pede 1 hora entre consultas sem novidade (61 min de folga)
const LIMITE_TEMPO_MS = 100_000;   // para antes do limite da função
const MAX_CONSULTAS = 15;          // lotes de até 50 documentos por chamada

function chaveSecreta() {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default; if (k) return k; } catch { /* chave antiga */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

// Envia à SEFAZ pela ponte
async function ponte(servico: 'dist' | 'evento', ambiente: number, soap: string, cert: {pfx: string; senha: string}): Promise<string> {
  const url = Deno.env.get('SEFAZ_PONTE_URL'), chave = Deno.env.get('SEFAZ_PONTE_CHAVE');
  if (!url || !chave) throw Object.assign(new Error('A conexão com a SEFAZ ainda não foi ligada no servidor.'), {status: 503});
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 75000);
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/enviar', {method: 'POST', signal: ctl.signal, headers: {'Content-Type': 'application/json', 'x-ponte-chave': chave},
      body: JSON.stringify({servico, ambiente, soap, pfx: cert.pfx, senha: cert.senha})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || `Falha na ponte (${r.status}).`), {status: 502});
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
    const status = async () => (await adm.from('sefaz_config').select('doc, tipo_doc, nome, validade, uf, ambiente, prox_consulta, ult_consulta, ult_cstat, ult_motivo, atualizado_em').eq('farm_id', fazenda).maybeSingle()).data;

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
        ...(novoDoc ? {ult_nsu: '0', max_nsu: null, prox_consulta: null, ult_cstat: null, ult_motivo: null} : {}), atualizado_por: email, atualizado_em: new Date().toISOString()});
      if (eC) return erro(500, 'Não foi possível salvar a configuração.');
      return resposta(200, {config: await status()});
    }
    if (b.acao === 'remover') {
      if (papel !== 'admin') return erro(403, 'Só o ADM da fazenda remove o certificado.');
      await adm.rpc('sefaz_cert_apagar', {p_farm: fazenda});
      await adm.from('sefaz_config').delete().eq('farm_id', fazenda);
      return resposta(200, {ok: true});
    }
    if (b.acao === 'status') return resposta(200, {config: await status()});

    // ---------- Buscar notas ----------
    if (b.acao !== 'buscar') return erro(400, 'Ação inválida.');
    const {data: cfg} = await adm.from('sefaz_config').select('*').eq('farm_id', fazenda).maybeSingle();
    if (!cfg) return erro(400, 'O ADM ainda não cadastrou o certificado A1 da fazenda.');
    if (cfg.validade && new Date(cfg.validade) < new Date()) return erro(400, 'O certificado A1 venceu. O ADM precisa enviar o certificado renovado.');
    const {data: bruto} = await adm.rpc('sefaz_cert_ler', {p_farm: fazenda});
    if (!bruto) return erro(400, 'Certificado não encontrado. O ADM precisa enviar o certificado de novo.');
    const certArq = JSON.parse(bruto) as {pfx: string; senha: string};
    const cert = lerCertificado(certArq.pfx, certArq.senha);
    const amb = Number(cfg.ambiente) || 1, inicio = Date.now();
    const res = {novas: 0, completas: 0, canceladas: 0, ciencias: 0, cienciaFalhas: [] as string[], consultas: 0, aguardar: null as string | null, motivo: ''};

    // 1) Distribuição: lote a lote até alcançar o maxNSU (ou a SEFAZ dizer que não há nada)
    if (cfg.prox_consulta && new Date(cfg.prox_consulta).getTime() > Date.now()) {
      res.aguardar = cfg.prox_consulta; res.motivo = 'A SEFAZ só permite consultar de novo depois de 1 hora sem novidades.';
    } else {
      let ult = cfg.ult_nsu || '0';
      for (let i = 0; i < MAX_CONSULTAS && Date.now() - inicio < LIMITE_TEMPO_MS; i++) {
        const xml = await ponte('dist', amb, soapDist({tpAmb: amb, cUF: cfg.uf, doc: cfg.doc, tipoDoc: cfg.tipo_doc, ultNSU: ult}), certArq);
        const r = lerRetDist(xml); res.consultas++;
        const agora = new Date().toISOString();
        if (r.cStat === '138') {
          for (const d of r.docs) {
            const o = lerDocumento(d.schema, await descompactar(d.b64));
            if (!/^\d{44}$/.test(o.chave)) continue;
            if (o.tipo === 'resumo' || o.tipo === 'completa') {
              if (o.tpNF && o.tpNF !== '1') continue; // só notas de saída do fornecedor (entrada na fazenda)
              const {data: ja} = await adm.from('nfe_recebidas').select('situacao').eq('farm_id', fazenda).eq('chave', o.chave).maybeSingle();
              const situacao = ja?.situacao === 'cancelada' || o.cSit === '3' ? 'cancelada' : o.tipo === 'completa' ? 'completa' : (ja?.situacao || 'resumo');
              await adm.from('nfe_recebidas').upsert({farm_id: fazenda, chave: o.chave, nsu: d.nsu, situacao, numero: o.numero, emitente: o.nomeEmit, cnpj_emit: o.cnpjEmit, valor: o.valor,
                emissao: o.emissao, tp_nf: o.tpNF, ...(o.tipo === 'completa' ? {xml: o.xml} : {}), atualizado_em: agora}, {onConflict: 'farm_id,chave'});
              if (!ja) res.novas++;
              if (o.tipo === 'completa' && ja?.situacao !== 'completa') res.completas++;
            } else if (o.tipo === 'evento' && o.tpEvento === '110111') { // cancelamento pelo emitente
              const {data: up} = await adm.from('nfe_recebidas').update({situacao: 'cancelada', atualizado_em: agora}).eq('farm_id', fazenda).eq('chave', o.chave).select('chave');
              if (up?.length) res.canceladas++;
            }
          }
          ult = r.ultNSU || ult;
          const fim = !r.maxNSU || BigInt(ult || '0') >= BigInt(r.maxNSU);
          await adm.from('sefaz_config').update({ult_nsu: ult, max_nsu: r.maxNSU, ult_consulta: agora, ult_cstat: r.cStat, ult_motivo: r.xMotivo, prox_consulta: fim ? new Date(Date.now() + ESPERA_MS).toISOString() : null}).eq('farm_id', fazenda);
          if (fim) { res.aguardar = new Date(Date.now() + ESPERA_MS).toISOString(); break; }
          continue;
        }
        // 137 = nada novo; 656 = consumo indevido (bloqueio de 1 hora); demais = erro: em todos, espera 1 hora
        const prox = new Date(Date.now() + ESPERA_MS).toISOString();
        await adm.from('sefaz_config').update({ult_nsu: r.ultNSU || ult, max_nsu: r.maxNSU || cfg.max_nsu, ult_consulta: agora, ult_cstat: r.cStat, ult_motivo: r.xMotivo, prox_consulta: prox}).eq('farm_id', fazenda);
        res.aguardar = prox;
        if (r.cStat !== '137') res.motivo = `SEFAZ: ${r.cStat} — ${r.xMotivo || 'sem detalhes'}`;
        break;
      }
    }

    // 2) Ciência da Operação nas notas que só vieram em resumo (até 20 por lote; libera o XML completo na próxima busca)
    if (Date.now() - inicio < LIMITE_TEMPO_MS) {
      const {data: pend} = await adm.from('nfe_recebidas').select('chave').eq('farm_id', fazenda).eq('situacao', 'resumo').is('ciencia_em', null).eq('ignorada', false).order('emissao', {ascending: false}).limit(20);
      if (pend?.length) {
        try {
          const ret = lerRetEvento(await ponte('evento', amb, soapEvento(envEventoCiencia(pend.map(p => p.chave), cert, amb)), certArq));
          const agora = new Date().toISOString();
          for (const ev of ret.eventos) {
            if (!/^\d{44}$/.test(ev.chave)) continue;
            await adm.from('nfe_recebidas').update({ciencia_em: cienciaOk(ev.cStat) ? agora : null, ciencia_cstat: ev.cStat, ciencia_motivo: ev.xMotivo, atualizado_em: agora}).eq('farm_id', fazenda).eq('chave', ev.chave);
            if (cienciaOk(ev.cStat)) res.ciencias++; else res.cienciaFalhas.push(`${ev.chave.slice(25, 34).replace(/^0+/, '')}: ${ev.cStat} ${ev.xMotivo}`);
          }
          if (!ret.eventos.length && ret.cStat !== '128') res.cienciaFalhas.push(`Lote: ${ret.cStat} ${ret.xMotivo}`);
        } catch (e) { res.cienciaFalhas.push((e as Error).message); }
      }
    }
    return resposta(200, {...res, config: await status()});
  } catch (e) {
    console.error('sefaz', (e as Error).message);
    return erro((e as {status?: number}).status || 500, (e as Error).message || 'Erro inesperado.');
  }
});
