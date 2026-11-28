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
export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_FOTOS = 3;
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
    'AÇÕES: quando a pessoa contar algo que FEZ ou que aconteceu (ex.: "plantei 30 ha no T3", "abasteci 180 L no 7230", "choveu 25 mm") ou pedir para marcar, programar, passar ou reprogramar uma operação, coloque em acoes o registro pronto — o app mostra para a pessoa conferir e salvar; você nunca salva nada. Use os ids exatos de DADOS (talhoes[].id, maquinas[].id, operacoes[].id); "T3", "talhão 3" e "3" são o mesmo talhão se o nome bater. Datas em AAAA-MM-DD (hoje, ontem, sábado → calcule pela data de hoje). Para reprogramar, ache em DADOS.operacoes a operação ainda não concluída daquele talhão (e tipo, se disser) e use o id dela em operacaoId. Se faltar algo essencial (qual talhão, qual máquina, quantos litros) ou houver duas operações/talhões possíveis, pergunte na resposta e não crie a ação.',
    'Você NÃO registra, salva nem reprograma nada: nunca diga "registrei", "salvei", "reprogramei" ou "anotado". Diga "Preparei … para você conferir e salvar" e, em 1 ou 2 linhas, o que preparou. Se não criou a ação, não diga que fez.',
    'Tipos de ação: operacao (registro de operação; status Concluída se já fez, Programada se é para fazer; tipoOperacao entre os de DADOS.tiposOperacao), reprogramar (operacaoId de uma operação existente + a nova data e, se disser, a hora), abastecimento (maquinaId, litros, horimetro se disser), chuva (mm, data, talhaoId se disser o local).',
    'Exemplos (com hoje = quinta 26/11/2026): "passa o plantio do Talhão 08 para sábado" → uma ação reprogramar com operacaoId = id do Plantio do Talhão 08 (não concluído) em DADOS.operacoes e data 2026-11-28. "plantei 30 ha no T07" → uma ação operacao, tipoOperacao Plantio, talhaoId = id do Talhão 07, area 30, status Concluída, data 2026-11-26. "abasteci 180 L no 7230" → uma ação abastecimento, maquinaId = id do Trator 7230J, litros 180, data 2026-11-26. Cada coisa que a pessoa contar vira uma ação separada. Se você disser que preparou algo, a ação TEM de estar em acoes.',
    'DÚVIDA TÉCNICA: se a pergunta for uma dúvida agronômica geral que os DADOS não respondem (identificar ou manejar praga, doença ou planta daninha, nível de controle, adubação, cultivar, ZARC, estádio, tecnologia de aplicação), marque tecnica = true e responda só "Vou pesquisar nas fontes técnicas." — o agrônomo do Edy pesquisa e responde com as fontes. Se for sobre controlar um alvo ou produto registrado, preencha agrofitCultura e agrofitAlvo; se for sobre época/janela de plantio, preencha zarcCultura (e zarcMunicipio se citar outro município). Use a cultura do talhão citado se a pessoa não disser.',
    'Formato: texto simples; pode usar **negrito** e listas com "- ". No máximo umas 12 linhas, a não ser que peçam detalhes.',
  ].join('\n');
}

/** Agrônomo com fontes (busca no Google): só fontes técnicas, cita de onde tirou. */
export function instrucaoTecnica(hoje: string) {
  return [
    'Você é o Edy, a inteligência artificial do MercaPlant, e responde como um engenheiro agrônomo experiente, para produtores do Brasil (a maioria no Rio Grande do Sul). Fale no masculino.',
    `Hoje é ${hoje}. Responda em português do Brasil, direto e prático, como um agrônomo de campo explicaria ao produtor.`,
    ...REGRAS_FONTES,
    'Temas: identificação e manejo de pragas, doenças e plantas daninhas; nível de controle e de ação do MIP (como amostrar, quando agir); estádio fenológico (escala da cultura); janela de plantio pelo ZARC do município/RS; adubação e calagem pela análise de solo (manual CQFS-RS/SC); cultivares; manejo de resistência; tecnologia de aplicação.',
    'Não se apresente nem cumprimente (nada de "Fala, produtor" ou "Aqui é o Edy"): vá direto à resposta.',
    'Use também os DADOS da fazenda que vierem (talhões, cultura, estádio, monitoramentos, análise de solo e a recomendação que o app calculou pelo manual) para responder para o caso dela; confira os números com o manual e explique.',
    ...REGRAS_MANEJO,
    'Formato: texto simples; pode usar **negrito** e listas com "- ". No máximo umas 18 linhas.',
  ].join('\n');
}

/** Fontes e precisão (modo técnico e diagnóstico por foto). */
const REGRAS_FONTES = [
  'SEMPRE pesquise no Google antes de responder. Baseie a resposta em fontes técnicas, nesta ordem: Embrapa (Soja, Trigo, Milho e Sorgo, Clima Temperado, Arroz e Feijão…); MAPA (ZARC, Agrofit para produtos registrados, RAS); Manual de Calagem e Adubação RS/SC (CQFS-RS/SC, SBCS-NRS); Emater/RS-Ascar; Seapi/DDPA-RS; Conab; universidades e fundações (UFRGS, UFSM, UPF, UFPel, Fundação Pró-Sementes, CCGL TEC, Fundação ABC); HRAC/IRAC/FRAC-BR para modos de ação. Evite blogs, lojas e revendas.',
  'Precisão: números (nível de ação, épocas, doses de adubo, população, dias) SÓ se vierem de uma fonte encontrada — diga de qual (ex.: "segundo a Embrapa Soja…", "pelo ZARC do MAPA…", "pelo Manual da CQFS-RS/SC…"). Se as fontes divergirem ou não forem claras, diga isso. Se não achar fonte confiável, diga que não encontrou e NÃO invente.',
];
/** Como combater, sem receita: o que o agrônomo responsável assina não é a IA que decide. */
const REGRAS_MANEJO = [
  'Como combater: explique o manejo integrado — cultural (rotação, época, cultivar resistente/tolerante, palhada, cobertura), mecânico, biológico (agentes e produtos biológicos pelo tipo, ex.: Bacillus thuringiensis, Trichoderma, baculovírus, parasitoides) e químico pelo GRUPO/MECANISMO DE AÇÃO (HRAC, IRAC ou FRAC, ex.: "inibidores da ALS — HRAC grupo 2"), com rotação de mecanismos para evitar resistência, momento certo (estádio da planta daninha/praga, nível de ação) e tecnologia de aplicação.',
  'Registrados: se vierem DADOS OFICIAIS do Agrofit, você pode citar os INGREDIENTES ATIVOS registrados para a cultura e o alvo (com a classe), dizendo que a fonte é o Agrofit/MAPA. Se vier ZARC, use a janela e o risco dele e cite a portaria: copie datas e riscos EXATAMENTE como estão em cada linha (grupo — solos: período (risco)), sem juntar linhas nem trocar o risco; se não souber o grupo ou o solo do talhão, mostre as opções e diga o que conferir.',
  'Defensivos: NÃO indique marca comercial, NÃO dê dose nem monte receita. Diga que o produto e a dose saem do receituário agronômico do agrônomo responsável, usando só produto registrado no Agrofit/MAPA para a cultura e o alvo.',
];

/** Diagnóstico por foto: praga, doença, planta daninha, deficiência ou dano. */
export function instrucaoFoto(hoje: string) {
  return [
    'Você é o Edy, a inteligência artificial do MercaPlant, agindo como engenheiro agrônomo que identifica problemas na lavoura por foto, para produtores do Brasil (a maioria no RS). Fale no masculino.',
    `Hoje é ${hoje}. Responda em português do Brasil, direto e prático.`,
    'Olhe a(s) foto(s) com cuidado e identifique o que aparece: praga (inseto, ácaro, lagarta, percevejo, lesma…), doença (fungo, bactéria, vírus, nematoide), planta daninha, deficiência nutricional, fitotoxidez ou outro dano. Use a cultura, o estádio, a região, o tempo e os monitoramentos dos DADOS para decidir entre as possibilidades.',
    'Seja honesto com a dúvida: se a foto não deixa ter certeza, diga a confiança (alta, média ou baixa), cite o que pode ser confundido e peça a foto que falta (ex.: verso da folha, inseto de perto, planta inteira, raiz). Se não for planta/lavoura ou estiver ilegível, diga isso e não chute.',
    ...REGRAS_FONTES,
    ...REGRAS_MANEJO,
    'Responda nesta ordem, com **negrito** nos títulos e listas com "- ":',
    '**Provável:** nome comum (nome científico) — confiança alta/média/baixa',
    '**Por que:** os sinais vistos na foto',
    '**Pode ser confundido com:** (se houver)',
    '**Confirme no campo:** como olhar/amostrar',
    '**Nível de ação ou dano:** (com a fonte; se não houver nível definido, diga)',
    '**Como combater:** manejo integrado (cultural, biológico, químico pelo mecanismo de ação), sem marca e sem dose',
    'No máximo umas 22 linhas. Na ÚLTIMA linha, sozinha, escreva exatamente: ALVO: <nome comum> | TIPO: <Praga, Doença, Planta daninha, Deficiência, Outro ou Nenhum> | CONFIANCA: <alta, media ou baixa> | CULTURA: <cultura da lavoura na foto ou do talhão>',
  ].join('\n');
}

export type Diagnostico = {alvo: string, tipo: string, confianca: string, cultura?: string};
const TIPOS_DIAG = ['Praga', 'Doença', 'Planta daninha', 'Deficiência', 'Outro', 'Nenhum'];
/** Separa a última linha "ALVO: … | TIPO: … | CONFIANCA: …" do texto do diagnóstico. */
export function lerDiagnostico(texto: string): {resposta: string, diagnostico: Diagnostico | null} {
  const linhas = String(texto || '').trim().split('\n');
  const i = linhas.map(l => l.replace(/[*_`]/g, '').trim()).findLastIndex(l => /^ALVO\s*:/i.test(l));
  if (i < 0) return {resposta: texto.trim(), diagnostico: null};
  const l = linhas[i].replace(/[*_`]/g, ''), campo = (k: string) => (l.match(new RegExp(k + '\\s*:\\s*([^|]+)', 'i'))?.[1] || '').trim();
  const sem = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const tipo = TIPOS_DIAG.find(t => sem(t) === sem(campo('TIPO'))) || 'Outro';
  const conf = ['alta', 'media', 'baixa'].find(c => sem(campo('CONFIAN[CÇ]A')) === c) || 'baixa';
  const alvo = campo('ALVO').replace(/[<>]/g, '').slice(0, 80), cultura = campo('CULTURA').replace(/[<>]/g, '').slice(0, 40);
  linhas.splice(i, 1);
  return {resposta: linhas.join('\n').trim(), diagnostico: alvo && tipo !== 'Nenhum' ? {alvo, tipo, confianca: conf, ...(cultura && !/^(-|nenhum|desconhecid)/i.test(cultura) ? {cultura} : {})} : null};
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
      tecnica: {type: 'BOOLEAN', nullable: true, description: 'true se é dúvida agronômica geral que precisa de pesquisa em fontes técnicas (os DADOS não respondem)'},
      agrofitCultura: {type: 'STRING', nullable: true, description: 'Se a dúvida é sobre controlar/produto para um alvo: a cultura (ex.: Soja, Milho, Trigo)'},
      agrofitAlvo: {type: 'STRING', nullable: true, description: 'O alvo (praga, doença ou planta daninha) pelo nome comum ou científico (ex.: Ferrugem-asiática, Buva)'},
      zarcCultura: {type: 'STRING', nullable: true, description: 'Se a dúvida é sobre época/janela de plantio ou ZARC: a cultura'},
      zarcMunicipio: {type: 'STRING', nullable: true, description: 'Município citado na pergunta para o ZARC (vazio = o da fazenda)'},
      acoes: {type: 'ARRAY', description: 'Registros prontos para a pessoa conferir e salvar (vazio se a pergunta não pede registro)', items: {type: 'OBJECT', properties: {
        tipo: {type: 'STRING', enum: TIPOS_ACAO},
        talhaoId: nul('STRING', 'id do talhão em DADOS.talhoes'), maquinaId: nul('STRING', 'id da máquina em DADOS.maquinas'), operacaoId: nul('STRING', 'id da operação em DADOS.operacoes (para reprogramar)'),
        tipoOperacao: nul('STRING', 'tipo da operação (um de DADOS.tiposOperacao)'), status: {type: 'STRING', nullable: true, enum: STATUS_OP},
        data: {type: 'STRING', description: 'AAAA-MM-DD: o dia do registro, ou a NOVA data ao reprogramar'}, hora: nul('STRING', 'HH:MM'), area: nul('NUMBER', 'hectares'), litros: nul('NUMBER', 'litros abastecidos'),
        horimetro: nul('NUMBER', 'horímetro ou odômetro informado'), mm: nul('NUMBER', 'milímetros de chuva'), obs: nul('STRING', 'observação curta'),
      }, required: ['tipo', 'data']}},
    },
    required: ['resposta', 'acoes'],
  };
}

export type Acao = {tipo: string, talhaoId?: string, maquinaId?: string, operacaoId?: string, tipoOperacao?: string, status?: string, data?: string, hora?: string,
  area?: number, litros?: number, horimetro?: number, mm?: number, obs?: string};
const TIPO_OK = /^[\p{L}][\p{L} /-]{1,39}$/u; // "Plantio", "Preparo de solo" (texto quebrado da IA não passa)
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
    por('tipoOperacao', TIPO_OK.test(String(a.tipoOperacao ?? '').trim()) ? String(a.tipoOperacao).trim() : undefined); por('status', STATUS_OP.includes(String(a.status)) ? String(a.status) : undefined);
    por('data', d && d >= '2000-01-01' && d <= ate ? d : undefined); por('hora', h);
    por('area', num(a.area, 0.01, 100000) ?? undefined); por('litros', num(a.litros, 0.1, 100000) ?? undefined);
    por('horimetro', num(a.horimetro, 0, 10000000) ?? undefined); por('mm', num(a.mm, 0, 400) ?? undefined); por('obs', txt(a.obs, 160) || undefined);
    if (r.tipo === 'operacao' && r.operacaoId && r.data && r.status !== 'Concluída') r.tipo = 'reprogramar'; // mudar uma operação que já existe
    if (r.tipo === 'operacao' && !r.tipoOperacao) return null;
    if (r.tipo === 'reprogramar' && (!r.operacaoId || !r.data)) return null;
    if (r.tipo === 'abastecimento' && (!r.maquinaId || r.litros == null)) return null;
    if (r.tipo === 'chuva' && r.mm == null) return null;
    if ((r.tipo === 'chuva' || (r.tipo === 'operacao' && r.status === 'Concluída')) && r.data && r.data > hoje) r.data = hoje;
    return r;
  }).filter(Boolean).slice(0, 6) as Acao[];
}

/** A IA às vezes devolve um registro quebrado (aspas e campos dentro de um texto): vale pedir de novo. */
export function acoesQuebradas(texto: string): boolean {
  try {
    const j = JSON.parse(texto), lista = Array.isArray(j?.acoes) ? j.acoes : [];
    return lista.some((a: Record<string, unknown>) => Object.values(a || {}).some(v => typeof v === 'string' && /["{}\n]|\w:\s?\w/.test(v) && !/^\d{2}:\d{2}$/.test(v)));
  } catch { return false; }
}

/** Texto do chat → {resposta, acoes}. Se o modelo não devolveu JSON, o texto inteiro é a resposta. */
export type ConsultaOficial = {agrofitCultura?: string, agrofitAlvo?: string, zarcCultura?: string, zarcMunicipio?: string};
export function lerChat(texto: string, hoje: string): {resposta: string, acoes: Acao[], tecnica?: boolean, consulta?: ConsultaOficial} {
  try {
    const j = JSON.parse(texto);
    if (j && typeof j.resposta === 'string') {
      const acoes = normalizarAcoes(j.acoes, hoje);
      const consulta = Object.fromEntries(['agrofitCultura', 'agrofitAlvo', 'zarcCultura', 'zarcMunicipio'].map(k => [k, txt(j[k], 80)]).filter(([, v]) => v)) as ConsultaOficial;
      return {resposta: j.resposta.trim(), acoes, ...(j.tecnica === true && !acoes.length ? {tecnica: true, ...(Object.keys(consulta).length ? {consulta} : {})} : {})};
    }
  } catch { /* texto puro */ }
  return {resposta: texto.trim(), acoes: []};
}

/** Fontes técnicas/oficiais (aparecem primeiro, com selo). */
export const FONTES_OFICIAIS = /(^|\.)(embrapa\.br|gov\.br|agricultura\.rs\.gov\.br|emater\.tche\.br|ufrgs\.br|ufsm\.br|upf\.br|ufpel\.edu\.br|ufsc\.br|udesc\.br|usp\.br|unesp\.br|ufv\.br|ufpr\.br|epagri\.sc\.gov\.br|iapar\.br|idr\.pr\.gov\.br|conab\.gov\.br|sbcs-nrs\.org\.br|sbcs\.org\.br|fundacaoprosementes\.com\.br|ccgl\.com\.br|fundacaoabc\.org|hrac-br\.org|irac-br\.org|frac-br\.org|scielo\.br|edu\.br)$/i;
/** Fontes da busca do Google (groundingMetadata): título e endereço, sem repetir, as técnicas/oficiais primeiro, até 6. */
export function fontesDaResposta(j: Record<string, unknown>): {titulo: string, url: string, oficial?: boolean}[] {
  const c = (j?.candidates as {groundingMetadata?: {groundingChunks?: {web?: {uri?: string, title?: string}}[]}}[] | undefined)?.[0];
  const vistos = new Set<string>(), out: {titulo: string, url: string, oficial?: boolean}[] = [];
  (c?.groundingMetadata?.groundingChunks || []).forEach(g => {
    const url = String(g?.web?.uri || ''), titulo = String(g?.web?.title || '').trim().slice(0, 120);
    if (!/^https:\/\//.test(url) || vistos.has(titulo || url)) return;
    vistos.add(titulo || url);
    const nome = titulo || url.replace(/^https:\/\/([^/]+).*/, '$1'), dominio = nome.replace(/^www\./, '').split('/')[0];
    out.push({titulo: nome, url, ...(FONTES_OFICIAIS.test(dominio) ? {oficial: true} : {})});
  });
  return out.sort((a, b) => Number(!!b.oficial) - Number(!!a.oficial)).slice(0, 6);
}

/** Conversa no formato do Gemini: últimos turnos + a pergunta com os dados. */
export function conversa(historico: Turno[], pergunta: string, contexto: string) {
  const hist = (Array.isArray(historico) ? historico : []).filter(t => t && (t.de === 'pessoa' || t.de === 'ia') && typeof t.texto === 'string' && t.texto.trim())
    .slice(-8).map(t => ({role: t.de === 'ia' ? 'model' : 'user', parts: [{text: t.texto.slice(0, 2000)}]}));
  while (hist.length && hist[0].role === 'model') hist.shift(); // a conversa começa pela pessoa
  return [...hist, {role: 'user', parts: [{text: `DADOS (JSON):\n${contexto.slice(0, MAX_CONTEXTO)}\n\nPERGUNTA: ${pergunta.slice(0, MAX_PERGUNTA)}`}]}];
}
