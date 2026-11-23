import nodeAssert from 'node:assert/strict';
const assert = (v: unknown) => nodeAssert.ok(v);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepEqual(a, b);
import {avisosDoPonto, dentro, lerCap, lerRss, nivelDe} from './nucleo.ts';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Avisos INMET</title>
<item><title>Aviso de Tempestade. Severidade Grau: Perigo</title><link>https://apiprevmet3.inmet.gov.br/avisos/rss/56480</link>
<description><![CDATA[INMET publica aviso iniciando em: 24/11/2026 00:00. Chuva entre 20 e 30 mm/h]]></description></item>
<item><title>Aviso de Geada. Severidade Grau: Perigo Potencial</title><link>https://apiprevmet3.inmet.gov.br/avisos/rss/56481</link></item>
</channel></rss>`;
const CAP = (sev: string, cor: string, pol: string, fim = '2026-11-25T12:00:00-03:00') => `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>56480</identifier><info><language>pt-BR</language>
<event>Tempestade</event><severity>${sev}</severity><onset>2026-11-24T00:00:00-03:00</onset><expires>${fim}</expires>
<headline>Aviso de Tempestade</headline><description>Chuva entre 20 e 30 mm/h ou até 50 mm/dia, ventos intensos (40-60 km/h) e queda de granizo.</description>
<web>https://avisos.inmet.gov.br/56480</web><instruction>Em caso de rajadas de vento: não se abrigue debaixo de árvores.</instruction>
<parameter><valueName>ColorRisk</valueName><value>${cor}</value></parameter>
<area><areaDesc>Noroeste Rio-grandense, Norte Rio-grandense</areaDesc><polygon>${pol}</polygon></area></info></alert>`;
// quadrado no norte do RS (lat -29 a -27, lon -54 a -51)
const QUADRADO = '-27,-54 -27,-51 -29,-51 -29,-54 -27,-54';

Deno.test('RSS: número e link de cada aviso', () => {
  const r = lerRss(RSS);
  assertEquals(r.map(i => i.id), ['56480', '56481']);
  assertEquals(r[0].titulo, 'Aviso de Tempestade. Severidade Grau: Perigo');
  assert(r[0].descricao.startsWith('INMET publica aviso'));
});
Deno.test('CAP: evento, nível, período, área e polígono', () => {
  const a = lerCap(CAP('Severe', '#FFA500', QUADRADO), '56480', 'x')!;
  assertEquals(a.evento, 'Tempestade');
  assertEquals(a.nivel, 'laranja');
  assertEquals(a.inicio, '2026-11-24T03:00:00.000Z');
  assertEquals(a.area, 'Noroeste Rio-grandense, Norte Rio-grandense');
  assertEquals(a.poligonos[0].length, 5);
  assert(a.descricao.includes('granizo'));
  assertEquals(a.web, 'https://avisos.inmet.gov.br/56480');
});
Deno.test('Nível pelo grau do INMET, pela severidade CAP ou pela cor', () => {
  assertEquals(nivelDe('Moderate', 'Severidade Grau: Perigo Potencial'), 'amarelo');
  assertEquals(nivelDe('Severe', 'Severidade Grau: Perigo'), 'laranja');
  assertEquals(nivelDe('Extreme', 'Severidade Grau: Grande Perigo'), 'vermelho');
  assertEquals(nivelDe('Extreme'), 'vermelho');
  assertEquals(nivelDe('Moderate', 'Aviso de Tempestade. Severidade Grau: Moderate', '#FFFE00'), 'amarelo'); // como vem no CAP real
  assertEquals(nivelDe('', '', '#FF0000'), 'vermelho');
});
Deno.test('Ponto dentro e fora do polígono', () => {
  const p: [number, number][] = [[-27, -54], [-27, -51], [-29, -51], [-29, -54]];
  assert(dentro(-28.26, -52.41, p)); // Passo Fundo
  assert(!dentro(-30.03, -51.23, p)); // Porto Alegre
});
Deno.test('Só os avisos que pegam a fazenda e ainda valem, do mais grave ao mais leve', () => {
  const agora = Date.parse('2026-11-24T10:00:00-03:00');
  const avisos = [
    lerCap(CAP('Moderate', '#FFFF00', QUADRADO), '1', 'a')!,
    lerCap(CAP('Extreme', '#FF0000', QUADRADO), '2', 'b')!,
    lerCap(CAP('Severe', '#FFA500', '-31,-55 -31,-53 -33,-53 -33,-55'), '3', 'c')!, // sul do RS: fora
    lerCap(CAP('Severe', '#FFA500', QUADRADO, '2026-11-24T08:00:00-03:00'), '4', 'd')!, // já terminou
  ];
  const r = avisosDoPonto(avisos, -28.26, -52.41, agora);
  assertEquals(r.map(a => a.id), ['2']); // amarelo do mesmo evento e período fica por baixo do vermelho
  assert(!('poligonos' in r[0]) && !('area' in r[0]));
});
Deno.test('Mesmo evento em dias diferentes, ou outro evento no mesmo dia: mostra os dois', () => {
  const agora = Date.parse('2026-11-23T10:00:00-03:00');
  const hoje = lerCap(CAP('Moderate', '#FFFE00', QUADRADO, '2026-11-23T23:59:00-03:00').replace('2026-11-24T00:00:00-03:00', '2026-11-23T00:00:00-03:00'), 'h', 'a')!;
  const amanha = lerCap(CAP('Extreme', '#FF0000', QUADRADO, '2026-11-24T23:59:00-03:00'), 'v', 'b')!;
  const geada = {...lerCap(CAP('Moderate', '#FFFE00', QUADRADO), 'g', 'c')!, evento: 'Geada'};
  assertEquals(avisosDoPonto([hoje, amanha, geada], -28.26, -52.41, agora).map(a => a.id), ['v', 'h', 'g']);
});
