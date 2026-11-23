// MercaPlant — leitura dos avisos meteorológicos do INMET (RSS + CAP), sem dependências.
// O RSS lista os avisos ativos; cada aviso tem um CAP (XML padrão da OMM) com o polígono da área atingida.

export type Aviso = {
  id: string; evento: string; nivel: 'amarelo' | 'laranja' | 'vermelho'; severidade: string;
  inicio: string | null; fim: string | null; descricao: string; instrucoes: string; area: string;
  poligonos: [number, number][][]; link: string; web: string;
};

const ENT: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
export const texto = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m)
  .replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const tags = (xml: string, nome: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, 'gi'))].map(m => m[1]);
const tag = (xml: string, nome: string) => tags(xml, nome)[0] ?? '';

/** Itens do RSS: id (do link /avisos/rss/<id>), título e link. */
export function lerRss(xml: string) {
  return tags(xml, 'item').map(it => {
    const link = texto(tag(it, 'link')) || texto(tag(it, 'guid'));
    const id = (link.match(/(\d+)\/?$/) || [])[1] || '';
    return {id, titulo: texto(tag(it, 'title')), link, descricao: texto(tag(it, 'description'))};
  }).filter(i => i.id);
}

const GRAU: Record<Aviso['nivel'], string> = {amarelo: 'Perigo potencial', laranja: 'Perigo', vermelho: 'Grande perigo'};
const NIVEL_SEV: Record<string, Aviso['nivel']> = {minor: 'amarelo', moderate: 'amarelo', severe: 'laranja', extreme: 'vermelho'};
export function nivelDe(sev: string, titulo = '', cor = ''): Aviso['nivel'] {
  const t = (titulo + ' ' + sev).toLowerCase();
  if (/grande perigo/.test(t)) return 'vermelho';
  if (/perigo potencial/.test(t)) return 'amarelo';
  if (/perigo/.test(t)) return 'laranja';
  const c = cor.toLowerCase();
  if (/^#?(ff0000|f00)$/.test(c) || c === 'red') return 'vermelho';
  if (/^#?(ffa500|ff9900|ff8c00)$/.test(c) || c === 'orange') return 'laranja';
  return NIVEL_SEV[sev.trim().toLowerCase()] || 'amarelo';
}

/** "lat,lon lat,lon ..." (padrão CAP) → lista de [lat, lon]. */
export function lerPoligono(s: string): [number, number][] {
  return s.trim().split(/\s+/).map(p => p.split(',').map(Number)).filter(p => p.length >= 2 && p.every(Number.isFinite)).map(p => [p[0], p[1]] as [number, number]);
}

/** CAP de um aviso → Aviso (null se não der para ler). */
export function lerCap(xml: string, id: string, link: string): Aviso | null {
  const info = tag(xml, 'info'); if (!info) return null;
  const params = Object.fromEntries(tags(info, 'parameter').map(p => [texto(tag(p, 'valueName')).toLowerCase(), texto(tag(p, 'value'))]));
  const evento = texto(tag(info, 'event')) || texto(tag(info, 'headline'));
  const sev = texto(tag(info, 'severity'));
  const areas = tags(info, 'area');
  const poligonos = areas.flatMap(a => tags(a, 'polygon').map(lerPoligono)).filter(p => p.length >= 3);
  const iso = (v: string) => { const d = new Date(texto(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
  const nivel = nivelDe(sev, texto(tag(info, 'headline')) + ' ' + (params['severidade'] || ''), params['colorrisk'] || params['cor'] || '');
  return {
    id, evento, nivel, severidade: GRAU[nivel],
    inicio: iso(tag(info, 'onset') || tag(info, 'effective')), fim: iso(tag(info, 'expires')),
    descricao: texto(tag(info, 'description')), instrucoes: texto(tag(info, 'instruction')),
    area: areas.map(a => texto(tag(a, 'areaDesc'))).filter(Boolean).join('; '), poligonos, link,
    web: /^https:\/\/[a-z0-9.-]*inmet\.gov\.br\//.test(texto(tag(info, 'web'))) ? texto(tag(info, 'web')) : `https://avisos.inmet.gov.br/${id}`,
  };
}

/** Ponto dentro do polígono (raio cruzando as arestas). Polígono em [lat, lon]. */
export function dentro(lat: number, lon: number, pol: [number, number][]): boolean {
  let d = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const [yi, xi] = pol[i], [yj, xj] = pol[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) d = !d;
  }
  return d;
}

const ORDEM = {vermelho: 0, laranja: 1, amarelo: 2};
const periodo = (a: Aviso) => [a.inicio ? Date.parse(a.inicio) : -Infinity, a.fim ? Date.parse(a.fim) : Infinity];
const cruzam = (a: Aviso, b: Aviso) => { const [ai, af] = periodo(a), [bi, bf] = periodo(b); return ai < bf && bi < af; };
/** Avisos que valem para o ponto agora (ou que ainda vão começar), do mais grave ao mais leve.
 *  O INMET publica o mesmo evento em faixas (amarelo por fora, laranja e vermelho por dentro): para o mesmo evento
 *  no mesmo período, fica só o nível mais grave. Sai sem o desenho e sem a lista de regiões (pesadas e sem uso no app). */
export function avisosDoPonto(avisos: Aviso[], lat: number, lon: number, agora = Date.now()) {
  const validos = avisos.filter(a => (!a.fim || Date.parse(a.fim) > agora) && a.poligonos.some(p => dentro(lat, lon, p)))
    .sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel] || String(a.inicio).localeCompare(String(b.inicio)));
  const ficam: Aviso[] = [];
  for (const a of validos) if (!ficam.some(b => b.evento === a.evento && cruzam(a, b))) ficam.push(a);
  return ficam.map(({poligonos: _p, area: _a, ...resto}) => resto);
}
