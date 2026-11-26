'use strict';
/* MercaPlant — alertas de tempo só no perímetro da fazenda.
   • Perímetro: os contornos dos talhões (sem contorno desenhado, o ponto da fazenda).
   • Radar (tempestades STSC): alerta quando a tempestade está a até 10 km do limite dos talhões (ou sobre eles).
   • Avisos oficiais para a região (INMET): só viram alerta da fazenda quando a previsão do ponto da fazenda ou o radar
     confirmam o fenômeno no período do aviso; os outros ficam no MercaClima, em "Avisos da região".
   Funções puras (sem tela), testadas em referencias/tests/clima-fazenda.test.js. */
const CF = {tempPerimetro: 10, chuvaMm: 5, chuvaProb: 60, rajada: 50, geada: 3, calor: 35, umidade: 30};

// ---------- Geometria (pontos [lat, lon]) ----------
const cfKm = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
function cfDentro(P, la, lo) {
  let d = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ai, oi] = P[i], [aj, oj] = P[j];
    if ((oi > lo) !== (oj > lo) && la < (aj - ai) * (lo - oi) / (oj - oi) + ai) d = !d;
  }
  return d;
}
// Distância (km) do ponto ao segmento, numa projeção plana em volta do ponto (boa para dezenas de km)
function cfDistSeg(la, lo, [a1, o1], [a2, o2]) {
  const kx = 111.32 * Math.cos(la * Math.PI / 180), ky = 110.57;
  const x1 = (o1 - lo) * kx, y1 = (a1 - la) * ky, x2 = (o2 - lo) * kx, y2 = (a2 - la) * ky, dx = x2 - x1, dy = y2 - y1;
  const t = dx || dy ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(x1 + t * dx, y1 + t * dy);
}
/** Contornos dos talhões com pelo menos 3 cantos. */
const poligonosFazenda = () => (typeof db !== 'undefined' ? db.fields || [] : []).map(f => f.contorno?.pontos).filter(p => Array.isArray(p) && p.length >= 3);
/** Distância (km) do ponto à fazenda: 0 dentro de um talhão; senão até o lado mais perto. Sem contorno, até o ponto da fazenda. */
function distFazendaKm(la, lo, loc, pols = poligonosFazenda()) {
  if (!pols.length) return loc ? cfKm(loc.lat, loc.lon, la, lo) : Infinity;
  let m = Infinity;
  for (const P of pols) {
    if (cfDentro(P, la, lo)) return 0;
    for (let i = 0; i < P.length; i++) m = Math.min(m, cfDistSeg(la, lo, P[i], P[(i + 1) % P.length]));
  }
  return m;
}
const CF_RUMOS = ['ao norte', 'a nordeste', 'a leste', 'a sudeste', 'ao sul', 'a sudoeste', 'a oeste', 'a noroeste'];
function cfRumo(lat, lon, la, lo) { const r = Math.PI / 180, y = Math.sin((lo - lon) * r) * Math.cos(la * r), x = Math.cos(lat * r) * Math.sin(la * r) - Math.sin(lat * r) * Math.cos(la * r) * Math.cos((lo - lon) * r); return CF_RUMOS[Math.round(((Math.atan2(y, x) / r + 360) % 360) / 45) % 8]; }
/** Tempestade mais perto do perímetro no último quadro do radar e se está chegando (comparando com ~30 min antes). */
function tempestadeDaFazenda(T, loc, pols = poligonosFazenda()) {
  const ult = T?.at?.(-1); if (!ult) return null;
  const perto = q => (q?.pontos || []).reduce((m, [la, lo]) => { const d = distFazendaKm(la, lo, loc, pols); return !m || d < m.d ? {d, la, lo} : m; }, null);
  const agora = perto(ult); if (!agora) return {nenhuma: true, t: ult.t};
  const antes = T.filter(x => x.t <= new Date(ult.t.getTime() - 25 * 60000)).at(-1), a = perto(antes);
  return {d: agora.d, rumo: loc ? cfRumo(loc.lat, loc.lon, agora.la, agora.lo) : '', t: ult.t, chegando: a ? agora.d < a.d - 2 : null, perimetro: pols.length > 0};
}

// ---------- Avisos para a região x previsão e radar da fazenda ----------
const cfTipoAviso = ev => { const e = String(ev || '').toLowerCase();
  return /granizo|tempestade|trovo|chuva|acumulado/.test(e) ? 'chuva' : /vendaval|vento/.test(e) ? 'vento' : /geada|frio|declínio|declinio/.test(e) ? 'frio'
    : /calor|temperatura/.test(e) ? 'calor' : /umidade/.test(e) ? 'umidade' : ''; };
const cfNum = (v, c = 0) => typeof num === 'function' ? num(v, c) : String(Math.round(v * 10 ** c) / 10 ** c).replace('.', ',');
const cfHora = (t, hoje) => `${t.slice(0, 10) === hoje ? '' : (typeof nomeDiaCurto === 'function' ? nomeDiaCurto(t.slice(0, 10)) + ' ' : '')}${Number(t.slice(11, 13))}h`;
/** O aviso se confirma na fazenda? h = previsão horária (horas locais "AAAA-MM-DDTHH:00"); tp = tempestade do radar. */
function confirmaAviso(a, h, tp, agora = Date.now()) {
  const tipo = cfTipoAviso(a.evento); if (!tipo || !h?.time) return {ok: false, txt: '', tipo};
  const ini = a.inicio ? new Date(a.inicio).getTime() : agora, fim = a.fim ? new Date(a.fim).getTime() : ini + 864e5, de = Math.max(ini, agora - 3600e3);
  const idx = h.time.map((t, i) => [new Date(t).getTime(), i]).filter(([ms]) => ms >= de && ms <= fim).map(([, i]) => i);
  const radar = tipo === 'chuva' && tp && !tp.nenhuma && tp.d <= CF.tempPerimetro && ini <= agora && agora <= fim;
  if (!idx.length) return {ok: !!radar, txt: radar ? 'tempestade no radar perto da fazenda' : '', tipo};
  const v = k => idx.map(i => h[k]?.[i]).filter(x => x != null), max = k => Math.max(...v(k)), min = k => Math.min(...v(k)), hoje = new Date(agora - new Date(agora).getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (tipo === 'chuva') {
    const mm = v('precipitation').reduce((s, x) => s + x, 0), prob = v('precipitation_probability').length ? max('precipitation_probability') : 0;
    const horas = idx.filter(i => (h.precipitation?.[i] || 0) >= 0.2 || (h.precipitation_probability?.[i] || 0) >= CF.chuvaProb);
    const ok = mm >= CF.chuvaMm || prob >= CF.chuvaProb || !!radar;
    const faixa = ok && horas.length ? ` entre ${cfHora(h.time[horas[0]], hoje)} e ${cfHora(h.time[horas.at(-1)].slice(0, 11) + String(Number(h.time[horas.at(-1)].slice(11, 13)) + 1).padStart(2, '0'), hoje)}` : '';
    return {ok, tipo, mm, prob, txt: `${radar ? 'tempestade no radar perto da fazenda; ' : ''}previsão para a fazenda: ${cfNum(Math.round(mm * 10) / 10, mm % 1 ? 1 : 0)} mm${faixa}, chance de até ${Math.round(prob)}%`};
  }
  if (tipo === 'vento') { const r = max('wind_gusts_10m'); return {ok: r >= CF.rajada, tipo, txt: `previsão para a fazenda: rajadas de até ${Math.round(r)} km/h`}; }
  if (tipo === 'frio') { const t = min('temperature_2m'); return {ok: t <= CF.geada, tipo, txt: `previsão para a fazenda: mínima de ${Math.round(t)} °C`}; }
  if (tipo === 'calor') { const t = max('temperature_2m'); return {ok: t >= CF.calor, tipo, txt: `previsão para a fazenda: máxima de ${Math.round(t)} °C`}; }
  const u = min('relative_humidity_2m'); return {ok: u <= CF.umidade, tipo, txt: `previsão para a fazenda: umidade mínima de ${Math.round(u)}%`};
}
/** Separa os avisos: os que se confirmam na fazenda (viram alerta) e os que ficam só como aviso da região. */
function dividirAvisos(avisos, h, tp, agora = Date.now()) {
  const fazenda = [], regiao = [];
  (avisos || []).forEach(a => { const c = confirmaAviso(a, h, tp, agora); (c.ok ? fazenda : regiao).push({...a, conf: c}); });
  return {fazenda, regiao};
}
