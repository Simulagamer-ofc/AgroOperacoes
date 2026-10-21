'use strict';
/* MercaPlant — menu MercaClima + alertas de tempo que interferem nas operações.
   • Tela "MercaClima": alertas, mapa grande (satélite, radar, tempestades e chuva prevista), previsão completa e chuvas registradas.
   • Início: cartão curto do tempo; quando alguma condição atrapalha uma operação, aparecem os alertas e o mapa pequeno.
   Critérios do app (orientação; confirmar no campo): chuva por hora ≥ 0,2 mm ou chance ≥ 60%; chuva forte ≥ 10 mm no dia;
   rajadas ≥ 50 km/h (≥ 70 vermelho); geada provável com mínima ≤ 3 °C (≤ 0 vermelho); calor ≥ 35 °C;
   solo encharcado com ≥ 30 mm em 48 h; tempestade (STSC/REDEMET) até 40 km vermelho, até 100 km laranja. */

const OPS_CAMPO = ['Plantio', 'Aplicação', 'Adubação', 'Colheita', 'Preparo de solo', 'Transporte'];
const OPS_PULVERIZAR = ['Aplicação'];
const LIM = {rajada: 50, rajadaForte: 70, geada: 3, geadaForte: 0, calor: 35, encharcado: 30, chuvaForte: 10, tempPerto: 40, tempAtencao: 100};
const opsDoDia = dia => db.operations.filter(o => o.date === dia && ['Programada', 'Em andamento'].includes(o.status));
const nomeOp = o => `${o.type}${o.fieldId ? ' — ' + (typeof fieldName === 'function' ? fieldName(o.fieldId) : '') : o.place ? ' — ' + o.place : ''}${o.time ? ' (' + o.time + ')' : ''}`;
const listaOps = ops => ops.slice(0, 3).map(nomeOp).join('; ') + (ops.length > 3 ? ` e mais ${ops.length - 3}` : '');
const nomeDiaCurto = d => d === today() ? 'hoje' : d === addDias(today(), 1) ? 'amanhã' : (typeof DIA_SEMANA_LONGO !== 'undefined' ? DIA_SEMANA_LONGO[new Date(d + 'T12:00:00').getDay()] : fmtDate(d));
const maxDia = (h, campo, dia, ini = 0, fim = 24) => { let m = null; h.time.forEach((t, i) => { const hr = Number(t.slice(11, 13)); if (t.startsWith(dia) && hr >= ini && hr < fim && h[campo]?.[i] != null) m = m == null ? h[campo][i] : Math.max(m, h[campo][i]); }); return m; };

// Lista de riscos de tempo (sem a tempestade, que chega depois pela REDEMET)
function riscosClima(agora = new Date()) {
  const c = typeof lerClima === 'function' ? lerClima() : null, d = c?.dados?.daily, h = c?.dados?.hourly; if (!d || !h) return [];
  const hoje = today(), amanha = addDias(hoje, 1), lista = [], add = (nivel, icone, titulo, texto, chave) => lista.push({nivel, icone, titulo, texto, chave});
  // Chuva hoje e amanhã, com as operações que ela atrapalha
  [hoje, amanha].forEach(dia => {
    const fx = typeof horariosChuva === 'function' ? horariosChuva(c.dados, dia, dia === hoje ? agora : undefined) : [];
    const mm = fx.reduce((t, f) => t + f.mm, 0); if (!fx.length) return;
    const ops = opsDoDia(dia).filter(o => OPS_CAMPO.includes(o.type));
    const patio = dia === hoje && typeof noPatio === 'function' ? noPatio().length : 0, secando = db.lotesSecagem?.some(l => l.status === 'Em andamento');
    const extras = [ops.length ? `Atrapalha: ${listaOps(ops)}.` : '', patio || secando ? 'Moega e secador: cubra o pátio e as cargas expostas.' : ''].filter(Boolean).join(' ');
    if (!ops.length && mm < LIM.chuvaForte && dia === amanha) return; // amanhã sem operação e chuva fraca: fica só no cartão
    add(mm >= LIM.chuvaForte ? 'red' : 'orange', '🌧', `Chuva ${nomeDiaCurto(dia)} ${typeof txtHorariosChuva === 'function' ? txtHorariosChuva(fx) : ''}`.trim(), extras || 'Programe aplicações, plantio e colheita fora desse horário.', 'chuva-' + dia);
  });
  // Pulverização programada sem condição boa
  [hoje, amanha].forEach(dia => {
    const ops = opsDoDia(dia).filter(o => OPS_PULVERIZAR.includes(o.type)); if (!ops.length || typeof janelasDoDia !== 'function') return;
    const j = janelasDoDia(c.dados, dia);
    if (!j.janelas.length) add('orange', '💨', `Sem condição boa para pulverizar ${nomeDiaCurto(dia)}${j.principal ? ' (principalmente ' + j.principal + ')' : ''}`, `Programado: ${listaOps(ops)}. Reprograme ou aplique só se as condições no campo permitirem.`, 'pulv-' + dia);
  });
  // Vento, geada e calor nos próximos 3 dias
  for (let k = 0; k < 3; k++) {
    const dia = addDias(hoje, k), i = d.time.indexOf(dia); if (i < 0) continue;
    const raj = maxDia(h, 'wind_gusts_10m', dia), min = d.temperature_2m_min?.[i], max = d.temperature_2m_max?.[i], ops = opsDoDia(dia).filter(o => OPS_CAMPO.includes(o.type));
    if (raj != null && raj >= LIM.rajada) add(raj >= LIM.rajadaForte ? 'red' : 'orange', '🌬', `Rajadas de até ${Math.round(raj)} km/h ${nomeDiaCurto(dia)}`, `Não pulverize (deriva); atenção a lonas, estruturas e máquinas altas.${ops.length ? ' Programado: ' + listaOps(ops) + '.' : ''}`, 'vento-' + dia);
    if (min != null && min <= LIM.geada) add(min <= LIM.geadaForte ? 'red' : 'orange', '❄', `Risco de geada ${nomeDiaCurto(dia)} (mínima de ${Math.round(min)} °C)`, 'Lavouras em emergência ou floração são as mais sensíveis. Evite aplicações na madrugada fria.', 'geada-' + dia);
    if (max != null && max >= LIM.calor) add('orange', '🌡', `Calor de ${Math.round(max)} °C ${nomeDiaCurto(dia)}`, `Pulverize só cedo ou no fim da tarde (evaporação e deriva); hidratação da equipe.${ops.length ? ' Programado: ' + listaOps(ops) + '.' : ''}`, 'calor-' + dia);
  }
  // Muita chuva em 48 h: solo encharcado
  const i0 = d.time.indexOf(hoje), mm48 = i0 >= 0 ? (d.precipitation_sum[i0] || 0) + (d.precipitation_sum[i0 + 1] || 0) : 0;
  if (mm48 >= LIM.encharcado) add('orange', '🚜', `${num(Math.round(mm48))} mm previstos até amanhã`, 'Solo encharcado pode impedir a entrada de máquinas e causar compactação; reprograme operações pesadas.', 'encharcado');
  const ordem = {red: 0, orange: 1}; return lista.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
}
// Tempestade perto (STSC/REDEMET), guardada 5 min neste aparelho
let tempestadeCache = null;
async function tempestadePerto(loc) {
  if (tempestadeCache && Date.now() - tempestadeCache.em < 300000) return tempestadeCache.r;
  if (typeof redemet !== 'function' || typeof horariosStsc !== 'function' || navigator.onLine === false) return null;
  try {
    const s = await redemet({produto: 'stsc', anima: 6, lat: loc.lat.toFixed(2), lon: loc.lon.toFixed(2), graus: 3});
    const r = tempestadeMaisPerto(horariosStsc(s), loc.lat, loc.lon); tempestadeCache = {em: Date.now(), r}; return r;
  } catch { return null; }
}
const riscoTempestade = tp => !tp || tp.nenhuma || tp.d > LIM.tempAtencao ? null : {nivel: tp.d <= LIM.tempPerto ? 'red' : 'orange', icone: '⚡', chave: 'tempestade',
  titulo: `Tempestade a ${Math.round(tp.d)} km ${tp.rumo} da fazenda${tp.chegando === true ? ' — se aproximando' : ''}`, texto: `Detectada às ${hhmm(tp.t)} (REDEMET). Raios: suspenda trabalho em campo aberto e em silos e secadores; recolha a equipe.`};
const htmlRiscos = rs => rs.map(r => `<div class="clima-risco ${r.nivel}"><span aria-hidden="true">${r.icone}</span><div><strong>${esc(r.titulo)}</strong><small>${esc(r.texto)}</small></div></div>`).join('');

// ---------- Início: só a previsão do dia + alertas de uma linha; o resto fica no MercaClima ----------
const cartaoClimaCompleto = cartaoClima;
function cartaoClimaCurto() {
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null, c = lerClima();
  if (!loc || !c?.dados?.daily) return cartaoClimaCompleto();
  const d = c.dados.daily, i0 = Math.max(0, d.time.indexOf(today())), jan = janelasDoDia(c.dados, d.time[i0]), ch = horariosChuva(c.dados, today());
  const proxChuva = ch.length ? (ch[0].agora ? 'chovendo agora' : `chuva às ${hh2(ch[0].ini)}`) : (() => { const k = d.precipitation_sum.findIndex((mm, i) => i > i0 && mm >= 1); return k > 0 ? `chuva ${nomeDiaCurto(d.time[k])}` : 'sem chuva prevista'; })();
  const rs = riscosClima();
  return `<article class="card panel hoje-clima clima-curto" id="hojeClima">
    <button type="button" class="clima-linha" data-act="nav" data-id="clima"><span class="clima-ic" aria-hidden="true">${iconeDia(c.dados, i0)}</span>
      <span class="clima-txt"><strong>Hoje ${Math.round(d.temperature_2m_max[i0])}° / ${Math.round(d.temperature_2m_min[i0])}°</strong><small class="${jan.janelas.length ? 'ok' : 'nao'}">${jan.janelas.length ? 'Pulverizar ' + jan.janelas.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(', ') : 'Sem janela para pulverizar'} • ${esc(proxChuva)}</small></span><span class="clima-seta" aria-hidden="true">›</span></button>
    <div id="climaRiscos">${htmlRiscos(rs)}</div>
    <button type="button" class="secondary clima-abrir" data-act="nav" data-id="clima">Detalhar no MercaClima ›</button></article>`;
}
// eslint-disable-next-line no-global-assign
cartaoClima = () => (parseRoute().name === 'clima' ? cartaoClimaCompleto() : cartaoClimaCurto());
async function completarAlertasInicio() {
  const loc = localDaFazenda?.(), box = document.getElementById('climaRiscos'); if (!loc || !box) return;
  const r = riscoTempestade(await tempestadePerto(loc)); if (!r || !document.getElementById('climaRiscos')) return;
  document.getElementById('climaRiscos').insertAdjacentHTML('afterbegin', htmlRiscos([r]));
}
if (VIEWS.inicio) {
  const depoisSemAlertas = VIEWS.inicio.after;
  VIEWS.inicio.after = (...a) => { depoisSemAlertas?.(...a); completarAlertasInicio(); };
}

// ---------- Tela MercaClima ----------
VIEWS.clima = () => {
  safeStorage.set('agro-clima-aberto', '1'); // previsão sempre aberta nesta tela
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null;
  const topo = head('MercaClima', 'Previsão, mapa do tempo, alertas para as operações e chuvas da fazenda', btn('+ Registrar chuva', 'ch-new') + btn('Atualizar previsão', 'clima-atualizar', '', 'secondary'));
  if (!loc) return topo + cartaoClimaCompleto();
  const rs = riscosClima(), chuvas = db.chuvas.slice().sort(byDateDesc), soma = dias => chuvas.filter(x => x.date >= daysAgo(dias)).reduce((t, x) => t + (Number(x.mm) || 0), 0);
  return topo + `<section class="clima-tela">
    <div class="clima-col-mapa">${painelMapaHTML(false).replace('mt-painel', 'mt-painel mt-tela')}</div>
    <div class="clima-col-prev">
      <section class="card panel"><h3 style="margin:0 0 8px">Alertas para as operações</h3><div id="climaRiscos">${rs.length ? htmlRiscos(rs) : '<p class="nota" style="margin:0">Nenhuma condição de tempo atrapalhando as operações programadas.</p>'}</div></section>
      ${cartaoClimaCompleto()}
      <section class="card panel"><div class="section-title" style="margin:0 0 8px"><h3>Chuva registrada</h3><button data-act="nav" data-id="chuva">Ver todas</button></div>
        <div class="lote-nums"><span><small>Últimos 7 dias</small><b>${num(soma(7))} mm</b></span><span><small>Últimos 30 dias</small><b>${num(soma(30))} mm</b></span><span><small>Último registro</small><b>${chuvas[0] ? `${num(chuvas[0].mm)} mm` : '—'}</b><small>${chuvas[0] ? fmtDate(chuvas[0].date) : 'nenhum'}</small></span></div></section>
    </div></section>`;
};
TITLES.clima = 'MercaClima';
VIEWS.clima.after = async () => {
  iniciarMapaTempo();
  const loc = localDaFazenda?.(); if (!loc) return;
  if (typeof buscarClima === 'function') buscarClima();
  const r = riscoTempestade(await tempestadePerto(loc)), box = document.getElementById('climaRiscos');
  if (r && box) { if (!box.querySelector('.clima-risco')) box.innerHTML = ''; box.insertAdjacentHTML('afterbegin', htmlRiscos([r])); }
};
