// MercaPlant — Notas da SEFAZ: o que fazer com cada resposta da SEFAZ.
// Comum aos dois tipos de certificado: A1 (função sefaz, pela ponte na nuvem) e A3 (função sefaz-conecta,
// com o MercaPlant Conecta no computador da fazenda falando com a SEFAZ pelo token/cartão).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { lerRetDist, descompactar, lerDocumento, lerRetEvento, cienciaOk } from './nucleo.ts';

export async function sha256(t: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const ESPERA_MS = 61 * 60 * 1000; // a SEFAZ pede 1 hora entre consultas sem novidade (61 min de folga)

export type Config = {farm_id: string; doc: string | null; tipo_doc: 'CNPJ' | 'CPF' | null; uf: string; ambiente: number; ult_nsu: string | null; max_nsu: string | null; prox_consulta: string | null; modo?: string};
export type Contagem = {novas: number; completas: number; canceladas: number; ciencias: number; cienciaFalhas: string[]; consultas: number; aguardar: string | null; motivo: string};
export const contagemVazia = (): Contagem => ({novas: 0, completas: 0, canceladas: 0, ciencias: 0, cienciaFalhas: [], consultas: 0, aguardar: null, motivo: ''});

export const podeConsultar = (cfg: Pick<Config, 'prox_consulta'>, agora = Date.now()) => !cfg.prox_consulta || new Date(cfg.prox_consulta).getTime() <= agora;

/**
 * Processa um retorno da Distribuição de DF-e: grava as notas, marca cancelamentos e avança o NSU.
 * Devolve {continuar, ult}: continuar = há mais lotes para buscar agora.
 */
export async function processarDist(adm: SupabaseClient, fazenda: string, cfg: Config, xml: string, res: Contagem): Promise<{continuar: boolean; ult: string}> {
  const r = lerRetDist(xml); res.consultas++;
  const agora = new Date().toISOString();
  let ult = cfg.ult_nsu || '0';
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
    const prox = fim ? new Date(Date.now() + ESPERA_MS).toISOString() : null;
    await adm.from('sefaz_config').update({ult_nsu: ult, max_nsu: r.maxNSU, ult_consulta: agora, ult_cstat: r.cStat, ult_motivo: r.xMotivo, prox_consulta: prox}).eq('farm_id', fazenda);
    cfg.ult_nsu = ult; cfg.max_nsu = r.maxNSU; cfg.prox_consulta = prox;
    if (fim) res.aguardar = prox;
    return {continuar: !fim, ult};
  }
  // 137 = nada novo; 656 = consumo indevido (bloqueio de 1 hora); demais = erro: em todos, espera 1 hora
  const prox = new Date(Date.now() + ESPERA_MS).toISOString();
  await adm.from('sefaz_config').update({ult_nsu: r.ultNSU || ult, max_nsu: r.maxNSU || cfg.max_nsu, ult_consulta: agora, ult_cstat: r.cStat, ult_motivo: r.xMotivo, prox_consulta: prox}).eq('farm_id', fazenda);
  cfg.ult_nsu = r.ultNSU || ult; cfg.prox_consulta = prox;
  res.aguardar = prox;
  if (r.cStat !== '137') res.motivo = `SEFAZ: ${r.cStat} — ${r.xMotivo || 'sem detalhes'}`;
  return {continuar: false, ult: cfg.ult_nsu};
}

/** Notas que chegaram só em resumo e ainda precisam da Ciência da Operação (até 20 por lote). */
export async function pendentesCiencia(adm: SupabaseClient, fazenda: string): Promise<string[]> {
  const {data} = await adm.from('nfe_recebidas').select('chave').eq('farm_id', fazenda).eq('situacao', 'resumo').is('ciencia_em', null).eq('ignorada', false).order('emissao', {ascending: false}).limit(20);
  return (data || []).map(p => p.chave as string);
}

/** Processa o retorno do lote de Ciência da Operação. */
export async function processarEvento(adm: SupabaseClient, fazenda: string, xml: string, res: Contagem): Promise<void> {
  const ret = lerRetEvento(xml);
  const agora = new Date().toISOString();
  for (const ev of ret.eventos) {
    if (!/^\d{44}$/.test(ev.chave)) continue;
    await adm.from('nfe_recebidas').update({ciencia_em: cienciaOk(ev.cStat) ? agora : null, ciencia_cstat: ev.cStat, ciencia_motivo: ev.xMotivo, atualizado_em: agora}).eq('farm_id', fazenda).eq('chave', ev.chave);
    if (cienciaOk(ev.cStat)) res.ciencias++; else res.cienciaFalhas.push(`${ev.chave.slice(25, 34).replace(/^0+/, '')}: ${ev.cStat} ${ev.xMotivo}`);
  }
  if (!ret.eventos.length && ret.cStat !== '128') res.cienciaFalhas.push(`Lote: ${ret.cStat} ${ret.xMotivo}`);
}
