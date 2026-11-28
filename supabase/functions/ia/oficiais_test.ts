import assert from 'node:assert/strict';
import * as nucleoDados from '../dados-oficiais/nucleo.ts';
import {janelas, normalizar, padraoBusca, resumirAgrofit, resumirZarc, textoOficiais} from './oficiais.ts';
const assertEquals = (a: unknown, b: unknown) => assert.deepEqual(a, b);

Deno.test('as cópias batem com dados-oficiais/nucleo.ts', () => {
  for (const d of ['0'.repeat(27) + '222222222', '34' + '0'.repeat(25) + '222222222', '0000022233300000000000000000000000000'.slice(0, 36)]) assertEquals(janelas(d), nucleoDados.janelas(d));
  assertEquals(normalizar('Ferrugem-asiática da Soja'), nucleoDados.normalizar('Ferrugem-asiática da Soja'));
});

Deno.test('Agrofit: ingredientes registrados, sem marca e sem dose; busca pelo alvo', () => {
  assertEquals(padraoBusca('Ferrugem-asiática da soja', 'Soja'), '%ferrugem%asiatica%');
  assertEquals(padraoBusca('buva'), '%buva%');
  const r = resumirAgrofit([
    {cultura: 'Soja', alvo_comum: 'Ferrugem-asiática', alvo_cientifico: 'Phakopsora pachyrhizi', ingrediente: 'azoxistrobina + ciproconazol', classe: 'Fungicida', modo_acao: 'sistêmico', produtos: 12},
    {cultura: 'Soja', alvo_comum: 'Ferrugem', alvo_cientifico: 'Phakopsora pachyrhizi', ingrediente: 'mancozebe', classe: 'Fungicida', modo_acao: 'contato', produtos: 20},
    {cultura: 'Soja', alvo_comum: 'Ferrugem-asiática', alvo_cientifico: 'Phakopsora pachyrhizi', ingrediente: 'azoxistrobina + ciproconazol', classe: 'Fungicida', modo_acao: 'sistêmico', produtos: 3},
    {cultura: 'Todas as culturas', alvo_comum: 'Ferrugem-asiática', alvo_cientifico: 'Phakopsora pachyrhizi', ingrediente: 'Bacillus subtilis (Biológico)', classe: 'Fungicida microbiológico', modo_acao: '', produtos: 40, organico: true},
  ], 'Soja', 'Ferrugem-asiática', '28/11/2026')!;
  assertEquals(r.titulo, 'Registrado no MAPA (Agrofit) — Soja × Ferrugem-asiática');
  assertEquals(r.fonte, 'Agrofit/MAPA, dados abertos (atualizado em 28/11/2026)');
  assertEquals(r.linhas[0], '3 ingredientes ativos em 75 registros ativos. Alvo no Agrofit: Ferrugem-asiática (Phakopsora pachyrhizi); Ferrugem (Phakopsora pachyrhizi).');
  assertEquals(r.linhas.slice(1, 4), ['mancozebe — Fungicida (contato) · 20 produtos', 'azoxistrobina + ciproconazol — Fungicida (sistêmico) · 15 produtos',
    'Bacillus subtilis (Biológico) — Fungicida microbiológico · 40 produtos · registro para "todas as culturas" · permitido no orgânico']);
  assert.ok(r.linhas.at(-1)!.includes('receituário'));
  assertEquals(resumirAgrofit([], 'Soja', 'x'), null);
  // modos de ação escritos de jeitos diferentes viram uma lista só
  const m = resumirAgrofit([
    {cultura: 'Soja', alvo_comum: 'Buva', alvo_cientifico: 'Conyza bonariensis', ingrediente: 'glifosato', classe: 'Herbicida', modo_acao: 'Sistêmico; Seletivo;', produtos: 2},
    {cultura: 'Soja', alvo_comum: 'Buva', alvo_cientifico: 'Conyza bonariensis', ingrediente: 'glifosato', classe: 'Herbicida', modo_acao: 'sistêmico, Sistêmico/Seletivo', produtos: 1},
  ], 'Soja', 'Buva')!;
  assertEquals(m.linhas[1], 'glifosato — Herbicida (sistêmico, seletivo) · 3 produtos');
});

Deno.test('ZARC: janelas por ciclo juntando solos iguais, sequeiro primeiro', () => {
  const base = {cultura: 'Soja', safra: '2026/2027', municipio: 'Passo Fundo', uf: 'RS', clima: 'Não se aplica', portaria: 'Port.300_de_01-07-2026'};
  const d1 = '0'.repeat(27) + '222222222', d2 = '0'.repeat(28) + '22222223';
  const r = resumirZarc([
    {...base, ciclo: 21, solo: 13, manejo: 'Sequeiro', decs: d1}, {...base, ciclo: 21, solo: 14, manejo: 'Sequeiro', decs: d1}, {...base, ciclo: 21, solo: 11, manejo: 'Sequeiro', decs: d2 + '0'},
    {...base, ciclo: 21, solo: 13, manejo: 'Irrigado', decs: d1},
  ])!;
  assertEquals(r.titulo, 'ZARC — Passo Fundo/RS, safra 2026/2027');
  assertEquals(r.fonte, 'ZARC/MAPA (Portaria 300 de 01-07-2026)');
  assertEquals(r.linhas.slice(0, 2), ['Soja · grupo II — AD3, AD4: 01/10–31/12 (risco 20%)', 'Soja · grupo II — AD1: 11/10–20/12 (risco 20%), 21/12–31/12 (risco 30%)']);
  assert.ok(textoOficiais([r]).includes('DADOS OFICIAIS') && textoOficiais([]) === '');
});
