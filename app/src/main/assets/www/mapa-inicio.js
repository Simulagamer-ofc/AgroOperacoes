// Mapa interativo do Início (o mesmo jeito de mexer do mapa do MercaClima).
// No celular: um dedo rola a tela; dois dedos movem e aproximam o mapa. Em tela cheia, um dedo já move.
// Sem internet ou sem a biblioteca de mapas, fica a imagem parada de antes.

function mapaToque() {
  return !!(window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
}
// Um dedo rola a página; dois dedos movem e aproximam. Aviso rápido quando a pessoa tenta mover com um dedo.
function mapaDoisDedos(mapa, el) {
  if (!mapaToque() || el.dataset.doisDedos) return;
  el.dataset.doisDedos = '1';
  mapa.dragging.disable();
  const aviso = document.createElement('div');
  aviso.className = 'mapa-dedos'; aviso.setAttribute('aria-hidden', 'true'); aviso.textContent = 'Use dois dedos para mover o mapa';
  el.append(aviso);
  let ini = null, t = 0;
  const esconder = () => aviso.classList.remove('on');
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 1 && !mapa.dragging.enabled()) ini = [e.touches[0].clientX, e.touches[0].clientY];
    else { ini = null; esconder(); }
  }, {passive: true});
  el.addEventListener('touchmove', e => {
    if (!ini || e.touches.length !== 1) return;
    if (Math.hypot(e.touches[0].clientX - ini[0], e.touches[0].clientY - ini[1]) < 14) return;
    ini = null; aviso.classList.add('on'); clearTimeout(t); t = setTimeout(esconder, 1500);
  }, {passive: true});
  el.addEventListener('touchend', () => { ini = null; }, {passive: true});
}

const INI_FUNDO_KEY = 'agro-ini-fundo';
let iniMapa = null, iniMapaPedido = null;
const iniFundo = () => { try { return localStorage.getItem(INI_FUNDO_KEY) === 'mapa' ? 'mapa' : 'sat'; } catch { return 'sat'; } };

// O cartão continua montando a imagem parada; ela fica por baixo até o mapa interativo carregar
const iniMapaFazendaBase = i2MapaFazenda;
i2MapaFazenda = function (fs, modo) {
  const svg = iniMapaFazendaBase(fs, modo); if (!svg) return svg;
  iniMapaPedido = {tipo: 'fazenda', fs, modo};
  setTimeout(iniMontarMapa, 0);
  return `<div class="ini-mapa-slot">${svg}</div>`;
};
const iniSateliteBase = iniSatelite;
iniSatelite = function (lat, lon, z) {
  iniMapaPedido = {tipo: 'ponto', lat, lon, z};
  setTimeout(iniMontarMapa, 0);
  return `<div class="ini-mapa-slot">${iniSateliteBase(lat, lon, z)}</div>`;
};

function iniBotao(ic, rot, fn) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'ini-mb'; b.title = rot; b.setAttribute('aria-label', rot);
  b.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic}</svg>`;
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(b); });
  return b;
}
const INI_IC = {
  cheia: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  sair: '<path d="M6 6l12 12M18 6 6 18"/>',
  camadas: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  centro: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  menos: '<path d="M5 12h14"/>'
};

function iniCriarMapa() {
  const L = window.L, el = document.createElement('div');
  el.className = 'ini-mapa-l'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Mapa da fazenda');
  const mapa = L.map(el, {zoomControl: false, attributionControl: true, doubleClickZoom: true, zoomSnap: 0.25, minZoom: 3, maxZoom: 20});
  mapa.attributionControl.setPrefix(false);
  const sat = typeof tmCamadaSatelite === 'function' ? tmCamadaSatelite(L) : null;
  const fundos = {sat, mapa: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap'})};
  const m = {L, el, mapa, fundos, fundo: '', grupo: L.layerGroup().addTo(mapa), chave: '', limites: null};
  m.trocarFundo = f => {
    if (!fundos[f]) f = fundos.sat ? 'sat' : 'mapa';
    if (m.fundo && fundos[m.fundo]) mapa.removeLayer(fundos[m.fundo]);
    fundos[f].addTo(mapa); m.fundo = f; el.classList.toggle('fundo-mapa', f === 'mapa');
  };
  m.trocarFundo(iniFundo());
  // Botões por cima do mapa
  const topo = document.createElement('div'), baixo = document.createElement('div');
  topo.className = 'ini-mctrl topo'; baixo.className = 'ini-mctrl baixo';
  m.btCheia = iniBotao(INI_IC.cheia, 'Tela cheia', () => iniTelaCheia(!el.classList.contains('cheio')));
  topo.append(m.btCheia, iniBotao(INI_IC.camadas, 'Trocar satélite e mapa de ruas', () => {
    const f = m.fundo === 'sat' ? 'mapa' : 'sat'; try { localStorage.setItem(INI_FUNDO_KEY, f); } catch {}
    m.trocarFundo(f); showToast?.(f === 'sat' ? 'Satélite' : 'Mapa de ruas');
  }));
  baixo.append(iniBotao(INI_IC.centro, 'Centralizar na fazenda', () => iniCentralizar(true)),
    iniBotao(INI_IC.mais, 'Aproximar', () => mapa.zoomIn()), iniBotao(INI_IC.menos, 'Afastar', () => mapa.zoomOut()));
  [topo, baixo].forEach(c => { L.DomEvent.disableClickPropagation(c); L.DomEvent.disableScrollPropagation(c); el.append(c); });
  // Nomes dos talhões somem quando o mapa está muito afastado
  const zoomCls = () => el.classList.toggle('longe', mapa.getZoom() < 13.5);
  mapa.on('zoomend', zoomCls); mapa.whenReady?.(zoomCls);
  mapaDoisDedos(mapa, el);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('cheio')) iniTelaCheia(false); });
  return m;
}

function iniTelaCheia(on) {
  const m = iniMapa; if (!m) return;
  m.el.classList.toggle('cheio', on);
  // Em tela cheia o mapa vai para o corpo da página (fora do cartão), e volta ao cartão ao fechar
  if (on) document.body.append(m.el);
  else {
    // Volta para o cartão; se o cartão não estiver na tela (outra página), o mapa sai da tela e é remontado ao voltar ao Início
    const slot = document.querySelector('.ini-mapa-slot');
    if (slot) { slot.append(m.el); slot.classList.add('vivo'); } else m.el.remove();
  }
  document.documentElement.classList.toggle('ini-mapa-aberto', on);
  m.btCheia.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${on ? INI_IC.sair : INI_IC.cheia}</svg>`;
  m.btCheia.title = on ? 'Fechar tela cheia' : 'Tela cheia'; m.btCheia.setAttribute('aria-label', m.btCheia.title);
  if (on || !mapaToque()) m.mapa.dragging.enable(); else m.mapa.dragging.disable();
  if (!on) m.mapa.closePopup();
  // O aparelho pode demorar a refazer o tamanho: acerta o mapa algumas vezes e, ao voltar, reenquadra a fazenda
  [60, 250, 700].forEach(ms => setTimeout(() => { if (!m.el.isConnected) return; m.mapa.invalidateSize(); if (!on && ms === 250) iniCentralizar(false); }, ms));
}

function iniCentralizar(animar) {
  const m = iniMapa; if (!m) return;
  if (m.limites?.isValid?.()) m.mapa.fitBounds(m.limites, {padding: [28, 28], maxZoom: 17, animate: !!animar});
  else if (m.centro) m.mapa.setView(m.centro, m.zoom, {animate: !!animar});
}

async function iniMontarMapa() {
  const pedido = iniMapaPedido, slot = document.querySelector('.ini-mapa-slot');
  if (!pedido || !slot) return;
  try { await carregarLeaflet(); } catch { return; } // sem a biblioteca: fica a imagem parada
  if (!slot.isConnected || slot.querySelector('.ini-mapa-l')) return;
  const novo = !iniMapa;
  if (novo) iniMapa = iniCriarMapa();
  const m = iniMapa;
  slot.querySelectorAll('svg.i2-faz-mapa, svg.pf-sat').forEach(s => s.remove());
  if (!m.el.classList.contains('cheio')) slot.append(m.el);
  slot.classList.add('vivo'); slot.closest('.pf-mapa')?.classList.add('vivo');
  m.mapa.invalidateSize();
  const chave = pedido.tipo === 'fazenda' ? iniDesenharFazenda(pedido.fs, pedido.modo) : iniDesenharPonto(pedido);
  // Volta ao enquadramento da fazenda só na primeira vez ou quando muda o que está no mapa; tocar num talhão não mexe na vista
  if (novo || chave !== m.chave) { m.chave = chave; iniCentralizar(false); }
}

function iniDesenharPonto(p) {
  const m = iniMapa, L = m.L; m.grupo.clearLayers(); m.limites = null;
  const sede = typeof localDaFazenda === 'function' ? localDaFazenda() : null;
  const temPonto = p.z > 6;
  m.centro = [p.lat, p.lon]; m.zoom = p.z;
  if (temPonto) {
    const eSede = sede && Math.abs(sede.lat - p.lat) < 1e-6 && Math.abs(sede.lon - p.lon) < 1e-6;
    L.marker([p.lat, p.lon], {interactive: false, icon: L.divIcon({className: 'ini-pin-l', iconSize: [0, 0],
      html: `<div class="pf-pin ${eSede ? 'sede' : ''}"><span class="pf-pulso"></span><span class="pf-ponto"></span><b>${eSede ? 'Sede' : 'Você está aqui'}</b></div>`})}).addTo(m.grupo);
  }
  return `p:${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.z}`;
}

function iniDesenharFazenda(fs, modo) {
  const m = iniMapa, L = m.L; m.grupo.clearLayers();
  const comC = fs.filter(f => f.contorno?.pontos?.length > 2);
  const lim = L.latLngBounds([]);
  comC.forEach(f => {
    const inf = i2InfoTalhao(f), pt = i2Pintura(f, inf, modo), sel = i2TalSel === f.id;
    const borda = sel || pt.muda ? '#ffffff' : pt.borda || (pt.cor === '#ffffff' ? 'rgba(255,255,255,.85)' : pt.cor);
    const pol = L.polygon(f.contorno.pontos, {color: borda, weight: sel || pt.muda ? 4 : pt.larg || 2.5, fillColor: pt.cor, fillOpacity: pt.op,
      dashArray: pt.tracejado ? '8 5' : null, lineJoin: 'round', className: `ini-tal ${pt.pulsa ? 'pulsa' : ''} ${sel ? 'sel' : ''}`}).addTo(m.grupo);
    pol.on('click', ev => { L.DomEvent.stop(ev); iniTocarTalhao(f, pt, pol); });
    const b = pol.getBounds(); lim.extend(b);
    L.marker(b.getCenter(), {interactive: false, icon: L.divIcon({className: 'ini-tal-rot', iconSize: [0, 0],
      html: `<span><b>${esc(i2Curto(f.name))}</b>${pt.txt ? `<small>${esc(String(pt.txt).slice(0, 22))}</small>` : ''}</span>`})}).addTo(m.grupo);
    // Máquina trabalhando (ou programada para hoje) no talhão, com quem opera
    const o = inf.andamento || inf.progHoje;
    if (o?.machineId) {
      const quem = typeof pvResp === 'function' ? pvResp(o) : '', rot = machineName(o.machineId) + (quem ? ' • ' + quem : '');
      L.marker(b.getNorthEast(), {interactive: false, icon: L.divIcon({className: 'ini-maq-l', iconSize: [0, 0],
        html: `<span class="ini-maq ${o.status === 'Em andamento' ? 'ag' : ''}"><i><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${(window.ICONES_MENU?.maquinas || [])[1] || ''}</svg></i><b>${esc(rot)}</b></span>`})}).addTo(m.grupo);
    }
  });
  const sede = typeof localDaFazenda === 'function' ? localDaFazenda() : null;
  if (sede && Number.isFinite(sede.lat)) {
    L.marker([sede.lat, sede.lon], {interactive: false, icon: L.divIcon({className: 'ini-sede-l', iconSize: [0, 0],
      html: '<span class="ini-sede"><i><svg width="16" height="16" viewBox="-9 -9 18 18"><path d="M0-7 8 0v7h-16V0z" fill="#1f7a3f"/></svg></i><b>Sede</b></span>'})}).addTo(m.grupo);
    lim.extend([sede.lat, sede.lon]);
  }
  m.limites = lim; m.centro = null;
  return 'f:' + comC.map(f => f.id + ':' + f.contorno.pontos.length).join('|');
}

function iniTocarTalhao(f, pt, pol) {
  const m = iniMapa;
  // Em tela cheia, o resumo do talhão aparece no próprio mapa
  if (m.el.classList.contains('cheio')) {
    const html = `<div class="ini-pop"><b>${esc(f.name)}</b><small>${esc([f.crop || 'Sem cultura', `${num(f.area)} ha`, pt.txt && pt.txt !== f.crop ? pt.txt : ''].filter(Boolean).join(' • '))}</small>
      <div class="ini-pop-bts"><button type="button" class="primary small" data-pop="op-field">+ Operação</button><button type="button" class="secondary small" data-pop="nav">Abrir talhão</button></div></div>`;
    pol.bindPopup(html, {closeButton: true, autoPanPadding: [20, 70]}).openPopup();
    const c = pol.getPopup()?.getElement();
    c?.querySelectorAll('[data-pop]').forEach(b => b.addEventListener('click', () => {
      iniTelaCheia(false);
      if (b.dataset.pop === 'nav') go(`talhao/${f.id}`); else ACTIONS['op-field']?.(f.id);
    }));
    return;
  }
  ACTIONS['i2-tal']?.(f.id);
}

// Saindo do Início com o mapa em tela cheia (menu, atalho, link), a tela cheia fecha sozinha
window.addEventListener('hashchange', () => { if (iniMapa?.el.classList.contains('cheio') && parseRoute().name !== 'inicio') iniTelaCheia(false); });
window.addEventListener('resize', () => { if (iniMapa?.el.isConnected) setTimeout(() => iniMapa.mapa.invalidateSize(), 120); });

// O botão Voltar do Android fecha a tela cheia antes de sair do Início
const iniVoltarBase = window.voltarApp;
window.voltarApp = () => {
  if (iniMapa?.el.classList.contains('cheio')) { iniTelaCheia(false); return true; }
  return typeof iniVoltarBase === 'function' ? iniVoltarBase() : false;
};
