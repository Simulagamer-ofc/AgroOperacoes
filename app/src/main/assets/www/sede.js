'use strict';
/* MercaPlant — local da fazenda (sede). Um ponto só, guardado no servidor junto com a fazenda e usado por todos os
   aparelhos: previsão do tempo, janela de pulverização, mapa do tempo e onde os mapas abrem. Marcado pelo ADM ou pelo
   supervisor: pelo GPS do celular, tocando no mapa de satélite ou colando as coordenadas (ex.: do Google Maps).
   Localização aproximada — o computador sem GPS é localizado pela internet, às vezes a centenas de km — é recusada. */

const SEDE_PRECISAO_MAX = 3000; // metros: acima disso a posição veio pela internet, não pelo GPS
const SEDE_ORIGEM = {gps: 'marcada pelo GPS', mapa: 'marcada no mapa', coordenadas: 'coordenadas informadas'};
const sedeNaNuvem = () => typeof nvVinculado === 'function' && nvVinculado() && !!nv?.fazenda?.id;
const sedePodeMudar = () => !sedeNaNuvem() || ['admin', 'supervisor'].includes(typeof nvPapel === 'function' ? nvPapel() : '');
// Sede guardada no servidor (a da fazenda aberta)
function sedeServidor() {
  const s = typeof nv !== 'undefined' ? nv?.sede : null;
  return s && s.farm === nv?.fazenda?.id && Number.isFinite(s.lat) && Number.isFinite(s.lon) ? s : null;
}
// Centro dos contornos dos talhões
function sedeCentroTalhoes() {
  const ps = db.fields.filter(f => f.contorno?.pontos?.length > 2).flatMap(f => f.contorno.pontos); if (!ps.length) return null;
  return {lat: ps.reduce((t, p) => t + p[0], 0) / ps.length, lon: ps.reduce((t, p) => t + p[1], 0) / ps.length};
}
// Onde fica a fazenda, do mais confiável ao menos: sede do servidor; posição precisa guardada neste aparelho;
// centro dos talhões; e só por último uma posição antiga deste aparelho (de antes da conferência da precisão)
localDaFazenda = function () {
  const s = sedeServidor();
  if (s) return {lat: s.lat, lon: s.lon, origem: `sede ${SEDE_ORIGEM[s.origem] || 'marcada'}`, fonte: 'servidor', precisao: s.precisao ?? null};
  const l = db.settings.local, ok = l && Number.isFinite(l.lat) && Number.isFinite(l.lon);
  if (ok && Number.isFinite(l.precisao) && l.precisao <= SEDE_PRECISAO_MAX) return {lat: l.lat, lon: l.lon, origem: l.origem || 'localização da sede', fonte: 'aparelho', precisao: l.precisao};
  const t = sedeCentroTalhoes(); if (t) return {...t, origem: 'centro dos talhões', fonte: 'talhoes'};
  if (ok && !Number.isFinite(l.precisao)) return {lat: l.lat, lon: l.lon, origem: l.origem || 'localização da sede', fonte: 'aparelho-antigo'};
  return null;
};

// Busca a sede no servidor (junto com a conferência da fazenda) e, se mudou, atualiza a previsão
async function sedeAtualizarDoServidor(farmId) {
  if (!farmId) return;
  const rows = await nvHttp(`/rest/v1/farms?select=sede_lat,sede_lon,sede_origem,sede_precisao_m,sede_em&id=eq.${encodeURIComponent(farmId)}`).catch(() => null);
  if (!Array.isArray(rows) || !rows[0]) return; // servidor sem as colunas ainda, ou sem internet: fica o que já sabia
  const r = rows[0], novo = r.sede_lat == null ? null : {farm: farmId, lat: r.sede_lat, lon: r.sede_lon, origem: r.sede_origem, precisao: r.sede_precisao_m, em: r.sede_em};
  const antes = nv.sede && nv.sede.farm === farmId ? nv.sede : null;
  if (JSON.stringify(antes) === JSON.stringify(novo)) return;
  nv.sede = novo; nvSalvar();
  sedeDepoisDeMudar();
}
function sedeDepoisDeMudar() {
  try { safeStorage.del(typeof CLIMA_KEY !== 'undefined' ? CLIMA_KEY : 'agro-clima'); } catch { /* previsão antiga: busca de novo */ }
  if (typeof buscarClima === 'function') buscarClima(true);
  const r = typeof parseRoute === 'function' ? parseRoute().name : '';
  if (['inicio', 'clima', 'clima-mapa'].includes(r)) render(); // na tela do local, quem salvou já vai para o MercaClima
}
// Grava a sede: no servidor (ADM e supervisor, com internet) e, sem nuvem, só neste aparelho
async function sedeSalvar(lat, lon, origem, precisao = null) {
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) || (lat === 0 && lon === 0)) throw Object.assign(new Error('Coordenadas inválidas.'), {amigavel: true});
  if (precisao != null && precisao > SEDE_PRECISAO_MAX) throw Object.assign(new Error(sedeTextoImprecisa(precisao)), {amigavel: true});
  if (sedeNaNuvem()) {
    if (!sedePodeMudar()) throw Object.assign(new Error('Só o ADM ou o supervisor da fazenda pode marcar o local da sede.'), {amigavel: true});
    const r = await nvHttp('/rest/v1/rpc/fazenda_sede_salvar', {method: 'POST', body: {p_farm: nv.fazenda.id, p_lat: lat, p_lon: lon, p_origem: origem, p_precisao: precisao == null ? null : Math.round(precisao)}});
    nv.sede = {farm: nv.fazenda.id, lat: Number(r.sede_lat), lon: Number(r.sede_lon), origem: r.sede_origem, precisao: r.sede_precisao_m, em: r.sede_em}; nvSalvar();
  }
  db.settings.local = {lat, lon, origem: `localização da sede (${SEDE_ORIGEM[origem] || origem})`, precisao: precisao == null ? 0 : Math.round(precisao)}; save();
  sedeDepoisDeMudar();
}
const sedeTextoImprecisa = m => `A posição veio com precisão de ${m >= 1000 ? num(m / 1000, 0) + ' km' : num(m, 0) + ' m'} — provavelmente pela internet (computador não tem GPS). Marque a sede no mapa, cole as coordenadas ou use o GPS do celular.`;

// “Ativar localização” (cartão do clima): GPS de verdade, recusando a posição aproximada
solicitarLocalClima = function () {
  if (climaLocalEstado === 'buscando') return;
  const falha = (estado, mensagem) => { climaLocalEstado = estado; climaLocalMensagem = mensagem; atualizarLocalClima(); };
  if (globalThis.isSecureContext === false) return falha('indisponivel', 'Abra o MercaPlant pelo endereço HTTPS para usar a localização.');
  if (!navigator.geolocation) return falha('indisponivel', 'Este navegador não disponibiliza localização. Marque a sede no mapa.');
  if (sedeNaNuvem() && !sedePodeMudar()) return falha('indisponivel', 'O local da fazenda é marcado pelo ADM ou pelo supervisor. Peça para marcarem a sede.');
  climaLocalEstado = 'buscando'; climaLocalMensagem = 'Aguardando o GPS. Se o aparelho pedir autorização, toque em Permitir.'; atualizarLocalClima();
  try {
    navigator.geolocation.getCurrentPosition(async p => {
      const acc = p.coords.accuracy;
      if (acc > SEDE_PRECISAO_MAX) return falha('imprecisa', sedeTextoImprecisa(acc));
      try { await sedeSalvar(p.coords.latitude, p.coords.longitude, 'gps', acc); climaLocalEstado = ''; climaLocalMensagem = ''; showToast('Local da fazenda marcado pelo GPS'); }
      catch (e) { falha('sinal', e.message || 'Não foi possível guardar o local. Tente de novo.'); }
    }, erro => {
      if (erro.code === 1) falha('negada', 'O acesso à localização foi negado ou está bloqueado. Tente novamente pelo botão; se o Safari não perguntar, siga as instruções abaixo.');
      else if (erro.code === 3) falha('tempo', 'O GPS demorou a responder. Vá para uma área aberta e tente de novo, ou marque a sede no mapa.');
      else falha('sinal', 'A posição está indisponível no momento. Marque a sede no mapa ou tente de novo numa área aberta.');
    }, {enableHighAccuracy: true, timeout: 30000, maximumAge: 0});
  } catch {
    falha('indisponivel', 'Não foi possível iniciar a localização neste navegador. Marque a sede no mapa.');
  }
};
ACTIONS['clima-local'] = () => solicitarLocalClima();
// O controle do cartão do clima ganha “Marcar no mapa”
const sedeControleBase = controleLocalClima;
controleLocalClima = function () {
  return sedeControleBase().replace('</div>', `<button type="button" class="secondary" data-act="nav" data-id="sede">🗺 Marcar no mapa</button></div>`);
};

// ---------- Tela: Local da fazenda ----------
let sedeEd = null; // ponto escolhido na tela e ainda não salvo: {lat, lon, origem, precisao}
function sedeQuando(iso) { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString('pt-BR') : ''; }
// Lê “-28.15, -52.47”, “-28,15 -52,47”, “28°09'S 52°28'W” não; links do Google Maps com @lat,lon sim
function sedeLerCoordenadas(txt) {
  const s = String(txt || '').trim(); if (!s) return null;
  const at = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  let nums = at ? [at[1], at[2]] : s.includes('.') ? s.match(/-?\d+(?:\.\d+)?/g) : s.match(/-?\d+(?:,\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const lat = Number(String(nums[0]).replace(',', '.')), lon = Number(String(nums[1]).replace(',', '.'));
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) || (lat === 0 && lon === 0)) return null;
  return {lat, lon};
}
VIEWS.sede = () => {
  const s = sedeServidor(), loc = localDaFazenda(), pode = sedePodeMudar();
  const atual = s ? `<b>${num(s.lat, 5)}, ${num(s.lon, 5)}</b><small>Sede ${esc(SEDE_ORIGEM[s.origem] || 'marcada')}${s.precisao ? ` • precisão de ~${num(s.precisao, 0)} m` : ''}${s.em ? ` • ${sedeQuando(s.em)}` : ''} • vale para todos os aparelhos da fazenda</small>`
    : loc ? `<b>${num(loc.lat, 5)}, ${num(loc.lon, 5)}</b><small>${esc(loc.fonte === 'talhoes' ? 'Usando o centro dos talhões (a sede ainda não foi marcada)' : loc.fonte === 'aparelho-antigo' ? 'Posição antiga deste aparelho — pode estar errada; marque a sede' : 'Só neste aparelho')}</small>`
    : '<b>Ainda não marcado</b><small>Marque a sede para a previsão do tempo e o mapa do tempo.</small>';
  return head('Local da fazenda', 'O ponto da sede é usado na previsão do tempo, na janela de pulverização e no mapa do tempo — para todos os aparelhos da fazenda.', (sedeVoltar === 'inicio' ? btn('← Início', 'nav', 'inicio', 'secondary') : btn('← MercaClima', 'nav', 'clima', 'secondary'))) +
    `<section class="card panel sede-atual"><span class="sede-pino" aria-hidden="true">📍</span><div>${atual}</div></section>
    ${pode ? `<section class="card panel sede-painel">
      <div class="sede-acoes"><button type="button" class="secondary" data-act="sede-gps">📡 Usar o GPS deste aparelho</button>
        <form class="sede-coord sede-busca" data-sede-busca><input id="sedeBusca" type="search" autocomplete="off" placeholder="Buscar cidade ou localidade (ex.: Coxilha, RS)" aria-label="Buscar cidade"><button type="submit" class="secondary">🔎 Buscar</button></form>
        <form class="sede-coord" data-sede-coord><input id="sedeCoord" inputmode="text" autocomplete="off" placeholder="Colar coordenadas (ex.: -28.15, -52.47)" aria-label="Coordenadas da sede"><button type="submit" class="secondary">Ir</button></form></div>
      <div class="sede-mapa-caixa"><div id="sedeMapa" class="sede-mapa" role="application" aria-label="Mapa de satélite: toque para marcar a sede"></div>
        <div class="sede-dica" id="sedeDica">Toque no mapa em cima da sede. Dá para arrastar o pino para ajustar.</div></div>
      <div class="sede-rodape"><small id="sedeEscolha">${sedeEd ? `${num(sedeEd.lat, 5)}, ${num(sedeEd.lon, 5)}` : 'Nenhum ponto escolhido ainda'}</small>
        <button type="button" class="primary" data-act="sede-salvar" ${sedeEd ? '' : 'disabled'}>Salvar este local</button></div>
      <p class="nota">No computador, a localização do navegador vem pela internet e pode errar por centenas de km — por isso ela não é aceita. Use o mapa, as coordenadas ou o GPS do celular.</p></section>`
    : `<section class="card panel"><p class="nota" style="margin:0">O local da fazenda é marcado pelo ADM ou pelo supervisor. Se estiver errado, peça para eles corrigirem em MercaClima → Local da fazenda.</p></section>`}`;
};
TITLES.sede = 'Local da fazenda';
let sedeMapaL = null, sedePino = null, sedeVoltar = '';
// Fecha o mapa da tela antes de sair dela (o mapa do tempo abre em seguida)
function sedeFecharMapa() { try { sedeMapaL?.off(); sedeMapaL?.remove(); } catch { /* já fechado */ } sedeMapaL = null; sedePino = null; }
addEventListener('hashchange', () => { if (!/^#\/sede/.test(location.hash) && sedeMapaL) sedeFecharMapa(); });
function sedeMostrarPonto(p, centralizar = true) {
  sedeEd = p; const L = window.L; if (!sedeMapaL || !L) return;
  if (!sedePino) {
    sedePino = L.marker([p.lat, p.lon], {draggable: true, icon: L.divIcon({className: 'mt-faz', iconSize: [0, 0], html: `<span class="mt-faz-pino"><svg class="ic-linha" width="16" height="16" viewBox="0 0 24 24"><path d="M12 21v-8.5"/><path d="M12 12.5C12 8.4 9.2 5.8 5 5.8c0 4.1 2.8 6.7 7 6.7zM12 14.5c0-3.7 2.6-6.2 6.8-6.2 0 3.7-2.6 6.2-6.8 6.2z"/></svg></span><b>Sede</b>`})}).addTo(sedeMapaL);
    sedePino.on('dragend', () => { const ll = sedePino.getLatLng(); sedeMostrarPonto({lat: ll.lat, lon: ll.lng, origem: 'mapa', precisao: null}, false); });
  } else sedePino.setLatLng([p.lat, p.lon]);
  if (centralizar) sedeMapaL.setView([p.lat, p.lon], Math.max(sedeMapaL.getZoom(), 16));
  const e = document.getElementById('sedeEscolha'); if (e) e.textContent = `${num(p.lat, 5)}, ${num(p.lon, 5)} • ${SEDE_ORIGEM[p.origem] || ''}${p.precisao ? ` (~${num(p.precisao, 0)} m)` : ''}`;
  const b = document.querySelector('[data-act="sede-salvar"]'); if (b) b.disabled = false;
  const d = document.getElementById('sedeDica'); if (d) d.hidden = true;
}
VIEWS.sede.after = async () => {
  const el = document.getElementById('sedeMapa'); if (!el) return;
  sedeFecharMapa();
  try { await carregarLeaflet(); } catch { el.innerHTML = '<p class="nota" style="padding:12px">Sem internet: o mapa não carregou. Use o GPS ou cole as coordenadas.</p>'; return; }
  if (!document.body.contains(el)) return; // a tela foi redesenhada enquanto o mapa carregava: fica o mapa da tela nova
  // Mapa próprio (o dos talhões é fechado pelo talhaomapa.js ao trocar de tela)
  const L = window.L, mapa = L.map(el, {doubleClickZoom: false});
  (typeof tmCamadaSatelite === 'function' ? tmCamadaSatelite(L) : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© OpenStreetMap'})).addTo(mapa);
  sedeMapaL = mapa;
  // Talhões com contorno, para achar a sede com facilidade
  const grupos = db.fields.filter(f => f.contorno?.pontos?.length > 2).map(f => { L.polygon(f.contorno.pontos, {color: '#ffd23f', weight: 2, fillOpacity: 0.08, interactive: false}).addTo(mapa); return f.contorno.pontos; });
  const s = sedeServidor(), loc = localDaFazenda();
  if (sedeEd) sedeMostrarPonto(sedeEd);
  else if (s) { mapa.setView([s.lat, s.lon], 16); sedeMostrarPonto({lat: s.lat, lon: s.lon, origem: s.origem, precisao: s.precisao}, false); sedeEd = null; const b = document.querySelector('[data-act="sede-salvar"]'); if (b) b.disabled = true; }
  else if (grupos.length && typeof tmEnquadrar === 'function') tmEnquadrar(mapa, grupos);
  else if (loc && loc.fonte !== 'aparelho-antigo') mapa.setView([loc.lat, loc.lon], 14);
  else mapa.setView([-15.8, -52], 4);
  mapa.on('click', e => sedeMostrarPonto({lat: e.latlng.lat, lon: e.latlng.lng, origem: 'mapa', precisao: null}, false));
  setTimeout(() => { if (sedeMapaL === mapa && document.body.contains(el)) mapa.invalidateSize(); }, 60);
};
// Buscar cidade (OpenStreetMap): só leva o mapa até lá; a sede é marcada tocando no mapa
document.addEventListener('submit', async e => {
  if (!e.target.matches?.('[data-sede-busca]')) return;
  e.preventDefault();
  const q = document.getElementById('sedeBusca')?.value.trim(); if (!q) return;
  const coord = sedeLerCoordenadas(q);
  if (coord) { sedeMapaL?.setView([coord.lat, coord.lon], 16); sedeMostrarPonto({...coord, origem: 'coordenadas', precisao: null}); return; }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`).then(x => x.json());
    if (!r?.[0]) { showToast('Não encontrei esse lugar. Tente "cidade, estado".', true); return; }
    sedeMapaL?.setView([Number(r[0].lat), Number(r[0].lon)], 14);
    showToast(`${r[0].display_name.split(',').slice(0, 2).join(',')}: agora toque no mapa em cima da sede`);
  } catch { showToast('Sem internet para buscar. Cole as coordenadas ou use o GPS.', true); }
});
document.addEventListener('submit', e => {
  if (!e.target.matches?.('[data-sede-coord]')) return;
  e.preventDefault();
  const p = sedeLerCoordenadas(document.getElementById('sedeCoord')?.value);
  if (!p) { showToast('Não reconheci as coordenadas. Exemplo: -28.15, -52.47 (latitude, longitude)', true); return; }
  sedeMostrarPonto({...p, origem: 'coordenadas', precisao: null});
});
Object.assign(ACTIONS, {
  'sede-gps': () => {
    if (!navigator.geolocation) { showToast('Este aparelho não oferece localização. Toque no mapa ou cole as coordenadas.', true); return; }
    showToast('Lendo o GPS…');
    navigator.geolocation.getCurrentPosition(p => {
      if (p.coords.accuracy > SEDE_PRECISAO_MAX) { showToast(sedeTextoImprecisa(p.coords.accuracy), true); return; }
      sedeMostrarPonto({lat: p.coords.latitude, lon: p.coords.longitude, origem: 'gps', precisao: Math.round(p.coords.accuracy)});
    }, () => showToast('GPS sem sinal ou sem permissão. Toque no mapa ou cole as coordenadas.', true), {enableHighAccuracy: true, timeout: 30000, maximumAge: 0});
  },
  'sede-salvar': async () => {
    if (!sedeEd) return;
    const b = document.querySelector('[data-act="sede-salvar"]'); if (b) { b.disabled = true; b.textContent = 'Salvando…'; }
    try { await sedeSalvar(sedeEd.lat, sedeEd.lon, sedeEd.origem, sedeEd.precisao); sedeEd = null; sedeFecharMapa(); showToast('Local da fazenda salvo — vale para todos os aparelhos'); const v = sedeVoltar || 'clima'; sedeVoltar = ''; go(v); }
    catch (e) { showToast(e.amigavel || e.message ? e.message : 'Não foi possível salvar. Confira a internet e tente de novo.', true); if (b) { b.disabled = false; b.textContent = 'Salvar este local'; } }
  }
});
