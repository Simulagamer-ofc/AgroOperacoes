'use strict';
/* MercaPlant — Mapa do tempo (no estilo dos apps de radar): uma linha do tempo só, do passado recente ao futuro.
   Observado (últimas ~1 h 30, a cada 10 min) — fonte oficial REDEMET/DECEA, pela função "redemet" do Supabase:
     • Satélite: imagem infravermelha (tons de cinza) da América do Sul (equiretangular), reprojetada aqui para o mapa e
       sobreposta em modo “clarear”: nuvem fica branca por cima do mapa e o chão escuro some (como nos apps de radar).
     • Radar: MaxCAPPI dos radares do DECEA perto da fazenda (quando o radar publica imagem).
     • Tempestades: STSC (células de tempestade por radar e descargas elétricas), mais recentes em vermelho.
   Previsão (próximas 48 h, hora a hora): chuva da média dos modelos (Open-Meteo) numa grade 9 × 9 em volta da fazenda.
   Mapa base OpenStreetMap; Leaflet 1.9.4 (BSD-2) carregado só ao abrir o mapa. */

safeStorage.del?.('agro-clima-grade'); // grade antiga (só em volta da fazenda)
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
// Previsão de chuva em blocos (25 pontos cada), buscados conforme a área que aparece no mapa — a chuva cobre o mapa
// inteiro, não só em volta da fazenda. Perto (zoom ≥ 7): blocos de 3° com pontos a cada 0,6° (~65 km); afastando, a grade
// fica mais aberta (6° e 12°) para cobrir o estado ou o país sem pesar. Até 9 blocos por tela; cada um guardado 30 min.
const NIVEIS_CHUVA = [{g: 3, p: 0.6}, {g: 6, p: 1.2}, {g: 12, p: 2.4}], BLOCO_N = 5, BLOCO_KEY = 'agro-clima-blocos', BLOCO_VALIDADE = 1800000, BLOCO_MAX_TELA = 9;
const nivelDoZoom = z => z >= 7 ? 0 : z >= 6 ? 1 : 2;
const blocosChuva = new Map(), blocosBuscando = new Map();
const fusoLocal = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'; } catch { return 'America/Sao_Paulo'; } };
(() => { try { const g = JSON.parse(safeStorage.get(BLOCO_KEY) || '{}'); Object.entries(g).forEach(([k, b]) => { if (Date.now() - b.em < BLOCO_VALIDADE) blocosChuva.set(k, b); }); } catch { /* recomeça */ } })();
function guardarBlocos() {
  const lista = [...blocosChuva.entries()].filter(([, b]) => Date.now() - b.em < BLOCO_VALIDADE).sort((x, y) => y[1].em - x[1].em).slice(0, 14);
  try { safeStorage.set(BLOCO_KEY, JSON.stringify(Object.fromEntries(lista))); } catch { /* sem espaço: fica só na memória */ }
}
const chaveBloco = (nv, bi, bj) => `${nv}:${bi},${bj}`;
async function buscarBloco(nv, bi, bj) {
  const k = chaveBloco(nv, bi, bj), b = blocosChuva.get(k), {g, p} = NIVEIS_CHUVA[nv];
  if (b && Date.now() - b.em < BLOCO_VALIDADE) return b;
  if (blocosBuscando.has(k)) return blocosBuscando.get(k);
  const pts = [];
  for (let i = 0; i < BLOCO_N; i++) for (let j = 0; j < BLOCO_N; j++) pts.push([bi * g + (i + 0.5) * p, bj * g + (j + 0.5) * p]);
  const q = new URLSearchParams({latitude: pts.map(x => x[0].toFixed(2)).join(','), longitude: pts.map(x => x[1].toFixed(2)).join(','), hourly: 'precipitation,precipitation_probability', forecast_days: '3', timezone: fusoLocal()});
  const pr = fetch('https://api.open-meteo.com/v1/forecast?' + q).then(r => { if (!r.ok) throw new Error('grade ' + r.status); return r.json(); }).then(j => {
    const lista = Array.isArray(j) ? j : [j];
    const novo = {em: Date.now(), horas: lista[0].hourly.time, mm: lista.map(x => x.hourly.precipitation.map(v => v == null ? 0 : Math.round(v * 10) / 10)), prob: lista.map(x => x.hourly.precipitation_probability)};
    blocosChuva.set(k, novo); guardarBlocos(); return novo;
  }).finally(() => blocosBuscando.delete(k));
  blocosBuscando.set(k, pr);
  return pr;
}
// Blocos que cobrem uma área [[s, w], [n, e]] num nível; os mais perto do centro primeiro
function blocosDaArea(nv, s, w, n, e) {
  const {g} = NIVEIS_CHUVA[nv], lista = [], cLat = (s + n) / 2, cLon = (w + e) / 2;
  for (let bi = Math.floor(s / g); bi <= Math.floor(n / g); bi++) for (let bj = Math.floor(w / g); bj <= Math.floor(e / g); bj++) lista.push([bi, bj]);
  const dist = ([bi, bj]) => Math.hypot((bi + 0.5) * g - cLat, (bj + 0.5) * g - cLon);
  return lista.sort((x, y) => dist(x) - dist(y));
}
// Valor de um ponto da grade (índices globais do nível) numa hora; null quando o bloco ainda não chegou
function pontoChuva(nv, gi, gj, iso, campo = 'mm') {
  const bi = Math.floor(gi / BLOCO_N), bj = Math.floor(gj / BLOCO_N), b = blocosChuva.get(chaveBloco(nv, bi, bj)); if (!b) return null;
  const h = b.horas.indexOf(iso); if (h < 0) return null;
  const v = b[campo][(gi - bi * BLOCO_N) * BLOCO_N + (gj - bj * BLOCO_N)]?.[h];
  return v == null ? null : v;
}
// Chuva interpolada (bilinear) num lugar; usa o nível pedido e, onde ainda não chegou, um nível mais aberto
function chuvaEm(lat, lon, iso, nv0 = 0) {
  for (let nv = nv0; nv < NIVEIS_CHUVA.length; nv++) {
    const {p} = NIVEIS_CHUVA[nv], fi = lat / p - 0.5, fj = lon / p - 0.5, i = Math.floor(fi), j = Math.floor(fj), di = fi - i, dj = fj - j;
    let soma = 0, peso = 0;
    [[i, j, (1 - di) * (1 - dj)], [i + 1, j, di * (1 - dj)], [i, j + 1, (1 - di) * dj], [i + 1, j + 1, di * dj]].forEach(([a, b, w]) => { const v = pontoChuva(nv, a, b, iso); if (v != null) { soma += v * w; peso += w; } });
    if (peso) return {mm: soma / peso, peso};
  }
  return null;
}
function chuvaNoPonto(lat, lon, iso, nv0 = 0) {
  for (let nv = nv0; nv < NIVEIS_CHUVA.length; nv++) { const {p} = NIVEIS_CHUVA[nv], gi = Math.round(lat / p - 0.5), gj = Math.round(lon / p - 0.5), mm = pontoChuva(nv, gi, gj, iso); if (mm != null) return {mm, prob: pontoChuva(nv, gi, gj, iso, 'prob')}; }
  return null;
}
// Camada da chuva prevista: pinta a área visível inteira (em baixa resolução, suavizada pelo navegador)
function criarCamadaChuva(L) {
  const Camada = L.Layer.extend({
    onAdd(map) { this._map = map; this.cv = L.DomUtil.create('canvas', 'leaflet-zoom-hide mt-prev'); map.getPanes().overlayPane.appendChild(this.cv); map.on('moveend zoomend resize viewreset', this.desenhar, this); this.desenhar(); },
    onRemove(map) { this.cv.remove(); map.off('moveend zoomend resize viewreset', this.desenhar, this); },
    usar(iso) { this.iso = iso; this.desenhar(); },
    desenhar() {
      const map = this._map, cv = this.cv; if (!map || !cv) return;
      const tam = map.getSize(), topo = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(cv, topo); cv.style.width = tam.x + 'px'; cv.style.height = tam.y + 'px';
      const F = 4, W = Math.ceil(tam.x / F), H = Math.ceil(tam.y / F); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, W, H); if (!this.iso) return;
      const im = ctx.createImageData(W, H), lats = [], lons = [], nv = nivelDoZoom(map.getZoom());
      for (let y = 0; y < H; y++) lats.push(map.containerPointToLatLng([0, (y + 0.5) * F]).lat);
      for (let x = 0; x < W; x++) lons.push(map.containerPointToLatLng([(x + 0.5) * F, 0]).lng);
      const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)], cores = new Map();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const r = chuvaEm(lats[y], lons[x], this.iso, nv); if (!r) continue;
        const cor = corChuva(r.mm); if (!cor) continue;
        if (!cores.has(cor)) cores.set(cor, hex(cor));
        const [R, G, B] = cores.get(cor), o = (y * W + x) * 4; im.data[o] = R; im.data[o + 1] = G; im.data[o + 2] = B; im.data[o + 3] = Math.round(150 * Math.min(1, r.peso * 1.3));
      }
      ctx.putImageData(im, 0, 0);
    }
  });
  return new Camada();
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

// Tempestade mais perto da fazenda no último quadro do STSC, direção e se está chegando (comparando com ~30 min antes)
const RUMOS = ['ao norte', 'a nordeste', 'a leste', 'a sudeste', 'ao sul', 'a sudoeste', 'a oeste', 'a noroeste'];
function rumo(lat, lon, la, lo) { const r = Math.PI / 180, y = Math.sin((lo - lon) * r) * Math.cos(la * r), x = Math.cos(lat * r) * Math.sin(la * r) - Math.sin(lat * r) * Math.cos(la * r) * Math.cos((lo - lon) * r); return RUMOS[Math.round(((Math.atan2(y, x) / r + 360) % 360) / 45) % 8]; }
function tempestadeMaisPerto(T, lat, lon) {
  const ult = T.at(-1); if (!ult) return null;
  const maisPerto = q => (q?.pontos || []).reduce((m, [la, lo]) => { const d = distKm(lat, lon, la, lo); return !m || d < m.d ? {d, la, lo} : m; }, null);
  const agora = maisPerto(ult); if (!agora) return {nenhuma: true, t: ult.t};
  const antes = T.filter(x => x.t <= new Date(ult.t.getTime() - 25 * 60000)).at(-1), a = maisPerto(antes);
  return {d: agora.d, rumo: rumo(lat, lon, agora.la, agora.lo), t: ult.t, chegando: a ? agora.d < a.d - 5 : null};
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

// Painel do mapa (tela cheia ou embutido no cartão do clima do Início)
function painelMapaHTML(compacto = false) {
  const v = mtEstado.vis, bt = (k, rot) => `<button class="${v[k] ? 'active' : ''}" data-act="mt-camada" data-id="${k}" aria-pressed="${v[k]}">${rot}</button>`;
  return `<section class="card panel mt-painel ${compacto ? 'mt-compacto' : ''}" ${compacto ? 'id="mtCasa"' : ''}>
    ${compacto ? `<div class="section-title" style="margin:0"><h3>Radar e chuva no mapa</h3><button type="button" data-act="nav" data-id="clima">⛶ Abrir MercaClima</button></div>` : ''}
    <p class="mt-alerta" id="mtAlerta" hidden></p>
    <div class="filters mt-camadas" role="group" aria-label="Camadas do mapa">${bt('sat', '☁ Satélite')}${bt('radar', '📡 Radar')}${bt('stsc', '⚡ Tempestades')}${bt('prev', '🌧 Chuva prevista')}</div>
    <div id="mapaTempo" class="mt-mapa" role="img" aria-label="Mapa do tempo em volta da fazenda"></div>
    <div class="mt-tempo"><button type="button" class="primary mt-play" data-act="mt-play" aria-label="Animar">▶</button><input type="range" id="mtSlider" min="0" max="0" value="0" aria-label="Hora"><b id="mtHora">—</b></div>
    <div class="mt-dias" id="mtDias"></div>
    ${compacto ? '' : '<div class="mt-legenda" id="mtLegenda"></div>'}
    <p class="nota" id="mtStatus">Carregando o mapa…</p>
    <small class="nota">Observado (radar, satélite e tempestades): REDEMET/DECEA — não substitui informação oficial para a aviação. Chuva prevista: média dos modelos (Open-Meteo). Mapa © OpenStreetMap.</small>
  </section>`;
}
VIEWS['clima-mapa'] = () => {
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null;
  if (!loc) return head('Mapa do tempo', 'Radar, satélite, tempestades e chuva prevista em volta da fazenda', btn('← Início', 'nav', 'inicio', 'secondary')) + `<section class="card">${empty('Informe onde fica a fazenda', 'O mapa é centrado na fazenda. Ative a localização no cartão do clima, na tela inicial.', {act: 'nav', id: 'inicio', label: 'Ir para o início'})}</section>`;
  return head('Mapa do tempo', 'Radar, satélite, tempestades e chuva prevista em volta da fazenda', btn('← MercaClima', 'nav', 'clima', 'secondary')) + painelMapaHTML(false);
};
TITLES['clima-mapa'] = 'Mapa do tempo';
// Busca os blocos da área visível (com folga). Afastado demais: só os mais perto do centro, para não pesar
let avisoAfastado = false;
async function carregarChuvaDaTela(mapa) {
  const b = mapa.getBounds().pad(0.1), nv = nivelDoZoom(mapa.getZoom()), todos = blocosDaArea(nv, b.getSouth(), b.getWest(), b.getNorth(), b.getEast()), lista = todos.slice(0, BLOCO_MAX_TELA);
  avisoAfastado = todos.length > lista.length;
  const st = document.getElementById('mtStatus'); if (st) st.dataset.afastado = avisoAfastado ? '1' : '';
  const res = await Promise.allSettled(lista.map(([bi, bj]) => buscarBloco(nv, bi, bj)));
  const ok = res.find(r => r.status === 'fulfilled')?.value; if (!ok) throw new Error('previsão indisponível');
  return ok;
}
async function iniciarMapaTempo() {
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
    redemet({produto: 'stsc', anima: 15, lat: loc.lat.toFixed(2), lon: loc.lon.toFixed(2), graus: 8}), carregarChuvaDaTela(mapa)]);
  if (!document.getElementById('mapaTempo')) return; // saiu da tela enquanto carregava
  // --- Observado ---
  const S = sat.status === 'fulfilled' ? sat.value : null, R = rad.status === 'fulfilled' ? rad.value : null, T = tem.status === 'fulfilled' ? horariosStsc(tem.value) : [];
  const tp = T.length ? tempestadeMaisPerto(T, loc.lat, loc.lon) : null, al = document.getElementById('mtAlerta');
  if (al && tp) {
    const perto = !tp.nenhuma && tp.d <= 150;
    al.hidden = false; al.className = 'mt-alerta ' + (perto ? (tp.d <= 40 ? 'perigo' : 'atencao') : 'ok');
    al.textContent = perto ? `⚡ Tempestade a ${Math.round(tp.d)} km ${tp.rumo} da fazenda (às ${hhmm(tp.t)})${tp.chegando === true ? ' — se aproximando' : tp.chegando === false ? ' — não está se aproximando' : ''}.` : `Nenhuma tempestade num raio de 150 km (última verificação às ${hhmm(tp.t)}).`;
  }
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
  // --- Previsão (chuva em blocos que acompanham o mapa) ---
  let chuvaCamada = null, G = null;
  if (grade.status === 'fulfilled' && grade.value) {
    G = grade.value; const proxHora = new Date(); proxHora.setMinutes(0, 0, 0); proxHora.setHours(proxHora.getHours() + 1);
    const iso0 = `${isoDate(proxHora)}T${String(proxHora.getHours()).padStart(2, '0')}:00`, i0 = Math.max(0, G.horas.indexOf(iso0)), n = Math.min(48, G.horas.length - i0);
    G.horas.slice(i0, i0 + n).forEach((h, k) => mtEstado.quadros.push({tipo: 'prev', iso: h, idx: i0 + k, rotulo: rotuloHora(h)}));
    chuvaCamada = criarCamadaChuva(L).addTo(mapa);
    // Ao arrastar ou afastar: busca a previsão da nova área e redesenha
    let espera = null;
    mapa.on('moveend', () => { clearTimeout(espera); espera = setTimeout(() => carregarChuvaDaTela(mapa).then(() => { if (mtEstado.quadros[mtEstado.quadro]?.tipo === 'prev') chuvaCamada.desenhar(); }).catch(() => {}), 350); });
    mapa.on('click', e => { const q = mtEstado.quadros[mtEstado.quadro]; if (q?.tipo !== 'prev') return;
      const c = chuvaNoPonto(e.latlng.lat, e.latlng.lng, q.iso, nivelDoZoom(mapa.getZoom())), mm = c?.mm, pb = c?.prob;
      L.popup().setLatLng(e.latlng).setContent(mm == null ? `<b>${esc(q.rotulo)}</b><br>Carregando a previsão desta área…` : `<b>${esc(q.rotulo)}</b><br>${num(mm, 1)} mm/h • chance ${Math.round(pb ?? 0)}%`).openOn(mapa); });
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
    chuvaCamada?.usar(G && v.prev && !obs ? q.iso : null);
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
}
VIEWS['clima-mapa'].after = () => iniciarMapaTempo();
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
