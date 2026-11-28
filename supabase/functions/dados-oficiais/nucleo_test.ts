import assert from 'node:assert/strict';
import {campos, colunas, decendio, ingredienteLimpo, janelas, linhaAgrofit, linhasDoFluxo, linhaZarc, normalizar} from './nucleo.ts';
const assertEquals: (a: unknown, b: unknown) => void = (a, b) => assert.deepEqual(a, b);

const CAB_AGROFIT = 'NR_REGISTRO;MARCA_COMERCIAL;FORMULACAO;INGREDIENTE_ATIVO;TITULAR_DE_REGISTRO;CLASSE;MODO_DE_ACAO;CULTURA;PRAGA_NOME_CIENTIFICO;PRAGA_NOME_COMUM;EMPRESA_PAIS_TIPO;CLASSE_TOXICOLOGICA;CLASSE_AMBIENTAL;ORGANICOS;SITUACAO';
Deno.test('Agrofit: linha real do CSV vira registro sem marca e sem concentração', () => {
  const col = colunas(CAB_AGROFIT);
  const l = '35226 ;" Endemic; Protenac";SC - Suspensão Concentrada;Bacillus velezensis isolado SC-INF 03 (Biológico) (80 g/L) + Bacillus licheniformis isolado SC-INF 01 (Biológico) (20 g/L);Inflora Biociência Ltda;Fungicida microbiológico;seletivo;Todas as culturas;Sclerotinia sclerotiorum;Mofo branco; (Inflora<BRASIL>FORMULADOR);Categoria 5;Produto Pouco Perigoso;OUTROS;TRUE';
  const r = linhaAgrofit(campos(l), col)!;
  assertEquals(campos(l).length, 15);
  assertEquals(r.ingrediente, 'Bacillus licheniformis isolado SC-INF 01 (Biológico) + Bacillus velezensis isolado SC-INF 03 (Biológico)');
  assertEquals([r.cultura, r.alvo_comum, r.classe, r.modo_acao, r.alvo_n], ['Todas as culturas', 'Mofo branco', 'Fungicida microbiológico', 'seletivo', 'mofo branco sclerotinia sclerotiorum']);
  assert.ok(!JSON.stringify(r).includes('Endemic') && !JSON.stringify(r).includes('g/L'));
  assertEquals(linhaAgrofit(campos(l.replace(/TRUE$/, 'FALSE')), col), null); // registro cancelado
  assertEquals(ingredienteLimpo('azoxistrobina (200 g/L) + ciproconazol (80 g/L)'), 'azoxistrobina + ciproconazol');
  assertEquals(normalizar('Ferrugem-asiática'), 'ferrugem asiatica');
});

Deno.test('ZARC: linha da tábua de risco e janelas de plantio', () => {
  const cab = '﻿Nome_cultura;SafraIni;SafraFin;Cod_Cultura;Cod_Ciclo;Cod_Solo;geocodigo;UF;municipio;Cod_Clima;Nome_Clima;Cod_Outros_Manejos;Nome_Outros_Manejos;Produtividade;Cod_NM;Cod_Munic;Cod_Meso;Cod_Micro;Portaria;' + Array.from({length: 36}, (_, i) => 'dec' + (i + 1)).join(';');
  const decs = Array(36).fill(0); [28, 29, 30, 31, 32, 33, 34, 35, 36].forEach(d => decs[d - 1] = 20); decs[0] = 30; decs[1] = 40;
  const l = `Soja;2026;2027;1201;21;13;4314100;RS;Passo Fundo;0;Não se aplica;1;Sequeiro;;;012345;01;005;Port.300_de_01-07-2026;${decs.join(';')}`;
  const col = colunas(cab), z = linhaZarc(campos(l), col, new Set(['RS']))!;
  assertEquals([z.safra, z.geocodigo, z.municipio_n, z.ciclo, z.solo, z.manejo, z.portaria], ['2026/2027', 4314100, 'passo fundo', 21, 13, 'Sequeiro', 'Port.300_de_01-07-2026']);
  assertEquals(z.decs, '34' + '0'.repeat(25) + '222222222');
  assertEquals(linhaZarc(campos(l.replace(';RS;', ';MG;')), col, new Set(['RS'])), null);
  assertEquals(janelas(z.decs), [{de: '01/10', ate: '31/12', risco: 20}, {de: '01/01', ate: '10/01', risco: 30}, {de: '11/01', ate: '20/01', risco: 40}]);
  assertEquals(decendio(6), {ini: '21/02', fim: '28/02'});
});

Deno.test('pedaço do arquivo lido aos poucos: só linhas inteiras que começam antes do fim', async () => {
  const fluxo = (b: Uint8Array, n = 3) => new ReadableStream<Uint8Array>({start(c) { for (let i = 0; i < b.length; i += n) c.enqueue(b.slice(i, i + n)); c.close(); }});
  const todo = new TextEncoder().encode('cab\nl1;a\nl2;b\nl3;c\nl4;'), ler = async (g: AsyncGenerator<string>) => { const o: string[] = []; for await (const l of g) o.push(l); return o; };
  assertEquals(await ler(linhasDoFluxo(fluxo(todo), 0, true, todo.length, true)), ['cab', 'l1;a', 'l2;b', 'l3;c', 'l4;']);
  assertEquals(await ler(linhasDoFluxo(fluxo(todo), 0, true, todo.length, false)), ['cab', 'l1;a', 'l2;b', 'l3;c']); // l4 cortada: não é o fim do arquivo
  assertEquals(await ler(linhasDoFluxo(fluxo(todo.subarray(5)), 5, false, 100, true)), ['l2;b', 'l3;c', 'l4;']); // começou no meio de "l1;a"
  assertEquals(await ler(linhasDoFluxo(fluxo(todo.subarray(8)), 8, false, 100, true)), ['l2;b', 'l3;c', 'l4;']); // byte 8 é a quebra: l2 começa no 9
  assertEquals(await ler(linhasDoFluxo(fluxo(todo), 0, true, 9)), ['cab', 'l1;a']); // l2 começa no byte 9: fica para o próximo pedaço
  assertEquals(campos('a;"b;c";d'), ['a', 'b;c', 'd']);
});
