// MercaPlant — IA (Gemini): partes puras, testadas em nucleo_test.ts.
// boletim: lê a foto ou o PDF do boletim de análise de sementes e devolve os campos do formulário do app.

export type Grupo = {id: string, rot: string};
export type Encontrada = {nome: string, n: number, grupo: string};
export type Boletim = {
  data: string | null, boletim: string | null, laboratorio: string | null,
  amostraG: number | null, amostraCS: number | null,
  germinacao: number | null, vigor: number | null, pureza: number | null, outrasPct: number | null, pms: number | null, umidade: number | null,
  encontradas: Encontrada[], especieNoBoletim: string | null, loteNoBoletim: string | null, avisos: string[],
};

export const TIPOS_ARQUIVO = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_BASE64 = 7_000_000; // ~5 MB de arquivo

const n = (descricao: string) => ({type: 'NUMBER', nullable: true, description: descricao});
const s = (descricao: string) => ({type: 'STRING', nullable: true, description: descricao});

/** Esquema da resposta (o Gemini devolve JSON nesse formato). */
export function esquemaBoletim(grupos: Grupo[]) {
  return {
    type: 'OBJECT',
    properties: {
      data: s('Data do resultado/emissão do boletim no formato AAAA-MM-DD'),
      boletim: s('Número do boletim de análise'),
      laboratorio: s('Nome do laboratório'),
      especieNoBoletim: s('Espécie escrita no boletim'),
      loteNoBoletim: s('Identificação do lote escrita no boletim'),
      amostraG: n('Peso (g) da amostra examinada na determinação de outras sementes por número (a de nocivas, se houver duas)'),
      amostraCS: n('Peso (g) da amostra para outras cultivadas e silvestres, só se o boletim mostrar um peso diferente para elas'),
      germinacao: n('Germinação: plântulas normais (%)'),
      vigor: n('Vigor (%), se houver'),
      pureza: n('Pureza: semente pura (%)'),
      outrasPct: n('Pureza: outras sementes (%)'),
      pms: n('Peso de mil sementes (g)'),
      umidade: n('Grau de umidade (%)'),
      encontradas: {type: 'ARRAY', description: 'Determinação de outras sementes por número: cada espécie encontrada com a quantidade',
        items: {type: 'OBJECT', properties: {
          nome: {type: 'STRING', description: 'Nome da espécie como está no boletim (comum ou científico)'},
          n: {type: 'INTEGER', description: 'Número de sementes encontradas'},
          grupo: {type: 'STRING', enum: [...grupos.map(g => g.id), 'nenhum'], description: 'id do grupo da lista; nenhum se não tiver certeza'},
        }, required: ['nome', 'n', 'grupo']}},
      avisos: {type: 'ARRAY', items: {type: 'STRING'}, description: 'Partes ilegíveis, valores duvidosos ou diferenças a conferir, em português, curtas'},
    },
    required: ['encontradas', 'avisos'],
  };
}

export function promptBoletim(especie: string, cientifico: string, grupos: Grupo[]) {
  return [
    'Você lê boletins de análise de sementes do Brasil (Regras para Análise de Sementes, MAPA).',
    `Espécie do lote no sistema: ${especie || 'não informada'}${cientifico ? ` (${cientifico})` : ''}.`,
    'Extraia SOMENTE o que está escrito no documento. Se um valor não aparece ou está ilegível, use null — nunca invente nem calcule.',
    'Números com vírgula decimal (ex.: 98,5) viram número com ponto (98.5). Percentuais sem o símbolo %.',
    'Germinação = plântulas normais (%). Pureza = semente pura (%). outrasPct = outras sementes (%) da análise de pureza.',
    'Na "determinação de outras sementes por número" (ou "exame de sementes nocivas"), liste cada espécie com a quantidade, e o peso da amostra examinada em gramas.',
    'Classifique cada espécie num destes grupos (use o id; use nenhum se não tiver certeza):',
    ...grupos.map(g => `- ${g.id}: ${g.rot}`),
    'Se a espécie do boletim for diferente da do lote, ou houver mais de um lote no documento, diga em avisos.',
    'Responda só o JSON pedido.',
  ].join('\n');
}

const num = (v: unknown, min: number, max: number) => { const x = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(x) || x < min || x > max ? null : Math.round(x * 100) / 100; };
const txt = (v: unknown, max = 80) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const dataIso = (v: unknown) => { const t = txt(v, 20); if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return t;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); if (!m) return null;
  const a = m[3].length === 2 ? '20' + m[3] : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };

/** Confere e limpa a resposta do Gemini (o app só recebe valores possíveis). */
export function normalizarBoletim(r: Record<string, unknown>, grupos: Grupo[]): Boletim {
  const ids = new Set(grupos.map(g => g.id)), avisos = Array.isArray(r.avisos) ? r.avisos.map(a => txt(a, 200)).filter(Boolean) as string[] : [];
  const encontradas = (Array.isArray(r.encontradas) ? r.encontradas : []).map((e: Record<string, unknown>) => ({
    nome: txt(e?.nome, 60) || '', n: Math.round(Number(e?.n)), grupo: ids.has(String(e?.grupo)) ? String(e.grupo) : '',
  })).filter(e => e.nome && Number.isInteger(e.n) && e.n >= 0 && e.n < 100000).slice(0, 30);
  const d = dataIso(r.data), hoje = new Date().toISOString().slice(0, 10);
  if (r.data && !d) avisos.push('A data do boletim não ficou clara: confira.');
  return {
    data: d && d <= hoje && d >= '2000-01-01' ? d : null, boletim: txt(r.boletim, 40), laboratorio: txt(r.laboratorio, 80),
    amostraG: num(r.amostraG, 0.1, 100000), amostraCS: num(r.amostraCS, 0.1, 100000),
    germinacao: num(r.germinacao, 0, 100), vigor: num(r.vigor, 0, 100), pureza: num(r.pureza, 0, 100), outrasPct: num(r.outrasPct, 0, 100),
    pms: num(r.pms, 0.01, 5000), umidade: num(r.umidade, 0, 100),
    encontradas, especieNoBoletim: txt(r.especieNoBoletim, 80), loteNoBoletim: txt(r.loteNoBoletim, 60), avisos: avisos.slice(0, 8),
  };
}

/** Texto do JSON na resposta do Gemini (generateContent). */
export function textoDaResposta(j: Record<string, unknown>): string {
  const c = (j?.candidates as {content?: {parts?: {text?: string}[]}, finishReason?: string}[] | undefined)?.[0];
  return (c?.content?.parts || []).map(p => p.text || '').join('').trim();
}

/** Mensagem para a pessoa a partir do erro do Gemini. */
export function erroGemini(status: number, corpo: string): {status: number, msg: string} {
  if (status === 429) return {status: 429, msg: 'A IA está no limite de uso agora. Tente de novo em 1 minuto.'};
  if (status === 400 && /API key|API_KEY/i.test(corpo)) return {status: 503, msg: 'A chave da IA no servidor não foi aceita pelo Google. Confira a GEMINI_API_KEY.'};
  if (status === 403) return {status: 503, msg: 'O Google recusou a chave da IA (sem permissão). Confira o projeto da GEMINI_API_KEY no AI Studio.'};
  if (status >= 500) return {status: 502, msg: 'A IA do Google não respondeu agora. Tente de novo em instantes.'};
  return {status: 502, msg: `A IA não conseguiu ler o arquivo (${status}).`};
}
