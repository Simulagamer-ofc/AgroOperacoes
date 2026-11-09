// MercaPlant — leitura da foto da nota fiscal (DANFE) para dar entrada no estoque.
// O app manda 1 a 4 fotos; a função confere o login e o acesso à fazenda (tela Estoque ou Compras),
// limita o uso por fazenda e por dia, e pede a um modelo de IA com leitura de imagem que transcreva a nota
// num formato fixo (ferramenta "registrar_nota"). Nada entra no estoque aqui: o app mostra a conferência
// e só grava depois que a pessoa confere item por item.
// A chave da IA fica só no servidor (segredo ANTHROPIC_API_KEY). Publicar com verify_jwt = true.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS'};
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), {status, headers: {...CORS, 'Content-Type': 'application/json'}});
const erro = (status: number, message: string) => json({message}, status);

const CHAVE_APP = 'sb_publishable_BxbOeMIvyAlyTkCMy3sUWg__PpRKnYK'; // chave pública do app (mesma do nuvem.js)
const LIMITE_DIA = Number(Deno.env.get('NOTA_FOTO_LIMITE_DIA') || 60); // notas lidas por fazenda por dia
const MODELO = Deno.env.get('NOTA_FOTO_MODELO') || 'claude-sonnet-5-5';
const MAX_FOTOS = 4, MAX_BYTES = 4_500_000; // por foto, já em base64 (o app reduz antes de enviar)
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

const num = {type: ['number', 'null']}, txt = {type: ['string', 'null']};
const FERRAMENTA = {
  name: 'registrar_nota',
  description: 'Registra o que está escrito na nota fiscal (DANFE) das fotos, exatamente como impresso.',
  input_schema: {
    type: 'object',
    properties: {
      eh_nota: {type: 'boolean', description: 'true se as fotos são de uma nota fiscal / DANFE legível'},
      motivo: {...txt, description: 'Se eh_nota for false ou a leitura estiver ruim: o motivo, curto, em português'},
      chave: {...txt, description: 'Chave de acesso com 44 dígitos, só números, sem espaços'},
      numero: {...txt, description: 'Número da NF-e, só números'},
      serie: txt,
      data_emissao: {...txt, description: 'AAAA-MM-DD'},
      emitente: {...txt, description: 'Razão social do emitente (quem vendeu)'},
      cnpj_emitente: {...txt, description: 'CNPJ ou CPF do emitente, só números'},
      total_produtos: {...num, description: 'VALOR TOTAL DOS PRODUTOS'},
      total_nota: {...num, description: 'VALOR TOTAL DA NOTA'},
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            codigo: txt, descricao: txt, ncm: txt,
            unidade: {...txt, description: 'Unidade comercial como impressa (UN, KG, L, SC, CX…)'},
            quantidade: num, valor_unitario: num,
            valor_total: {...num, description: 'Valor total do item (quantidade × valor unitário), sem impostos'},
            desconto: num,
            lote: {...txt, description: 'Lote, se impresso nos dados do produto ou informações adicionais'},
            validade: {...txt, description: 'Validade AAAA-MM-DD, se impressa'},
            duvida: {type: 'boolean', description: 'true se algum número ou texto deste item estava difícil de ler'},
          },
          required: ['descricao', 'quantidade', 'valor_total', 'duvida'],
        },
      },
      duplicatas: {type: 'array', items: {type: 'object', properties: {numero: txt, vencimento: {...txt, description: 'AAAA-MM-DD'}, valor: num}}},
    },
    required: ['eh_nota', 'itens'],
  },
};
const PEDIDO = `Estas fotos são de uma nota fiscal brasileira (DANFE) de compra de uma fazenda, possivelmente em mais de uma página.
Transcreva exatamente o que está impresso e chame a ferramenta registrar_nota.
- Não invente nem complete nada: o que não estiver legível fica null e o item recebe duvida = true.
- Itens: todas as linhas do quadro "Dados dos produtos / serviços", na ordem, sem juntar nem pular linhas. Se uma descrição continuar na linha de baixo, junte ao mesmo item.
- Números com ponto decimal (1.234,56 vira 1234.56). Quantidade na unidade impressa na nota.
- Chave de acesso: os 44 dígitos impressos perto do código de barras.
- Se as fotos não forem de uma nota fiscal, eh_nota = false e diga o motivo.`;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: CORS});
  if (req.method !== 'POST') return erro(405, 'Use POST.');
  try {
    const auth = req.headers.get('Authorization') || '';
    const b = await req.json().catch(() => ({}));
    const fazenda = String(b.farm_id || '');
    // Acesso: login válido e tela Estoque ou Compras nesta fazenda (ADM e supervisor têm todas)
    const eu = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') || CHAVE_APP, {global: {headers: {Authorization: auth}}, auth: {persistSession: false}});
    const [{data: est}, {data: cpr}] = await Promise.all([eu.rpc('tem_modulo', {p_farm: fazenda, p_modulo: 'estoque'}), eu.rpc('tem_modulo', {p_farm: fazenda, p_modulo: 'compras'})]);
    if (!est && !cpr) return erro(403, 'Sem acesso ao Estoque desta fazenda.');

    const fotos = Array.isArray(b.imagens) ? b.imagens.slice(0, MAX_FOTOS) : [];
    if (!fotos.length) return erro(400, 'Mande pelo menos uma foto da nota.');
    for (const f of fotos) {
      if (!TIPOS.includes(f?.tipo) || typeof f?.dados !== 'string' || !f.dados.length) return erro(400, 'Foto em formato inválido.');
      if (f.dados.length > MAX_BYTES) return erro(413, 'Foto grande demais. Tire de novo, mais perto e só da nota.');
    }

    const chaveIa = Deno.env.get('ANTHROPIC_API_KEY');
    if (!chaveIa) return erro(503, 'A leitura da foto da nota ainda não foi ligada no servidor. Por enquanto, use o XML da nota.');

    // Limite por fazenda e por dia (protege o custo da leitura)
    const adm = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth: {persistSession: false}});
    const {data: n, error: eUso} = await adm.rpc('nota_foto_contar', {p_farm: fazenda, p_limite: LIMITE_DIA});
    if (eUso) return erro(500, 'Não foi possível conferir o limite de uso.');
    if (n === -1) return erro(429, `Limite de ${LIMITE_DIA} notas lidas por foto hoje nesta fazenda. Amanhã libera de novo, ou use o XML da nota.`);

    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 90000);
    let r: Response;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctl.signal,
        headers: {'x-api-key': chaveIa, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
        body: JSON.stringify({
          model: MODELO, max_tokens: 8000, temperature: 0,
          tools: [FERRAMENTA], tool_choice: {type: 'tool', name: 'registrar_nota'},
          messages: [{role: 'user', content: [...fotos.map((f: any) => ({type: 'image', source: {type: 'base64', media_type: f.tipo, data: f.dados}})), {type: 'text', text: PEDIDO}]}],
        }),
      });
    } finally { clearTimeout(t); }
    if (!r.ok) { console.error('IA', r.status, (await r.text()).slice(0, 300)); return erro(502, 'O serviço de leitura não respondeu. Tente de novo em instantes.'); }
    const resp = await r.json();
    const uso = resp.content?.find((c: any) => c.type === 'tool_use' && c.name === 'registrar_nota');
    if (!uso?.input) return erro(502, 'Não foi possível ler a nota. Tire a foto de novo, com boa luz e a nota inteira.');
    return json({nota: uso.input, usadasHoje: n, limite: LIMITE_DIA});
  } catch (e) {
    console.error(e);
    return erro(500, (e as Error).name === 'AbortError' ? 'A leitura demorou demais. Tente com menos fotos.' : 'Erro inesperado ao ler a nota.');
  }
});
