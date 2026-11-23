'use strict';
/* MercaPlant — camada técnica sem perder a praticidade.
   Regra de todas as partes: o dado entra sozinho sempre que der; por cima uma linha simples, embaixo "Detalhes" com a conta.
   1. Condições da aplicação: tempo na hora em que a pulverização começa e termina (já gravado), agora com as rajadas,
      mostrado na lista de aplicações e no relatório da safra.
   2. Estádio da lavoura por talhão: soma térmica (graus-dia) desde o plantio para trigo, aveia, cevada e milho;
      soja pelo ciclo da cultivar (fotoperíodo manda mais que a temperatura). O estádio visto no monitoramento vale mais.
   3. Balanço hídrico automático: chuva estimada do dia (ou a leitura do pluviômetro, quando houver) − evapotranspiração
      da cultura (ET0 × Kc do estádio), num "balde" do tamanho da água disponível do solo.
   4. Análise de solo e recomendação pelo Manual de Calagem e Adubação RS/SC (CQFS, 2016): calagem pelo índice SMP,
      interpretação de P e K, adubação do trigo; soja e milho pela tabela que o agrônomo preenche uma vez.
   5. Vigor por satélite (NDVI): média de cada talhão na imagem mais recente com poucas nuvens e o mapa colorido. */

const tecR1 = x => Math.round(x * 10) / 10;
const tecGestor = () => typeof tmGestor !== 'function' || tmGestor();
// Troca a tela mantendo o que ela faz depois de desenhar (.after)
const tecEmbrulhar = (nome, novo) => { const antes = VIEWS[nome]; if (!antes) return; const f = novo(antes); f.after = antes.after; VIEWS[nome] = f; };
const tecCult = f => typeof culturaNorm === 'function' ? culturaNorm(f?.crop) : String(f?.crop || '').toLowerCase();

// ======================= 1. Condições da aplicação =======================
// Mesma leitura da previsão horária guardada, agora com as rajadas e a idade da previsão
if (typeof prodClimaAgora === 'function') {
// eslint-disable-next-line no-global-assign
prodClimaAgora = function () {
  const c = typeof lerClima === 'function' ? lerClima() : null, h = c?.dados?.hourly; if (!h?.time || typeof avaliarHora !== 'function') return null;
  const agora = new Date(), chave = `${today()}T${String(agora.getHours()).padStart(2, '0')}:00`, i = h.time.indexOf(chave); if (i < 0) return null;
  const a = avaliarHora(h, i), raj = h.wind_gusts_10m?.[i];
  return {em: agora.toISOString(), t: tecR1(a.t), ur: Math.round(a.ur), v: tecR1(a.v), raj: raj != null ? Math.round(raj) : null, dt: tecR1(a.dt),
    ok: a.ok, motivos: a.motivos, fonte: 'previsão', previsaoDe: c.em ? new Date(c.em).toISOString() : null};
};
}
const tecClimaTxt = c => !c ? '' : `${num(c.t, 1)} °C • umidade ${num(c.ur)}% • vento ${num(c.v, 1)} km/h${c.raj != null ? ` (rajadas ${num(c.raj)})` : ''} • Delta T ${num(c.dt, 1)}`;
// Pulverizações de qualquer tipo (dessecação, fungicida...) também guardam o tempo, não só "Aplicação"
if (typeof prodAoIniciar === 'function' && typeof prodAoConcluir === 'function') {
  const ini = prodAoIniciar;
  // eslint-disable-next-line no-global-assign
  prodAoIniciar = o => { ini(o); if (!o.climaIni && typeof pulverizacao === 'function' && pulverizacao(o)) { const c = prodClimaAgora(); if (c) o.climaIni = c; } };
  const fim = prodAoConcluir;
  // eslint-disable-next-line no-global-assign
  prodAoConcluir = o => { fim(o); if (!o.climaFim && typeof pulverizacao === 'function' && pulverizacao(o)) { const c = prodClimaAgora(); if (c) o.climaFim = c; } };
}
// Condições de uma aplicação (pela operação que a lançou): simples (✓/⚠) e o texto técnico
function tecCondicoesAplicacao(a) {
  const o = a?.opId ? find('operations', a.opId) : null, ci = o?.climaIni, cf = o?.climaFim;
  if (!ci && !cf) return null;
  const ok = [ci, cf].filter(Boolean).every(c => c.ok), motivos = [...new Set([ci, cf].filter(Boolean).flatMap(c => c.motivos || []))];
  return {ok, motivos, ini: ci, fim: cf, txt: [ci && `Início ${hhmm(new Date(ci.em))}: ${tecClimaTxt(ci)}`, cf && `Fim ${hhmm(new Date(cf.em))}: ${tecClimaTxt(cf)}`].filter(Boolean).join(' | ')};
}
const tecSeloCondicao = c => !c ? '<span class="nota">—</span>' : `<span class="tec-cond ${c.ok ? 'ok' : 'ruim'}" title="${esc(c.txt)}">${c.ok ? '✓ Na janela' : '⚠ Fora da janela'}</span><small class="tec-cond-txt">${esc(c.ok ? c.txt : `${c.motivos.join(', ')} • ${c.txt}`)}</small>`;
// Lista de aplicações: coluna "Condições"
tecEmbrulhar('aplicacoes', apSemCond => (...args) => {
    const html = apSemCond(...args);
    if (!html.includes('<th>Colheita liberada</th>')) return html;
    const t = document.createElement('template'); t.innerHTML = html;
    const tab = t.content.querySelector('table.tbl'); if (!tab) return html;
    tab.querySelector('thead tr th:last-child')?.insertAdjacentHTML('beforebegin', '<th>Condições na aplicação</th>');
    const lista = db.aplicacoes.slice().sort(byDateDesc);
    [...tab.querySelectorAll('tbody tr')].forEach((tr, k) => tr.lastElementChild?.insertAdjacentHTML('beforebegin', `<td class="tec-cond-td">${tecSeloCondicao(tecCondicoesAplicacao(lista[k]))}</td>`));
    return t.innerHTML;
});

// ======================= Histórico do tempo (para estádio e balanço hídrico) =======================
// Últimos 92 dias pela previsão (dados observados/analisados); antes disso, o arquivo histórico. Guardado 6 h no aparelho.
const TEC_HIST = 'agro-clima-hist';
const tecLerHist = () => { try { return JSON.parse(safeStorage.get(TEC_HIST) || 'null'); } catch { return null; } };
let tecHistPedido = null;
function tecDesdeNecessario() {
  const plantios = (db.fields || []).filter(f => f.plantingDate && (typeof emCiclo !== 'function' || emCiclo(f))).map(f => f.plantingDate);
  const min = plantios.sort()[0], padrao = addDias(today(), -92);
  return min && min < padrao ? (min < addDias(today(), -210) ? addDias(today(), -210) : min) : padrao;
}
function tecJuntar(daily, dias) {
  (daily?.time || []).forEach((d, i) => {
    const x = {tmax: daily.temperature_2m_max?.[i], tmin: daily.temperature_2m_min?.[i], chuva: daily.precipitation_sum?.[i], et0: daily.et0_fao_evapotranspiration?.[i]};
    if (x.tmax == null && x.chuva == null) return;
    dias[d] = {...(dias[d] || {}), ...Object.fromEntries(Object.entries(x).filter(([, v]) => v != null))};
  });
}
function tecHistorico(forcar = false) {
  const loc = typeof localDaFazenda === 'function' ? localDaFazenda() : null, h = tecLerHist(), desde = tecDesdeNecessario();
  if (!loc || navigator.onLine === false) return Promise.resolve(h);
  const ok = h && Math.abs(h.lat - loc.lat) < 0.01 && Math.abs(h.lon - loc.lon) < 0.01 && (h.desde || '9999') <= desde;
  if (!forcar && ok && Date.now() - h.em < 6 * 3600000) return Promise.resolve(h);
  if (tecHistPedido) return tecHistPedido;
  const p = {latitude: loc.lat.toFixed(4), longitude: loc.lon.toFixed(4), timezone: 'auto', daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration'};
  const pedir = url => fetch(url).then(r => r.ok ? r.json() : Promise.reject(new Error('hist ' + r.status)));
  tecHistPedido = (async () => {
    const rec = await pedir('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({...p, past_days: '92', forecast_days: '1'}));
    const dias = {}; tecJuntar(rec.daily, dias);
    const ini = rec.daily?.time?.[0];
    if (ini && desde < ini) {
      const arq = await pedir('https://archive-api.open-meteo.com/v1/archive?' + new URLSearchParams({...p, start_date: desde, end_date: addDias(ini, -1)})).catch(() => null);
      if (arq?.daily) tecJuntar(arq.daily, dias);
    }
    const novo = {em: Date.now(), lat: loc.lat, lon: loc.lon, desde: Object.keys(dias).sort()[0] || desde, dias};
    safeStorage.set(TEC_HIST, JSON.stringify(novo));
    return novo;
  })().catch(() => h).finally(() => { tecHistPedido = null; });
  return tecHistPedido;
}

// ======================= 2. Estádio da lavoura =======================
// Soma térmica: média do dia (máx. limitada ao teto, mín. limitada à base) menos a temperatura-base.
// Valores de referência para cultivares de ciclo médio no Sul; a conta é uma estimativa e o campo confirma.
const TEC_FENO = {
  trigo: {base: 0, teto: 35, est: [[0, 'Semeado', 'semente no solo'], [140, 'Emergência', 'plantas saindo'], [350, 'Afilhamento', 'perfilhos aparecendo'], [650, 'Alongamento', '1º nó visível'],
    [950, 'Emborrachamento', 'espiga dentro da bainha'], [1100, 'Espigamento', 'espigas aparecendo'], [1200, 'Floração', 'anteras expostas'], [1400, 'Grão leitoso', ''], [1600, 'Grão em massa', ''], [1900, 'Maturação', 'perto da colheita']]},
  milho: {base: 10, teto: 30, est: [[0, 'Semeado', 'semente no solo'], [70, 'VE', 'emergência'], [190, 'V4', '4 folhas'], [380, 'V8', '8 folhas'], [560, 'V12', '12 folhas'], [750, 'VT', 'pendoamento'],
    [800, 'R1', 'embonecamento'], [920, 'R2', 'grão bolha'], [1020, 'R3', 'grão leitoso'], [1120, 'R4', 'grão pastoso'], [1250, 'R5', 'grão dentado'], [1450, 'R6', 'maturidade fisiológica']]}
};
TEC_FENO.aveia = TEC_FENO.cevada = TEC_FENO.triticale = TEC_FENO.trigo;
// Soja: fração do ciclo da cultivar (dias após o plantio ÷ ciclo)
const TEC_SOJA = [[0, 'Semeada', 'semente no solo'], [0.05, 'VE', 'emergência'], [0.15, 'V3', '3º trifólio'], [0.27, 'V6', '6º trifólio'], [0.38, 'R1', 'início da floração'],
  [0.43, 'R2', 'floração plena'], [0.50, 'R3', 'início da formação de vagens'], [0.57, 'R4', 'vagens formadas'], [0.64, 'R5', 'início do enchimento de grãos'],
  [0.76, 'R6', 'grãos cheios'], [0.88, 'R7', 'início da maturação'], [0.96, 'R8', 'maturação plena']];
const tecPosicao = (tab, v) => { let i = 0; tab.forEach((e, k) => { if (v >= e[0]) i = k; }); return i; };
function tecGrausDia(desde, t, h = tecLerHist()) {
  const dias = h?.dias || {}, ontem = addDias(today(), -1); let soma = 0, n = 0, falta = 0, d = desde;
  const porDia = [];
  while (d <= ontem) {
    const x = dias[d];
    if (x?.tmax != null && x?.tmin != null) { const g = Math.max(0, (Math.min(x.tmax, t.teto) + Math.max(x.tmin, t.base)) / 2 - t.base); soma += g; n++; porDia.push(g); } else falta++;
    d = addDias(d, 1);
  }
  if (!n) return null;
  // Dias sem dado (fora do histórico): estima pela média dos dias conhecidos
  const media = soma / n; soma += falta * media;
  const ult = porDia.slice(-7), media7 = ult.length ? ult.reduce((a, b) => a + b, 0) / ult.length : media;
  return {soma: Math.round(soma), dias: n, falta, media7};
}
function estadioTalhao(f) {
  if (!f?.plantingDate || (typeof emCiclo === 'function' && !emCiclo(f))) return null;
  const cult = tecCult(f), dap = Math.max(0, diasEntreAuto(f.plantingDate, today()));
  const mon = (db.monitoramentos || []).filter(m => m.fieldId === f.id && String(m.estadio || '').trim() && (m.date || '') >= f.plantingDate && (m.date || '') >= addDias(today(), -10)).sort(byDateDesc)[0];
  let r;
  if (cult === 'soja') {
    const ciclo = Number(f.ciclo) > 0 ? Number(f.ciclo) : 125, frac = dap / ciclo, i = tecPosicao(TEC_SOJA, frac), e = TEC_SOJA[i], p = TEC_SOJA[i + 1];
    r = {cod: e[1], desc: e[2], metodo: 'ciclo', ciclo, cicloInformado: Number(f.ciclo) > 0, frac: Math.min(1, frac), dap,
      prox: p ? {cod: p[1], desc: p[2], emDias: Math.max(1, Math.round(p[0] * ciclo - dap))} : null};
  } else if (TEC_FENO[cult]) {
    const t = TEC_FENO[cult], g = tecGrausDia(f.plantingDate, t);
    if (!g) r = {metodo: 'sem-dados', dap};
    else {
      const i = tecPosicao(t.est, g.soma), e = t.est[i], p = t.est[i + 1], fim = t.est[t.est.length - 1][0];
      r = {cod: e[1], desc: e[2], metodo: 'graus-dia', gdd: g.soma, base: t.base, frac: Math.min(1, g.soma / fim), dap, estimados: g.falta,
        prox: p ? {cod: p[1], desc: p[2], emDias: g.media7 > 0.5 ? Math.max(1, Math.ceil((p[0] - g.soma) / g.media7)) : null, gdd: p[0]} : null};
    }
  } else r = {metodo: 'dias', dap, frac: Number(f.ciclo) > 0 ? Math.min(1, dap / Number(f.ciclo)) : null};
  if (mon) r.observado = {estadio: String(mon.estadio).trim(), date: mon.date};
  return r;
}
// "R1 — início da floração" / "Alongamento — 1º nó visível"
const tecEstadioTxt = r => !r ? '' : r.observado ? `${r.observado.estadio} (visto em ${fmtDate(r.observado.date).slice(0, 5)})`
  : r.cod ? `${r.cod}${r.desc && r.desc !== r.cod ? ' — ' + r.desc : ''}` : `${r.dap} ${r.dap === 1 ? 'dia' : 'dias'} após o plantio`;
function tecEstadioDetalhe(r, f) {
  if (!r) return '';
  const l = [];
  if (r.metodo === 'graus-dia') l.push(`Soma térmica desde o plantio: <b>${num(r.gdd)} °C·dia</b> (base ${r.base} °C), ${r.dap} dias.${r.estimados ? ` ${r.estimados} dias sem dado foram estimados pela média.` : ''}`);
  if (r.metodo === 'ciclo') l.push(`Pelo ciclo ${r.cicloInformado ? `de ${r.ciclo} dias da cultivar` : `padrão de ${r.ciclo} dias (informe o ciclo da cultivar no talhão para acertar)`}: ${r.dap} dias, ${Math.round(r.frac * 100)}% do ciclo. Na soja o fotoperíodo pesa mais que a temperatura.`);
  if (r.metodo === 'sem-dados') l.push('Sem o histórico do tempo neste aparelho ainda; aparece quando a internet voltar.');
  if (r.prox) l.push(`Próximo: <b>${esc(r.prox.cod)}</b>${r.prox.desc ? ` (${esc(r.prox.desc)})` : ''}${r.prox.emDias ? ` em ~${r.prox.emDias} ${r.prox.emDias === 1 ? 'dia' : 'dias'}` : ''}${r.prox.gdd ? ` — aos ${num(r.prox.gdd)} °C·dia` : ''}.`);
  if (r.observado && r.cod) l.push(`A conta indicava ${esc(r.cod)}; vale o que foi visto no monitoramento.`);
  l.push('Estimativa para cultivares de ciclo médio. Confirme no campo e registre o estádio no monitoramento.');
  return l.map(x => `<p>${x}</p>`).join('');
}

// ======================= 3. Balanço hídrico =======================
// Água disponível no solo (CAD, mm) e coeficiente da cultura pela fase do ciclo (FAO-56, simplificado)
const TEC_SOLOS = [['40', 'Arenoso (40 mm)'], ['60', 'Médio (60 mm)'], ['75', 'Argiloso (75 mm) — padrão'], ['90', 'Muito argiloso (90 mm)']];
const tecCad = () => Number(db.settings.cadSolo) > 0 ? Number(db.settings.cadSolo) : 75;
const tecKc = frac => frac == null ? 0.5 : frac < 0.15 ? 0.4 : frac < 0.4 ? 0.4 + (frac - 0.15) / 0.25 * 0.7 : frac < 0.8 ? 1.1 : Math.max(0.5, 1.1 - (frac - 0.8) / 0.2 * 0.6);
// Leitura do pluviômetro no dia (do talhão; senão da sede). Estimativas não contam como leitura.
function tecChuvaLida(d, f) {
  const lidas = (db.chuvas || []).filter(c => c.date === d && c.fonte !== 'estimativa');
  const doTalhao = f ? lidas.filter(c => c.fieldId === f.id) : [], sede = lidas.filter(c => !c.fieldId);
  const usar = doTalhao.length ? doTalhao : sede;
  return usar.length ? usar.reduce((t, c) => t + (Number(c.mm) || 0), 0) : null;
}
function balancoHidrico(f = null, h = tecLerHist()) {
  const dias = h?.dias; if (!dias) return null;
  const cad = tecCad(), hoje = today(), datas = Object.keys(dias).sort().filter(d => d < hoje).slice(-60);
  if (datas.length < 10) return null;
  const est = f ? estadioTalhao(f) : null, plantio = f?.plantingDate || '';
  let arm = cad, def = 0, lidos7 = 0, chuva7 = 0, etc7 = 0, chuva30 = 0;
  const serie = [];
  datas.forEach((d, k) => {
    const x = dias[d], lida = tecChuvaLida(d, f), p = lida != null ? lida : Number(x.chuva) || 0;
    // Kc do dia: antes do plantio (ou sem cultura) palhada/pousio; depois, pela fase do ciclo naquele dia
    let frac = null;
    if (f && plantio && d >= plantio && est?.frac != null) { const dapHoje = Math.max(1, est.dap), dapD = diasEntreAuto(plantio, d); frac = Math.min(1, est.frac * dapD / dapHoje); }
    const kc = f && plantio && d >= plantio ? tecKc(frac) : 0.5, etc = (Number(x.et0) || 0) * kc;
    arm = Math.min(cad, Math.max(0, arm + p - etc));
    def = arm / cad < 0.4 ? def + 1 : 0;
    const ult = datas.length - k;
    if (ult <= 7) { chuva7 += p; etc7 += etc; if (lida != null) lidos7++; }
    if (ult <= 30) chuva30 += p;
    serie.push({d, p, etc, arm, lida: lida != null});
  });
  const pct = arm / cad, nivel = pct >= 0.7 ? 'boa' : pct >= 0.4 ? 'secando' : 'deficit';
  return {cad, arm: Math.round(arm), pct, nivel, diasDeficit: def, chuva7: tecR1(chuva7), etc7: tecR1(etc7), chuva30: Math.round(chuva30), lidos7,
    kcHoje: f && plantio ? tecR1(tecKc(est?.frac ?? null) * 100) / 100 : 0.5, serie: serie.slice(-14)};
}
const TEC_NIVEL_AGUA = {boa: ['Boa umidade', 'ok'], secando: ['Secando', 'atencao'], deficit: ['Déficit de água', 'ruim']};
const tecAguaTxt = b => !b ? '' : `${TEC_NIVEL_AGUA[b.nivel][0]} (${Math.round(b.pct * 100)}%)${b.nivel === 'deficit' && b.diasDeficit > 1 ? ` há ${b.diasDeficit} dias` : ''}`;
function tecAguaDetalhe(b) {
  if (!b) return '';
  const max = Math.max(1, ...b.serie.map(s => Math.max(s.p, s.etc)));
  const barras = `<div class="tec-barras" role="img" aria-label="Chuva e consumo de água nos últimos 14 dias">${b.serie.map(s => `<span title="${fmtDate(s.d).slice(0, 5)}: chuva ${num(tecR1(s.p), 1)} mm${s.lida ? ' (pluviômetro)' : ' (≈ estimada)'} • consumo ${num(tecR1(s.etc), 1)} mm"><i class="ch ${s.lida ? '' : 'est'}" style="height:${Math.round(s.p / max * 100)}%"></i><i class="et" style="height:${Math.round(s.etc / max * 100)}%"></i></span>`).join('')}</div>
    <div class="tec-leg"><span><i class="ch"></i>Chuva</span><span><i class="ch est"></i>Chuva ≈ estimada</span><span><i class="et"></i>Consumo da lavoura</span></div>`;
  return `${barras}<p>Água no solo: <b>${num(b.arm)} de ${num(b.cad)} mm</b> disponíveis. Últimos 7 dias: chuva ${num(b.chuva7, 1)} mm × consumo ${num(b.etc7, 1)} mm (coeficiente da cultura hoje ${num(b.kcHoje, 2)}). Chuva em 30 dias: ${num(b.chuva30)} mm.</p>
    <p>${b.lidos7 ? `${b.lidos7} dos últimos 7 dias com leitura do pluviômetro; os outros, chuva ≈ estimada.` : 'Chuva dos últimos dias ≈ estimada pela previsão; registrar o pluviômetro deixa a conta mais certa.'} Capacidade de água do solo: ${num(b.cad)} mm (Ajustes → Agronomia).</p>`;
}

// ======================= 4. Análise de solo (CQFS-RS/SC, 2016) =======================
// Índice SMP → calcário (t/ha, PRNT 100%) para pH em água 6,0 (camada 0–20 cm)
const TEC_SMP60 = {4.4: 21.0, 4.5: 17.3, 4.6: 15.1, 4.7: 13.3, 4.8: 11.9, 4.9: 10.7, 5.0: 9.9, 5.1: 9.1, 5.2: 8.3, 5.3: 7.5, 5.4: 6.8, 5.5: 6.1, 5.6: 5.4, 5.7: 4.8, 5.8: 4.2,
  5.9: 3.7, 6.0: 3.2, 6.1: 2.7, 6.2: 2.2, 6.3: 1.8, 6.4: 1.4, 6.5: 1.1, 6.6: 0.8, 6.7: 0.5, 6.8: 0.3, 6.9: 0.2, 7.0: 0.0};
const tecSmpDose = smp => { const s = Math.round(Number(smp) * 10) / 10; return !(s > 0) ? null : s <= 4.4 ? 21 : s >= 7 ? 0 : TEC_SMP60[s.toFixed(1)] ?? null; };
const TEC_CLASSES = ['Muito baixo', 'Baixo', 'Médio', 'Alto', 'Muito alto'];
// P (Mehlich-1, mg/dm³) pela classe de argila; K (mg/dm³) pela CTC a pH 7 (cmolc/dm³)
const TEC_P = {1: [3, 6, 9, 12], 2: [4, 8, 12, 24], 3: [6, 12, 18, 36], 4: [10, 20, 30, 60]};
const TEC_K = [[7.5, [20, 40, 60, 120]], [15, [30, 60, 90, 180]], [30, [40, 80, 120, 240]], [Infinity, [45, 90, 135, 270]]];
const tecClasseArgila = a => a > 60 ? 1 : a > 40 ? 2 : a > 20 ? 3 : 4;
const tecInterp = (v, lim) => v <= lim[0] ? 0 : v <= lim[1] ? 1 : v <= lim[2] ? 2 : v <= lim[3] ? 3 : 4;
const tecN = v => v === '' || v == null ? NaN : Number(String(v).replace(',', '.'));
// Trigo e triticale (RS/SC): P2O5 e K2O por classe, 1º e 2º cultivo, para 3 t/ha; acima, +15 P2O5 e +10 K2O por tonelada
const TEC_TRIGO = {ref: 3, extraP: 15, extraK: 10, p1: [155, 95, 85, 45, 0], p2: [95, 75, 45, 45, 45], k1: [110, 70, 60, 30, 0], k2: [70, 50, 30, 30, 30]};
// Soja e milho: o agrônomo preenche as doses da tabela do manual (Ajustes → Agronomia); a soja já vem com o que é fixo
const tecTabelaPadrao = c => c === 'Soja' ? {ref: 3, extraP: 15, extraK: 25} : {ref: '', extraP: '', extraK: ''};
const tecTabela = c => c === 'Trigo' ? TEC_TRIGO : {...tecTabelaPadrao(c), ...(db.settings.tabelaAdubo?.[c] || {})};
function recomendacaoSolo(a) {
  if (!a) return null;
  const ph = tecN(a.phAgua), smp = tecN(a.smp), v = tecN(a.v), mAl = tecN(a.mAl), prnt = tecN(a.prnt) > 0 ? tecN(a.prnt) : 100, sist = a.sistema || 'consolidado';
  const out = {cal: null, p: null, k: null, adubo: null, avisos: []};
  // Calagem
  if (!(ph > 0)) out.cal = {txt: 'Informe o pH em água'};
  else if (ph >= 5.5) out.cal = {dose: 0, txt: 'Sem calcário', porque: `pH em água ${num(ph, 1)} (calagem só abaixo de 5,5).`};
  else if (sist === 'consolidado' && v >= 65 && mAl < 10) out.cal = {dose: 0, txt: 'Sem calcário', porque: `pH ${num(ph, 1)}, mas V ${num(v)}% (≥ 65%) e saturação por Al ${num(mAl)}% (< 10%): o manual não indica aplicar.`};
  else {
    const d100 = tecSmpDose(smp);
    if (d100 == null) out.cal = {txt: 'Informe o índice SMP'};
    else {
      const sup = sist === 'consolidado', lim = sup && d100 > 5, d = (lim ? 5 : d100) * 100 / prnt;
      out.cal = {dose: tecR1(d), txt: `${num(tecR1(d), 1)} t/ha de calcário`, como: sup ? 'na superfície, sem incorporar' : 'incorporado (0–20 cm)',
        porque: `pH ${num(ph, 1)} < 5,5. Índice SMP ${num(smp, 1)} → ${num(d100, 1)} t/ha (PRNT 100%) para pH 6,0${lim ? '; na superfície o limite é 5 t/ha' : ''}; com PRNT ${num(prnt)}%: ${num(tecR1(d), 1)} t/ha.`};
    }
  }
  // P e K
  const argila = tecN(a.argila), p = tecN(a.p), k = tecN(a.k), ctc = tecN(a.ctc);
  if (argila >= 0 && p >= 0) { const cl = tecClasseArgila(argila); out.p = {i: tecInterp(p, TEC_P[cl]), porque: `P ${num(p, 1)} mg/dm³, argila ${num(argila)}% (classe ${cl})`}; }
  if (ctc > 0 && k >= 0) { const lim = TEC_K.find(([max]) => ctc <= max)[1]; out.k = {i: tecInterp(k, lim), porque: `K ${num(k)} mg/dm³, CTC pH 7 ${num(ctc, 1)} cmolc/dm³`}; }
  // Adubação de P e K (e N no trigo) para a cultura escolhida
  const cult = a.cultura || '', t = tecTabela(cult), exp = tecN(a.expectativa) > 0 ? tecN(a.expectativa) : Number(t.ref) || 3, seg = a.cultivo === '2';
  if (cult && out.p && out.k) {
    const pTab = (seg ? t.p2 : t.p1)?.[out.p.i], kTab = (seg ? t.k2 : t.k1)?.[out.k.i];
    if (pTab === '' || pTab == null || kTab === '' || kTab == null) out.adubo = {falta: true, cult};
    else {
      const extra = Math.max(0, exp - (Number(t.ref) || 0)), P = Math.round(Number(pTab) + extra * (Number(t.extraP) || 0)), K = Math.round(Number(kTab) + extra * (Number(t.extraK) || 0));
      out.adubo = {cult, P, K, exp, porque: `${cult}, ${seg ? '2º' : '1º'} cultivo após a análise, expectativa de ${num(exp, 1)} t/ha (tabela para ${num(Number(t.ref), 1)} t/ha${extra ? `, + ${num(t.extraP)} kg de P₂O₅ e ${num(t.extraK)} kg de K₂O por tonelada a mais` : ''}).`};
      if (cult === 'Trigo') {
        const mo = tecN(a.mo), aposMilho = a.precedente === 'Milho';
        if (mo >= 0) { const base = mo <= 2.5 ? (aposMilho ? 80 : 60) : mo <= 5 ? (aposMilho ? 60 : 40) : 20; out.adubo.N = Math.round(base + Math.max(0, exp - 3) * (aposMilho ? 30 : 20)); out.adubo.porqueN = `MO ${num(mo, 1)}%, depois de ${aposMilho ? 'milho' : 'soja'}: 15 a 20 kg/ha na semeadura e o resto em cobertura, do afilhamento ao alongamento.`; }
      }
      if (cult === 'Soja' && (P > 120 || K > 80)) out.avisos.push('Na linha da soja, no máximo 120 kg/ha de P₂O₅ e 80 kg/ha de K₂O; o restante a lanço antes da semeadura ou em cobertura (V2–V3).');
    }
  }
  return out;
}
const tecUltimaAnalise = f => (db.analisesSolo || []).filter(a => a.fieldId === f.id).sort(byDateDesc)[0] || null;
function tecSoloTxt(r) {
  if (!r) return '';
  return [r.cal?.dose != null ? (r.cal.dose > 0 ? `Calcário ${num(r.cal.dose, 1)} t/ha` : 'Sem calcário') : '', r.p ? `P ${TEC_CLASSES[r.p.i].toLowerCase()}` : '', r.k ? `K ${TEC_CLASSES[r.k.i].toLowerCase()}` : ''].filter(Boolean).join(' • ');
}
function tecSoloDetalhe(a, r) {
  if (!a || !r) return '';
  const l = [];
  if (r.cal) l.push(`<b>Calagem:</b> ${esc(r.cal.txt)}${r.cal.como ? `, ${esc(r.cal.como)}` : ''}. ${esc(r.cal.porque || '')}`);
  if (r.p) l.push(`<b>Fósforo:</b> ${TEC_CLASSES[r.p.i]} — ${esc(r.p.porque)}.`);
  if (r.k) l.push(`<b>Potássio:</b> ${TEC_CLASSES[r.k.i]} — ${esc(r.k.porque)}.`);
  if (r.adubo?.falta) l.push(`<b>Adubação da ${esc(r.adubo.cult.toLowerCase())}:</b> preencha uma vez as doses da tabela do manual em Ajustes → Agronomia; depois a conta sai sozinha.`);
  else if (r.adubo) l.push(`<b>Adubação (${esc(r.adubo.cult)}):</b> ${num(r.adubo.P)} kg/ha de P₂O₅ e ${num(r.adubo.K)} kg/ha de K₂O${r.adubo.N != null ? ` + ${num(r.adubo.N)} kg/ha de N` : ''}. ${esc(r.adubo.porque)}${r.adubo.porqueN ? ' N: ' + esc(r.adubo.porqueN) : ''}`);
  r.avisos.forEach(x => l.push(esc(x)));
  l.push(`Análise de ${fmtDate(a.date)}${a.laboratorio ? ` (${esc(a.laboratorio)})` : ''}, ${esc(TEC_SISTEMAS.find(([k]) => k === (a.sistema || 'consolidado'))?.[1] || '')}. Critérios do Manual de Calagem e Adubação RS/SC (2016); o agrônomo confirma.`);
  return l.map(x => `<p>${x}</p>`).join('');
}
const TEC_SISTEMAS = [['consolidado', 'Plantio direto consolidado (amostra 0–10 cm)'], ['implantacao', 'Implantação do plantio direto (0–20 cm)'], ['convencional', 'Preparo convencional (0–20 cm)']];
function analiseSoloForm(a = {}, fieldId = '') {
  const ult = fieldId ? tecUltimaAnalise({id: fieldId}) : null;
  openForm({title: a.id ? 'Editar análise de solo' : 'Análise de solo', sub: 'Copie os números do laudo. A recomendação sai na hora, pelo manual RS/SC.',
    values: {date: today(), fieldId, sistema: ult?.sistema || 'consolidado', prnt: ult?.prnt || 80, cultura: '', cultivo: '1', expectativa: '', precedente: 'Soja', ...a},
    fields: [{k: 'fieldId', label: 'Talhão', type: 'select', required: true, full: true, options: typeof fieldOptions === 'function' ? fieldOptions : () => db.fields.map(f => ({value: f.id, label: f.name}))},
      {k: 'date', label: 'Data da coleta', type: 'date', required: true}, {k: 'laboratorio', label: 'Laboratório', mais: true},
      {k: 'sistema', label: 'Sistema', type: 'select', full: true, options: TEC_SISTEMAS.map(([value, label]) => ({value, label}))},
      {k: 'phAgua', label: 'pH em água', type: 'number', min: 3, max: 9, step: 0.1, required: true}, {k: 'smp', label: 'Índice SMP', type: 'number', min: 4, max: 7.5, step: 0.1},
      {k: 'argila', label: 'Argila (%)', type: 'number', min: 0, max: 100}, {k: 'mo', label: 'Matéria orgânica (%)', type: 'number', min: 0, max: 20, step: 0.1},
      {k: 'p', label: 'P Mehlich-1 (mg/dm³)', type: 'number', min: 0, step: 0.1}, {k: 'k', label: 'K (mg/dm³)', type: 'number', min: 0},
      {k: 'ctc', label: 'CTC pH 7 (cmolc/dm³)', type: 'number', min: 0, step: 0.1}, {k: 'v', label: 'Saturação por bases V (%)', type: 'number', min: 0, max: 100},
      {k: 'mAl', label: 'Saturação por Al (%)', type: 'number', min: 0, max: 100}, {k: 'prnt', label: 'PRNT do calcário (%)', type: 'number', min: 40, max: 130, hint: 'Do calcário que vai ser usado'},
      {k: 'cultura', label: 'Próxima cultura', type: 'select', options: [{value: '', label: 'Só calagem e interpretação'}, 'Soja', 'Milho', 'Trigo']},
      {k: 'expectativa', label: 'Produtividade esperada (t/ha)', type: 'number', min: 0, step: 0.1, hint: 'Em branco: a da tabela'},
      {k: 'cultivo', label: 'Cultivo', type: 'select', options: [{value: '1', label: '1º cultivo após a análise'}, {value: '2', label: '2º cultivo'}]},
      {k: 'precedente', label: 'Cultura anterior (para o N do trigo)', type: 'select', options: ['Soja', 'Milho'], mais: true}],
    submit: 'Salvar análise',
    onSubmit: v => {
      const reg = {...a, ...v, id: a.id || uid()};
      if (!(tecN(reg.phAgua) > 0)) return 'Informe o pH em água';
      if (tecN(reg.phAgua) < 5.5 && !(tecN(reg.smp) > 0)) return 'Com pH abaixo de 5,5, informe o índice SMP para calcular o calcário';
      upsert('analisesSolo', reg);
      const r = recomendacaoSolo(reg); showToast(`Análise salva — ${tecSoloTxt(r) || 'recomendação no talhão'}`);
    }});
}
ACTIONS['solo-nova'] = id => analiseSoloForm({}, id || '');
ACTIONS['solo-editar'] = id => { const a = find('analisesSolo', id); if (a) analiseSoloForm(a, a.fieldId); };
ACTIONS['solo-excluir'] = id => confirmDialog('Excluir esta análise de solo?', () => { remove('analisesSolo', id); showToast('Análise excluída'); render(); }, 'Excluir');

// ======================= 5. Vigor por satélite (NDVI) =======================
const TEC_NDVI = 'agro-ndvi';
const tecLerNdvi = () => { try { return JSON.parse(safeStorage.get(TEC_NDVI) || 'null'); } catch { return null; } };
const tecContornos = () => (db.fields || []).filter(f => !f.inactive && !f.inativo && f.contorno?.pontos?.length > 2);
const tecChaveNdvi = fs => fs.map(f => `${f.id}:${f.contorno.pontos.length}:${f.contorno.pontos[0]}`).join('|');
let tecNdviPedido = null;
function tecNdvi(forcar = false) {
  const fs = tecContornos(), atual = tecLerNdvi(), chave = tecChaveNdvi(fs);
  if (!fs.length || typeof NUVEM === 'undefined' || navigator.onLine === false) return Promise.resolve(atual);
  if (!forcar && atual?.chave === chave && Date.now() - atual.em < 12 * 3600000) return Promise.resolve(atual);
  if (tecNdviPedido) return tecNdviPedido;
  tecNdviPedido = fetch(`${NUVEM.url}/functions/v1/satelite?acao=ndvi`, {method: 'POST', headers: {'Content-Type': 'application/json', apikey: NUVEM.chave},
    body: JSON.stringify({talhoes: fs.slice(0, 80).map(f => ({id: f.id, pontos: f.contorno.pontos.map(p => [Number(p[0]), Number(p[1])])}))})})
    .then(r => r.ok ? r.json() : Promise.reject(new Error('ndvi ' + r.status)))
    .then(d => { const novo = {em: Date.now(), chave, ...d}; safeStorage.set(TEC_NDVI, JSON.stringify(novo)); return novo; })
    .catch(() => atual).finally(() => { tecNdviPedido = null; });
  return tecNdviPedido;
}
const TEC_VIGOR = [[0.7, 'Alto', '#1a9850'], [0.5, 'Bom', '#66bd63'], [0.3, 'Médio', '#d9ef8b'], [0.15, 'Baixo', '#fdae61'], [-1, 'Solo exposto ou palhada', '#d73027']];
const tecVigorDe = v => TEC_VIGOR.find(([min]) => v >= min);
function vigorTalhao(f, n = tecLerNdvi()) {
  const t = n?.talhoes?.find(x => x.id === f.id); if (!t || t.ndvi == null) return null;
  const [, rot, cor] = tecVigorDe(t.ndvi); return {ndvi: t.ndvi, desvio: t.desvio, rot, cor, data: n.data, nuvens: n.nuvens};
}
const tecVigorTxt = v => !v ? '' : `${v.rot} (${num(v.ndvi, 2)}) • imagem de ${fmtDate(String(v.data).slice(0, 10)).slice(0, 5)}`;
function tecVigorDetalhe(v, f) {
  if (!v) return '';
  const est = estadioTalhao(f), cedo = est?.frac != null && est.frac < 0.25;
  return `<p>Índice de vegetação (NDVI) médio do talhão: <b>${num(v.ndvi, 2)}</b>${v.desvio != null ? `, variação ±${num(v.desvio, 2)}` : ''} na imagem de ${fmtDate(String(v.data).slice(0, 10))} (${num(v.nuvens)}% de nuvens na cena).</p>
    <p>Quanto mais perto de 1, mais folha verde. Variação alta indica manchas: veja no mapa (modo Vigor) onde a lavoura está mais fraca.${cedo ? ' No começo do ciclo o índice é baixo mesmo: compare entre talhões da mesma idade.' : ''}</p>`;
}
// Mapa do Início: modo "Vigor" (talhões pela média e o mapa colorido por cima)
if (typeof I2_MODOS !== 'undefined' && !I2_MODOS.some(([k]) => k === 'vigor')) I2_MODOS.push(['vigor', 'Vigor']);
if (typeof I2_LEGENDA !== 'undefined') I2_LEGENDA.vigor = TEC_VIGOR.map(([, rot, cor]) => [cor, rot]);
if (typeof i2Pintura === 'function') {
  const pintSemVigor = i2Pintura;
  // eslint-disable-next-line no-global-assign
  i2Pintura = (f, inf, modo) => {
    if (modo !== 'vigor') return pintSemVigor(f, inf, modo);
    const v = vigorTalhao(f);
    return v ? {cor: v.cor, op: tecLerNdvi()?.item ? 0.05 : 0.55, borda: '#ffffff', larg: 2, txt: `${v.rot} ${num(v.ndvi, 2)}`} : {cor: '#9aa4ad', op: 0.2, txt: 'Sem imagem'};
  };
}
if (typeof iniDesenharFazenda === 'function') {
  const desenharSemVigor = iniDesenharFazenda;
  // eslint-disable-next-line no-global-assign
  iniDesenharFazenda = (fs, modo) => {
    const chave = desenharSemVigor(fs, modo), n = tecLerNdvi(), m = typeof iniMapa !== 'undefined' ? iniMapa : null;
    if (modo === 'vigor' && n?.item && m?.L && typeof NUVEM !== 'undefined') {
      m.L.tileLayer(`${NUVEM.url}/functions/v1/satelite?acao=tile&item=${encodeURIComponent(n.item)}&z={z}&x={x}&y={y}&apikey=${encodeURIComponent(NUVEM.chave)}`,
        {opacity: 0.8, minZoom: 8, maxZoom: 19, maxNativeZoom: 15, pane: 'overlayPane', className: 'tec-ndvi'}).addTo(m.grupo).bringToBack();
    }
    return chave + (modo === 'vigor' ? ':v' + (n?.item || '') : '');
  };
}

// ======================= Onde aparece =======================
// Bloco técnico: uma linha simples e "Detalhes" com a conta (mesmo padrão dos alertas)
const tecLinha = (ic, rot, valor, cls, detalhe, chave) => !valor ? '' : `<details class="tec-linha ${cls || ''}" data-tec="${esc(chave)}"><summary><span class="tec-ic" aria-hidden="true">${ic}</span><span class="tec-txt"><small>${esc(rot)}</small><b>${esc(valor)}</b></span>${detalhe ? '<span class="tec-mais">Detalhes</span>' : ''}</summary>${detalhe ? `<div class="tec-det">${detalhe}</div>` : ''}</details>`;
const TEC_IC = {
  estadio: '<path d="M12 21v-8.5"/><path d="M12 12.5C12 8.4 9.2 5.8 5 5.8c0 4.1 2.8 6.7 7 6.7zM12 14.5c0-3.7 2.6-6.2 6.8-6.2 0 3.7-2.6 6.2-6.8 6.2z"/><path d="M8 21h8"/>',
  agua: '<path d="M12 3.5s6 6.8 6 10.8a6 6 0 0 1-12 0c0-4 6-10.8 6-10.8z"/><path d="M6.5 15.5h11"/>',
  vigor: '<path d="M3.5 20.5h17M6.5 17v-4M11 17v-6.5M15.5 17V12M20 17V7.5"/>',
  solo: '<path d="M3 9h18M3 14h18M3 19h18"/><circle cx="7" cy="11.5" r=".6"/><circle cx="15" cy="16.5" r=".6"/><circle cx="12" cy="6" r="2.5"/>'
};
const tecHex = (k, cor = 'verde') => typeof hexGlifo === 'function' ? hexGlifo(TEC_IC[k], cor, 34) : '';
const TEC_COR_AGUA = {boa: 'azul', secando: 'azul', deficit: 'azul'};
function tecBlocoTalhao(f, completo = false) {
  const est = estadioTalhao(f), agua = balancoHidrico(f), vig = vigorTalhao(f), an = tecUltimaAnalise(f), sol = recomendacaoSolo(an);
  const linhas = [
    tecLinha(tecHex('estadio'), est?.observado ? 'Estádio' : 'Estádio provável', tecEstadioTxt(est), '', tecEstadioDetalhe(est, f), 'estadio'),
    tecLinha(tecHex('agua', 'azul'), 'Água no solo', tecAguaTxt(agua), agua ? 'agua-' + agua.nivel : '', tecAguaDetalhe(agua), 'agua'),
    tecLinha(tecHex('vigor'), 'Vigor da lavoura', tecVigorTxt(vig), '', tecVigorDetalhe(vig, f), 'vigor'),
    an ? tecLinha(tecHex('solo', 'azul'), 'Solo', tecSoloTxt(sol) || 'Análise lançada', '', tecSoloDetalhe(an, sol) + (completo && tecGestor() ? `<div class="btn-row">${btn('Editar análise', 'solo-editar', an.id, 'secondary small')}${btn('+ Nova análise', 'solo-nova', f.id, 'secondary small')}</div>` : ''), 'solo') : ''
  ].filter(Boolean);
  const semSolo = !an && completo && tecGestor() ? `<button type="button" class="link tec-add" data-act="solo-nova" data-id="${esc(f.id)}">+ Lançar análise de solo</button>` : '';
  if (!linhas.length && !semSolo) return '';
  return `<div class="tec-bloco" data-tec-talhao="${esc(f.id)}">${linhas.join('')}${semSolo}</div>`;
}
// Início: painel do talhão (ao tocar no mapa)
if (typeof i2PainelTalhao === 'function') {
  const painelSemTec = i2PainelTalhao;
  // eslint-disable-next-line no-global-assign
  i2PainelTalhao = f => {
    const html = painelSemTec(f), i = html.indexOf('<div class="i2-pt-bts">');
    const bloco = tecBlocoTalhao(f);
    return i < 0 || !bloco ? html : html.slice(0, i) + bloco + html.slice(i);
  };
}
// Página do talhão: cartão "Técnico" depois do resumo agronômico
tecEmbrulhar('talhao', talhaoSemTec => id => {
    const html = talhaoSemTec(id), f = find('fields', id); if (!f) return html;
    const card = `<section class="card panel tec-card" data-tec-pagina="${esc(f.id)}"><h3>Técnico</h3>${tecBlocoTalhao(f, true) || '<p class="nota">Sem dados técnicos ainda.</p>'}</section>`;
    const r = html.indexOf('class="card panel ag-resumo"'), fim = r < 0 ? -1 : html.indexOf('</section>', r);
    return fim < 0 ? html + card : html.slice(0, fim + 10) + card + html.slice(fim + 10);
});
// MercaClima: "Água no solo" da sede (sem cultura) e de cada talhão em ciclo
function tecCartaoAgua() {
  const fs = (db.fields || []).filter(f => !f.inactive && !f.inativo && f.plantingDate && (typeof emCiclo !== 'function' || emCiclo(f)));
  const geral = balancoHidrico(null);
  if (!geral) return `<section class="card panel tec-agua" data-tec-clima><h3>Água no solo</h3><p class="nota">Calculando com o histórico do tempo… aparece quando houver internet.</p></section>`;
  const linhaT = f => { const b = balancoHidrico(f); return b ? `<div class="tec-agua-l agua-${b.nivel}"><span>${esc(f.name)}<small>${esc(tecEstadioTxt(estadioTalhao(f)))}</small></span><b>${esc(tecAguaTxt(b))}</b></div>` : ''; };
  return `<section class="card panel tec-agua" data-tec-clima><h3>Água no solo</h3>
    ${tecLinha(tecHex('agua', 'azul'), fs.length ? 'Fazenda (sem considerar a cultura)' : 'Fazenda', tecAguaTxt(geral), 'agua-' + geral.nivel, tecAguaDetalhe(geral), 'agua-geral')}
    ${fs.length ? `<div class="tec-agua-lista">${fs.map(linhaT).join('')}</div>` : ''}</section>`;
}
tecEmbrulhar('clima', climaSemAgua => (...a) => {
    const html = climaSemAgua(...a), i = html.indexOf('<section class="card panel cd-chuva-card">');
    return i < 0 ? html : html.slice(0, i) + tecCartaoAgua() + html.slice(i);
});
// Ajustes → Agronomia: água do solo e tabela de adubação da soja e do milho
const TEC_ADUBO_CAMPOS = [['p1', 'P₂O₅ 1º cultivo'], ['p2', 'P₂O₅ 2º cultivo'], ['k1', 'K₂O 1º cultivo'], ['k2', 'K₂O 2º cultivo']];
function tabelaAduboForm(cult) {
  const t = tecTabela(cult), v = {ref: t.ref, extraP: t.extraP, extraK: t.extraK};
  TEC_ADUBO_CAMPOS.forEach(([k]) => TEC_CLASSES.forEach((_, i) => { v[`${k}_${i}`] = t[k]?.[i] ?? ''; }));
  openForm({title: `Tabela de adubação — ${cult}`, sub: 'Copie as doses (kg/ha) da tabela do Manual de Calagem e Adubação RS/SC. Uma vez só: depois toda análise de solo já sai com a dose.', values: v,
    fields: [{k: 'ref', label: 'Produtividade de referência da tabela (t/ha)', type: 'number', min: 0, step: 0.1, full: true},
      {k: 'extraP', label: 'P₂O₅ a mais por tonelada (kg/ha)', type: 'number', min: 0}, {k: 'extraK', label: 'K₂O a mais por tonelada (kg/ha)', type: 'number', min: 0},
      ...TEC_ADUBO_CAMPOS.flatMap(([k, rot]) => TEC_CLASSES.map((c, i) => ({k: `${k}_${i}`, label: `${rot} — ${c}`, type: 'number', min: 0})))],
    submit: 'Salvar tabela',
    onSubmit: x => {
      const novo = {ref: x.ref, extraP: x.extraP, extraK: x.extraK};
      TEC_ADUBO_CAMPOS.forEach(([k]) => { novo[k] = TEC_CLASSES.map((_, i) => x[`${k}_${i}`]); });
      db.settings.tabelaAdubo = {...(db.settings.tabelaAdubo || {}), [cult]: novo}; save(); showToast(`Tabela da ${cult.toLowerCase()} salva`); render();
    }});
}
ACTIONS['tec-tabela'] = c => tabelaAduboForm(c === 'Milho' ? 'Milho' : 'Soja');
ACTIONS['tec-cad'] = v => { db.settings.cadSolo = Number(v) || 75; save(); showToast('Capacidade de água do solo salva'); };
if (typeof CFG_GRUPOS !== 'undefined' && !CFG_GRUPOS.some(([id]) => id === 'agronomia')) {
  CFG_GRUPOS.splice(CFG_GRUPOS.findIndex(([id]) => id === 'dados'), 0, ['agronomia', 'Agronomia', 'Água do solo e tabela de adubação', /^Agronomia$/]);
  if (typeof CFG_ICONE !== 'undefined') CFG_ICONE.agronomia = TEC_IC.estadio;
}
tecEmbrulhar('cadastros', ajustesSemAgro => (...a) => {
    const html = ajustesSemAgro(...a), i = html.lastIndexOf('</section>'); if (i < 0 || !tecGestor()) return html;
    const preenchida = c => { const t = tecTabela(c); return TEC_ADUBO_CAMPOS.every(([k]) => (t[k] || []).some(x => x !== '' && x != null)); };
    const card = `<article class="card panel"><h3>Agronomia</h3><p>Usado no balanço de água do solo e na recomendação das análises de solo.</p>
      <div class="field"><label for="tecCad">Capacidade de água do solo</label><select id="tecCad" data-change="tec-cad">${TEC_SOLOS.map(([v, r]) => `<option value="${v}" ${String(tecCad()) === v ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <p class="nota">Trigo e triticale já vêm com a tabela do manual RS/SC (2016). Soja e milho: preencha uma vez com as doses do manual.</p>
      <div class="btn-row">${btn(`Tabela da soja${preenchida('Soja') ? ' ✓' : ''}`, 'tec-tabela', 'Soja', 'secondary')}${btn(`Tabela do milho${preenchida('Milho') ? ' ✓' : ''}`, 'tec-tabela', 'Milho', 'secondary')}</div></article>`;
    return html.slice(0, i) + card + html.slice(i);
});
document.addEventListener('change', e => { const s = e.target.closest?.('[data-change="tec-cad"]'); if (s) ACTIONS['tec-cad'](s.value); });

// ======================= Busca em segundo plano e atualização das telas =======================
// Com o histórico e o satélite chegando depois, só os blocos técnicos da tela são redesenhados (sem piscar o resto)
function tecRedesenhar() {
  document.querySelectorAll('[data-tec-talhao]').forEach(el => { const f = find('fields', el.dataset.tecTalhao); if (!f) return; const novo = tecBlocoTalhao(f, !!el.closest('[data-tec-pagina]')); if (novo) el.outerHTML = novo; });
  document.querySelectorAll('[data-tec-pagina]').forEach(sec => { if (!sec.querySelector('[data-tec-talhao]')) { const f = find('fields', sec.dataset.tecPagina); const b = f && tecBlocoTalhao(f, true); if (b) sec.querySelector('.nota')?.replaceWith(document.createRange().createContextualFragment(b)); } });
  document.querySelectorAll('[data-tec-clima]').forEach(el => { el.outerHTML = tecCartaoAgua(); });
}
let tecUltimaBusca = 0;
function tecAtualizar() {
  if (Date.now() - tecUltimaBusca < 20000) return; tecUltimaBusca = Date.now();
  const antesH = tecLerHist()?.em, antesN = tecLerNdvi()?.em;
  Promise.all([tecHistorico(), tecNdvi()]).then(([h, n]) => {
    const mudouN = n?.em && n.em !== antesN;
    if ((h?.em && h.em !== antesH) || mudouN) tecRedesenhar();
    // Modo Vigor aberto e o satélite chegou agora: redesenha o mapa
    if (mudouN && typeof i2Modo === 'function' && i2Modo() === 'vigor' && typeof i2AtualizarFazenda === 'function' && parseRoute().name === 'inicio') i2AtualizarFazenda();
  });
}
['inicio', 'clima', 'talhao', 'talhoes'].forEach(r => {
  if (!VIEWS[r]) return;
  const depois = VIEWS[r].after;
  VIEWS[r].after = (...a) => { depois?.(...a); tecAtualizar(); };
});
