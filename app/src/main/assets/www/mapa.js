'use strict';
/* Contorno do talhão por GPS, sem internet: caminhar pela divisa (pontos automáticos), marcar pontos parados
   ou digitar coordenadas. Área geodésica (Chamberlain & Duquette, 2007 — mesmo método do Turf.js/OpenLayers)
   e perímetro por haversine. A área medida só substitui a do cadastro se o usuário escolher. */

const RAIO_TERRA = 6378137; // m (WGS 84)
const PRECISAO_MAX_M = 20;  // pontos com precisão pior que isso são descartados ao caminhar (aviso da tela)
const PASSO_MIN_M = 5;      // distância mínima entre pontos automáticos
let ctn = null; // {fieldId, pontos:[[lat,lon,precisao]], watch}

const rad = g => g * Math.PI / 180;
function areaGeodesicaM2(p) {
  if (p.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < p.length; i++) { const [la1, lo1] = p[i], [la2, lo2] = p[(i + 1) % p.length]; s += rad(lo2 - lo1) * (2 + Math.sin(rad(la1)) + Math.sin(rad(la2))); }
  return Math.abs(s * RAIO_TERRA * RAIO_TERRA / 2);
}
function distM([la1, lo1], [la2, lo2]) {
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * RAIO_TERRA * Math.asin(Math.min(1, Math.sqrt(a)));
}
const perimetroM = p => p.length < 2 ? 0 : p.reduce((s, x, i) => s + (i ? distM(p[i - 1], x) : 0), 0) + (p.length > 2 ? distM(p.at(-1), p[0]) : 0);

// Desenho em SVG (projeção local equiretangular, suficiente para a escala de um talhão)
function svgContorno(pontos, {tam = 260, classe = 'ctn-svg', rotulo = 'Contorno do talhão'} = {}) {
  if (!pontos?.length) return '';
  const lat0 = pontos.reduce((s, p) => s + p[0], 0) / pontos.length;
  const xy = pontos.map(([la, lo]) => [rad(lo) * RAIO_TERRA * Math.cos(rad(lat0)), -rad(la) * RAIO_TERRA]);
  const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]), minx = Math.min(...xs), miny = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - minx), h = Math.max(1, Math.max(...ys) - miny), esc = (tam - 20) / Math.max(w, h);
  const pts = xy.map(([x, y]) => [10 + (x - minx) * esc, 10 + (y - miny) * esc]);
  return `<svg class="${classe}" viewBox="0 0 ${tam} ${tam}" role="img" aria-label="${esc_(rotulo)}">${pts.length > 2 ? `<polygon points="${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"/>` : `<polyline points="${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"/>`}${pts.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === 0 ? 4 : 2.5}"/>`).join('')}</svg>`;
}
const esc_ = s => esc(s);

function pararGps() { if (ctn?.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(ctn.watch); if (ctn) ctn.watch = null; }
function adicionarPonto(pos, manual = false) {
  const {latitude: la, longitude: lo, accuracy: ac} = pos.coords;
  if (!manual && ac > PRECISAO_MAX_M) { ctn.ultimaPrecisao = ac; atualizarTelaCtn(); return; }
  const ult = ctn.pontos.at(-1);
  if (!manual && ult && distM(ult, [la, lo]) < PASSO_MIN_M) { ctn.ultimaPrecisao = ac; atualizarTelaCtn(); return; }
  ctn.pontos.push([la, lo, Math.round(ac)]); ctn.ultimaPrecisao = ac; atualizarTelaCtn();
}
// Sem permissão: para. Sem sinal ou demora: continua gravando e avisa (no campo o sinal oscila).
function erroGps(e) {
  if (e.code === 1) { pararGps(); showToast('Permita o acesso à localização para medir o talhão'); }
  else if (ctn?.watch == null) showToast('GPS sem sinal no momento — tente de novo em local aberto');
  else ctn.ultimaPrecisao = null;
  atualizarTelaCtn();
}

function painelCtn() {
  const f = find('fields', ctn.fieldId), p = ctn.pontos, area = areaGeodesicaM2(p) / 1e4, per = perimetroM(p);
  const prec = p.length ? p.reduce((s, x) => s + (x[2] || 0), 0) / p.length : null;
  return `<div class="ctn-grid"><div class="card panel ctn-desenho">${p.length ? svgContorno(p, {tam: 300}) : '<p class="viz-vazio">Nenhum ponto ainda.</p>'}</div>
    <div class="card panel"><div class="ctn-num"><div><span>Pontos</span><b>${p.length}</b></div><div><span>Área</span><b>${p.length > 2 ? um1(area) + ' ha' : '—'}</b></div><div><span>Perímetro</span><b>${p.length > 1 ? num(per) + ' m' : '—'}</b></div><div><span>Precisão média</span><b>${prec != null ? '± ' + num(prec) + ' m' : '—'}</b></div></div>
      <p class="nota">${ctn.watch != null ? `<strong>Gravando:</strong> caminhe pela divisa; um ponto a cada ${PASSO_MIN_M} m. Último sinal: ${ctn.ultimaPrecisao ? '± ' + num(ctn.ultimaPrecisao) + ' m' + (ctn.ultimaPrecisao > PRECISAO_MAX_M ? ' (fraco — aguardando melhorar)' : '') : 'aguardando GPS…'}` : 'Toque em “Caminhar pela divisa” e percorra o contorno, ou marque os cantos parado em cada um.'}</p>
      <div class="btn-row">${ctn.watch != null ? btn('■ Parar', 'ctn-parar') : btn('▶ Caminhar pela divisa', 'ctn-caminhar')}${btn('+ Marcar ponto aqui', 'ctn-ponto', '', 'secondary')}${btn('Digitar coordenadas', 'ctn-digitar', '', 'secondary')}${p.length ? btn('Desfazer ponto', 'ctn-desfazer', '', 'secondary') : ''}</div>
      ${p.length > 2 ? `<div class="actions"><button class="secondary" data-act="ctn-limpar">Limpar</button><button class="primary" data-act="ctn-salvar">Salvar contorno</button></div>` : ''}
      <p class="nota">Área calculada no elipsoide WGS 84 (método geodésico). A precisão depende do GPS do aparelho — compare com a área do cadastro (${f ? num(f.area) + ' ha' : '—'}).</p></div></div>`;
}
function atualizarTelaCtn() { const el = $('#ctnPainel'); if (el && ctn) el.innerHTML = painelCtn(); }

VIEWS.contorno = id => {
  const f = find('fields', id); if (!f) return empty('Talhão não encontrado', '');
  if (!ctn || ctn.fieldId !== id) { pararGps(); ctn = {fieldId: id, pontos: (f.contorno?.pontos || []).map(p => [...p]), watch: null}; }
  return head(`Contorno — ${f.name}`, 'Meça a área caminhando com o celular pela divisa do talhão', btn('← Talhão', 'nav', 'talhao/' + id, 'secondary') + (f.contorno ? btn('Exportar KML', 'ctn-kml', id, 'secondary') : '')) + `<div id="ctnPainel">${painelCtn()}</div>`;
};
TITLES.contorno = 'Contorno do talhão';

function kmlTalhao(f) {
  const c = f.contorno.pontos.map(([la, lo]) => `${lo},${la},0`); c.push(c[0]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(db.settings.farm || 'Nexus Agro')}</name><Placemark><name>${esc(f.name)}</name><description>${esc(`${um1(f.contorno.areaHa)} ha medidos em ${fmtDate(f.contorno.data)}`)}</description><Polygon><outerBoundaryIs><LinearRing><coordinates>${c.join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
}

Object.assign(ACTIONS, {
  'ctn-caminhar': () => {
    if (!navigator.geolocation) { showToast('Este aparelho não oferece localização'); return; }
    pararGps(); ctn.watch = navigator.geolocation.watchPosition(p => adicionarPonto(p), erroGps, {enableHighAccuracy: true, maximumAge: 0}); atualizarTelaCtn();
  },
  'ctn-parar': () => { pararGps(); atualizarTelaCtn(); },
  'ctn-ponto': () => { if (!navigator.geolocation) { showToast('Este aparelho não oferece localização'); return; } showToast('Lendo o GPS…'); navigator.geolocation.getCurrentPosition(p => { adicionarPonto(p, true); showToast(`Ponto marcado (± ${num(p.coords.accuracy)} m)`); }, erroGps, {enableHighAccuracy: true, timeout: 30000, maximumAge: 0}); },
  'ctn-digitar': () => openForm({title: 'Digitar coordenada', sub: 'Graus decimais (ex.: -15,7801 e -47,9292).', fields: [{k: 'lat', label: 'Latitude', required: true}, {k: 'lon', label: 'Longitude', required: true}],
    onSubmit: v => { const la = umNum(v.lat), lo = umNum(v.lon); if (la === undefined || lo === undefined || Math.abs(la) > 90 || Math.abs(lo) > 180) return 'Coordenada inválida'; ctn.pontos.push([la, lo, 0]); setTimeout(atualizarTelaCtn, 0); }}),
  'ctn-desfazer': () => { ctn.pontos.pop(); atualizarTelaCtn(); },
  'ctn-limpar': () => confirmDialog('Apagar os pontos medidos?', () => { pararGps(); ctn.pontos = []; }, 'Limpar'),
  'ctn-salvar': () => {
    const f = find('fields', ctn.fieldId); if (!f || ctn.pontos.length < 3) return;
    pararGps();
    const areaHa = Math.round(areaGeodesicaM2(ctn.pontos) / 100) / 100;
    f.contorno = {pontos: ctn.pontos.map(p => [...p]), areaHa, perimetroM: Math.round(perimetroM(ctn.pontos)), data: today()}; save();
    dialog.innerHTML = `<h3>Contorno salvo</h3><p>Área medida: <strong>${um1(areaHa)} ha</strong>. Área no cadastro: <strong>${num(f.area)} ha</strong>.</p><p class="sub">Quer usar a área medida no cadastro do talhão? Isso muda os cálculos por hectare (custo/ha, sc/ha).</p><div class="actions"><button class="secondary" data-close>Manter ${num(f.area)} ha</button><button class="primary" data-usar>Usar ${um1(areaHa)} ha</button></div>`;
    $('[data-close]', dialog).onclick = () => { closeModal(); go('talhao/' + f.id); };
    $('[data-usar]', dialog).onclick = () => { f.area = areaHa; save(); closeModal(); showToast('Área do talhão atualizada'); go('talhao/' + f.id); };
    modal.classList.add('open');
  },
  'ctn-kml': id => { const f = find('fields', id); if (f?.contorno) downloadFile(`talhao-${semAcentoApp(f.name).replace(/[^a-z0-9]+/g, '-')}.kml`, 'application/vnd.google-earth.kml+xml', kmlTalhao(f)); }
});
addEventListener('hashchange', () => { if (!location.hash.startsWith('#/contorno')) pararGps(); });
