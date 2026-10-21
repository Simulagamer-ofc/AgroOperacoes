'use strict';
/* MercaPlant — Mapa do tempo (no estilo dos apps de radar): uma linha do tempo só, do passado recente ao futuro.
   Observado (últimas ~1 h 30, a cada 10 min) — fonte oficial REDEMET/DECEA, pela função "redemet" do Supabase:
     • Satélite: imagem infravermelha (tons de cinza) da América do Sul (equiretangular), reprojetada aqui para o mapa e
       sobreposta em modo “clarear”: nuvem fica branca por cima do mapa e o chão escuro some (como nos apps de radar).
     • Radar: MaxCAPPI dos radares do DECEA perto da fazenda (quando o radar publica imagem).
     • Tempestades: STSC (células de tempestade por radar e descargas elétricas), mais recentes em vermelho.
   Previsão (próximas 48 h, hora a hora): chuva da média dos modelos (Open-Meteo) numa grade 9 × 9 em volta da fazenda.
   Mapa base OpenStreetMap; Leaflet 1.9.4 (BSD-2) carregado só ao abrir o mapa. */

const GRADE_N = 9, GRADE_PASSO = 0.4, GRADE_KEY = 'agro-clima-grade';
const ESCALA_CHUVA = [[0.2, '#a9d8f7', 'fraca'], [1, '#4aa8ec', ''], [2.5, '#1f6fd1', 'moderada'], [5, '#f2d43f', ''], [10, '#f39a3c', 'forte'], [20, '#e0443f', 'muito forte']];
const corChuva = mm => { let c = null; ESCALA_CHUVA.forEach(([min, cor]) => { if (mm >= min) c = cor; }); return c; };
// Radares do DECEA (centro e alcance de 400 km do MaxCAPPI)
const RADARES_DECEA = {mq: [-0.047, -51.098, 'Macapá'], tm: [-18.207, -45.461, 'Três Marias'], nt: [-5.904, -35.254, 'Natal'], sg: [-29.225, -54.930, 'Santiago'], mi: [-28.128, -49.472, 'Morro da Igreja'],
  pc: [-22.464, -43.297, 'Pico do Couto'], ga: [-15.976, -48.016, 'Gama'], ua: [-0.144, -67.057, 'São Gabriel da Cachoeira'], st: [-19.989, -40.579, 'Santa Teresa'], cz: [-7.596, -72.768, 'Cruzeiro do Sul'],
  mo: [-9.551, -35.771, 'Maceió'], sf: [-16.009, -44.696, 'São Francisco'], tf: [-3.377, -64.721, 'Tefé'], bv: [2.844, -60.700, 'Boa Vista'], tt: [-4.248, -69.935, 'Tabatinga'], al: [-16.202, -40.674, 'Almenara'],
  sl: [-2.597, -44.238, 'São Luís'], sn: [-2.430, -54.799, 'Santarém'], cn: [-31.404, -52.702, 'Canguçu'], pv: [-8.715, -63.894, 'Porto Velho'], jr: [-20.279, -54.474, 'Jaraguari'], pl: [-9.367, -40.573, 'Petrolina'],
  sv: [-12.903, -38.327, 'Salvador'], mn: [-3.149, -59.992, 'Manaus'], sr: [-23.602, -47.094, 'São Roque'], be: [-1.407, -48.461, 'Belém']};
const distKm = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
const radaresPerto = (lat, lon, km = 420) => Object.entries(RADARES_DECEA).map(([k, [la, lo, nome]]) => ({k, nome, d: distKm(lat, lon, la, lo)})).filter(x => x.d <= km).sort((a, b) => a.d - b.d).slice(0, 4);
let mtEstado = {quadro: 0, tocando: null, mapa: null, quadros: [], vis: {sat: true, radar: true, stsc: true, prev: true}};

function carregarLeaflet() {
  if (window.L?.map) return Promise.resolve();
  return new Promise((ok, erro) => {
    if (!document.querySelector('link[href="lib/leaflet/leaflet.css"]')) document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'lib/leaflet/leaflet.css'}));
    const s = Object.assign(document.createElement('script'), {src: 'lib/leaflet/leaflet.js'});
    s.onload = () => ok(); s.onerror = () => erro(new Error('leaflet')); document.head.append(s);
  });
}
// Dados da REDEMET pela função do Supabase (a chave da REDEMET fica guardada lá, não no app)
async function redemet(params) {
  const base = typeof NUVEM !== 'undefined' ? NUVEM : null; if (!base) throw new Error('nuvem');
  const r = await fetch(`${base.url}/functions/v1/redemet?${new URLSearchParams(params)}`, {headers: {apikey: base.chave}});
  if (!r.ok) throw new Error('redemet ' + r.status);
  return r.json();
}
// Previsão de chuva em grade (uma chamada para os 81 pontos), guardada por 1 hora
async function gradeChuva(loc) {
  try { const g = JSON.parse(safeStorage.get(GRADE_KEY) || 'null'); if (g && Date.now() - g.em < 3600000 && Math.abs(g.lat - loc.lat) < 0.05 && Math.abs(g.lon - loc.lon) < 0.05) return g; } catch { /* refaz */ }
  const meio = (GRADE_N - 1) / 2, pts = [];
  for (let i = 0; i < GRADE_N; i++) for (let j = 0; j < GRADE_N; j++) pts.push([loc.lat + (i - meio) * GRADE_PASSO, loc.lon + (j - meio) * GRADE_PASSO]);
  const q = new URLSearchParams({latitude: pts.map(p => p[0].toFixed(3)).join(','), longitude: pts.map(p => p[1].toFixed(3)).join(','), hourly: 'precipitation,precipitation_probability', forecast_days: '3', timezone: 'auto'});
  const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q); if (!r.ok) throw new Error('grade ' + r.status);
  const j = await r.json(), lista = Array.isArray(j) ? j : [j];
  const g = {em: Date.now(), lat: loc.lat, lon: loc.lon, horas: lista[0].hourly.time, pontos: lista.map((x, k) => ({lat: pts[k][0], lon: pts[k][1], mm: x.hourly.precipitation, prob: x.hourly.precipitation_probability}))};
  safeStorage.set(GRADE_KEY, JSON.stringify(g));
  return g;
}
const dataUTC = s => s ? new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')) : null;
const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
function rotuloHora(iso) {
  const d = new Date(iso), dia = isoDate(d), nome = dia === today() ? 'hoje' : dia === addDias(today(), 1) ? 'amanhã' : (typeof DIA_SEMANA_LONGO !== 'undefined' ? DIA_SEMANA_LONGO[d.getDay()] : fmtDate(dia));
  return `${nome} ${String(d.getHours()).padStart(2, '0')}h`;
}
// Quadros do STSC: horas "HH:MM" em UTC no dia da última ocorrência (volta um dia se passar da meia-noite)
function horariosStsc(s) {
  const ult = dataUTC(s?.ultima); if (!ult) return [];
  const dia = ult.toISOString().slice(0, 10);
  return (s.quadros || []).map(q => { let d = dataUTC(`${dia} ${q.hora}:00`); if (d > ult.getTime() + 60000) d = new Date(d.getTime() - 864e5); return {t: d, pontos: q.pontos || []}; });
}

// Imagem da chuva prevista de uma hora: interpolação bilinear da grade, pintada pela escala (transparente sem chuva)
function imagemChuva(g, idx, limites) {
  const W = 168, cv = document.createElement('canvas'); cv.width = cv.height = W; const ctx = cv.getContext('2d'), im = ctx.createImageData(W, W);
  const lat0 = Math.min(...g.pontos.map(p => p.lat)), lon0 = Math.min(...g.pontos.map(p => p.lon)), n = GRADE_N;
  const v = (i, j) => g.pontos[Math.max(0, Math.min(n - 1, i)) * n + Math.max(0, Math.min(n - 1, j))].mm[idx] || 0;
  const [[sLat, sLon], [nLat, nLon]] = limites, hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const lat = nLat - (y + 0.5) / W * (nLat - sLat), lon = sLon + (x + 0.5) / W * (nLon - sLon);
    const fi = Math.max(0, Math.min(n - 1, (lat - lat0) / GRADE_PASSO)), fj = Math.max(0, Math.min(n - 1, (lon - lon0) / GRADE_PASSO)), i = Math.floor(fi), j = Math.floor(fj), di = fi - i, dj = fj - j;
    const mm = v(i, j) * (1 - di) * (1 - dj) + v(i + 1, j) * di * (1 - dj) + v(i, j + 1) * (1 - di) * dj + v(i + 1, j + 1) * di * dj;
    const cor = corChuva(mm); if (!cor) continue;
    const borda = Math.min(fi, n - 1 - fi, fj, n - 1 - fj), a = Math.round(150 * Math.min(1, 0.15 + borda / 1.2)); // some aos poucos na borda da grade
    const [r, gg, b] = hex(cor), o = (y * W + x) * 4; im.data[o] = r; im.data[o + 1] = gg; im.data[o + 2] = b; im.data[o + 3] = a;
  }
  ctx.putImageData(im, 0, 0); return cv.toDataURL('image/png');
}
// Camada do satélite: a imagem da REDEMET é equiretangular (lat/lon proporcionais); o mapa é Mercator.
// Desenha faixa por faixa num canvas, cada uma na latitude certa (sem ler os pixels: não precisa de CORS).
function criarCamadaSatelite(L, limitesImg) {
  const Camada = L.Layer.extend({
    onAdd(map) { this._map = map; this.cv = L.DomUtil.create('canvas', 'leaflet-zoom-hide mt-sat'); map.getPanes().overlayPane.appendChild(this.cv); map.on('zoomend viewreset moveend resize', this.desenhar, this); this.desenhar(); },
    onRemove(map) { this.cv.remove(); map.off('zoomend viewreset moveend resize', this.desenhar, this); },
    usar(img) { this.img = img; this.desenhar(); },
    desenhar() {
      const map = this._map, cv = this.cv; if (!map || !cv) return;
      const [[IS, IW], [IN, IE]] = limitesImg, b = map.getBounds().pad(0.2);
      const s = Math.max(IS, b.getSouth()), n = Math.min(IN, b.getNorth()), w = Math.max(IW, b.getWest()), e = Math.min(IE, b.getEast());
      const ctx = cv.getContext('2d');
      if (!(n > s && e > w)) { cv.width = cv.height = 0; return; }
      const p1 = map.latLngToLayerPoint([n, w]), p2 = map.latLngToLayerPoint([s, e]), W = Math.round(p2.x - p1.x), H = Math.round(p2.y - p1.y);
      L.DomUtil.setPosition(cv, p1); cv.width = W; cv.height = H; ctx.clearRect(0, 0, W, H);
      const img = this.img; if (!img || !img.complete || !img.naturalWidth) return;
      const iw = img.naturalWidth, ih = img.naturalHeight, sx = (w - IW) / (IE - IW) * iw, sw = (e - w) / (IE - IW) * iw, passo = 3;
      for (let y = 0; y < H; y += passo) {
        const lt = map.layerPointToLatLng([p1.x, p1.y + y]).lat, lb = map.layerPointToLatLng([p1.x, p1.y + Math.min(H, y + passo)]).lat;
        const sy = (IN - lt) / (IN - IS) * ih, sh = Math.max(0.5, (lt - lb) / (IN - IS) * ih);
        ctx.drawImage(img, sx, sy, sw, sh, 0, y, W, Math.min(passo, H - y));
      }
    }
  });
  return new Camada();
}

VIEWS['clima-mapa'] = () => {
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null;
  if (!loc) return head('Mapa do tempo', 'Radar, satélite, tempestades e chuva prevista em volta da fazenda', btn('← Início', 'nav', 'inicio', 'secondary')) + `<section class="card">${empty('Informe onde fica a fazenda', 'O mapa é centrado na fazenda. Ative a localização no cartão do clima, na tela inicial.', {act: 'nav', id: 'inicio', label: 'Ir para o início'})}</section>`;
  const v = mtEstado.vis, bt = (k, rot) => `<button class="${v[k] ? 'active' : ''}" data-act="mt-camada" data-id="${k}" aria-pressed="${v[k]}">${rot}</button>`;
  return head('Mapa do tempo', 'Radar, satélite, tempestades e chuva prevista em volta da fazenda', btn('← Início', 'nav', 'inicio', 'secondary')) + `
  <section class="card panel mt-painel">
    <div class="filters mt-camadas" role="group" aria-label="Camadas do mapa">${bt('sat', '☁ Satélite')}${bt('radar', '📡 Radar')}${bt('stsc', '⚡ Tempestades')}${bt('prev', '🌧 Chuva prevista')}</div>
    <div id="mapaTempo" class="mt-mapa" role="img" aria-label="Mapa do tempo em volta da fazenda"></div>
    <div class="mt-tempo"><button type="button" class="primary mt-play" data-act="mt-play" aria-label="Animar">▶</button><input type="range" id="mtSlider" min="0" max="0" value="0" aria-label="Hora"><b id="mtHora">—</b></div>
    <div class="mt-dias" id="mtDias"></div>
    <div class="mt-legenda" id="mtLegenda"></div>
    <p class="nota" id="mtStatus">Carregando o mapa…</p>
    <small class="nota">Observado (radar, satélite e tempestades): REDEMET/DECEA — não substitui informação oficial para a aviação. Chuva prevista: média dos modelos (Open-Meteo), em pontos a cada ~40 km. Mapa © OpenStreetMap.</small>
  </section>`;
};
TITLES['clima-mapa'] = 'Mapa do tempo';
VIEWS['clima-mapa'].after = async () => {
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null, el = document.getElementById('mapaTempo'); if (!loc || !el) return;
  const avisos = [], status = () => { const s = document.getElementById('mtStatus'); if (s) s.textContent = avisos.join(' '); };
  try { await carregarLeaflet(); } catch { avisos.push('Não foi possível carregar o mapa. Confira a internet e abra de novo.'); return status(); }
  pararAnimacao();
  const L = window.L, mapa = L.map(el, {zoomControl: true, attributionControl: true}).setView([loc.lat, loc.lon], 7);
  mtEstado.mapa = mapa; mtEstado.quadros = [];
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 12, attribution: '© OpenStreetMap'}).addTo(mapa);
  L.circleMarker([loc.lat, loc.lon], {radius: 7, color: '#fff', weight: 2, fillColor: '#e0443f', fillOpacity: 1}).addTo(mapa).bindTooltip(db.settings.farm || 'Fazenda');
  if (navigator.onLine === false) { avisos.push('Sem internet: o mapa do tempo precisa de conexão.'); return status(); }
  const perto = radaresPerto(loc.lat, loc.lon);
  const [sat, rad, tem, grade] = await Promise.allSettled([redemet({produto: 'satelite', tipo: 'ir', anima: 9}),
    perto.length ? redemet({produto: 'radar', tipo: 'maxcappi', areas: perto.map(r => r.k).join(','), anima: 9}) : Promise.resolve(null),
    redemet({produto: 'stsc', anima: 15, lat: loc.lat.toFixed(2), lon: loc.lon.toFixed(2), graus: 8}), gradeChuva(loc)]);
  if (!document.getElementById('mapaTempo')) return; // saiu da tela enquanto carregava
  // --- Observado ---
  const S = sat.status === 'fulfilled' ? sat.value : null, R = rad.status === 'fulfilled' ? rad.value : null, T = tem.status === 'fulfilled' ? horariosStsc(tem.value) : [];
  if (!S && !R && !T.length) avisos.push('Os dados observados da REDEMET (radar, satélite e tempestades) não responderam agora. Tente de novo em alguns minutos.');
  let tempos = (S?.quadros || []).map(q => dataUTC(q.data)).filter(Boolean);
  if (!tempos.length) tempos = T.slice(-9).map(x => x.t);
  const satImgs = new Map(), satCamada = S?.quadros?.length ? criarCamadaSatelite(L, S.limites).addTo(mapa) : null;
  if (satCamada) satCamada.setZIndex?.(2);
  const radQ = (R?.quadros || []).map(q => ({...q, t: dataUTC(q.data)})), radOverlays = {};
  if (perto.length && R) { const semImg = perto.filter(r => !radQ.some(q => q.area === r.k)); if (semImg.length === perto.length) avisos.push(`Radar: ${semImg.map(r => r.nome).join(', ')} não ${semImg.length === 1 ? 'publicou' : 'publicaram'} imagem na REDEMET agora; aparecem o satélite e as tempestades.`); }
  if (!perto.length) avisos.push('Não há radar do DECEA a menos de 400 km da fazenda.');
  perto.forEach(r => { radOverlays[r.k] = null; });
  const stscGrupo = L.layerGroup().addTo(mapa);
  mtEstado.quadros = tempos.map(t => ({tipo: 'obs', t, rotulo: `${hhmm(t)}${t.getTime() === tempos.at(-1)?.getTime() ? ' (último)' : ''}`}));
  const nObs = mtEstado.quadros.length;
  // --- Previsão ---
  let prevImg = null, G = null, limitesG = null;
  if (grade.status === 'fulfilled') {
    G = grade.value; const proxHora = new Date(); proxHora.setMinutes(0, 0, 0); proxHora.setHours(proxHora.getHours() + 1);
    const iso0 = `${isoDate(proxHora)}T${String(proxHora.getHours()).padStart(2, '0')}:00`, i0 = Math.max(0, G.horas.indexOf(iso0)), n = Math.min(48, G.horas.length - i0);
    G.horas.slice(i0, i0 + n).forEach((h, k) => mtEstado.quadros.push({tipo: 'prev', iso: h, idx: i0 + k, rotulo: rotuloHora(h)}));
    const meio = GRADE_PASSO / 2, la = G.pontos.map(p => p.lat), lo = G.pontos.map(p => p.lon);
    limitesG = [[Math.min(...la) - meio, Math.min(...lo) - meio], [Math.max(...la) + meio, Math.max(...lo) + meio]];
    mapa.on('click', e => { const q = mtEstado.quadros[mtEstado.quadro]; if (q?.tipo !== 'prev') return; const p = G.pontos.reduce((m, x) => Math.hypot(x.lat - e.latlng.lat, x.lon - e.latlng.lng) < Math.hypot(m.lat - e.latlng.lat, m.lon - e.latlng.lng) ? x : m, G.pontos[0]);
      L.popup().setLatLng(e.latlng).setContent(`<b>${esc(q.rotulo)}</b><br>${num(p.mm[q.idx] || 0, 1)} mm/h • chance ${Math.round(p.prob[q.idx] ?? 0)}%`).openOn(mapa); });
  } else avisos.push('A chuva prevista não respondeu agora.');
  // --- Desenhar um quadro ---
  mtEstado.desenhar = k => {
    const q = mtEstado.quadros[k], v = mtEstado.vis; if (!q) return;
    const obs = q.tipo === 'obs';
    if (satCamada) {
      const sq = obs ? S.quadros.reduce((m, x) => { const t = dataUTC(x.data); return t <= q.t && (!m || t > dataUTC(m.data)) ? x : m; }, null) : null;
      if (!sq || !v.sat) satCamada.usar(null);
      else { let img = satImgs.get(sq.path); if (!img) { img = new Image(); img.onload = () => { if (mtEstado.quadros[mtEstado.quadro]?.t === q.t) satCamada.usar(img); }; img.src = sq.path; satImgs.set(sq.path, img); } satCamada.usar(img); }
    }
    Object.keys(radOverlays).forEach(a => {
      const rq = obs && v.radar ? radQ.filter(x => x.area === a && x.t <= new Date(q.t.getTime() + 5 * 60000) && x.t >= new Date(q.t.getTime() - 20 * 60000)).at(-1) : null;
      if (!rq) { radOverlays[a]?.setOpacity(0); return; }
      if (!radOverlays[a]) radOverlays[a] = L.imageOverlay(rq.path, rq.limites, {opacity: 0.8}).addTo(mapa); else { radOverlays[a].setUrl(rq.path); radOverlays[a].setBounds(L.latLngBounds(rq.limites)); radOverlays[a].setOpacity(0.8); }
    });
    stscGrupo.clearLayers();
    if (obs && v.stsc) T.filter(x => x.t <= new Date(q.t.getTime() + 5 * 60000) && x.t > new Date(q.t.getTime() - 30 * 60000)).forEach(x => {
      const idade = (q.t - x.t) / 60000, cor = idade <= 6 ? '#ff2d2d' : idade <= 18 ? '#ff9f1c' : '#ffd23f';
      x.pontos.forEach(([la, lo]) => L.circleMarker([la, lo], {radius: idade <= 6 ? 4 : 3, stroke: false, fillColor: cor, fillOpacity: 0.9, interactive: false}).addTo(stscGrupo));
    });
    if (G && v.prev && !obs) { const url = imagemChuva(G, q.idx, limitesG); if (!prevImg) prevImg = L.imageOverlay(url, limitesG, {opacity: 1}).addTo(mapa); else { prevImg.setUrl(url); prevImg.setOpacity(1); } }
    else prevImg?.setOpacity(0);
  };
  // Atalhos: observado (−1 h, último) e previsão por dia
  const dias = document.getElementById('mtDias'), atalhos = [];
  if (nObs) { atalhos.push([0, `−${Math.round((tempos.at(-1) - tempos[0]) / 60000)} min`]); atalhos.push([nObs - 1, 'agora']); }
  [...new Set(mtEstado.quadros.filter(q => q.tipo === 'prev').map(q => q.iso.slice(0, 10)))].forEach(d => atalhos.push([mtEstado.quadros.findIndex(q => q.tipo === 'prev' && q.iso.startsWith(d)), d === today() ? 'próximas horas' : d === addDias(today(), 1) ? 'amanhã' : fmtDate(d).slice(0, 5)]));
  if (dias) dias.innerHTML = atalhos.map(([k, r]) => `<button type="button" class="chip" data-act="mt-quadro" data-id="${k}">${esc(r)}</button>`).join('');
  const leg = document.getElementById('mtLegenda');
  if (leg) leg.innerHTML = `<span><i style="background:#ff2d2d;border-radius:50%"></i>tempestade nos últimos 6 min</span><span><i style="background:#ff9f1c;border-radius:50%"></i>até 30 min</span>` +
    ESCALA_CHUVA.map(([min, cor, n]) => `<span><i style="background:${cor}"></i>${num(min, min < 1 ? 1 : 0)}${n ? ' ' + n : ''}</span>`).join('') + '<small>chuva prevista em mm/h • satélite: quanto mais branca a nuvem, mais alta e fria (mais chance de chuva forte)</small>';
  const slider = document.getElementById('mtSlider');
  if (!mtEstado.quadros.length) { avisos.push('Nada para mostrar agora.'); return status(); }
  slider.max = mtEstado.quadros.length - 1; slider.oninput = () => { pararAnimacao(); mostrarQuadro(Number(slider.value)); };
  status(); mostrarQuadro(nObs ? nObs - 1 : 0);
  setTimeout(() => mapa.invalidateSize(), 50);
};
function mostrarQuadro(k) {
  const q = mtEstado.quadros[k]; if (!q) return; mtEstado.quadro = k;
  mtEstado.desenhar?.(k);
  const h = document.getElementById('mtHora'), s = document.getElementById('mtSlider');
  if (h) h.textContent = q.rotulo; if (s) s.value = k;
}
function pararAnimacao() { if (mtEstado.tocando) clearInterval(mtEstado.tocando); mtEstado.tocando = null; const b = document.querySelector('.mt-play'); if (b) b.textContent = '▶'; }
Object.assign(ACTIONS, {
  'clima-mapa': () => go('clima-mapa'),
  'mt-camada': c => { mtEstado.vis[c] = !mtEstado.vis[c]; document.querySelectorAll('[data-act="mt-camada"]').forEach(b => { const on = mtEstado.vis[b.dataset.id]; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); }); mostrarQuadro(mtEstado.quadro); },
  'mt-quadro': k => { pararAnimacao(); mostrarQuadro(Number(k)); },
  'mt-play': () => {
    if (mtEstado.tocando) return pararAnimacao();
    const b = document.querySelector('.mt-play'); if (b) b.textContent = '❚❚';
    mtEstado.tocando = setInterval(() => { if (!document.getElementById('mapaTempo')) return pararAnimacao(); mostrarQuadro((mtEstado.quadro + 1) % Math.max(1, mtEstado.quadros.length)); }, 700);
  }
});
