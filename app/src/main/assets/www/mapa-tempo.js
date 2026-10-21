'use strict';
/* MercaPlant — Mapa do tempo (estilo radar): chuva prevista hora a hora em volta da fazenda e nuvens do satélite.
   - Chuva prevista: grade de 9 × 9 pontos (~40 km entre pontos, ~350 km de lado) da previsão Open-Meteo, a mesma usada no cartão do clima,
     pintada pela intensidade (mm/h) e animada nas próximas 48 h.
   - Nuvens: imagem infravermelha do satélite GOES-East (NOAA), servida pela NASA GIBS (dados abertos), últimas 2 h.
   - Mapa base: OpenStreetMap. Biblioteca Leaflet 1.9.4 (BSD-2), carregada só quando o mapa é aberto. */

const GRADE_N = 9, GRADE_PASSO = 0.4, GRADE_KEY = 'agro-clima-grade';
const ESCALA_CHUVA = [[0.2, '#a9d8f7', 'fraca'], [1, '#4aa8ec', ''], [2.5, '#1f6fd1', 'moderada'], [5, '#f2d43f', ''], [10, '#f39a3c', 'forte'], [20, '#e0443f', 'muito forte']];
const corChuva = mm => { let c = null; ESCALA_CHUVA.forEach(([min, cor]) => { if (mm >= min) c = cor; }); return c; };
let mtEstado = {camada: 'chuva', quadro: 0, tocando: null, mapa: null, camadas: [], quadros: []};

function carregarLeaflet() {
  if (window.L?.map) return Promise.resolve();
  return new Promise((ok, erro) => {
    if (!document.querySelector('link[href="lib/leaflet/leaflet.css"]')) document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'lib/leaflet/leaflet.css'}));
    const s = Object.assign(document.createElement('script'), {src: 'lib/leaflet/leaflet.js'});
    s.onload = () => ok(); s.onerror = () => erro(new Error('leaflet')); document.head.append(s);
  });
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
// Quadros do satélite: a cada 20 min nas últimas 2 h (a imagem chega com uns 30 min de atraso)
function quadrosSatelite(agora = Date.now()) {
  const base = Math.floor((agora - 40 * 60000) / 600000) * 600000;
  return Array.from({length: 7}, (_, k) => new Date(base - (6 - k) * 20 * 60000));
}
const isoUTC = d => d.toISOString().slice(0, 19) + 'Z';
const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
function rotuloHora(iso) {
  const d = new Date(iso), dia = isoDate(d), nome = dia === today() ? 'hoje' : dia === addDias(today(), 1) ? 'amanhã' : DIA_SEMANA_LONGO?.[d.getDay()] || fmtDate(dia);
  return `${nome} ${String(d.getHours()).padStart(2, '0')}h`;
}

VIEWS['clima-mapa'] = () => {
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null;
  if (!loc) return head('Mapa do tempo', 'Chuva prevista e nuvens em volta da fazenda', btn('← Início', 'nav', 'inicio', 'secondary')) + `<section class="card">${empty('Informe onde fica a fazenda', 'O mapa é centrado na fazenda. Ative a localização no cartão do clima, na tela inicial.', {act: 'nav', id: 'inicio', label: 'Ir para o início'})}</section>`;
  const c = mtEstado.camada;
  return head('Mapa do tempo', 'Chuva prevista hora a hora e nuvens do satélite em volta da fazenda', btn('← Início', 'nav', 'inicio', 'secondary')) + `
  <section class="card panel mt-painel">
    <div class="filters mt-camadas" role="group" aria-label="O que mostrar"><button class="${c === 'chuva' ? 'active' : ''}" data-act="mt-camada" data-id="chuva">🌧 Chuva prevista</button><button class="${c === 'nuvens' ? 'active' : ''}" data-act="mt-camada" data-id="nuvens">☁ Nuvens (satélite)</button></div>
    <div id="mapaTempo" class="mt-mapa" role="img" aria-label="Mapa do tempo em volta da fazenda"></div>
    <div class="mt-tempo"><button type="button" class="primary mt-play" data-act="mt-play" aria-label="Animar">▶</button><input type="range" id="mtSlider" min="0" max="0" value="0" aria-label="Hora"><b id="mtHora">—</b></div>
    ${c === 'chuva' ? `<div class="mt-dias" id="mtDias"></div>` : ''}
    <div class="mt-legenda">${c === 'chuva' ? ESCALA_CHUVA.map(([min, cor, n]) => `<span><i style="background:${cor}"></i>${num(min, min < 1 ? 1 : 0)}${n ? ' ' + n : ''}</span>`).join('') + '<small>mm por hora</small>' : '<span><i style="background:#fff"></i>nuvem alta e fria (chuva forte provável)</span><span><i style="background:#888"></i>nuvem baixa</span><small>sem nuvem: aparece o mapa</small>'}</div>
    <p class="nota" id="mtStatus">Carregando o mapa…</p>
    <small class="nota">${c === 'chuva' ? 'Chuva prevista pela média dos modelos (Open-Meteo), em pontos a cada ~40 km. É previsão, não radar: confirme no céu e no pluviômetro.' : 'Imagem infravermelha do satélite GOES-East (NOAA) via NASA GIBS, com cerca de 30 min de atraso.'} Mapa © OpenStreetMap.</small>
  </section>`;
};
TITLES['clima-mapa'] = 'Mapa do tempo';
VIEWS['clima-mapa'].after = async () => {
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null, el = document.getElementById('mapaTempo'); if (!loc || !el) return;
  const status = msg => { const s = document.getElementById('mtStatus'); if (s) s.textContent = msg; };
  try { await carregarLeaflet(); } catch { return status('Não foi possível carregar o mapa. Confira a internet e abra de novo.'); }
  pararAnimacao();
  const L = window.L, mapa = L.map(el, {zoomControl: true, attributionControl: true}).setView([loc.lat, loc.lon], 7);
  mtEstado.mapa = mapa; mtEstado.camadas = []; mtEstado.quadros = [];
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 12, attribution: '© OpenStreetMap'}).addTo(mapa);
  L.circleMarker([loc.lat, loc.lon], {radius: 7, color: '#fff', weight: 2, fillColor: '#e0443f', fillOpacity: 1}).addTo(mapa).bindTooltip(db.settings.farm || 'Fazenda');
  const slider = document.getElementById('mtSlider');
  if (mtEstado.camada === 'nuvens') {
    const quadros = quadrosSatelite(); let erros = 0, ok = 0;
    mtEstado.quadros = quadros.map(d => ({rotulo: hhmm(d)}));
    mtEstado.camadas = quadros.map(d => L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {layers: 'GOES-East_ABI_Band13_Clean_Infrared', format: 'image/png', transparent: true, version: '1.3.0', time: isoUTC(d), opacity: 0, attribution: 'NOAA GOES-East / NASA GIBS'})
      .on('tileerror', () => { erros++; if (!ok && erros > 8) status('A imagem do satélite não respondeu agora. Tente de novo em alguns minutos.'); }).on('tileload', () => { ok++; status(''); }).addTo(mapa));
    mostrarQuadro(quadros.length - 1);
  } else {
    let g; try { g = await gradeChuva(loc); } catch { return status(navigator.onLine === false ? 'Sem internet: o mapa de chuva precisa de conexão.' : 'A previsão em grade não respondeu agora. Tente de novo em alguns minutos.'); }
    const agora = `${today()}T${String(new Date().getHours()).padStart(2, '0')}:00`, i0 = Math.max(0, g.horas.indexOf(agora)), n = Math.min(48, g.horas.length - i0);
    mtEstado.quadros = g.horas.slice(i0, i0 + n).map((h, k) => ({iso: h, idx: i0 + k, rotulo: rotuloHora(h)}));
    // Chuva desenhada como imagem suavizada (interpolação entre os pontos da grade), parecida com a de um radar
    const meio = GRADE_PASSO / 2, la = g.pontos.map(p => p.lat), lo = g.pontos.map(p => p.lon);
    const limites = [[Math.min(...la) - meio, Math.min(...lo) - meio], [Math.max(...la) + meio, Math.max(...lo) + meio]];
    const img = L.imageOverlay(imagemChuva(g, mtEstado.quadros[0].idx, limites), limites, {opacity: 1, interactive: false}).addTo(mapa);
    mtEstado.camadas = [{grade: g, img, limites}];
    mapa.on('click', e => { const q = mtEstado.quadros[mtEstado.quadro], p = g.pontos.reduce((m, x) => Math.hypot(x.lat - e.latlng.lat, x.lon - e.latlng.lng) < Math.hypot(m.lat - e.latlng.lat, m.lon - e.latlng.lng) ? x : m, g.pontos[0]);
      L.popup().setLatLng(e.latlng).setContent(`<b>${esc(q.rotulo)}</b><br>${num(p.mm[q.idx] || 0, 1)} mm/h • chance ${Math.round(p.prob[q.idx] ?? 0)}%`).openOn(mapa); });
    // Atalhos de dia: primeira hora com chuva de cada dia
    const dias = document.getElementById('mtDias');
    if (dias) dias.innerHTML = [...new Set(mtEstado.quadros.map(q => q.iso.slice(0, 10)))].map(d => { const k = mtEstado.quadros.findIndex(q => q.iso.startsWith(d)); return `<button type="button" class="chip" data-act="mt-quadro" data-id="${k}">${d === today() ? 'agora' : d === addDias(today(), 1) ? 'amanhã' : fmtDate(d).slice(0, 5)}</button>`; }).join('');
    const total = g.pontos.reduce((a, p) => a + mtEstado.quadros.reduce((s, q) => s + (p.mm[q.idx] || 0), 0), 0);
    status(total < 0.5 ? 'Sem chuva prevista nas próximas 48 h em volta da fazenda.' : '');
    mostrarQuadro(0);
  }
  slider.max = Math.max(0, mtEstado.quadros.length - 1); slider.value = mtEstado.quadro;
  slider.oninput = () => { pararAnimacao(); mostrarQuadro(Number(slider.value)); };
  setTimeout(() => mapa.invalidateSize(), 50);
};
// Imagem da chuva de uma hora: interpolação bilinear da grade, pintada pela escala (transparente sem chuva)
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
function mostrarQuadro(k) {
  const q = mtEstado.quadros[k]; if (!q) return; mtEstado.quadro = k;
  if (mtEstado.camada === 'nuvens') mtEstado.camadas.forEach((c, i) => c.setOpacity(i === k ? 0.7 : 0));
  else { const c = mtEstado.camadas[0]; if (c?.img) c.img.setUrl(imagemChuva(c.grade, q.idx, c.limites)); }
  const h = document.getElementById('mtHora'), s = document.getElementById('mtSlider');
  if (h) h.textContent = q.rotulo; if (s) s.value = k;
}
function pararAnimacao() { if (mtEstado.tocando) clearInterval(mtEstado.tocando); mtEstado.tocando = null; const b = document.querySelector('.mt-play'); if (b) b.textContent = '▶'; }
Object.assign(ACTIONS, {
  'clima-mapa': () => go('clima-mapa'),
  'mt-camada': c => { pararAnimacao(); mtEstado.camada = c; mtEstado.quadro = 0; mtEstado.mapa?.remove(); mtEstado.mapa = null; render(); },
  'mt-quadro': k => { pararAnimacao(); mostrarQuadro(Number(k)); },
  'mt-play': () => {
    if (mtEstado.tocando) return pararAnimacao();
    const b = document.querySelector('.mt-play'); if (b) b.textContent = '❚❚';
    mtEstado.tocando = setInterval(() => { if (!document.getElementById('mapaTempo')) return pararAnimacao(); mostrarQuadro((mtEstado.quadro + 1) % Math.max(1, mtEstado.quadros.length)); }, mtEstado.camada === 'nuvens' ? 900 : 600);
  }
});
