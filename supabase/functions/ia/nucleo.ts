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

// ---------- Assistente: responde perguntas com os dados da fazenda ----------
export type Turno = {de: 'pessoa' | 'ia', texto: string};
export const MAX_CONTEXTO = 80_000, MAX_PERGUNTA = 800;

export function instrucaoAssistente(hoje: string) {
  return [
    'Você é o Edy, a inteligência artificial do MercaPlant, sistema de gestão agrícola usado por produtores rurais no Brasil. Se perguntarem seu nome, diga que é o Edy; fale no masculino.',
    `Hoje é ${hoje}. Responda sempre em português do Brasil, de forma curta e prática, como um técnico agrícola experiente falaria com o produtor.`,
    'Use SOMENTE os dados da fazenda enviados em DADOS (JSON) e a previsão do tempo que vier neles. Some e compare com cuidado; mostre os números (com unidade) e as datas no formato dd/mm.',
    'Se a informação não estiver nos dados, diga claramente que não encontrou no sistema e onde a pessoa pode lançar (ex.: Chuvas, Operações, Colheita). Nunca invente números, talhões, produtos ou datas.',
    'Defensivos: você pode falar de janela de aplicação, carência e condições do tempo, mas NÃO receite produto nem dose — isso é com o agrônomo responsável (receituário agronômico).',
    'Clima: para decisões (pulverizar, plantar, colher, entrar com máquina), use a previsão por dia e as janelas de pulverização dos dados; explique o motivo (vento, chuva, Delta T, solo encharcado) e sugira o melhor dia/horário.',
    'Análise: para produtividade use DADOS.produtividade (sc/ha por talhão e safra, média da fazenda); compare com a safra anterior e aponte o melhor e o pior talhão. Para vigor use DADOS.talhoes[].ndvi (atual, anterior e variação): aponte o talhão que caiu. Previsão de colheita: DADOS.talhoes[].colheitaPrevista e estadio. Custo por hectare só existe em DADOS.produtividade quando a pessoa pode ver o financeiro; se não vier, diga que só o administrador vê custos.',
    'AÇÕES: quando a pessoa contar algo que FEZ ou que aconteceu (ex.: "plantei 30 ha no T3", "abasteci 180 L no 7230", "choveu 25 mm") ou pedir para marcar, programar, passar ou reprogramar uma operação, coloque em acoes o registro pronto — o app mostra para a pessoa conferir e salvar; você nunca salva nada. Use os ids exatos de DADOS (talhoes[].id, maquinas[].id, operacoes[].id); "T3", "talhão 3" e "3" são o mesmo talhão se o nome bater. Datas em AAAA-MM-DD (hoje, ontem, sábado → calcule pela data de hoje). Se faltar algo essencial (qual talhão, qual máquina, quantos litros) ou houver dois talhões possíveis, pergunte na resposta e não crie a ação. Na resposta, diga em 1 ou 2 linhas o que preparou para ela conferir.',
    'Tipos de ação: operacao (registro de operação; status Concluída se já fez, Programada se é para fazer; tipoOperacao entre os de DADOS.tiposOperacao), reprogramar (operacaoId de uma operação existente + a nova data e, se disser, a hora), abastecimento (maquinaId, litros, horimetro se disser), chuva (mm, data, talhaoId se disser o local).',
    'Formato: texto simples; pode usar **negrito** e listas com "- ". No máximo umas 12 linhas, a não ser que peçam detalhes.',
  ].join('\n');
}

/** Agrônomo com fontes (busca no Google): só fontes técnicas, cita de onde tirou. */
export function instrucaoTecnica(hoje: string) {
  return [
    'Você é o Edy, a inteligência artificial do MercaPlant, respondendo como engenheiro agrônomo para produtores do Brasil (a maioria no Rio Grande do Sul). Fale no masculino.',
    `Hoje é ${hoje}. Responda em português do Brasil, curto e prático.`,
    'Pesquise e baseie a resposta em fontes técnicas oficiais, nesta ordem: Embrapa; MAPA (Zoneamento Agrícola de Risco Climático — ZARC, Agrofit para registro de produtos, RAS para sementes); Manual de Calagem e Adubação para os Estados do RS e SC (CQFS-RS/SC, SBCS-NRS); Emater/RS-Ascar; Seapi/DDPA-RS; Conab; universidades e fundações de pesquisa (UFRGS, UFSM, UPF, Fundação Pró-Sementes, CCGL TEC). Evite blogs e lojas.',
    'Diga de qual fonte veio cada ponto principal (ex.: "segundo a Embrapa Soja…", "pelo ZARC do MAPA…", "pelo Manual da CQFS-RS/SC…"). Se as fontes não forem claras ou divergirem, diga isso.',
    'Temas: estádio fenológico (escala da cultura), janela de plantio pelo ZARC do município/RS, nível de controle e de ação do MIP (amostragem, quando agir), adubação e calagem pela análise de solo, cultivares, manejo.',
    'Use também os DADOS da fazenda que vierem (talhões, estádio, análise de solo e a recomendação que o app calculou pelo manual) para responder para o caso dela; confira os números com o manual e explique.',
    'Defensivos: você pode explicar nível de controle, momento e modo de ação em termos gerais, mas NÃO indique produto comercial nem dose — isso é do agrônomo responsável, com receituário agronômico. Diga isso quando perguntarem.',
    'Formato: texto simples; pode usar **negrito** e listas com "- ". No máximo umas 15 linhas.',
  ].join('\n');
}

export const TIPOS_ACAO = ['operacao', 'reprogramar', 'abastecimento', 'chuva'];
export const STATUS_OP = ['Programada', 'Em andamento', 'Concluída'];
/** Esquema da resposta do chat: texto + registros prontos para a pessoa conferir. */
export function esquemaChat() {
  const nul = (type: string, description: string) => ({type, nullable: true, description});
  return {
    type: 'OBJECT',
    properties: {
      resposta: {type: 'STRING', description: 'Resposta para a pessoa (texto simples, pode usar **negrito** e listas com "- ")'},
      acoes: {type: 'ARRAY', description: 'Registros prontos para a pessoa conferir e salvar (vazio se a pergunta não pede registro)', items: {type: 'OBJECT', properties: {
        tipo: {type: 'STRING', enum: TIPOS_ACAO},
        talhaoId: nul('STRING', 'id do talhão em DADOS.talhoes'), maquinaId: nul('STRING', 'id da máquina em DADOS.maquinas'), operacaoId: nul('STRING', 'id da operação em DADOS.operacoes (para reprogramar)'),
        tipoOperacao: nul('STRING', 'tipo da operação (um de DADOS.tiposOperacao)'), status: {type: 'STRING', nullable: true, enum: STATUS_OP},
        data: nul('STRING', 'AAAA-MM-DD'), hora: nul('STRING', 'HH:MM'), area: nul('NUMBER', 'hectares'), litros: nul('NUMBER', 'litros abastecidos'),
        horimetro: nul('NUMBER', 'horímetro ou odômetro informado'), mm: nul('NUMBER', 'milímetros de chuva'), obs: nul('STRING', 'observação curta'),
      }, required: ['tipo']}},
    },
    required: ['resposta', 'acoes'],
  };
}

export type Acao = {tipo: string, talhaoId?: string, maquinaId?: string, operacaoId?: string, tipoOperacao?: string, status?: string, data?: string, hora?: string,
  area?: number, litros?: number, horimetro?: number, mm?: number, obs?: string};
const id = (v: unknown) => typeof v === 'string' && /^[\w-]{1,60}$/.test(v.trim()) ? v.trim() : undefined;
/** Confere as ações da IA: só tipos, datas, horas e números possíveis; sem o essencial, a ação cai. */
export function normalizarAcoes(lista: unknown, hoje: string): Acao[] {
  const ate = (() => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 400); return d.toISOString().slice(0, 10); })();
  return (Array.isArray(lista) ? lista : []).map((a: Record<string, unknown>) => {
    if (!a || !TIPOS_ACAO.includes(String(a.tipo))) return null;
    const d = dataIso(a.data), h = typeof a.hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(a.hora.trim()) ? a.hora.trim() : undefined;
    const r: Acao = {tipo: String(a.tipo)};
    const por = (k: keyof Acao, v: unknown) => { if (v !== undefined && v !== null) (r as Record<string, unknown>)[k] = v; };
    por('talhaoId', id(a.talhaoId)); por('maquinaId', id(a.maquinaId)); por('operacaoId', id(a.operacaoId));
    por('tipoOperacao', txt(a.tipoOperacao, 40) || undefined); por('status', STATUS_OP.includes(String(a.status)) ? String(a.status) : undefined);
    por('data', d && d >= '2000-01-01' && d <= ate ? d : undefined); por('hora', h);
    por('area', num(a.area, 0.01, 100000) ?? undefined); por('litros', num(a.litros, 0.1, 100000) ?? undefined);
    por('horimetro', num(a.horimetro, 0, 10000000) ?? undefined); por('mm', num(a.mm, 0, 400) ?? undefined); por('obs', txt(a.obs, 160) || undefined);
    if (r.tipo === 'operacao' && !r.tipoOperacao) return null;
    if (r.tipo === 'reprogramar' && (!r.operacaoId || !r.data)) return null;
    if (r.tipo === 'abastecimento' && (!r.maquinaId || r.litros == null)) return null;
    if (r.tipo === 'chuva' && r.mm == null) return null;
    if ((r.tipo === 'chuva' || (r.tipo === 'operacao' && r.status === 'Concluída')) && r.data && r.data > hoje) r.data = hoje;
    return r;
  }).filter(Boolean).slice(0, 6) as Acao[];
}

/** Texto do chat → {resposta, acoes}. Se o modelo não devolveu JSON, o texto inteiro é a resposta. */
export function lerChat(texto: string, hoje: string): {resposta: string, acoes: Acao[]} {
  try {
    const j = JSON.parse(texto);
    if (j && typeof j.resposta === 'string') return {resposta: j.resposta.trim(), acoes: normalizarAcoes(j.acoes, hoje)};
  } catch { /* texto puro */ }
  return {resposta: texto.trim(), acoes: []};
}

/** Fontes da busca do Google (groundingMetadata): título e endereço, sem repetir, até 6. */
export function fontesDaResposta(j: Record<string, unknown>): {titulo: string, url: string}[] {
  const c = (j?.candidates as {groundingMetadata?: {groundingChunks?: {web?: {uri?: string, title?: string}}[]}}[] | undefined)?.[0];
  const vistos = new Set<string>(), out: {titulo: string, url: string}[] = [];
  (c?.groundingMetadata?.groundingChunks || []).forEach(g => {
    const url = String(g?.web?.uri || ''), titulo = String(g?.web?.title || '').trim().slice(0, 120);
    if (!/^https:\/\//.test(url) || vistos.has(titulo || url)) return;
    vistos.add(titulo || url); out.push({titulo: titulo || url.replace(/^https:\/\/([^/]+).*/, '$1'), url});
  });
  return out.slice(0, 6);
}

/** Conversa no formato do Gemini: últimos turnos + a pergunta com os dados. */
export function conversa(historico: Turno[], pergunta: string, contexto: string) {
  const hist = (Array.isArray(historico) ? historico : []).filter(t => t && (t.de === 'pessoa' || t.de === 'ia') && typeof t.texto === 'string' && t.texto.trim())
    .slice(-8).map(t => ({role: t.de === 'ia' ? 'model' : 'user', parts: [{text: t.texto.slice(0, 2000)}]}));
  while (hist.length && hist[0].role === 'model') hist.shift(); // a conversa começa pela pessoa
  return [...hist, {role: 'user', parts: [{text: `DADOS (JSON):\n${contexto.slice(0, MAX_CONTEXTO)}\n\nPERGUNTA: ${pergunta.slice(0, MAX_PERGUNTA)}`}]}];
}
