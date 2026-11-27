import assert from 'node:assert/strict';
const assertEquals = (a: unknown, b: unknown) => assert.deepEqual(a, b);
import {erroGemini, esquemaBoletim, esquemaChat, fontesDaResposta, instrucaoAssistente, instrucaoTecnica, lerChat, normalizarAcoes, normalizarBoletim, textoDaResposta} from './nucleo.ts';

const G = [{id: 'cultivada', rot: 'Outra espécie cultivada'}, {id: 'silvestre', rot: 'Silvestre'}, {id: 'nt', rot: 'Nociva tolerada'}];

Deno.test('normaliza números com vírgula, data brasileira e grupos fora da lista', () => {
  const b = normalizarBoletim({data: '12/11/2026', boletim: ' 1234/26 ', germinacao: '92', pureza: '98,7', outrasPct: 0.3, amostraG: '500', umidade: 130,
    encontradas: [{nome: 'Azevém', n: 3, grupo: 'nt'}, {nome: 'Nabo', n: 1.4, grupo: 'nenhum'}, {nome: '', n: 2, grupo: 'nt'}], avisos: ['ok']}, G);
  assertEquals(b.data, '2026-11-12'); assertEquals(b.boletim, '1234/26');
  assertEquals(b.germinacao, 92); assertEquals(b.pureza, 98.7); assertEquals(b.outrasPct, 0.3); assertEquals(b.amostraG, 500);
  assertEquals(b.umidade, null); // fora de 0–100
  assertEquals(b.encontradas, [{nome: 'Azevém', n: 3, grupo: 'nt'}, {nome: 'Nabo', n: 1, grupo: ''}]);
});

Deno.test('data no futuro ou ilegível não entra; aviso de data', () => {
  const b = normalizarBoletim({data: '31/12/2099', encontradas: [], avisos: []}, G);
  assertEquals(b.data, null);
  assertEquals(normalizarBoletim({data: 'ontem', encontradas: [], avisos: []}, G).avisos.length, 1);
});

Deno.test('esquema com os grupos da espécie e texto da resposta', () => {
  const e = esquemaBoletim(G) as {properties: {encontradas: {items: {properties: {grupo: {enum: string[]}}}}}};
  assertEquals(e.properties.encontradas.items.properties.grupo.enum, ['cultivada', 'silvestre', 'nt', 'nenhum']);
  assertEquals(textoDaResposta({candidates: [{content: {parts: [{text: '{"a":'}, {text: '1}'}]}}]}), '{"a":1}');
});

Deno.test('erros do Gemini viram mensagem clara', () => {
  assertEquals(erroGemini(429, '').status, 429);
  assertEquals(erroGemini(400, 'API key not valid').status, 503);
  assertEquals(erroGemini(503, '').status, 502);
});

import {conversa} from './nucleo.ts';
Deno.test('assistente: conversa começa pela pessoa, corta o histórico e leva os dados na última pergunta', () => {
  const h = [{de: 'ia', texto: 'Olá'}, ...Array.from({length: 12}, (_, i) => ({de: i % 2 ? 'ia' : 'pessoa', texto: 't' + i}))] as {de: 'pessoa' | 'ia', texto: string}[];
  const c = conversa(h, 'Quanto choveu?', '{"chuvas":[]}');
  assertEquals(c[0].role, 'user');
  assertEquals(c.at(-1)!.role, 'user');
  assert.ok(c.at(-1)!.parts[0].text.includes('PERGUNTA: Quanto choveu?') && c.at(-1)!.parts[0].text.includes('"chuvas"'));
  assert.ok(c.length <= 9);
  assert.ok(instrucaoAssistente('27/11/2026').includes('NÃO receite'));
});

Deno.test('Edy: nome nas instruções, sem receitar defensivo, fontes oficiais no modo técnico', () => {
  const a = instrucaoAssistente('quinta-feira, 26/11/2026'), t = instrucaoTecnica('quinta-feira, 26/11/2026');
  assert.ok(a.includes('Edy') && !/\bEde\b/.test(a) && a.includes('NÃO receite'));
  assert.ok(t.includes('Embrapa') && t.includes('ZARC') && t.includes('CQFS-RS/SC') && t.includes('NÃO indique produto'));
  assertEquals((esquemaChat() as {required: string[]}).required, ['resposta', 'acoes']);
});

Deno.test('ações da IA: só o que é possível, sem o essencial a ação cai', () => {
  const a = normalizarAcoes([
    {tipo: 'operacao', tipoOperacao: 'Plantio', talhaoId: 't3', area: '30', status: 'Concluída', data: '2026-11-26'},
    {tipo: 'abastecimento', maquinaId: 'm1', litros: 180, horimetro: 1495.5},
    {tipo: 'reprogramar', operacaoId: 'o8', data: '28/11/2026', hora: '07:30'},
    {tipo: 'chuva', mm: 25, data: '2026-11-30'}, // leitura no futuro vira hoje
    {tipo: 'abastecimento', maquinaId: 'm1'}, // sem litros
    {tipo: 'reprogramar', operacaoId: 'o8'}, // sem data
    {tipo: 'apagar', operacaoId: 'o8'}, // tipo que não existe
    {tipo: 'operacao', tipoOperacao: 'Colheita', talhaoId: '../x', hora: '25:00', area: -3},
  ], '2026-11-26');
  assertEquals(a.length, 5);
  assertEquals(a[0], {tipo: 'operacao', talhaoId: 't3', tipoOperacao: 'Plantio', status: 'Concluída', data: '2026-11-26', area: 30});
  assertEquals(a[1].litros, 180); assertEquals(a[1].horimetro, 1495.5);
  assertEquals(a[2], {tipo: 'reprogramar', operacaoId: 'o8', data: '2026-11-28', hora: '07:30'});
  assertEquals(a[3].data, '2026-11-26');
  assertEquals(a[4], {tipo: 'operacao', tipoOperacao: 'Colheita'});
});

Deno.test('resposta do chat em JSON ou texto puro; fontes da busca sem repetir', () => {
  assertEquals(lerChat('{"resposta":" Preparei o plantio. ","acoes":[{"tipo":"chuva","mm":12}]}', '2026-11-26'), {resposta: 'Preparei o plantio.', acoes: [{tipo: 'chuva', mm: 12}]});
  assertEquals(lerChat('Só texto', '2026-11-26'), {resposta: 'Só texto', acoes: []});
  const f = fontesDaResposta({candidates: [{groundingMetadata: {groundingChunks: [{web: {uri: 'https://x.google/1', title: 'embrapa.br'}}, {web: {uri: 'https://x.google/2', title: 'embrapa.br'}}, {web: {uri: 'http://inseguro', title: 'a'}}, {web: {uri: 'https://x.google/3', title: 'gov.br'}}]}}]});
  assertEquals(f, [{titulo: 'embrapa.br', url: 'https://x.google/1'}, {titulo: 'gov.br', url: 'https://x.google/3'}]);
});
