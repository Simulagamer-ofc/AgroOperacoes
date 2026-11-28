// MercaPlant — bases oficiais do MAPA (dados abertos): partes puras, testadas em nucleo_test.ts.
// Agrofit (produtos formulados registrados): guarda só cultura × alvo × ingrediente ativo × classe × modo de ação
// (sem marca e sem concentração/dose). ZARC (tábua de risco): janelas de plantio por município, cultura, ciclo e solo.

/** Minúsculas, sem acento e sem pontuação: para buscar "ferrugem-asiática" ou "Ferrugem asiatica". */
export function normalizar(s: string): string {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Divide uma linha CSV com ; respeitando aspas ("a; b" fica num campo só). */
export function campos(linha: string, sep = ';'): string[] {
  if (!linha.includes('"')) return linha.split(sep).map(x => x.replace(/\r$/, '').trim()); // caminho rápido
  const out: string[] = []; let atual = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
    else if (c === sep && !aspas) { out.push(atual); atual = ''; }
    else atual += c;
  }
  out.push(atual);
  return out.map(x => x.replace(/\r$/, '').trim());
}

/** Ingrediente ativo sem a concentração do produto ("(20 g/L)"): a IA não fala de dose. Mistura em ordem fixa. */
export function ingredienteLimpo(s: string): string {
  return String(s || '').split(/\s\+\s/).map(p => p.replace(/\(\s*[\d.,]+\s*(?:g|mg|kg|ml|mL|L|l|%|UFC|ufc|UI)\b[^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt')).join(' + ');
}

export type Agrofit = {cultura: string, alvo_comum: string, alvo_cientifico: string, ingrediente: string, classe: string, modo_acao: string, organico: boolean, cultura_n: string, alvo_n: string};
/** Linha do CSV do Agrofit → registro (só registros ativos). */
export function linhaAgrofit(c: string[], col: Record<string, number>): Agrofit | null {
  const v = (k: string) => (col[k] >= 0 ? c[col[k]] ?? '' : '').trim();
  if (col.SITUACAO >= 0 && !/^true$/i.test(v('SITUACAO'))) return null;
  const cultura = v('CULTURA'), ingrediente = ingredienteLimpo(v('INGREDIENTE_ATIVO'));
  if (!cultura || !ingrediente) return null;
  const alvo_comum = v('PRAGA_NOME_COMUM').slice(0, 200), alvo_cientifico = v('PRAGA_NOME_CIENTIFICO').slice(0, 200);
  return {cultura: cultura.slice(0, 120), alvo_comum, alvo_cientifico, ingrediente: ingrediente.slice(0, 400), classe: v('CLASSE').slice(0, 120), modo_acao: v('MODO_DE_ACAO').slice(0, 120),
    organico: /org[aâ]n/i.test(v('ORGANICOS')) || /^(sim|true)$/i.test(v('ORGANICOS')), cultura_n: normalizar(cultura), alvo_n: normalizar(`${alvo_comum} ${alvo_cientifico}`)};
}

export type Zarc = {safra: string, geocodigo: number, uf: string, municipio: string, municipio_n: string, cultura: string, cultura_n: string,
  ciclo: number | null, solo: number | null, manejo: string, clima: string, portaria: string, decs: string};
/** Linha da tábua de risco → registro (só as UFs pedidas e com alguma janela). decs: 36 letras, 0 = fora, 2/3/4 = risco 20/30/40%. */
export function linhaZarc(c: string[], col: Record<string, number>, ufs: Set<string>): Zarc | null {
  const v = (k: string) => (col[k] >= 0 ? c[col[k]] ?? '' : '').trim();
  const uf = v('UF').toUpperCase(); if (ufs.size && !ufs.has(uf)) return null;
  let decs = '';
  for (let i = 1; i <= 36; i++) { const r = Number(v('dec' + i)); decs += r >= 40 ? '4' : r >= 30 ? '3' : r >= 20 ? '2' : r > 0 ? '1' : '0'; }
  if (!/[1-4]/.test(decs)) return null;
  const geocodigo = Number(v('geocodigo')), cultura = v('Nome_cultura'), municipio = v('municipio');
  if (!geocodigo || !cultura) return null;
  const n = (x: string) => { const y = Number(x); return Number.isFinite(y) && x !== '' ? y : null; };
  return {safra: `${v('SafraIni')}/${v('SafraFin')}`.replace(/^\/|\/$/g, ''), geocodigo, uf, municipio, municipio_n: normalizar(municipio), cultura, cultura_n: normalizar(cultura),
    ciclo: n(v('Cod_Ciclo')), solo: n(v('Cod_Solo')), manejo: v('Nome_Outros_Manejos'), clima: v('Nome_Clima'), portaria: v('Portaria'), decs};
}

/** Posição das colunas pelo cabeçalho (tira o BOM). */
export function colunas(cabecalho: string): Record<string, number> {
  const c = campos(cabecalho.replace(/^\uFEFF/, ''));
  return new Proxy(Object.fromEntries(c.map((n, i) => [n, i])), {get: (o, k) => (k in o ? o[k as string] : -1)}) as Record<string, number>;
}

/** Linhas inteiras de um pedaço baixado aos poucos (o arquivo é grande: não cabe tudo na memória da função).
 *  O pedaço começa no byte `de` (= início − 1, ou 0) e só valem as linhas que COMEÇAM antes de `fim` (posições absolutas). */
export async function* linhasDoFluxo(corpo: ReadableStream<Uint8Array>, de: number, comecaNoZero: boolean, fim: number, fimDoArquivo = false): AsyncGenerator<string> {
  const leitor = corpo.getReader(), dec = new TextDecoder('utf-8');
  let resto = new Uint8Array(0), pos = de, pular = !comecaNoZero;
  try {
    while (true) {
      const {value, done} = await leitor.read();
      const buf = value ? (resto.length ? (() => { const b = new Uint8Array(resto.length + value.length); b.set(resto); b.set(value, resto.length); return b; })() : value) : resto;
      let i = 0;
      for (let j = buf.indexOf(10, i); j >= 0; j = buf.indexOf(10, i)) {
        const inicio = pos + i;
        if (pular) pular = false; // o pedaço começou no meio (ou no fim) da linha anterior
        else { if (inicio >= fim) return; yield dec.decode(buf.subarray(i, j)).replace(/\r$/, ''); }
        i = j + 1;
      }
      pos += i; resto = buf.slice(i);
      if (done) { if (fimDoArquivo && resto.length && pos < fim && !pular) yield dec.decode(resto).replace(/\r$/, ''); return; }
    }
  } finally { leitor.cancel().catch(() => {}); }
}

export const CICLOS: Record<number, string> = {13: 'perene', 19: 'semiperene', 20: 'grupo I', 21: 'grupo II', 22: 'grupo III', 24: 'grupo IV', 25: 'grupo V', 26: 'grupo VI'};
export const SOLOS: Record<number, string> = {1: 'arenoso', 2: 'textura média', 3: 'argiloso', 11: 'AD1', 12: 'AD2', 13: 'AD3', 14: 'AD4', 15: 'AD5', 16: 'AD6'};
const fimDoMes = (m: number) => [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
/** Decêndio n (1–36) → dias do mês ("01/10", "11/10", "21/10" … último dia). */
export function decendio(n: number): {ini: string, fim: string} {
  const m = Math.ceil(n / 3), p = (n - 1) % 3, mm = String(m).padStart(2, '0');
  return {ini: `${['01', '11', '21'][p]}/${mm}`, fim: `${p === 2 ? fimDoMes(m) : p === 0 ? 10 : 20}/${mm}`};
}
/** decs → janelas seguidas com o mesmo risco: [{de, ate, risco}] (vira o ano: out → jan). */
export function janelas(decs: string): {de: string, ate: string, risco: number}[] {
  const out: {de: string, ate: string, risco: number}[] = [];
  let i0 = -1;
  // começa num decêndio fora da janela para juntar dez/jan
  const inicio = Math.max(0, decs.indexOf('0'));
  for (let k = 0; k <= 36; k++) {
    const i = (inicio + k) % 36, r = k < 36 ? decs[i] : '0', ant = i0 >= 0 ? decs[i0] : '0';
    if (i0 >= 0 && r !== ant) { out.push({de: decendio(i0 + 1).ini, ate: decendio(((i - 1 + 36) % 36) + 1).fim, risco: {'1': 10, '2': 20, '3': 30, '4': 40}[ant] || 0}); i0 = -1; }
    if (i0 < 0 && r !== '0' && k < 36) i0 = i;
  }
  return out;
}
