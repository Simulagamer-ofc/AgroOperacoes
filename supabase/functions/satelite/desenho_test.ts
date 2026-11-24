import assert from 'node:assert/strict';
import {camadaDoPng, contornoDaMascara, lerPng, opcoesDoToque, rascunho, segmentar, simplificarAnel} from './desenho.ts';

// Imagem sintética 120×90: talhão A (x 5–39, y 5–54) NDVI alto, talhão B (x 42–75) NDVI médio, mata (x 40–41) e ruído leve
function fazenda(w = 120, h = 90) {
  const c = new Float32Array(w * h); let semente = 7;
  const ruido = () => { semente = (semente * 16807) % 2147483647; return (semente / 2147483647 - 0.5) * 0.03; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = x >= 5 && x <= 39 && y >= 5 && y <= 54, b = x >= 42 && x <= 75 && y >= 5 && y <= 54, mata = x === 40 || x === 41;
    c[y * w + x] = (a ? 0.75 : b ? 0.45 : mata ? 0.9 : 0.2) + ruido();
  }
  return c;
}

Deno.test('cresce só o talhão tocado e respeita a divisa', () => {
  const w = 120, h = 90, r = segmentar([fazenda()], w, h, 20, 30)!;
  assert.ok(r.n > 34 * 49 && r.n <= 37 * 52, `área ${r.n}`);
  assert.equal(r.mascara[30 * w + 50], 0); // não vazou para o talhão B
  const anel = simplificarAnel(contornoDaMascara(r.mascara, w, h));
  assert.ok(anel.length >= 4 && anel.length <= 8, `${anel.length} cantos`);
  const xs = anel.map(p => p[0]), ys = anel.map(p => p[1]);
  // Divisa a no máximo 1 ponto (10 m) do certo: x 5–40, y 5–55
  [[Math.min(...xs), 5], [Math.max(...xs), 40], [Math.min(...ys), 5], [Math.max(...ys), 55]].forEach(([v, certo]) => assert.ok(Math.abs(v - certo) <= 1, JSON.stringify(anel)));
});

Deno.test('duas datas separam vizinhos que estão iguais numa delas', () => {
  const w = 120, h = 90, d1 = fazenda(), d2 = fazenda();
  // Na data 1 os dois talhões estavam iguais (0,75); na data 2, só o B foi dessecado
  for (let y = 5; y <= 54; y++) for (let x = 42; x <= 75; x++) d1[y * w + x] = 0.75;
  for (let y = 0; y < h; y++) { d1[y * w + 40] = d1[y * w + 41] = 0.75; d2[y * w + 40] = d2[y * w + 41] = 0.75; }
  const so1 = segmentar([d1], w, h, 20, 30), as2 = segmentar([d1, d2], w, h, 20, 30)!;
  assert.ok(so1 === null || so1.mascara[30 * w + 60] === 1); // só com a data 1 não separa (junta ou desiste)
  assert.equal(as2.mascara[30 * w + 60], 0);   // com as duas, separa
});

Deno.test('toque fora de dado: sem desenho; rascunho em texto', () => {
  const c = new Float32Array(16).fill(NaN);
  assert.equal(segmentar([c], 4, 4, 2, 2), null);
  assert.match(rascunho(fazenda(), null, 120, 90, 10), /█/);
});

Deno.test('lê PNG em cinza com alfa (como o serviço de imagens entrega)', async () => {
  const w = 3, h = 2, linhas = [[0, 0, 0, 128, 255, 255, 255], [2, 10, 255, 10, 0, 10, 0]]; // filtro 0 e filtro 2 (Up)
  const cru = new Uint8Array(linhas.flat());
  const z = new Uint8Array(await new Response(new Blob([cru]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const pedaco = (t: string, d: Uint8Array) => { const b = new Uint8Array(12 + d.length), dv = new DataView(b.buffer); dv.setUint32(0, d.length); b.set([...t].map(c => c.charCodeAt(0)), 4); b.set(d, 8); return b; };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr.set([8, 4, 0, 0, 0], 8);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...pedaco('IHDR', ihdr), ...pedaco('IDAT', z), ...pedaco('IEND', new Uint8Array())]);
  const img = await lerPng(png), c = camadaDoPng(img);
  assert.deepEqual([img.w, img.h, img.canais], [3, 2, 2]);
  assert.ok(Number.isNaN(c[0]));                 // alfa 0 → sem dado
  assert.equal(c[1], Math.fround(128 / 255));
  assert.equal(c[3], Math.fround(10 / 255));                  // linha 2 = linha 1 + 10 (filtro Up)
});

Deno.test('divisa fraca com o vizinho: opções do maior para o menor, a padrão entre elas', () => {
  const w = 120, h = 90, c = fazenda();
  // B quase igual ao A (0,72) e separado só por um carreador fraco (0,62) no lugar da mata
  for (let y = 5; y <= 54; y++) { for (let x = 42; x <= 75; x++) c[y * w + x] = 0.72; c[y * w + 40] = c[y * w + 41] = 0.62; }
  const {opcoes, padrao} = opcoesDoToque([c], w, h, 20, 30);
  assert.ok(opcoes.length >= 1 && padrao >= 0 && padrao < opcoes.length);
  for (let i = 1; i < opcoes.length; i++) assert.ok(opcoes[i].n < 0.85 * opcoes[i - 1].n, opcoes.map(o => o.n).join('/'));
  const so = opcoes.at(-1)!; // a menor é só o talhão tocado
  assert.equal(so.mascara[30 * w + 60], 0);
  assert.ok(so.n > 30 * 45, `${so.n}`);
});
