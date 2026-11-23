// MercaPlant — vigor da lavoura (NDVI) por talhão, a partir de imagens Sentinel-2 (nível 2A) e Landsat 8/9 (coleção 2, nível 2),
// ambas de reflectância de superfície. A nuvem é medida só sobre a fazenda (a cena inteira pode estar nublada e a fazenda limpa).
// Funções puras: conferência do que chega do app, área de busca e escolha da imagem.

export type Talhao = {id: string, pontos: [number, number][]}; // pontos em [lat, lon], como o app guarda
export type Col = 's2' | 'ls';
export type Item = {id: string, col: Col, data: string, nuvens: number, bbox: [number, number, number, number]};

const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;
/** Talhões válidos (até 80, cada um com 3 a 600 pontos dentro do Brasil e arredores). */
export function lerTalhoes(corpo: unknown): Talhao[] {
  const lista = (corpo as {talhoes?: unknown})?.talhoes;
  if (!Array.isArray(lista)) return [];
  const out: Talhao[] = [];
  for (const t of lista.slice(0, 80)) {
    const id = String((t as Talhao)?.id ?? ''), pts = (t as Talhao)?.pontos;
    if (!ID_OK.test(id) || !Array.isArray(pts) || pts.length < 3 || pts.length > 600) continue;
    const pontos = pts.map(p => [Number(p?.[0]), Number(p?.[1])] as [number, number])
      .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo) && la > -40 && la < 10 && lo > -80 && lo < -30);
    if (pontos.length >= 3) out.push({id, pontos});
  }
  return out;
}

/** Caixa [oeste, sul, leste, norte] que cobre todos os talhões. */
export function caixa(ts: Talhao[]): [number, number, number, number] {
  let o = 180, s = 90, l = -180, n = -90;
  for (const t of ts) for (const [la, lo] of t.pontos) { o = Math.min(o, lo); l = Math.max(l, lo); s = Math.min(s, la); n = Math.max(n, la); }
  return [o, s, l, n];
}

/** Polígono GeoJSON (lon, lat) fechado. */
export function poligono(t: Talhao) {
  const anel = t.pontos.map(([la, lo]) => [lo, la]);
  const [a, b] = [anel[0], anel[anel.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) anel.push(a);
  return {type: 'Polygon', coordinates: [anel]};
}

const contem = (fora: number[], dentro: number[]) => fora[0] <= dentro[0] && fora[1] <= dentro[1] && fora[2] >= dentro[2] && fora[3] >= dentro[3];
/** Imagem mais recente que cobre a fazenda inteira e tem poucas nuvens; senão, a mais recente com poucas nuvens. */
export function escolherImagem(itens: Item[], area: number[], maxNuvens = 20): Item | null {
  const boas = itens.filter(i => i.nuvens <= maxNuvens).sort((a, b) => b.data.localeCompare(a.data));
  return boas.find(i => contem(i.bbox, area)) || boas[0] || null;
}
/** Candidatas a conferir a nuvem sobre a fazenda: as mais recentes que cobrem a fazenda inteira,
 *  sem as cenas quase todas nubladas (acima de 90% no Sentinel, 70% no Landsat), no máximo `max`. */
export function candidatas(itens: Item[], area: number[], max = 8): Item[] {
  return itens.filter(i => contem(i.bbox, area) && i.nuvens <= (i.col === 's2' ? 90 : 70))
    .sort((a, b) => b.data.localeCompare(a.data)).slice(0, max);
}
/** Fazenda limpa: no máximo 10% de nuvem ou sombra de nuvem sobre ela. */
export const LIMPA = 0.1;

/** Itens da busca STAC → Item (só Sentinel-2 L2A e Landsat 8/9 L2). */
export function lerItens(fc: unknown): Item[] {
  const fs = (fc as {features?: unknown[]})?.features;
  if (!Array.isArray(fs)) return [];
  return fs.map(f => {
    const x = f as {id?: string, bbox?: number[], properties?: Record<string, unknown>};
    const id = String(x.id || ''), col = colecaoDe(id);
    return {id, col: col || 's2', ok: !!col, data: String(x.properties?.datetime || ''), nuvens: Number(x.properties?.['eo:cloud_cover'] ?? 100), bbox: (x.bbox || [0, 0, 0, 0]) as [number, number, number, number]};
  }).filter(i => i.ok && i.data).map(({ok: _o, ...i}) => i);
}

/** Só imagens Sentinel-2 nível 2A e Landsat 8/9 nível 2 (o nome vem da busca e volta no pedido do mosaico). */
export const ITEM_OK = /^S2[ABC]_MSIL2A_\d{8}T\d{6}_[A-Z0-9_]{5,40}$/;
export const ITEM_LS = /^LC0[89]_L2SP_\d{6}_\d{8}_02_T[12]$/;
export const colecaoDe = (id: string): Col | null => ITEM_OK.test(id) ? 's2' : ITEM_LS.test(id) ? 'ls' : null;
export const COLECAO: Record<Col, string> = {s2: 'sentinel-2-l2a', ls: 'landsat-c2-l2'};
export const DETALHE: Record<Col, number> = {s2: 10, ls: 30}; // metros por ponto
// NDVI = (infravermelho − vermelho) ÷ (infravermelho + vermelho). Landsat L2: reflectância = valor × 0,0000275 − 0,2
export const NDVI_DE: Record<Col, string> = {s2: '(B08-B04)/(B08+B04)', ls: '(nir08*0.0000275-red*0.0000275)/(nir08*0.0000275+red*0.0000275-0.4)'};
export const NDVI = NDVI_DE.s2;
// Fração com nuvem ou sombra: Sentinel pela classificação da cena (SCL 3, 8, 9, 10); Landsat pelo que NÃO é "limpo" no QA_PIXEL
export const NUVEM_DE: Record<Col, string> = {s2: '((SCL==3)|(SCL==8)|(SCL==9)|(SCL==10))*1.0', ls: '1-((qa_pixel==21824)|(qa_pixel==21952))*1.0'};
