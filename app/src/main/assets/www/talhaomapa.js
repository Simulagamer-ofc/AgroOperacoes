'use strict';
/* MercaPlant — Talhões no mapa de satélite.
   • Mapa da fazenda: todos os talhões com contorno pintados sobre a imagem de satélite (cor pela cultura), com nome e área.
   • Desenhar no satélite: toque nos cantos do talhão; arraste um ponto para ajustar, toque no ponto do meio de um lado
     para criar outro, toque num canto para tirar. Área geodésica e perímetro iguais aos do contorno por GPS.
   • Importar: KML/KMZ (Google Earth), Shapefile (.zip ou .shp + .dbf + .prj, inclusive em UTM), GeoJSON — do monitor
     da máquina, do CAR (SICAR) ou de outro sistema. Cada contorno do arquivo vira um talhão novo ou vai para um existente.
   A imagem de satélite precisa de internet; o contorno salvo fica no aparelho e sincroniza com o talhão. */

// Imagem de satélite. Para vender o sistema, use uma chave própria (Esri ArcGIS Location Platform ou Mapbox),
// restrita aos endereços do app. Sem chave, o serviço público da Esri (para testes).
const SAT_CHAVES = {esri: '', mapbox: ''};
function tmCamadaSatelite(L) {
  if (SAT_CHAVES.mapbox) return L.tileLayer(`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${SAT_CHAVES.mapbox}`,
    {maxZoom: 20, maxNativeZoom: 19, tileSize: 512, zoomOffset: -1, attribution: '© Mapbox © Maxar'});
  const base = SAT_CHAVES.esri ? 'https://ibasemaps-api.arcgis.com' : 'https://server.arcgisonline.com';
  return L.tileLayer(`${base}/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}${SAT_CHAVES.esri ? `?token=${SAT_CHAVES.esri}` : ''}`,
    {maxZoom: 20, maxNativeZoom: 18, attribution: 'Imagem © Esri, Maxar, Earthstar Geographics'});
}
const tmErro = m => Object.assign(new Error(m), {amigavel: true});
const tmGestor = () => typeof mcpGestor !== 'function' || mcpGestor();
const tmR7 = v => Math.round(v * 1e7) / 1e7;
const tmAreaHa = p => p.length > 2 ? areaGeodesicaM2(p) / 1e4 : 0;
// Cor pela cultura (a mesma cultura, a mesma cor)
const TM_CORES = ['#f2c94c', '#6fcf97', '#56ccf2', '#f2994a', '#bb6bd9', '#eb5757', '#27ae60', '#2d9cdb', '#f78fb3', '#9b51e0'];
const tmCulturas = () => [...new Set(db.fields.filter(f => f.contorno?.pontos?.length > 2).map(f => (f.crop || '').trim() || 'Sem cultura'))].sort((a, b) => a === 'Sem cultura' ? 1 : b === 'Sem cultura' ? -1 : a.localeCompare(b, 'pt-BR'));
const tmCorCultura = c => (c || '').trim() ? TM_CORES[tmCulturas().filter(x => x !== 'Sem cultura').indexOf(c.trim()) % TM_CORES.length] || '#ffffff' : '#ffffff';

let tm = {mapa: null, semImagem: 0};
function tmNovoMapa(el, opcoes = {}) {
  if (tm.mapa) { try { tm.mapa.remove(); } catch { /* já removido com a tela */ } }
  const L = window.L, mapa = L.map(el, {doubleClickZoom: false, zoomControl: true, attributionControl: true, ...opcoes});
  tm = {mapa, semImagem: 0};
  const sat = tmCamadaSatelite(L).addTo(mapa);
  sat.on('tileerror', () => { if (++tm.semImagem === 4) { const av = $('.tm-aviso', el.parentElement); if (av) av.hidden = false; } });
  sat.on('tileload', () => { tm.semImagem = 0; const av = $('.tm-aviso', el.parentElement); if (av) av.hidden = true; });
  return mapa;
}
const tmAvisoSemImagem = '<div class="tm-aviso" hidden>Sem internet: a imagem de satélite não carregou. Os contornos aparecem mesmo assim.</div>';
// Onde abrir: contornos, local da sede, ou o Brasil
function tmEnquadrar(mapa, grupos) {
  const L = window.L, b = L.latLngBounds([]);
  grupos.forEach(p => p.forEach(([la, lo]) => b.extend([la, lo])));
  if (b.isValid()) mapa.fitBounds(b, {padding: [24, 24], maxZoom: 17});
  else if (db.settings.local?.lat) mapa.setView([db.settings.local.lat, db.settings.local.lon], 15);
  else mapa.setView([-15.8, -52], 4);
}
function tmMinhaPosicao(mapa, zoom = 17) {
  if (!navigator.geolocation) { showToast('Este aparelho não oferece localização'); return; }
  showToast('Lendo o GPS…');
  navigator.geolocation.getCurrentPosition(p => {
    const ll = [p.coords.latitude, p.coords.longitude];
    if (tm.posicao) tm.posicao.remove();
    tm.posicao = window.L.circleMarker(ll, {radius: 8, color: '#fff', weight: 3, fillColor: '#2f80ed', fillOpacity: 1}).addTo(mapa);
    mapa.setView(ll, Math.max(mapa.getZoom(), zoom));
  }, () => showToast('GPS sem sinal ou sem permissão'), {enableHighAccuracy: true, timeout: 20000, maximumAge: 30000});
}

// ---------------- Mapa da fazenda ----------------
VIEWS.mapatalhoes = () => {
  const fs = db.fields.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', {numeric: true}));
  const com = fs.filter(f => f.contorno?.pontos?.length > 2), sem = fs.filter(f => !(f.contorno?.pontos?.length > 2)), g = tmGestor();
  const haMapa = com.reduce((s, f) => s + Number(f.contorno.areaHa || 0), 0);
  const legenda = tmCulturas().map(c => `<span class="tm-leg"><i style="background:${tmCorCultura(c === 'Sem cultura' ? '' : c)}"></i>${esc(c)}</span>`).join('');
  return head('Talhões', `${com.length} de ${fs.length} no mapa • ${um1(haMapa)} ha medidos`, (g ? btn('Importar contornos', 'nav', 'importartalhoes', 'secondary') : '') + btn('📍 Minha localização', 'tm-eu', '', 'secondary') + (g ? btn('+ Novo talhão', 'fd-new') : '')) +
    `<section class="card tm-caixa"><div class="tm-mapa" id="tmMapa" aria-label="Mapa de satélite dos talhões"></div>${tmAvisoSemImagem}${legenda ? `<div class="tm-legenda">${legenda}</div>` : ''}</section>` +
    (sem.length ? `<div class="section-title"><h3>Sem contorno (${sem.length})</h3></div><section class="card list">${sem.map(f => `<div class="list-row"><div><strong>${esc(f.name)}</strong><small>${num(f.area)} ha no cadastro${f.crop ? ' • ' + esc(f.crop) : ''}</small></div><div class="row-actions">${g ? mini('🛰 Desenhar no satélite', 'nav', 'desenhar/' + f.id) + mini('⌖ Caminhar (GPS)', 'nav', 'contorno/' + f.id) : ''}</div></div>`).join('')}</section>` : '') +
    (fs.length ? '' : `<section class="card">${empty('Nenhum talhão cadastrado', 'Cadastre os talhões, desenhe no satélite ou importe de um arquivo (Google Earth, monitor da máquina, CAR).', g ? {act: 'nav', id: 'importartalhoes', label: 'Importar contornos'} : null)}</section>`);
};
VIEWS.mapatalhoes.after = () => {
  const el = $('#tmMapa'); if (!el) return;
  carregarLeaflet().then(() => {
    if (!document.body.contains(el)) return;
    const L = window.L, mapa = tmNovoMapa(el), com = db.fields.filter(f => f.contorno?.pontos?.length > 2);
    com.forEach(f => {
      const cor = tmCorCultura(f.crop);
      L.polygon(f.contorno.pontos.map(([la, lo]) => [la, lo]), {color: cor, weight: 2, fillColor: cor, fillOpacity: 0.28})
        .bindTooltip(`<b>${esc(f.name)}</b><br>${um1(f.contorno.areaHa)} ha${f.crop ? ' • ' + esc(f.crop) : ''}`, {permanent: true, direction: 'center', className: 'tm-rot'})
        .on('click', () => go('talhao/' + f.id)).addTo(mapa);
    });
    tmEnquadrar(mapa, com.map(f => f.contorno.pontos));
    setTimeout(() => mapa.invalidateSize(), 50);
  }).catch(() => { el.innerHTML = '<p class="viz-vazio">Não foi possível abrir o mapa.</p>'; });
};
TITLES.mapatalhoes = 'Talhões';

// ---------------- Desenhar no satélite ----------------
let tmd = null; // {fieldId, pontos: [[lat, lon]]}
function tmdPainel() {
  const f = find('fields', tmd.fieldId), p = tmd.pontos, area = tmAreaHa(p), per = perimetroM(p);
  return `<div class="ctn-num"><div><span>Pontos</span><b>${p.length}</b></div><div><span>Área</span><b>${p.length > 2 ? um1(area) + ' ha' : '—'}</b></div><div><span>Perímetro</span><b>${p.length > 1 ? num(Math.round(per)) + ' m' : '—'}</b></div><div><span>No cadastro</span><b>${f ? num(f.area) + ' ha' : '—'}</b></div></div>
    <div class="btn-row">${btn('📍 Minha localização', 'tm-eu', '', 'secondary')}${p.length ? btn('Desfazer', 'tmd-desfazer', '', 'secondary') + btn('Limpar', 'tmd-limpar', '', 'secondary') : ''}${p.length > 2 ? btn('Salvar contorno', 'tmd-salvar') : ''}</div>`;
}
function tmdRedesenhar(soLinha = false) {
  const L = window.L, mapa = tm.mapa; if (!mapa || !tmd) return;
  const ll = tmd.pontos.map(([la, lo]) => [la, lo]);
  if (!tmd.poli) tmd.poli = L.polygon([], {color: '#ffd400', weight: 3, fillColor: '#ffd400', fillOpacity: 0.18, interactive: false}).addTo(mapa);
  tmd.poli.setLatLngs(ll);
  const pn = $('#tmdPainel'); if (pn) pn.innerHTML = tmdPainel();
  if (soLinha) return;
  (tmd.marcas || []).forEach(m => m.remove()); tmd.marcas = [];
  const muitos = tmd.pontos.length > 150;
  tmd.pontos.forEach((pt, i) => {
    const m = L.marker(pt, {draggable: true, icon: L.divIcon({className: `tm-vert${i === 0 ? ' prim' : ''}${muitos ? ' peq' : ''}`, iconSize: muitos ? [10, 10] : [20, 20]}), keyboard: false}).addTo(mapa);
    m.on('drag', e => { const q = e.target.getLatLng(); tmd.pontos[i] = [q.lat, q.lng]; tmdRedesenhar(true); });
    m.on('dragend', () => tmdRedesenhar());
    m.on('click', () => { tmd.pontos.splice(i, 1); tmdRedesenhar(); });
    tmd.marcas.push(m);
  });
  // Ponto no meio de cada lado: toque para criar um canto ali
  if (tmd.pontos.length > 1 && !muitos) tmd.pontos.forEach((a, i) => {
    if (tmd.pontos.length < 3 && i === tmd.pontos.length - 1) return;
    const b = tmd.pontos[(i + 1) % tmd.pontos.length], meio = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const m = L.marker(meio, {icon: L.divIcon({className: 'tm-meio', iconSize: [14, 14]}), keyboard: false}).addTo(mapa);
    m.on('click', () => { tmd.pontos.splice(i + 1, 0, meio); tmdRedesenhar(); });
    tmd.marcas.push(m);
  });
}
VIEWS.desenhar = id => {
  const f = find('fields', id); if (!f) return empty('Talhão não encontrado', '');
  if (!tmGestor()) return head('Desenhar no satélite', 'Só para o ADM e o supervisor.', btn('← Talhão', 'nav', 'talhao/' + id, 'secondary')) + `<section class="card">${empty('Sem acesso', 'Seu nível de acesso é Usuário comum.')}</section>`;
  if (!tmd || tmd.fieldId !== id) tmd = {fieldId: id, pontos: (f.contorno?.pontos || []).map(([la, lo]) => [la, lo])};
  return head(`Desenhar no satélite — ${f.name}`, 'Toque nos cantos do talhão. Arraste um canto para ajustar; toque no ponto do meio de um lado para criar outro canto; toque num canto para tirar.',
    btn('← Talhão', 'nav', 'talhao/' + id, 'secondary') + btn('⌖ Caminhar (GPS)', 'nav', 'contorno/' + id, 'secondary')) +
    `<div class="tm-desenho"><section class="card tm-caixa"><div class="tm-mapa" id="tmMapa" aria-label="Mapa de satélite para desenhar o talhão"></div>${tmAvisoSemImagem}</section>
     <section class="card panel" id="tmdPainel">${tmdPainel()}</section></div>
     <p class="nota">Os outros talhões aparecem em branco, para não sobrepor. A área é calculada no elipsoide WGS 84, igual ao contorno medido com GPS.</p>`;
};
VIEWS.desenhar.after = () => {
  const el = $('#tmMapa'); if (!el || !tmd) return;
  carregarLeaflet().then(() => {
    if (!document.body.contains(el)) return;
    const L = window.L, mapa = tmNovoMapa(el); tmd.poli = null; tmd.marcas = [];
    const outros = db.fields.filter(f => f.id !== tmd.fieldId && f.contorno?.pontos?.length > 2);
    outros.forEach(f => L.polygon(f.contorno.pontos.map(([la, lo]) => [la, lo]), {color: '#fff', weight: 1.5, dashArray: '4 4', fillOpacity: 0.06, interactive: false})
      .bindTooltip(esc(f.name), {permanent: true, direction: 'center', className: 'tm-rot fraco'}).addTo(mapa));
    tmEnquadrar(mapa, tmd.pontos.length ? [tmd.pontos] : outros.map(f => f.contorno.pontos));
    mapa.on('click', e => { tmd.pontos.push([e.latlng.lat, e.latlng.lng]); tmdRedesenhar(); });
    tmdRedesenhar();
    setTimeout(() => mapa.invalidateSize(), 50);
  }).catch(() => { el.innerHTML = '<p class="viz-vazio">Não foi possível abrir o mapa.</p>'; });
};
TITLES.desenhar = 'Talhões';

Object.assign(ACTIONS, {
  'tm-eu': () => { if (tm.mapa) tmMinhaPosicao(tm.mapa); },
  'tmd-desfazer': () => { tmd?.pontos.pop(); tmdRedesenhar(); },
  'tmd-limpar': () => confirmDialog('Apagar os pontos desenhados?', () => { tmd.pontos = []; setTimeout(tmdRedesenhar, 0); }, 'Limpar'),
  'tmd-salvar': () => {
    if (!tmd || tmd.pontos.length < 3 || !tmGestor()) return;
    // Mesmo caminho do contorno por GPS: grava e pergunta se a área medida vai para o cadastro
    ctn = {fieldId: tmd.fieldId, pontos: tmd.pontos.map(([la, lo]) => [tmR7(la), tmR7(lo), 0]), watch: null};
    ACTIONS['ctn-salvar']();
    const f = find('fields', tmd.fieldId); if (f?.contorno) { f.contorno.origem = 'satélite'; save(); }
    tmd = null;
  }
});

// ---------------- Importar contornos ----------------
// Formato interno: {nome, pontos: [[lat, lon]], camada}
const tmNormNome = s => semAcentoApp(s).replace(/\btalhao\b|\btal\b|\bt\b/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b0+(\d)/g, '$1').trim();
function tmTirarFecho(anel) { const a = anel.slice(); if (a.length > 1 && a[0][0] === a.at(-1)[0] && a[0][1] === a.at(-1)[1]) a.pop(); return a; }
// Douglas-Peucker em metros, até no máximo `max` pontos (o registro do talhão tem limite de tamanho)
function tmSimplificar(pts, max = 800) {
  if (pts.length <= 4) return pts;
  const lat0 = rad(pts[0][0]), xy = pts.map(([la, lo]) => [rad(lo) * RAIO_TERRA * Math.cos(lat0), rad(la) * RAIO_TERRA]);
  const dp = tol => {
    const manter = new Uint8Array(xy.length); manter[0] = manter[xy.length - 1] = 1; const pilha = [[0, xy.length - 1]];
    while (pilha.length) {
      const [i, j] = pilha.pop(); let dmax = 0, k = -1;
      const [x1, y1] = xy[i], [x2, y2] = xy[j], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      for (let n = i + 1; n < j; n++) {
        const [x, y] = xy[n]; let t = l2 ? ((x - x1) * dx + (y - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)); if (d > dmax) { dmax = d; k = n; }
      }
      if (dmax > tol && k > 0) { manter[k] = 1; pilha.push([i, k], [k, j]); }
    }
    return pts.filter((_, n) => manter[n]);
  };
  let tol = 0.3, r = dp(tol);
  while (r.length > max) { tol *= 1.6; r = dp(tol); }
  return r;
}
const tmAssinada = anel => anel.reduce((s, p, i) => { const q = anel[(i + 1) % anel.length]; return s + (p[0] * q[1] - q[0] * p[1]); }, 0) / 2;

// KML (Google Earth): Placemark → Polygon → outerBoundaryIs
function tmLerKml(texto, camada = '') {
  const doc = new DOMParser().parseFromString(texto, 'text/xml'), out = [];
  const tags = (el, t) => [...el.getElementsByTagNameNS('*', t)];
  tags(doc, 'Placemark').forEach((pm, n) => {
    const nome = tags(pm, 'name')[0]?.textContent.trim() || `${camada || 'Contorno'} ${n + 1}`;
    const polis = tags(pm, 'Polygon');
    polis.forEach((pg, k) => {
      const c = tags(tags(pg, 'outerBoundaryIs')[0] || pg, 'coordinates')[0]?.textContent || '';
      const pts = c.trim().split(/\s+/).map(t => t.split(',').map(Number)).filter(v => v.length >= 2 && isFinite(v[0]) && isFinite(v[1])).map(([lo, la]) => [la, lo]);
      if (pts.length > 2) out.push({nome: polis.length > 1 ? `${nome} (parte ${k + 1})` : nome, pontos: tmTirarFecho(pts), camada});
    });
  });
  return out;
}
// GeoJSON: Polygon e MultiPolygon (anel externo)
function tmLerGeojson(texto, camada = '') {
  const j = JSON.parse(texto), out = [];
  const feats = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{type: 'Feature', properties: {}, geometry: j}];
  const nomeDe = p => p && (p.name ?? p.nome ?? p.Name ?? p.NOME ?? p.talhao ?? p.TALHAO ?? p.Talhao ?? p.field ?? p.FIELD_NAME ?? p.id);
  feats.forEach((f, n) => {
    const g = f?.geometry; if (!g) return;
    const polis = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const nome = String(nomeDe(f.properties) ?? `${camada || 'Contorno'} ${n + 1}`);
    polis.forEach((pl, k) => { const pts = (pl[0] || []).map(([lo, la]) => [la, lo]); if (pts.length > 2) out.push({nome: polis.length > 1 ? `${nome} (parte ${k + 1})` : nome, pontos: tmTirarFecho(pts), camada}); });
  });
  return out;
}
// UTM → graus (SIRGAS 2000 / WGS 84, elipsoide GRS 80)
function tmUtmParaGeo(x, y, zona, sul) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  x -= 500000; if (sul) y -= 10000000;
  const mu = y / k0 / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256)), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const fi = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(fi), c = Math.cos(fi), t = Math.tan(fi), N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, R = a * (1 - e2) / (1 - e2 * s * s) ** 1.5, D = x / (N * k0);
  const lat = fi - (N * t / R) * (D ** 2 / 2 - (5 + 3 * T + 10 * C - 4 * C * C - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T + 298 * C + 45 * T * T - 252 * ep2 - 3 * C * C) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T + C) * D ** 3 / 6 + (5 - 2 * C + 28 * T - 3 * C * C + 8 * ep2 + 24 * T * T) * D ** 5 / 120) / c;
  return [lat * 180 / Math.PI, zona * 6 - 183 + lon * 180 / Math.PI];
}
// .prj: graus, ou UTM com zona e hemisfério
function tmPrj(txt) {
  if (!txt) return {geo: null};
  const t = txt.toUpperCase().replace(/\s+/g, ''), sad = /SAD/.test(t);
  if (!/PROJCS/.test(t)) return {geo: true, sad};
  if (!/TRANSVERSE_MERCATOR|UTM/.test(t)) return {erro: 'O arquivo está numa projeção que o app não lê. Exporte em graus (WGS 84 ou SIRGAS 2000) ou em UTM.'};
  let zona = Number((t.match(/UTM_?ZONE_?(\d{1,2})/) || [])[1]);
  if (!zona) { const cm = t.match(/CENTRAL_MERIDIAN",(-?[\d.]+)/); if (cm) zona = Math.round((Number(cm[1]) + 183) / 6); }
  const sul = /ZONE_?\d{1,2}S\b|ZONE_?\d{1,2}S"|SOUTH/.test(t) || /FALSE_NORTHING",10000000/.test(t);
  return zona ? {zona, sul, sad} : {erro: 'Não achei a zona UTM no arquivo .prj.'};
}
function tmDbf(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), n = dv.getUint32(4, true), hl = dv.getUint16(8, true), rl = dv.getUint16(10, true), campos = [];
  const utf = new TextDecoder('utf-8', {fatal: true}), lat = new TextDecoder('windows-1252');
  const texto = b => { try { return utf.decode(b); } catch { return lat.decode(b); } };
  for (let p = 32; p < hl - 1 && u8[p] !== 0x0d; p += 32) campos.push({nome: lat.decode(u8.subarray(p, p + 11)).replace(/\0.*$/s, '').trim(), tam: u8[p + 16]});
  const regs = [];
  for (let r = 0; r < n; r++) {
    let p = hl + r * rl + 1; const o = {};
    campos.forEach(c => { o[c.nome] = texto(u8.subarray(p, p + c.tam)).trim(); p += c.tam; });
    regs.push(o);
  }
  return regs;
}
function tmShp(buf) {
  const dv = new DataView(buf), out = []; let p = 100;
  while (p + 12 <= buf.byteLength) {
    const len = dv.getInt32(p + 4) * 2, tipo = dv.getInt32(p + 8, true), aneis = [];
    if ([5, 15, 25].includes(tipo)) {
      const np = dv.getInt32(p + 44, true), npt = dv.getInt32(p + 48, true), partes = [];
      for (let i = 0; i < np; i++) partes.push(dv.getInt32(p + 52 + i * 4, true));
      partes.push(npt); const base = p + 52 + np * 4;
      for (let i = 0; i < np; i++) { const anel = []; for (let k = partes[i]; k < partes[i + 1]; k++) anel.push([dv.getFloat64(base + k * 16, true), dv.getFloat64(base + k * 16 + 8, true)]); aneis.push(anel); }
    }
    out.push(aneis); p += 8 + len;
  }
  return out;
}
// Shapefile: anéis externos (o de maior área define o sentido; os do sentido contrário são buracos)
function tmLerShapefile({shp, dbf, prj}, camada) {
  const proj = tmPrj(prj); if (proj.erro) throw tmErro(proj.erro);
  const regs = dbf ? tmDbf(dbf) : [], recs = tmShp(shp), out = [];
  const chaves = regs[0] ? Object.keys(regs[0]) : [];
  const chaveNome = chaves.find(k => /^(nome|name|talhao|talhão|tal|field|field_name|descricao|desc|cod_imovel|id)$/i.test(k)) || chaves.find(k => /nom|name|talh/i.test(k)) || '';
  let projetado = proj.zona ? true : proj.geo === true ? false : null;
  recs.forEach((aneis, n) => {
    if (!aneis.length) return;
    if (projetado === null) projetado = aneis.some(a => a.some(([x, y]) => Math.abs(x) > 180 || Math.abs(y) > 90));
    if (projetado && !proj.zona) throw tmErro('Arquivo em metros (UTM) sem o .prj: envie junto o arquivo .prj, ou exporte em graus.');
    const conv = projetado ? ([x, y]) => tmUtmParaGeo(x, y, proj.zona, proj.sul) : ([x, y]) => [y, x];
    const maior = aneis.reduce((m, a) => Math.abs(tmAssinada(a)) > Math.abs(tmAssinada(m)) ? a : m, aneis[0]), sentido = Math.sign(tmAssinada(maior));
    const externos = aneis.length === 1 ? aneis : aneis.filter(a => Math.sign(tmAssinada(a)) === sentido);
    const nome = (chaveNome && regs[n]?.[chaveNome]) || `${camada} ${n + 1}`;
    externos.forEach((a, k) => { const pts = tmTirarFecho(a.map(conv)); if (pts.length > 2) out.push({nome: externos.length > 1 ? `${nome} (parte ${k + 1})` : nome, pontos: pts, camada}); });
  });
  if (proj.sad) out.forEach(o => { o.aviso = 'SAD 69: pode ficar deslocado uns 60 m'; });
  return out;
}
// ZIP / KMZ (sem biblioteca): diretório central + descompressão do navegador
async function tmUnzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf); let fim = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw tmErro('Arquivo compactado inválido.');
  const n = dv.getUint16(fim + 10, true), ents = []; let p = dv.getUint32(fim + 16, true);
  for (let k = 0; k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    ents.push({nome: new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)), metodo: dv.getUint16(p + 10, true), comp: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true)});
    p += 46 + nl + xl + cl;
  }
  const ler = async e => {
    const ini = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true), dados = u8.slice(ini, ini + e.comp);
    if (e.metodo === 0) return dados.buffer;
    if (e.metodo !== 8 || typeof DecompressionStream !== 'function') throw tmErro('Não consegui abrir o arquivo compactado neste aparelho.');
    return new Response(new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  };
  return Promise.all(ents.filter(e => !e.nome.endsWith('/') && !/__MACOSX/.test(e.nome)).map(async e => ({nome: e.nome, dados: await ler(e)})));
}
// Junta os arquivos escolhidos (soltos ou dentro de .zip/.kmz) e lê cada formato
async function tmLerArquivos(lista) {
  let arqs = [];
  for (const f of lista) {
    const nome = f.name, buf = await f.arrayBuffer();
    if (/\.(zip|kmz)$/i.test(nome)) arqs.push(...await tmUnzip(buf)); else arqs.push({nome, dados: buf});
  }
  const txt = b => new TextDecoder().decode(b), base = n => n.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''), out = [];
  const shps = {};
  arqs.forEach(a => { const ext = (a.nome.match(/\.([^.]+)$/) || [])[1]?.toLowerCase(); if (['shp', 'dbf', 'prj'].includes(ext)) (shps[a.nome.replace(/\.[^.]+$/, '').toLowerCase()] ||= {nome: base(a.nome)})[ext] = ext === 'prj' ? txt(a.dados) : a.dados; });
  for (const a of arqs) {
    if (/\.kml$/i.test(a.nome)) out.push(...tmLerKml(txt(a.dados), base(a.nome)));
    else if (/\.(geo)?json$/i.test(a.nome)) out.push(...tmLerGeojson(txt(a.dados), base(a.nome)));
  }
  for (const s of Object.values(shps)) if (s.shp) out.push(...tmLerShapefile(s, s.nome.replace(/_/g, ' ')));
  return out.map(o => { const pontos = tmSimplificar(o.pontos).map(([la, lo]) => [tmR7(la), tmR7(lo)]); return {...o, pontos, areaHa: Math.round(tmAreaHa(pontos) * 100) / 100}; })
    .filter(o => o.areaHa > 0 && o.pontos.every(([la, lo]) => Math.abs(la) <= 90 && Math.abs(lo) <= 180));
}

let tmi = null; // {arquivo, itens: [{nome, pontos, areaHa, camada, destino}], usarArea}
function tmiDestinoInicial(o, usados) {
  const alvo = tmNormNome(o.nome), f = alvo && db.fields.find(x => !usados.has(x.id) && tmNormNome(x.name) === alvo);
  if (f) { usados.add(f.id); return f.id; }
  return tmi.itens.length > 60 ? '' : 'novo';
}
VIEWS.importartalhoes = () => {
  if (!tmGestor()) return head('Importar contornos', 'Só para o ADM e o supervisor.', btn('← Mapa', 'nav', 'mapatalhoes', 'secondary')) + `<section class="card">${empty('Sem acesso', 'Seu nível de acesso é Usuário comum.')}</section>`;
  const topo = head('Importar contornos', 'Traga os talhões já desenhados de outro lugar: cada contorno do arquivo vira um talhão novo ou vai para um que já existe.', btn('← Mapa', 'nav', 'mapatalhoes', 'secondary'));
  if (!tmi?.itens?.length) return topo + `<section class="card panel tmi-escolher">
      <label class="tmi-arquivo"><input type="file" data-tmi-arquivo multiple accept=".kml,.kmz,.zip,.shp,.dbf,.prj,.geojson,.json"><span class="primary">Escolher arquivo</span></label>
      <ul class="tmi-fontes">
        <li><b>Google Earth</b> — KML ou KMZ (clique com o botão direito na pasta → Salvar lugar como).</li>
        <li><b>Monitor da plantadeira ou colheitadeira</b> (John Deere, FieldView, Trimble…) — limites em Shapefile (.zip) ou GeoJSON.</li>
        <li><b>CAR</b> — no SICAR, baixe o shapefile do imóvel (.zip). Aparecem a área do imóvel e as outras camadas; escolha o que importar.</li>
      </ul>
      <p class="nota">Shapefile em UTM (SIRGAS 2000 ou WGS 84) é convertido sozinho, desde que venha o arquivo .prj junto. Nada é gravado antes de você conferir no mapa.</p></section>`;
  const opts = sel => `<option value="" ${sel === '' ? 'selected' : ''}>Não importar</option><option value="novo" ${sel === 'novo' ? 'selected' : ''}>+ Criar talhão novo</option>` +
    db.fields.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', {numeric: true})).map(f => `<option value="${esc(f.id)}" ${sel === f.id ? 'selected' : ''}>${esc(f.name)}${f.contorno ? ' (troca o contorno)' : ''}</option>`).join('');
  const n = tmi.itens.filter(i => i.destino).length;
  return topo + `<div class="tm-desenho"><section class="card tm-caixa"><div class="tm-mapa" id="tmMapa" aria-label="Contornos do arquivo no mapa"></div>${tmAvisoSemImagem}</section>
    <section class="card panel tmi-lista"><p class="nota" style="margin-top:0"><b>${esc(tmi.arquivo)}</b>: ${tmi.itens.length} ${tmi.itens.length === 1 ? 'contorno' : 'contornos'}. Escolha para onde vai cada um.</p>
      ${tmi.itens.map((o, i) => `<div class="tmi-it" data-tmi="${i}"><span class="tmi-n">${i + 1}</span><div><strong>${esc(o.nome)}</strong><small>${um1(o.areaHa)} ha${o.camada ? ' • ' + esc(o.camada) : ''}${o.aviso ? ' • ⚠ ' + esc(o.aviso) : ''}</small>
        <select data-tmi-destino="${i}" aria-label="Destino de ${esc(o.nome)}">${opts(o.destino)}</select></div></div>`).join('')}
      <label class="tmi-area"><input type="checkbox" data-tmi-area ${tmi.usarArea ? 'checked' : ''}> Usar a área medida no cadastro dos talhões que já existem</label>
      <div class="btn-row">${btn('Escolher outro arquivo', 'tmi-outro', '', 'secondary')}${btn(`Importar ${n}`, 'tmi-importar')}</div></section></div>`;
};
VIEWS.importartalhoes.after = () => {
  const el = $('#tmMapa'); if (!el || !tmi?.itens?.length) return;
  carregarLeaflet().then(() => {
    if (!document.body.contains(el)) return;
    const L = window.L, mapa = tmNovoMapa(el);
    db.fields.filter(f => f.contorno?.pontos?.length > 2).forEach(f => L.polygon(f.contorno.pontos.map(([la, lo]) => [la, lo]), {color: '#fff', weight: 1, dashArray: '4 4', fillOpacity: 0.05, interactive: false}).addTo(mapa));
    tmi.itens.forEach((o, i) => L.polygon(o.pontos, {color: o.destino ? '#ffd400' : '#9aa5b1', weight: 2, fillColor: o.destino ? '#ffd400' : '#9aa5b1', fillOpacity: o.destino ? 0.22 : 0.08})
      .bindTooltip(`${i + 1}`, {permanent: true, direction: 'center', className: 'tm-rot num'}).on('click', () => $(`[data-tmi="${i}"]`)?.scrollIntoView({block: 'center', behavior: 'smooth'})).addTo(mapa));
    tmEnquadrar(mapa, tmi.itens.map(o => o.pontos));
    setTimeout(() => mapa.invalidateSize(), 50);
  }).catch(() => { el.innerHTML = '<p class="viz-vazio">Não foi possível abrir o mapa.</p>'; });
};
TITLES.importartalhoes = 'Talhões';
document.addEventListener('change', async e => {
  const t = e.target;
  if (t?.matches?.('[data-tmi-arquivo]')) {
    const arqs = [...t.files]; if (!arqs.length) return;
    showToast('Lendo o arquivo…');
    try {
      const itens = await tmLerArquivos(arqs);
      if (!itens.length) { showToast('Nenhum contorno (polígono) encontrado no arquivo', true); return; }
      const lim = itens.slice(0, 300);
      tmi = {arquivo: arqs.map(a => a.name).join(', '), itens: [], usarArea: false}; tmi.itens = lim;
      const usados = new Set(); lim.forEach(o => { o.destino = tmiDestinoInicial(o, usados); });
      if (itens.length > lim.length) showToast(`O arquivo tem ${itens.length} contornos; aparecem os 300 primeiros`, true);
      render();
    } catch (err) { console.warn(err); showToast(err?.amigavel ? err.message : 'Não consegui ler este arquivo', true); }
  } else if (t?.matches?.('[data-tmi-destino]')) { tmi.itens[Number(t.dataset.tmiDestino)].destino = t.value; render(); }
  else if (t?.matches?.('[data-tmi-area]')) tmi.usarArea = t.checked;
});
Object.assign(ACTIONS, {
  'tmi-outro': () => { tmi = null; render(); },
  'tmi-importar': () => {
    if (!tmi || !tmGestor()) return;
    const sel = tmi.itens.filter(o => o.destino); if (!sel.length) { showToast('Escolha pelo menos um contorno para importar', true); return; }
    const repetidos = sel.filter(o => o.destino !== 'novo').map(o => o.destino).filter((id, i, l) => l.indexOf(id) !== i);
    if (repetidos.length) { showToast(`Dois contornos foram para o mesmo talhão (${fieldName(repetidos[0])}). Escolha um só.`, true); return; }
    let novos = 0, atual = 0;
    sel.forEach(o => {
      const contorno = {pontos: o.pontos.map(([la, lo]) => [la, lo, 0]), areaHa: o.areaHa, perimetroM: Math.round(perimetroM(o.pontos)), data: today(), origem: 'arquivo'};
      if (o.destino === 'novo') { db.fields.push({id: uid(), name: o.nome.slice(0, 60), area: o.areaHa, contorno}); novos++; }
      else { const f = find('fields', o.destino); if (!f) return; f.contorno = contorno; if (tmi.usarArea) f.area = o.areaHa; atual++; }
    });
    save(); tmi = null;
    showToast(`${[novos ? `${novos} ${novos === 1 ? 'talhão novo' : 'talhões novos'}` : '', atual ? `${atual} ${atual === 1 ? 'contorno atualizado' : 'contornos atualizados'}` : ''].filter(Boolean).join(' e ')}`);
    go('mapatalhoes');
  }
});

// Abas: Lista | Mapa; acesso igual ao dos talhões
ABAS.talhoes = [['talhoes', 'Lista'], ['mapatalhoes', 'Mapa']];
GRUPO_DA_ROTA.talhoes = 'talhoes'; GRUPO_DA_ROTA.mapatalhoes = 'talhoes'; GRUPO_DA_ROTA.desenhar = 'talhoes';
if (typeof NV_ROTA_TELA === 'object') Object.assign(NV_ROTA_TELA, {mapatalhoes: 'talhoes', desenhar: 'talhoes', importartalhoes: 'talhoes', contorno: 'talhoes'});
addEventListener('hashchange', () => { if (!/^#\/(mapatalhoes|desenhar|importartalhoes)/.test(location.hash) && tm.mapa) { try { tm.mapa.remove(); } catch { /* ok */ } tm.mapa = null; } });
