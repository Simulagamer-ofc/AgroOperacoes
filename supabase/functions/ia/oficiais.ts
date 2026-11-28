// MercaPlant — Edy consulta as bases oficiais do MAPA guardadas no servidor (função dados-oficiais):
//   Agrofit: ingredientes ativos registrados para a cultura × alvo (sem marca e sem dose)
//   ZARC: janela de plantio do município da sede (o app manda o nome) ou do município citado
// As partes puras (resumirAgrofit, resumirZarc, janelas…) estão testadas em oficiais_test.ts.
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2';

export type Consulta = {agrofitCultura?: string, agrofitAlvo?: string, zarcCultura?: string, zarcMunicipio?: string};
export type Oficial = {titulo: string, fonte: string, url: string, linhas: string[]};
export const URL_AGROFIT = 'https://agrofit.agricultura.gov.br/agrofit_cons/principal_agrofit_cons';
export const URL_ZARC = 'https://www.gov.br/agricultura/pt-br/assuntos/riscos-seguro/programa-nacional-de-zoneamento-agricola-de-risco-climatico/portarias';

// (iguais às de dados-oficiais/nucleo.ts; o teste confere)
export function normalizar(s: string): string {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export const CICLOS: Record<number, string> = {13: 'perene', 19: 'semiperene', 20: 'grupo I', 21: 'grupo II', 22: 'grupo III', 24: 'grupo IV', 25: 'grupo V', 26: 'grupo VI'};
export const SOLOS: Record<number, string> = {1: 'arenoso', 2: 'textura média', 3: 'argiloso', 11: 'AD1', 12: 'AD2', 13: 'AD3', 14: 'AD4', 15: 'AD5', 16: 'AD6'};
const fimDoMes = (m: number) => [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
export function decendio(n: number): {ini: string, fim: string} {
  const m = Math.ceil(n / 3), p = (n - 1) % 3, mm = String(m).padStart(2, '0');
  return {ini: `${['01', '11', '21'][p]}/${mm}`, fim: `${p === 2 ? fimDoMes(m) : p === 0 ? 10 : 20}/${mm}`};
}
export function janelas(decs: string): {de: string, ate: string, risco: number}[] {
  const out: {de: string, ate: string, risco: number}[] = [];
  let i0 = -1;
  const inicio = Math.max(0, decs.indexOf('0'));
  for (let k = 0; k <= 36; k++) {
    const i = (inicio + k) % 36, r = k < 36 ? decs[i] : '0', ant = i0 >= 0 ? decs[i0] : '0';
    if (i0 >= 0 && r !== ant) { out.push({de: decendio(i0 + 1).ini, ate: decendio(((i - 1 + 36) % 36) + 1).fim, risco: {'1': 10, '2': 20, '3': 30, '4': 40}[ant] || 0}); i0 = -1; }
    if (i0 < 0 && r !== '0' && k < 36) i0 = i;
  }
  return out;
}

const PALAVRAS_VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'na', 'no', 'em', 'a', 'o', 'e', 'praga', 'doenca', 'planta', 'daninha', 'controle']);
/** "Ferrugem-asiática da soja" → "%ferrugem%asiatica%" (busca no texto normalizado). */
export function padraoBusca(t: string, cultura = ''): string {
  const fora = new Set(normalizar(cultura).split(' '));
  const p = normalizar(t).split(' ').filter(x => x.length >= 3 && !PALAVRAS_VAZIAS.has(x) && !fora.has(x));
  return p.length ? `%${p.join('%')}%` : '';
}

type LinhaAgrofit = {cultura: string, alvo_comum: string, alvo_cientifico: string, ingrediente: string, classe: string, modo_acao: string, produtos: number, organico?: boolean};
/** Ingredientes ativos registrados (mais registros primeiro), sem marca e sem dose. */
export function resumirAgrofit(linhas: LinhaAgrofit[], cultura: string, alvo: string, atualizado = ''): Oficial | null {
  if (!linhas.length) return null;
  const por = new Map<string, {produtos: number, classes: Set<string>, modos: Set<string>, todas: boolean, especifica: boolean, organico: boolean}>();
  linhas.forEach(l => {
    const x = por.get(l.ingrediente) || {produtos: 0, classes: new Set(), modos: new Set(), todas: false, especifica: false, organico: false};
    x.produtos += Number(l.produtos) || 0; if (l.classe) x.classes.add(l.classe);
    String(l.modo_acao || '').split(/[;,/]|\s+e\s+/).map(m => m.trim().toLowerCase().replace(/[.:;]+$/, '')).filter(Boolean).forEach(m => x.modos.add(m));
    if (/todas as culturas/i.test(l.cultura)) x.todas = true; else x.especifica = true;
    x.organico ||= !!l.organico; por.set(l.ingrediente, x);
  });
  const lista = [...por.entries()].sort((a, b) => Number(b[1].especifica) - Number(a[1].especifica) || b[1].produtos - a[1].produtos);
  const alvos = [...new Set(linhas.map(l => [l.alvo_comum, l.alvo_cientifico && `(${l.alvo_cientifico})`].filter(Boolean).join(' ')))].slice(0, 3);
  const total = lista.reduce((s, [, x]) => s + x.produtos, 0);
  return {
    titulo: `Registrado no MAPA (Agrofit) — ${cultura} × ${alvo}`, fonte: `Agrofit/MAPA, dados abertos${atualizado ? ` (atualizado em ${atualizado})` : ''}`, url: URL_AGROFIT,
    linhas: [
      `${lista.length} ${lista.length === 1 ? 'ingrediente ativo' : 'ingredientes ativos'} em ${total} ${total === 1 ? 'registro ativo' : 'registros ativos'}. Alvo no Agrofit: ${alvos.join('; ')}.`,
      ...lista.slice(0, 25).map(([ing, x]) => `${ing} — ${[...x.classes].join(', ')}${x.modos.size ? ` (${[...x.modos].join(', ')})` : ''} · ${x.produtos} ${x.produtos === 1 ? 'produto' : 'produtos'}${!x.especifica ? ' · registro para "todas as culturas"' : ''}${x.organico ? ' · permitido no orgânico' : ''}`),
      ...(lista.length > 25 ? [`… e mais ${lista.length - 25} ingredientes.`] : []),
      'Produto e dose: só pelo receituário agronômico do responsável técnico.',
    ],
  };
}

type LinhaZarc = {cultura: string, safra: string, municipio: string, uf: string, ciclo: number | null, solo: number | null, manejo: string, clima: string, portaria: string, decs: string};
/** Janela de plantio do ZARC: por ciclo, juntando os solos com a mesma janela. Sequeiro primeiro. */
export function resumirZarc(linhas: LinhaZarc[]): Oficial | null {
  if (!linhas.length) return null;
  const seq = linhas.filter(l => /sequeiro/i.test(l.manejo)), uso = seq.length ? seq : linhas;
  const l0 = uso[0], txt = (d: string) => janelas(d).map(j => `${j.de}–${j.ate} (risco ${j.risco}%)`).join(', ');
  const grupos = new Map<string, Map<string, string[]>>(); // cultura · ciclo · manejo → janela → solos
  uso.forEach(l => {
    const g = [l.cultura, l.ciclo != null ? CICLOS[l.ciclo] || `ciclo ${l.ciclo}` : '', l.manejo !== 'Sequeiro' ? l.manejo : '', l.clima && !/n[aã]o se aplica/i.test(l.clima) ? l.clima : ''].filter(Boolean).join(' · ');
    const m = grupos.get(g) || new Map(); const j = txt(l.decs); const s = l.solo != null ? SOLOS[l.solo] || `solo ${l.solo}` : 'todos os solos';
    m.set(j, [...(m.get(j) || []), s]); grupos.set(g, m);
  });
  const linhasTxt: string[] = [];
  [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt')).forEach(([g, m]) => {
    [...m.entries()].forEach(([j, solos]) => linhasTxt.push(`${g} — ${solos.sort().join(', ')}: ${j || 'sem janela'}`));
  });
  const portarias = [...new Set(uso.map(l => l.portaria).filter(Boolean))].slice(0, 2).map(p => p.replace(/^Port\.?/i, 'Portaria ').replace(/_de_/, ' de ').replace(/_/g, ' '));
  return {
    titulo: `ZARC — ${l0.municipio}/${l0.uf}, safra ${l0.safra}`, fonte: `ZARC/MAPA${portarias.length ? ` (${portarias.join('; ')})` : ''}`, url: URL_ZARC,
    linhas: [...linhasTxt.slice(0, 14), ...(linhasTxt.length > 14 ? [`… e mais ${linhasTxt.length - 14} combinações.`] : []),
      'Risco = chance de perda pelo clima no período (20% é o menor). AD1 a AD6: água disponível no solo (AD1 retém menos, AD6 mais).'],
  };
}

const versaoAtual = async (adm: SupabaseClient, fonte: string) => {
  const {data} = await adm.from('dados_oficiais').select('atual, concluido').eq('fonte', fonte).maybeSingle();
  return data?.atual ? {versao: String(data.atual), quando: data.concluido ? new Date(data.concluido).toLocaleDateString('pt-BR', {timeZone: 'America/Sao_Paulo'}) : ''} : null;
};

/** Busca o que a pergunta pede nas bases oficiais guardadas. Sem base importada ainda: não devolve nada. */
export async function buscarOficiais(adm: SupabaseClient, c: Consulta, municipioFazenda?: {nome?: string, uf?: string}): Promise<Oficial[]> {
  const out: Oficial[] = [];
  try {
    if (c.agrofitCultura && c.agrofitAlvo) {
      const v = await versaoAtual(adm, 'agrofit'), alvo = padraoBusca(c.agrofitAlvo, c.agrofitCultura), cult = normalizar(c.agrofitCultura).split(' ')[0];
      if (v && alvo && cult) {
        const consulta = (p: string) => adm.from('agrofit').select('cultura, alvo_comum, alvo_cientifico, ingrediente, classe, modo_acao, produtos, organico')
          .eq('versao', v.versao).or(`cultura_n.ilike.*${cult}*,cultura_n.eq."todas as culturas"`).ilike('alvo_n', p).limit(3000);
        let {data} = await consulta(alvo);
        if (!data?.length) { const pr = alvo.split('%').filter(Boolean)[0]; if (pr) ({data} = await consulta(`%${pr}%`)); }
        const r = resumirAgrofit((data || []) as LinhaAgrofit[], c.agrofitCultura, c.agrofitAlvo, v.quando); if (r) out.push(r);
      }
    }
    if (c.zarcCultura) {
      const v = await versaoAtual(adm, 'zarc'), cult = normalizar(c.zarcCultura).split(' ')[0];
      if (v && cult) {
        // município citado na pergunta; senão, o da sede da fazenda (o app descobre pelo ponto da sede e manda o nome)
        const mun = c.zarcMunicipio ? {nome: c.zarcMunicipio, uf: ''} : municipioFazenda?.nome ? {nome: String(municipioFazenda.nome), uf: String(municipioFazenda.uf || '')} : null;
        if (mun) {
          let q = adm.from('zarc').select('geocodigo').eq('versao', v.versao).eq('municipio_n', normalizar(mun.nome)).limit(1);
          if (mun.uf) q = q.eq('uf', mun.uf.toUpperCase());
          const {data: g} = await q;
          if (g?.length) {
            const {data} = await adm.from('zarc').select('cultura, safra, municipio, uf, ciclo, solo, manejo, clima, portaria, decs').eq('versao', v.versao).eq('geocodigo', g[0].geocodigo).ilike('cultura_n', `${cult}%`).limit(400);
            const r = resumirZarc((data || []) as LinhaZarc[]); if (r) out.push(r);
          }
        }
      }
    }
  } catch (e) { console.warn('oficiais', (e as Error).message); }
  return out;
}

/** Texto para a IA: os dados oficiais encontrados (ela usa como fonte principal e cita). */
export function textoOficiais(o: Oficial[]): string {
  return o.length ? `\n\nDADOS OFICIAIS (bases do MAPA guardadas no MercaPlant; use como fonte principal e cite a fonte):\n${o.map(x => `### ${x.titulo} — fonte: ${x.fonte}\n${x.linhas.map(l => '- ' + l).join('\n')}`).join('\n\n')}` : '';
}
