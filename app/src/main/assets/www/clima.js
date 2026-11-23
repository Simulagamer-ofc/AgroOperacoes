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
  const hoje = today(), amanha = addDias(hoje, 1), lista = [], chuvas = [], add = (nivel, icone, titulo, texto, chave) => { const r = {nivel, icone, titulo, texto, chave}; lista.push(r); return r; };
  // Chuva hoje e amanhã, com as operações que ela atrapalha
  [hoje, amanha].forEach(dia => {
    const fx = typeof horariosChuva === 'function' ? horariosChuva(c.dados, dia, dia === hoje ? agora : undefined) : [];
    const mm = fx.reduce((t, f) => t + f.mm, 0); if (!fx.length) return;
    const ops = opsDoDia(dia).filter(o => OPS_CAMPO.includes(o.type));
    const patio = dia === hoje && typeof noPatio === 'function' ? noPatio().length : 0, secando = db.lotesSecagem?.some(l => l.status === 'Em andamento');
    const extras = [ops.length ? `Atrapalha: ${listaOps(ops)}.` : '', patio || secando ? 'Moega e secador: cubra o pátio e as cargas expostas.' : ''].filter(Boolean).join(' ');
    if (!ops.length && mm < LIM.chuvaForte && dia === amanha) return; // amanhã sem operação e chuva fraca: fica só no cartão
    chuvas.push({mm, r: add(mm >= LIM.chuvaForte ? 'red' : 'orange', '🌧', `Chuva ${nomeDiaCurto(dia)} ${typeof txtHorariosChuva === 'function' ? txtHorariosChuva(fx) : ''}`.trim(), extras || 'Programe aplicações, plantio e colheita fora desse horário.', 'chuva-' + dia)});
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
  // Se já há o alerta de chuva, o solo encharcado entra nele (mesma chuva, um alerta só)
  const txtEnch = 'Solo encharcado pode impedir a entrada de máquinas e causar compactação; reprograme operações pesadas.';
  const daChuva = chuvas.sort((a, b) => b.mm - a.mm)[0]?.r;
  if (mm48 >= LIM.encharcado && daChuva) { daChuva.titulo += ' · solo encharcado'; daChuva.texto += ` ${num(Math.round(mm48))} mm até amanhã: ${txtEnch.charAt(0).toLowerCase()}${txtEnch.slice(1)}`; }
  else if (mm48 >= LIM.encharcado) add('orange', '🚜', `${num(Math.round(mm48))} mm previstos até amanhã`, txtEnch, 'encharcado');
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
  titulo: `Tempestade a ${Math.round(tp.d)} km ${tp.rumo} da fazenda${tp.chegando === true ? ' — se aproximando' : ''}`, texto: `Detectada às ${hhmm(tp.t)}. Raios: suspenda trabalho em campo aberto e em silos e secadores; recolha a equipe.`};
// Alertas com a identidade do MercaPlant: ícone de linha no hexágono (borda na cor do nível) e selo "Alerta vermelho/laranja/amarelo".
// Não mostram de onde veio o dado (previsão, radar, avisos oficiais): para quem usa, é tudo alerta do MercaPlant.
const GLIFOS_RISCO = {
  tempestade: '<path d="M7 15a4 4 0 0 1 .6-8 5.2 5.2 0 0 1 9.9 1.7A3.4 3.4 0 0 1 17 15z"/><path d="M12.5 12.5l-2 3.5h3l-2 4"/>',
  raio: '<path d="M13.5 3 6 13.5h5.2L10 21l8-11.2h-5.3z"/>',
  chuva: '<path d="M7 15a4 4 0 0 1 .6-8 5.2 5.2 0 0 1 9.9 1.7A3.4 3.4 0 0 1 17 15z"/><path d="M8.5 18 7.5 20.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
  granizo: '<path d="M7 15a4 4 0 0 1 .6-8 5.2 5.2 0 0 1 9.9 1.7A3.4 3.4 0 0 1 17 15z"/><circle cx="8.5" cy="19" r="1"/><circle cx="12.5" cy="20.3" r="1"/><circle cx="16" cy="18.6" r="1"/>',
  vento: '<path d="M3 9h11.5a3 3 0 1 0-3-3M3 13.5h15a3 3 0 1 1-3 3M3 18h6"/>',
  geada: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.6 12 7l2.5-2.4M9.5 19.4 12 17l2.5 2.4"/>',
  calor: '<path d="M10 14.3V5a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z"/><path d="M12 9.5v6.5M17 6h2.5M17 9.5h2.5"/>',
  gota: '<path d="M12 3.5s6 6.8 6 10.8a6 6 0 0 1-12 0c0-4 6-10.8 6-10.8z"/><path d="M9.5 15a2.6 2.6 0 0 0 2.5 2.5"/>',
  pulverizar: '<path d="M9 3h6v4l-1.2 3h-3.6L9 7zM12 10v2.5M8.5 15.5 6.5 20M12 15.5V21M15.5 15.5l2 4.5"/>',
  solo: '<circle cx="7.5" cy="16" r="3.5"/><circle cx="18" cy="17.5" r="2"/><path d="M11 16h5M4 12.5V8h6.5l1.8 4.5M12 8V4.5h3V8M4 12.5h12.5a2.5 2.5 0 0 1 2.5 2.5"/>',
  alerta: '<path d="M12 3.8 21 19.5H3z"/><path d="M12 10v4.2M12 16.9v.2"/>'
};
const GLIFO_DO_ICONE = {'⛈': 'tempestade', '⚡': 'raio', '🌧': 'chuva', '🧊': 'granizo', '🌬': 'vento', '💨': 'pulverizar', '❄': 'geada', '🌡': 'calor', '💧': 'gota', '🚜': 'solo', '⚠': 'alerta'};
const SELO_RISCO = {red: 'Alerta vermelho', orange: 'Alerta laranja', yellow: 'Alerta amarelo'};
function hexRisco(icone, nivel, tam = 38) {
  const d = GLIFOS_RISCO[GLIFO_DO_ICONE[String(icone).replace(/\uFE0F/g, '')]] || GLIFOS_RISCO.alerta;
  return `<svg class="cr-hex n-${nivel || 'orange'}" width="${tam}" height="${tam}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><polygon class="cr-hex-borda" points="9,3 23,3 30,16 23,29 9,29 2,16"/><g class="cr-hex-glifo" transform="translate(6.4 6.4) scale(.8)">${d}</g></svg>`;
}
// Selo ao lado do título; linhas extras (ex.: outros períodos do mesmo alerta) logo abaixo do texto
const htmlRiscos = rs => rs.map(r => `<div class="clima-risco ${r.nivel}${r.fonte ? ' fonte-' + r.fonte.toLowerCase() : ''}"><span class="cr-icone" aria-hidden="true">${hexRisco(r.icone, r.nivel)}</span><div><strong>${esc(r.titulo)} <em class="clima-selo ${r.nivel}">${esc(r.selo || SELO_RISCO[r.nivel] || 'Alerta')}</em></strong><small>${esc(r.texto)}</small>${(r.extras || []).map(x => `<small class="clima-extra">${esc(x)}</small>`).join('')}${r.link ? `<a class="clima-fonte" href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.linkTxt || 'Ver mais')} ›</a>` : ''}</div></div>`).join('');

// ---------- Avisos oficiais do INMET (Alert-AS) para o ponto da fazenda, pela função do servidor ----------
// Somam-se aos alertas do app (previsão do Open-Meteo e tempestade da REDEMET); não substituem nada.
const INMET_VALIDADE = 10 * 60000;
let inmetCache = null;
async function avisosInmet(loc) {
  const k = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
  if (inmetCache?.k === k && Date.now() - inmetCache.em < INMET_VALIDADE) return inmetCache.avisos;
  const base = typeof NUVEM !== 'undefined' ? NUVEM : null; if (!base || navigator.onLine === false) return inmetCache?.k === k ? inmetCache.avisos : [];
  try {
    const r = await fetch(`${base.url}/functions/v1/inmet?${new URLSearchParams({lat: loc.lat.toFixed(4), lon: loc.lon.toFixed(4)})}`, {headers: {apikey: base.chave}});
    if (!r.ok) throw new Error('inmet ' + r.status);
    const d = await r.json(), avisos = Array.isArray(d?.avisos) ? d.avisos : [];
    inmetCache = {k, em: Date.now(), avisos};
    return avisos;
  } catch { return inmetCache?.k === k ? inmetCache.avisos : []; }
}
const NIVEL_INMET = {vermelho: 'red', laranja: 'orange', amarelo: 'yellow'}, COR_INMET = {vermelho: 'vermelho', laranja: 'laranja', amarelo: 'amarelo'};
function iconeInmet(evento) {
  const e = String(evento).toLowerCase();
  return /granizo/.test(e) ? '🧊' : /geada|frio|declínio de temperatura|declinio/.test(e) ? '❄' : /calor|temperatura/.test(e) ? '🌡'
    : /umidade/.test(e) ? '💧' : /vendaval|vento/.test(e) ? '🌬' : /tempestade|trovo/.test(e) ? '⛈' : /chuva|acumulado/.test(e) ? '🌧' : '⚠';
}
// Data/hora curtas: "hoje", "amanhã", "sábado" + "14h"
const diaInmet = d => nomeDiaCurto(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
const horaInmet = d => `${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`;
// "amanhã (o dia todo)", "hoje até 18h", "sábado, das 6h às 18h", "de hoje 14h até amanhã 10h"
function periodoInmet(a, agora = Date.now()) {
  const i = a.inicio ? new Date(a.inicio) : null, f = a.fim ? new Date(a.fim) : null;
  if (!f || Number.isNaN(f.getTime())) return 'em vigor';
  const comecou = !i || i.getTime() <= agora, mesmoDia = i && i.toDateString() === f.toDateString();
  const diaTodo = i && mesmoDia && i.getHours() === 0 && i.getMinutes() === 0 && f.getHours() === 23 && f.getMinutes() >= 59;
  if (diaTodo) return `${diaInmet(f)} (o dia todo)`;
  if (comecou) return `${diaInmet(f)} até ${horaInmet(f)}`;
  if (mesmoDia) return `${diaInmet(i)}, das ${horaInmet(i)} às ${horaInmet(f)}`;
  return `de ${diaInmet(i)} ${horaInmet(i)} até ${diaInmet(f)} ${horaInmet(f)}`;
}
// Tira o "INMET publica aviso iniciando em: 25/11/2026 00:00." (o período já aparece no título)
const descInmet = a => String(a.descricao || '').replace(/\s+/g, ' ').replace(/^INMET publica aviso iniciando em:?\s*[\d/]+\s*[\d:]*\.?\s*/i, '').trim();
// Primeira frase: o que vem (chuva, vento, granizo); a descrição completa aparece nos detalhes
const resumoInmet = a => { const d = descInmet(a), k = d.search(/\.\s+[A-ZÁÉÍÓÚ]/); return k > 0 ? d.slice(0, k + 1) : d; };
// Um alerta por evento: o INMET publica o mesmo evento em vários avisos (ex.: tempestade amarela hoje e vermelha amanhã).
// O mais grave vira o título; os outros períodos entram como linhas curtas no mesmo alerta.
const ORD_INMET = {vermelho: 0, laranja: 1, amarelo: 2};
const maiuscula = s => s.charAt(0).toUpperCase() + s.slice(1);
function riscoInmet(lista, completo = false) {
  lista = [].concat(lista).sort((x, y) => (ORD_INMET[x.nivel] ?? 2) - (ORD_INMET[y.nivel] ?? 2) || String(x.inicio).localeCompare(String(y.inicio)));
  const a = lista[0], outros = lista.slice(1).sort((x, y) => String(x.inicio).localeCompare(String(y.inicio)));
  return {nivel: NIVEL_INMET[a.nivel] || 'yellow', icone: iconeInmet(a.evento), chave: 'inmet-' + a.id, fonte: 'INMET',
    titulo: `${a.evento} ${periodoInmet(a)}`,
    texto: (completo ? descInmet(a) : resumoInmet(a)) || a.severidade || '',
    extras: outros.map(o => `${maiuscula(periodoInmet(o))}: alerta ${COR_INMET[o.nivel] || 'amarelo'}.${completo && resumoInmet(o) ? ' ' + resumoInmet(o) : ''}`)};
}
function agruparInmet(avisos) {
  const g = new Map();
  avisos.forEach(a => { const k = String(a.evento || '').trim().toLowerCase(); g.set(k, [...(g.get(k) || []), a]); });
  return [...g.values()];
}
async function riscosInmet(loc, completo = false) { return agruparInmet(await avisosInmet(loc)).map(l => riscoInmet(l, completo)); }
// Início: os alertas ficam recolhidos numa linha só (o mais grave + quantos mais há); tocando, abre a lista com os detalhes.
// Fechado: ícone, título e selo do mais grave e "+ 1 alerta: Chuva amanhã…". Aberto: "N alertas de tempo" e a lista completa.
const NIVEIS_RISCO = ['red', 'orange', 'yellow'];
function htmlResumoRiscos(icHtml, tituloHtml, outros) {
  const n = outros.length + 1;
  return `<span class="cr-fechado"><span class="cr-ic" aria-hidden="true">${icHtml}</span><span class="cr-txt"><strong>${tituloHtml}</strong>`
    + `<small>${outros.length ? `+ ${outros.length} ${outros.length === 1 ? 'alerta' : 'alertas'}: ${esc(outros.join(' · '))}` : 'Toque para ver os detalhes'}</small></span></span>`
    + `<span class="cr-aberto"><strong>${n} ${n === 1 ? 'alerta' : 'alertas'} de tempo na fazenda</strong></span>`
    + `<span class="cr-acao"><span class="cr-ver">Detalhes</span><span class="cr-fechar">Fechar</span><svg class="cr-seta" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5.5 15.5 12 9 18.5"/></svg></span>`;
}
function resumoRiscosInicio() {
  const det = document.querySelector('.clima-curto .clima-resumo'), box = det?.querySelector('#climaRiscos'); if (!det || !box) return;
  const rs = [...box.querySelectorAll('.clima-risco')]; det.hidden = !rs.length; if (!rs.length) return;
  const p = rs[0], tit = p.querySelector('strong');
  NIVEIS_RISCO.forEach(c => det.classList.toggle(c, p.classList.contains(c)));
  const outros = rs.slice(1).map(el => el.querySelector('strong')?.firstChild?.textContent.trim()).filter(Boolean);
  det.querySelector('summary').innerHTML = htmlResumoRiscos(p.firstElementChild?.innerHTML || hexRisco('⚠', 'orange'), tit ? tit.innerHTML : '', outros);
}
// Coloca os avisos que chegaram depois (INMET, tempestade) no topo da caixa de alertas, sem repetir, e some o "Tudo em dia"
function juntarRiscos(box, rs) {
  if (!box || !rs.length) return;
  const novos = rs.filter(r => !box.querySelector(`[data-chave="${CSS.escape(r.chave)}"]`)); if (!novos.length) return;
  if (!box.querySelector('.clima-risco')) box.innerHTML = '';
  const t = document.createElement('div'); t.innerHTML = htmlRiscos(novos);
  [...t.children].forEach((el, i) => { el.dataset.chave = novos[i].chave; });
  box.prepend(...t.children);
  box.closest('.ini-atencao')?.querySelectorAll('.ini-ok').forEach(ok => { ok.hidden = true; });
  resumoRiscosInicio();
}

// ---------- Início: só a previsão do dia + alertas de uma linha; o resto fica no MercaClima ----------
const cartaoClimaCompleto = cartaoClima;
function cartaoClimaCurto() {
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null, c = lerClima();
  if (!loc || !c?.dados?.daily) return cartaoClimaCompleto();
  const d = c.dados.daily, i0 = Math.max(0, d.time.indexOf(today())), jan = janelasDoDia(c.dados, d.time[i0]), ch = horariosChuva(c.dados, today());
  const proxChuva = ch.length ? (ch[0].agora ? 'chovendo agora' : `chuva às ${hh2(ch[0].ini)}`) : (() => { const k = d.precipitation_sum.findIndex((mm, i) => i > i0 && mm >= 1); return k > 0 ? `chuva ${nomeDiaCurto(d.time[k])}` : 'sem chuva prevista'; })();
  const rs = riscosClima();
  return `<article class="card panel hoje-clima clima-curto" id="hojeClima">
    <button type="button" class="clima-linha" data-act="nav" data-id="clima"><span class="clima-ic" aria-hidden="true">${hexTempo(iconeDia(c.dados, i0), 42)}</span>
      <span class="clima-txt"><strong>Hoje ${Math.round(d.temperature_2m_max[i0])}° / ${Math.round(d.temperature_2m_min[i0])}°</strong><small class="${jan.janelas.length ? 'ok' : 'nao'}">${jan.janelas.length ? 'Pulverizar ' + jan.janelas.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(', ') : 'Sem janela para pulverizar'} • ${esc(proxChuva)}</small></span><span class="clima-seta" aria-hidden="true">›</span></button>
    <details class="clima-resumo ${rs[0]?.nivel || ''}" ${rs.length ? '' : 'hidden'}><summary>${rs.length ? htmlResumoRiscos(hexRisco(rs[0].icone, rs[0].nivel), `${esc(rs[0].titulo)} <em class="clima-selo ${rs[0].nivel}">${SELO_RISCO[rs[0].nivel] || 'Alerta'}</em>`, rs.slice(1).map(r => r.titulo)) : ''}</summary>
      <div id="climaRiscos">${htmlRiscos(rs)}</div></details>
    <button type="button" class="secondary clima-abrir" data-act="nav" data-id="clima">Detalhar no MercaClima ›</button></article>`;
}
// eslint-disable-next-line no-global-assign
cartaoClima = () => (parseRoute().name === 'clima' ? cartaoClimaCompleto() : cartaoClimaCurto());
async function completarAlertasInicio() {
  const loc = localDaFazenda?.(), box = document.getElementById('climaRiscos'); if (!loc || !box) return;
  resumoRiscosInicio();
  const [tp, inmet] = await Promise.all([tempestadePerto(loc), riscosInmet(loc)]);
  const r = riscoTempestade(tp), rs = [...(r ? [r] : []), ...inmet];
  // vermelho primeiro, depois laranja e amarelo
  const ordem = {red: 0, orange: 1, yellow: 2};
  juntarRiscos(document.getElementById('climaRiscos'), rs.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]));
  resumoRiscosInicio();
}
if (VIEWS.inicio) {
  const depoisSemAlertas = VIEWS.inicio.after;
  VIEWS.inicio.after = (...a) => { depoisSemAlertas?.(...a); completarAlertasInicio(); };
}

// ---------- Tela MercaClima (padrão das prévias): agora, janela de aplicação, 7 dias, umidade e vento; depois mapa e detalhes ----------
const TEXTO_ICONE = {'⛈️': 'Trovoada', '🌧️': 'Chuva', '🌦️': 'Pancadas de chuva', '☁️': 'Nublado', '⛅': 'Parcialmente nublado', '🌤️': 'Poucas nuvens', '☀️': 'Ensolarado', '🌙': 'Céu limpo'};
function climaAgora(dados) {
  const h = dados.hourly, agora = new Date(), hr = agora.getHours();
  let i = h.time.indexOf(`${today()}T${String(hr).padStart(2, '0')}:00`); if (i < 0) i = Math.max(0, h.time.findIndex(t => t.startsWith(today())));
  const noite = hr < 6 || hr >= 19;
  const icone = iconeTempo({prob: h.precipitation_probability?.[i] ?? 0, mm: h.precipitation?.[i] || 0, nuvens: h.cloud_cover?.[i] ?? 50, trov: h.trovoada?.[i] || 0, noite});
  return {t: h.temperature_2m[i], ur: h.relative_humidity_2m[i], v: h.wind_speed_10m[i], raj: h.wind_gusts_10m?.[i], icone, texto: TEXTO_ICONE[icone] || ''};
}
const horasJanela = j => j.janelas.map(([x, y]) => `${hh(x)}–${hh(y)}`).join(', ');
function climaDestaque() {
  const c = lerClima(); if (!c?.dados?.daily || !c.dados.hourly) return '';
  const d = c.dados.daily, i0 = Math.max(0, d.time.indexOf(today())), a = climaAgora(c.dados), nDias = Math.min(7, d.time.length - i0);
  const jan = janelasDoDia(c.dados, d.time[i0]), jan1 = d.time[i0 + 1] ? janelasDoDia(c.dados, d.time[i0 + 1]) : null;
  const [jTit, jTxt, jDia, jCls] = jan.janelas.length ? ['Janela favorável para aplicação hoje', `${horasJanela(jan)} • vento, umidade e Delta T dentro da faixa ideal`, 0, 'ok']
    : jan1?.janelas.length ? ['Janela favorável para aplicação amanhã', `${horasJanela(jan1)} • hoje sem janela boa${jan.principal ? ` (${jan.principal})` : ''}`, 1, 'ok']
    : ['Sem janela boa para aplicação hoje e amanhã', jan.principal ? `Principalmente ${jan.principal}. Confira as condições no campo antes de aplicar.` : 'Confira as condições no campo antes de aplicar.', 0, 'nao'];
  const sel = Math.min(Math.max(0, climaDiaSel), Math.max(0, nDias - 1));
  const nomeD = k => { const dt = new Date(d.time[i0 + k] + 'T12:00:00'); return k === 0 ? 'Hoje' : DIA_SEMANA[dt.getDay()].replace(/^./, x => x.toUpperCase()); };
  const urOk = a.ur >= 50, vOk = a.v >= 3 && a.v <= 10 && (a.raj ?? a.v) < 20;
  const medida = (ic, rot, val, pct, ok, ideal, extra) => `<article class="card cd-medida"><span class="cd-m-ic" aria-hidden="true">${ic}</span><div><small>${rot}</small><b>${val}</b>
    <div class="cd-barra"><span class="${ok ? 'ok' : 'nao'}" style="width:${Math.max(3, Math.min(100, pct))}%"></span></div><small class="cd-ideal">${ideal}${extra ? ' • ' + extra : ''}</small></div></article>`;
  return `<section class="clima-destaque">
    <article class="card cd-agora"><span class="cd-icone" aria-hidden="true">${hexTempo(a.icone, 76)}</span>
      <div><div class="cd-temp">${Math.round(a.t)} °C</div><div class="cd-cond">${esc(a.texto)}</div><small class="cd-sub">Agora • atualizado ${hhmm(new Date(c.em))}</small></div>
      <div class="cd-lado"><div><small>Máx. hoje</small><b>${Math.round(d.temperature_2m_max[i0])} °C</b></div><div><small>Mín. hoje</small><b>${Math.round(d.temperature_2m_min[i0])} °C</b></div><div><small>Chuva hoje</small><b>${num(Math.round((d.precipitation_sum[i0] || 0) * 10) / 10)} mm • ${Math.round(d.precipitation_probability_max[i0] || 0)}%</b></div></div></article>
    <button type="button" class="cd-janela ${jCls}" data-act="clima-dia" data-id="${jDia}"><span class="cd-j-ic" aria-hidden="true">${jCls === 'ok' ? hexGlifo(GLIFOS_RISCO.pulverizar, 'verde', 52) : hexRisco('⚠', 'orange', 52)}</span><span><strong>${esc(jTit)}</strong><small>${esc(jTxt)}</small></span><span class="cd-seta" aria-hidden="true">›</span></button>
    <article class="card cd-semana"><h3>Previsão para os próximos ${nDias} dias</h3>
      <div class="cd-dias" role="group" aria-label="Toque em um dia para ver os detalhes e o mapa daquele dia">${d.time.slice(i0, i0 + nDias).map((t, k) => { const i = i0 + k; return `<button type="button" class="cd-dia ${k === sel ? 'sel' : ''}" data-act="clima-dia" data-id="${k}" aria-pressed="${k === sel}"><b>${nomeD(k)}</b><small>${fmtDate(t).slice(0, 5)}</small><span class="cd-d-ic" aria-hidden="true">${hexTempo(iconeDia(c.dados, i), 32)}</span><b class="cd-max">${Math.round(d.temperature_2m_max[i])}°</b><span class="cd-min">${Math.round(d.temperature_2m_min[i])}°</span><small class="cd-prob">💧 ${Math.round(d.precipitation_probability_max[i] || 0)}%</small></button>`; }).join('')}</div></article>
    <div class="cd-medidas">
      ${medida(hexGlifo(GLIFOS_RISCO.gota, 'azul', 46), 'Umidade do ar', `${Math.round(a.ur)} %`, a.ur, urOk, 'Ideal para aplicação: acima de 50%', urOk ? 'boa agora' : 'baixa agora')}
      ${medida(hexGlifo(GLIFOS_RISCO.vento, 'azul', 46), 'Vento', `${Math.round(a.v)} km/h`, a.v / 30 * 100, vOk, 'Ideal para aplicação: 3 a 10 km/h', a.raj != null ? `rajadas de ${Math.round(a.raj)} km/h` : '')}
    </div>
  </section>`;
}
VIEWS.clima = () => {
  safeStorage.set('agro-clima-aberto', '1'); // previsão sempre aberta nesta tela
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null;
  const local = loc ? `<button type="button" class="cd-local" data-act="nav" data-id="sede" title="Local da fazenda — toque para conferir ou mudar"><span aria-hidden="true">📍</span><span><b>${esc(db.settings.farm || 'Fazenda')}</b><small>${esc(loc.origem || 'local da fazenda')}${loc.fonte === 'aparelho-antigo' ? ' • conferir' : ''}</small></span></button>` : '';
  const topo = head('Clima da fazenda', 'Previsão, mapa do tempo, alertas para as operações e chuvas da fazenda', local + btn('+ Registrar chuva', 'ch-new') + btn('Atualizar previsão', 'clima-atualizar', '', 'secondary')).replace('<section class="view-head">', '<section class="view-head" data-eyebrow="MercaClima">');
  if (!loc) return topo + cartaoClimaCompleto();
  const rs = riscosClima(), chuvas = db.chuvas.slice().sort(byDateDesc), soma = dias => chuvas.filter(x => x.date >= daysAgo(dias)).reduce((t, x) => t + (Number(x.mm) || 0), 0);
  return topo + `<section class="clima-topo">
    <div class="clima-col-dest">${climaDestaque()}</div>
    <div class="clima-col-prev">
      <section class="card panel"><h3 style="margin:0 0 8px">Alertas para as operações</h3><div id="climaRiscos">${rs.length ? htmlRiscos(rs) : '<p class="nota" style="margin:0">Nenhuma condição de tempo atrapalhando as operações programadas.</p>'}</div></section>
      <section class="card panel cd-chuva-card"><div class="section-title" style="margin:0 0 8px"><h3>Chuva registrada</h3><button data-act="nav" data-id="chuva">Ver todas</button></div>
        <div class="lote-nums"><span><small>Últimos 7 dias</small><b>${num(soma(7))} mm</b></span><span><small>Últimos 30 dias</small><b>${num(soma(30))} mm</b></span><span><small>Último registro</small><b>${chuvas[0] ? `${num(chuvas[0].mm)} mm` : '—'}</b><small>${chuvas[0] ? fmtDate(chuvas[0].date) : 'nenhum'}</small></span></div>${chuvas.length ? `<div class="cd-chuvas"><small class="nota">Últimos registros</small>${chuvas.slice(0, 5).map(c => `<div class="cd-chuva"><span>${fmtDate(c.date).slice(0, 5)}${c.hora ? ' ' + esc(c.hora) : ''}</span><span>${esc(c.fieldId ? (typeof fieldName === 'function' ? fieldName(c.fieldId) : '') : 'Sede')}${c.fonte === 'estimativa' ? ' ≈' : ''}</span><b>${num(c.mm)} mm</b></div>`).join('')}</div>` : ''}</section>
    </div></section>
    <section class="clima-tela cd-detalhes cd-largo"><h3 class="cd-det-tit">Detalhes do dia</h3>${cartaoClimaCompleto()}</section>
    <section class="clima-mapa-largo">${painelMapaHTML(false).replace('mt-painel', 'mt-painel mt-tela')}</section>`;
};
// Dia escolhido: marca também nos cartões dos 7 dias
const climaDiaSemDestaque = ACTIONS['clima-dia'];
ACTIONS['clima-dia'] = k => {
  climaDiaSemDestaque?.(k);
  document.querySelectorAll('.cd-dia').forEach(b => { const on = b.dataset.id === String(Number(k) || 0); b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on); });
};
TITLES.clima = 'MercaClima';
VIEWS.clima.after = async () => {
  iniciarMapaTempo();
  const loc = localDaFazenda?.(); if (!loc) return;
  if (typeof buscarClima === 'function') buscarClima();
  const [tp, inmet] = await Promise.all([tempestadePerto(loc), riscosInmet(loc)]);
  const r = riscoTempestade(tp), ordem = {red: 0, orange: 1, yellow: 2};
  juntarRiscos(document.getElementById('climaRiscos'), [...(r ? [r] : []), ...inmet].sort((a, b) => ordem[a.nivel] - ordem[b.nivel]));
};
