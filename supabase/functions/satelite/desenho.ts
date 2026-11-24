// MercaPlant — desenho automático do talhão a partir do NDVI (até 3 datas): toque no meio do talhão → contorno.
// Funções puras: ler o PNG, crescer a região a partir do toque, limpar a máscara, traçar e simplificar o contorno.

/** PNG de 8 bits (cinza, cinza+alfa, RGB, RGBA), sem entrelaçamento. */
export async function lerPng(bytes: Uint8Array): Promise<{w: number, h: number, canais: number, dados: Uint8Array}> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat: Uint8Array[] = [];
  let p = 8, w = 0, h = 0, prof = 0, tipo = 0, entrel = 0;
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p), t = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    if (t === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); prof = bytes[p + 16]; tipo = bytes[p + 17]; entrel = bytes[p + 20]; }
    else if (t === 'IDAT') idat.push(bytes.subarray(p + 8, p + 8 + len));
    else if (t === 'IEND') break;
    p += 12 + len;
  }
  const canais = ({0: 1, 2: 3, 4: 2, 6: 4} as Record<number, number>)[tipo];
  if (prof !== 8 || !canais || entrel || !w || !h) throw new Error('png não suportado');
  const cru = new Uint8Array(await new Response(new Blob(idat as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const linha = w * canais, out = new Uint8Array(h * linha);
  for (let y = 0; y < h; y++) {
    const f = cru[y * (linha + 1)], o = y * linha, i0 = y * (linha + 1) + 1;
    for (let x = 0; x < linha; x++) {
      const a = x >= canais ? out[o + x - canais] : 0, b = y ? out[o - linha + x] : 0, c = x >= canais && y ? out[o - linha + x - canais] : 0;
      let v = cru[i0 + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[o + x] = v & 255;
    }
  }
  return {w, h, canais, dados: out};
}
/** PNG em cinza (NDVI reescalado) → valores 0–1, NaN onde não há dado (alfa 0). */
export function camadaDoPng(png: {w: number, h: number, canais: number, dados: Uint8Array}): Float32Array {
  const n = png.w * png.h, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const alfa = png.canais === 2 ? png.dados[i * 2 + 1] : png.canais === 4 ? png.dados[i * 4 + 3] : 255;
    c[i] = alfa === 0 ? NaN : png.dados[i * png.canais] / 255;
  }
  return c;
}

function suavizar(c: Float32Array, w: number, h: number) {
  const o = new Float32Array(c.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v = c[yy * w + xx]; if (!Number.isNaN(v)) { s += v; n++; }
    }
    o[y * w + x] = n ? s / n : NaN;
  }
  return o;
}
// Dilatação em quadrado (8 vizinhos): mantém os cantos do talhão em ângulo reto
function dilatar8(m: Uint8Array, w: number, h: number) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1 && !v; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx]) v = 1; }
    o[y * w + x] = v;
  }
  return o;
}
// Erosão / dilatação de 1 ponto (vizinhança de 4)
function morfo(m: Uint8Array, w: number, h: number, dilatar: boolean) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, viz = [x > 0 ? m[i - 1] : 0, x < w - 1 ? m[i + 1] : 0, y > 0 ? m[i - w] : 0, y < h - 1 ? m[i + w] : 0];
    o[i] = dilatar ? (m[i] || viz.some(Boolean) ? 1 : 0) : (m[i] && viz.every(Boolean) ? 1 : 0);
  }
  return o;
}
// Só o pedaço ligado ao ponto de partida; buracos internos preenchidos
function pedacoDoPonto(m: Uint8Array, w: number, h: number, s: number) {
  const o = new Uint8Array(m.length); if (!m[s]) return o;
  const fila = [s]; o[s] = 1;
  while (fila.length) { const i = fila.pop()!, x = i % w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < m.length && m[j] && !o[j]) { o[j] = 1; fila.push(j); } }
  const fora = new Uint8Array(m.length), f2: number[] = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const i = y * w + x; if (!o[i] && !fora[i]) { fora[i] = 1; f2.push(i); } }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const i = y * w + x; if (!o[i] && !fora[i]) { fora[i] = 1; f2.push(i); } }
  while (f2.length) { const i = f2.pop()!, x = i % w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < m.length && !o[j] && !fora[j]) { fora[j] = 1; f2.push(j); } }
  for (let i = 0; i < m.length; i++) if (!fora[i]) o[i] = 1;
  return o;
}

export type Segmento = {mascara: Uint8Array, n: number, borda: number, tol: number, cv: number};
// Força de divisa em cada ponto: a maior variação (Sobel) entre as imagens. Dentro do talhão é baixa mesmo que o verde
// mude aos poucos; na divisa (estrada, mato, outra lavoura ou outra época) é alta em pelo menos uma imagem.
function divisas(cs: Float32Array[], w: number, h: number) {
  // Cada imagem medida pela própria textura (mediana): a divisa de uma não some no "ruído" de outra
  const g = new Float32Array(w * h);
  for (const c of cs) {
    const gk = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const v = (dx: number, dy: number) => { const t = c[(y + dy) * w + x + dx]; return Number.isNaN(t) ? c[y * w + x] : t; };
      const gx = (v(1, -1) + 2 * v(1, 0) + v(1, 1)) - (v(-1, -1) + 2 * v(-1, 0) + v(-1, 1));
      const gy = (v(-1, 1) + 2 * v(0, 1) + v(1, 1)) - (v(-1, -1) + 2 * v(0, -1) + v(1, -1));
      gk[y * w + x] = Number.isNaN(c[y * w + x]) ? Infinity : Math.hypot(gx, gy) / 8;
    }
    const ord = Float32Array.from(gk.filter(Number.isFinite)).sort(), med = Math.max(0.002, ord[(ord.length / 2) | 0] ?? 0.002);
    for (let i = 0; i < g.length; i++) { const r = gk[i] / med; if (r > g[i]) g[i] = r; }
  }
  for (let x = 0; x < w; x++) { g[x] = g[(h - 1) * w + x] = Infinity; } for (let y = 0; y < h; y++) { g[y * w] = g[y * w + w - 1] = Infinity; }
  return g;
}
/** Toque (sx, sy) → desenhos possíveis do talhão: espalha pelos pontos sem divisa forte e não muito diferentes do toque,
 *  testando limites de divisa do mais solto ao mais firme. Sem nenhum que separe o talhão, a lista volta vazia (não inventa). */
export function opcoesDoToque(camadas: Float32Array[], w: number, h: number, sx: number, sy: number, diag?: number[][], dif = 0.1): {opcoes: Segmento[], padrao: number} {
  const cs = camadas.map(c => suavizar(c, w, h));
  if (cs.some(c => Number.isNaN(c[sy * w + sx]))) return {opcoes: [], padrao: 0};
  const g = divisas(cs, w, h);
  // Parte do ponto mais "liso" num raio de 3 (quem toca perto da divisa não estraga o desenho)
  let s = sy * w + sx;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const j = (sy + dy) * w + sx + dx; if (g[j] < g[s] && cs.every(c => !Number.isNaN(c[j]))) s = j; }
  const media = cs.map(c => { let t = 0, n = 0; const x0 = s % w, y0 = (s / w) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const v = c[(y0 + dy) * w + x0 + dx]; if (!Number.isNaN(v)) { t += v; n++; } } return t / n; });
  const espalhar = (lim: number, dif: number) => {
    const m = new Uint8Array(w * h), fila = [s]; m[s] = 1;
    while (fila.length) {
      const i = fila.pop()!, x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= m.length || m[j] || g[j] >= lim) continue;
        let ok = true; for (let k = 0; k < cs.length && ok; k++) { const v = cs[k][j]; ok = !Number.isNaN(v) && Math.abs(v - media[k]) <= dif; }
        if (ok) { m[j] = 1; fila.push(j); }
      }
    }
    // Limpa: abre (corta pontes finas), fica o pedaço do toque, preenche buracos, fecha a borda e devolve a faixa da divisa
    let r = pedacoDoPonto(morfo(morfo(m, w, h, false), w, h, true), w, h, s);
    if (!r[s]) r = pedacoDoPonto(m, w, h, s);
    r = morfo(morfo(r, w, h, true), w, h, false);
    r = dilatar8(dilatar8(r, w, h), w, h); // a faixa da divisa (≈ 2 pontos) volta para o talhão
    let n = 0, borda = 0; for (let i = 0; i < r.length; i++) if (r[i]) { n++; const x = i % w, y = (i / w) | 0; if (x < 2 || y < 2 || x > w - 3 || y > h - 3) borda++; }
    return {mascara: r, n, borda, tol: lim, cv: dif};
  };
  // Limites em vezes a textura típica de cada imagem: acima disso é divisa. Do mais solto ao mais firme.
  // Se nenhum limite separa o talhão (tudo igual em volta, como solo e palha em todas as datas), não inventa: devolve null.
  // Cada faixa de limites que dá quase a mesma área é uma divisa de verdade (um "patamar"). Patamares diferentes
  // são respostas possíveis (o talhão sozinho, ou junto com o vizinho de divisa fraca): o app oferece "menor / maior".
  // O padrão é o patamar mais firme (o que se mantém em mais limites). Menos de 1,5 ha (150 pontos) não conta.
  const ok = (r: Segmento) => r.n <= 0.25 * w * h && r.borda <= 0.02 * (w + h) && r.n >= MINIMO;
  const grupos: Segmento[][] = [];
  for (let k = 6; k >= 1.45; k *= 0.9) {
    const r = espalhar(k, dif);
    diag?.push([Math.round(k * 100) / 100, r.n, r.borda]);
    if (r.n < MINIMO) break;
    if (!ok(r)) continue;
    const g = grupos[grupos.length - 1];
    if (g && r.n >= 0.85 * g[0].n) g.push(r); else grupos.push([r]);
  }
  let padrao = 0;
  grupos.forEach((g, i) => { if (g.length > grupos[padrao].length) padrao = i; });
  return {opcoes: grupos.map(g => g[0]), padrao};
}
const MINIMO = 150;
/** O desenho padrão do toque (ou null se não deu para separar o talhão). */
export function segmentar(camadas: Float32Array[], w: number, h: number, sx: number, sy: number, diag?: number[][], dif = 0.1): Segmento | null {
  const {opcoes, padrao} = opcoesDoToque(camadas, w, h, sx, sy, diag, dif);
  return opcoes[padrao] || null;
}

/** Contorno externo da máscara (vértices nos cantos dos pontos), no sentido horário da imagem. */
export function contornoDaMascara(m: Uint8Array, w: number, h: number): [number, number][] {
  const prox = new Map<number, number[]>(), chave = (x: number, y: number) => y * (w + 1) + x;
  const lado = (x1: number, y1: number, x2: number, y2: number) => { const a = chave(x1, y1); (prox.get(a) || prox.set(a, []).get(a)!).push(chave(x2, y2)); };
  const dentro = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!dentro(x, y)) continue;
    if (!dentro(x, y - 1)) lado(x, y, x + 1, y);
    if (!dentro(x + 1, y)) lado(x + 1, y, x + 1, y + 1);
    if (!dentro(x, y + 1)) lado(x + 1, y + 1, x, y + 1);
    if (!dentro(x - 1, y)) lado(x, y + 1, x, y);
  }
  let melhor: number[] = [];
  const usados = new Set<string>();
  for (const [ini, saidas] of prox) for (const s0 of saidas) {
    if (usados.has(ini + '>' + s0)) continue;
    const anel = [ini]; let a = ini, b = s0, guarda = 0;
    while (guarda++ < 4 * w * h) {
      usados.add(a + '>' + b); anel.push(b);
      if (b === ini) break;
      const op = (prox.get(b) || []).filter(c => !usados.has(b + '>' + c));
      if (!op.length) break;
      a = b; b = op[0];
    }
    if (anel.length > melhor.length) melhor = anel;
  }
  return melhor.slice(0, -1).map(k => [k % (w + 1), Math.floor(k / (w + 1))]);
}

/** Douglas-Peucker em pontos da imagem (anel fechado). */
export function simplificarAnel(pts: [number, number][], tol = 0.9): [number, number][] {
  if (pts.length < 5) return pts;
  // Começa pelos dois pontos mais distantes entre si, para o anel não depender de onde começou
  let ia = 0, ib = 0, dm = -1;
  for (let i = 0; i < pts.length; i += Math.max(1, (pts.length / 60) | 0)) for (let j = 0; j < pts.length; j += Math.max(1, (pts.length / 60) | 0)) { const d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2; if (d > dm) { dm = d; ia = i; ib = j; } }
  if (ia > ib) [ia, ib] = [ib, ia];
  const dp = (seg: [number, number][]) => {
    const manter = new Uint8Array(seg.length); manter[0] = manter[seg.length - 1] = 1; const pilha = [[0, seg.length - 1]];
    while (pilha.length) {
      const [i, j] = pilha.pop()!; let dmax = 0, k = -1; const [x1, y1] = seg[i], [x2, y2] = seg[j], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      for (let n = i + 1; n < j; n++) { const [x, y] = seg[n]; let t = l2 ? ((x - x1) * dx + (y - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)); if (d > dmax) { dmax = d; k = n; } }
      if (dmax > tol && k > 0) { manter[k] = 1; pilha.push([i, k], [k, j]); }
    }
    return seg.filter((_, n) => manter[n]);
  };
  const a = dp(pts.slice(ia, ib + 1)), b = dp([...pts.slice(ib), ...pts.slice(0, ia + 1)]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Uma imagem em texto (para conferir o desenho sem tela): . sem dado, ░▒▓█ pelo NDVI, # dentro do contorno. */
export function rascunho(camada: Float32Array, m: Uint8Array | null, w: number, h: number, passo = 4): string {
  const tons = ' ░▒▓█'; let s = '';
  for (let y = 0; y < h; y += passo) {
    for (let x = 0; x < w; x += passo) {
      const i = y * w + x, v = camada[i];
      s += m?.[i] ? '#' : Number.isNaN(v) ? '.' : tons[Math.min(4, Math.max(0, Math.floor(v * 5)))];
    }
    s += '\n';
  }
  return s;
}
