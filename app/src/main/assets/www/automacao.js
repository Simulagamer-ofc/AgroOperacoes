'use strict';
/* Nexus Agro — automação do dia a dia: o sistema faz as contas para o produtor.
   • Previsão da revisão por data (pelo ritmo de uso de cada máquina)
   • Estoque que avisa antes de acabar (pelo consumo das últimas semanas)
   • Concluir operação já atualiza o horímetro, as horas trabalhadas e a área
   • Aviso ao iniciar pulverização com pulverizador de aferição vencida/reprovada
   • “Hoje” na Visão geral: o que fazer, em ordem de prioridade, e o clima com as janelas de pulverização
   • Relatório da safra por talhão, pronto para imprimir/PDF
   Tudo calculado no aparelho; só a previsão do tempo usa a internet (e fica guardada para ver sem sinal). */

// ---------- Máquinas: ritmo de uso e data prevista da revisão ----------
const diasEntreAuto = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
// Horas por dia de uso, pelos registros de horímetro dos últimos 60 dias (precisa de 7 dias ou mais de registros)
function ritmoHoras(machineId, dias = 60) {
  const logs = db.hourLogs.filter(h => h.machineId === machineId && h.date >= daysAgo(dias) && Number(h.hours) > 0).sort((a, b) => a.date.localeCompare(b.date) || a.hours - b.hours);
  if (logs.length < 2) return null;
  const a = logs[0], z = logs[logs.length - 1], span = diasEntreAuto(a.date, z.date), h = Number(z.hours) - Math.min(Number(a.previous) || Number(a.hours), Number(a.hours));
  if (span < 7 || !(h > 0)) return null;
  return h / span;
}
function previsaoRevisao(m) {
  if (!(Number(m.nextService) > 0)) return null;
  const falta = hoursToService(m), ritmo = ritmoHoras(m.id);
  if (!ritmo) return null;
  if (falta <= 0) return {vencida: true, ritmo};
  const dias = Math.max(0, Math.round(falta / ritmo));
  return {dias, data: addDias(today(), dias), ritmo};
}

// ---------- Estoque: quando acaba e até quando comprar ----------
function previsaoEstoque(s) {
  const desde = daysAgo(60), saidas = db.movements.filter(m => m.itemId === s.id && m.kind === 'Saída' && (m.date || '') >= desde && Number(m.qty) > 0);
  if (saidas.length < 2 || !(Number(s.qty) > 0)) return null;
  const primeira = saidas.reduce((d, m) => m.date < d ? m.date : d, today());
  const porDia = saidas.reduce((t, m) => t + Number(m.qty), 0) / Math.max(14, diasEntreAuto(primeira, today()));
  if (!(porDia > 0)) return null;
  const dias = Math.floor(Number(s.qty) / porDia);
  return {dias, porDia, acaba: addDias(today(), dias), compraAte: addDias(today(), Math.max(0, dias - 7))};
}

// ---------- Avisos novos ----------
const alertasSemAutomacao = alerts;
alerts = function () {
  const lista = alertasSemAutomacao();
  db.stock.filter(s => !stockLow(s)).forEach(s => {
    const p = previsaoEstoque(s);
    if (p && p.dias <= 21) lista.push({color: p.dias <= 7 ? 'red' : 'orange', icon: '□', title: `${s.name} acaba em cerca de ${p.dias} ${p.dias === 1 ? 'dia' : 'dias'}`,
      text: `Saldo ${num(s.qty)} ${s.unit}; consumo médio de ${num(p.porDia, p.porDia >= 10 ? 0 : 1)} ${s.unit}/dia nas últimas semanas. Compre até ${fmtDate(p.compraAte)}.`, route: 'estoque/' + s.id});
  });
  // Só as telas liberadas para a função de quem usa (mesma regra dos outros avisos)
  return typeof nvPodeRota === 'function' ? lista.filter(a => !a.route || nvPodeRota(String(a.route).split('/')[0])) : lista;
};

// ---------- Operações: iniciar e concluir já registram o horímetro e a área ----------
const pulverizacao = o => /pulveriz|aplica|defensiv|fungic|herbic|inseticid|dessec/i.test(o?.type || '');
function iniciarOperacao(id) {
  const o = find('operations', id); if (!o) return;
  const comecar = () => {
    const m = o.machineId ? find('machines', o.machineId) : null;
    o.status = 'Em andamento'; o.startedAt = new Date().toISOString(); if (!o.time) o.time = nowTime();
    if (m && Number(m.hours) > 0) o.horimetroIni = Number(m.hours);
    save(); showToast('Operação iniciada'); render();
  };
  const aviso = o.machineId && pulverizacao(o) && typeof avisoPulverizador === 'function' ? avisoPulverizador(o.machineId) : '';
  if (aviso) return confirmDialog(`${machineName(o.machineId)}: ${aviso}. Iniciar a pulverização mesmo assim?`, comecar, 'Iniciar mesmo assim');
  comecar();
}
function concluirOperacao(id) {
  const o = find('operations', id); if (!o) return;
  const m = o.machineId ? find('machines', o.machineId) : null, f = o.fieldId ? find('fields', o.fieldId) : null;
  const fields = [];
  if (m) fields.push({k: 'horimetro', label: `Horímetro final — ${m.name} (h)`, type: 'number', min: 0, full: true, hint: `Atual: ${num(m.hours)} h${o.horimetroIni ? ` • no início: ${num(o.horimetroIni)} h` : ''}. Atualiza a máquina, as revisões e o consumo.`});
  if (opTemArea(o)) fields.push({k: 'area', label: 'Área trabalhada (ha)', type: 'number', min: 0, hint: f && Number(f.area) > 0 ? `Talhão ${f.name}: ${num(f.area)} ha` : ''});
  if (OP_COM_KG.includes(o.type)) fields.push({k: 'kg', label: 'Quantidade de sementes (kg)', type: 'number', min: 0, hint: 'Para calcular o rendimento em kg/h.'});
  fields.push({k: 'notes', label: 'Observações', type: 'textarea'});
  openForm({title: `Concluir: ${o.type}`, sub: [opPlace(o), m?.name].filter(Boolean).join(' • '), submit: 'Concluir operação',
    values: {horimetro: m ? m.hours : '', area: o.area || (f ? f.area : ''), kg: o.kg || '', notes: o.notes || ''}, fields,
    onSubmit: v => {
      if (m && v.horimetro !== '' && Number(v.horimetro) < Number(o.horimetroIni || 0)) return `O horímetro final não pode ser menor que o do início (${num(o.horimetroIni)} h)`;
      if (m && v.horimetro !== '' && Number(v.horimetro) > Number(m.hours || 0)) {
        db.hourLogs.push({id: uid(), machineId: m.id, date: today(), hours: Number(v.horimetro), previous: Number(m.hours || 0), notes: `Operação: ${o.type}`, opId: o.id});
        m.hours = Number(v.horimetro);
      }
      if (m && v.horimetro !== '') { o.horimetroFim = Number(v.horimetro); if (o.horimetroIni) o.horas = Math.round((o.horimetroFim - o.horimetroIni) * 10) / 10; }
      if (opTemArea(o) && v.area !== '' && v.area != null) o.area = Number(v.area);
      if (OP_COM_KG.includes(o.type) && v.kg !== '' && v.kg != null) o.kg = Number(v.kg);
      o.notes = v.notes; o.status = 'Concluída'; o.finishedAt = new Date().toISOString();
      save();
      showToast(`Operação concluída${o.horas > 0 ? ` — ${um1(o.horas)} h` : ''}${o.horas > 0 && o.area > 0 && opTemArea(o) ? `, ${um1(o.area / o.horas)} ha/h` : o.horas > 0 && o.kg > 0 ? `, ${num(o.kg / o.horas)} kg/h` : ''}`);
    }});
}
Object.assign(ACTIONS, {'op-start': iniciarOperacao, 'op-done': concluirOperacao});

// ---------- Clima: previsão e janelas de pulverização (Open-Meteo, gratuito, sem cadastro) ----------
const CLIMA_KEY = 'agro-clima';
let climaBuscando = false;
function localDaFazenda() {
  const s = db.settings.local;
  if (s && Number.isFinite(s.lat) && Number.isFinite(s.lon)) return {lat: s.lat, lon: s.lon, origem: s.origem || 'localização salva'};
  const f = db.fields.find(x => x.contorno?.pontos?.length > 2);
  if (f) { const ps = f.contorno.pontos; return {lat: ps.reduce((t, p) => t + p[0], 0) / ps.length, lon: ps.reduce((t, p) => t + p[1], 0) / ps.length, origem: `contorno do talhão ${f.name}`}; }
  return null;
}
const lerClima = () => { try { return JSON.parse(safeStorage.get(CLIMA_KEY) || 'null'); } catch { return null; } };
async function buscarClima(forcar = false) {
  const loc = localDaFazenda(); if (!loc || climaBuscando || navigator.onLine === false) return;
  const atual = lerClima();
  if (!forcar && atual && Date.now() - atual.em < 3600000 && Math.abs(atual.lat - loc.lat) < 0.01 && Math.abs(atual.lon - loc.lon) < 0.01) return;
  climaBuscando = true;
  try {
    const q = new URLSearchParams({latitude: loc.lat.toFixed(4), longitude: loc.lon.toFixed(4), timezone: 'auto', forecast_days: '4',
      hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,precipitation',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max'});
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
    if (!r.ok) throw new Error('clima ' + r.status);
    const dados = await r.json();
    safeStorage.set(CLIMA_KEY, JSON.stringify({em: Date.now(), lat: loc.lat, lon: loc.lon, dados}));
    const el = document.getElementById('hojeClima'); if (el) el.outerHTML = cartaoClima();
  } catch { /* sem internet ou serviço fora: mantém a última previsão guardada */ } finally { climaBuscando = false; }
}
// Delta T = temperatura do ar − temperatura de bulbo úmido (Stull, 2011). Boa faixa para pulverizar: 2 a 8 °C
function deltaT(t, ur) {
  const tw = t * Math.atan(0.151977 * Math.sqrt(ur + 8.313659)) + Math.atan(t + ur) - Math.atan(ur - 1.676331) + 0.00391838 * ur ** 1.5 * Math.atan(0.023101 * ur) - 4.686035;
  return t - tw;
}
// Cada hora: boa para pulverizar? (vento 3–10 km/h, rajada < 20, Delta T 2–8, até 30 °C, umidade ≥ 50%, sem chuva agora e na hora seguinte)
function avaliarHora(h, i) {
  const t = h.temperature_2m[i], ur = h.relative_humidity_2m[i], v = h.wind_speed_10m[i], raj = h.wind_gusts_10m?.[i] ?? v, pp = h.precipitation_probability?.[i] ?? 0, chuva = (h.precipitation?.[i] || 0) + (h.precipitation?.[i + 1] || 0);
  const dt = deltaT(t, ur), motivos = [];
  if (v < 3) motivos.push('vento fraco (risco de inversão térmica)'); else if (v > 10 || raj >= 20) motivos.push('vento forte');
  if (t > 30) motivos.push('calor acima de 30 °C');
  if (ur < 50) motivos.push('umidade baixa');
  if (dt > 8) motivos.push('Delta T alto (gotas evaporam)'); else if (dt < 2 && v >= 3) motivos.push('Delta T baixo');
  if (chuva > 0.2 || pp >= 40) motivos.push('chuva');
  return {ok: !motivos.length, motivos, t, ur, v, dt};
}
function janelasDoDia(dados, data) {
  const h = dados.hourly; const idx = h.time.map((x, i) => [x, i]).filter(([x]) => x.startsWith(data)).map(([, i]) => i);
  const horas = idx.map(i => ({hora: Number(h.time[i].slice(11, 13)), ...avaliarHora(h, i)})).filter(x => x.hora >= 5 && x.hora <= 20);
  const janelas = []; let ini = null;
  horas.forEach((x, k) => { if (x.ok && ini == null) ini = x.hora; if ((!x.ok || k === horas.length - 1) && ini != null) { const fim = x.ok ? x.hora + 1 : x.hora; if (fim - ini >= 1) janelas.push([ini, fim]); ini = null; } });
  const cont = {}; horas.filter(x => !x.ok).forEach(x => x.motivos.forEach(m => { cont[m] = (cont[m] || 0) + 1; }));
  const principal = Object.entries(cont).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return {janelas, principal};
}
const hh = n => String(n).padStart(2, '0') + 'h';
const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function cartaoClima() {
  const loc = localDaFazenda(), c = lerClima();
  if (!loc) return `<article class="card panel hoje-clima" id="hojeClima"><h3>Clima e pulverização</h3><p class="nota">Para ver a previsão do tempo e as melhores horas para pulverizar, informe onde fica a fazenda.</p><div class="btn-row">${btn('📍 Usar a localização atual', 'clima-local', '', 'secondary')}</div><small class="nota">Ou meça o contorno de um talhão pelo GPS: o app usa o centro dele.</small></article>`;
  if (!c?.dados?.daily) return `<article class="card panel hoje-clima" id="hojeClima"><h3>Clima e pulverização</h3><p class="nota">${navigator.onLine === false ? 'Sem internet: a previsão aparece quando o sinal voltar.' : 'Buscando a previsão…'}</p></article>`;
  const d = c.dados.daily, hoje = today(), i0 = Math.max(0, d.time.indexOf(hoje));
  const jan = janelasDoDia(c.dados, d.time[i0]), amanha = d.time[i0 + 1] ? janelasDoDia(c.dados, d.time[i0 + 1]) : null;
  const txtJan = (j, quando) => j.janelas.length ? `<strong>Boas horas para pulverizar ${quando}:</strong> ${j.janelas.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(', ')}` : `<strong>Sem janela boa para pulverizar ${quando}</strong>${j.principal ? ` (principalmente ${j.principal})` : ''}`;
  const chuvaProx = d.time.map((t, i) => ({t, mm: d.precipitation_sum[i]})).find((x, i) => i >= i0 && x.mm >= 5);
  const idade = Math.round((Date.now() - c.em) / 60000);
  return `<article class="card panel hoje-clima" id="hojeClima"><div class="section-title" style="margin:0 0 6px"><h3>Clima e pulverização</h3><button data-act="clima-atualizar" title="Atualizar">↻</button></div>
    <div class="hoje-dias">${d.time.slice(i0, i0 + 4).map((t, k) => { const i = i0 + k; return `<div class="hoje-dia"><small>${k === 0 ? 'Hoje' : DIA_SEMANA[new Date(t + 'T12:00:00').getDay()]}</small><strong>${Math.round(d.temperature_2m_max[i])}° <span>${Math.round(d.temperature_2m_min[i])}°</span></strong><small>💧 ${num(d.precipitation_sum[i], 0)} mm · ${d.precipitation_probability_max[i] ?? 0}%</small><small>💨 ${Math.round(d.wind_speed_10m_max[i])} km/h</small></div>`; }).join('')}</div>
    <p class="hoje-jan ${jan.janelas.length ? 'ok' : 'nao'}">${txtJan(jan, 'hoje')}</p>${amanha ? `<p class="hoje-jan ${amanha.janelas.length ? 'ok' : 'nao'}">${txtJan(amanha, 'amanhã')}</p>` : ''}
    ${chuvaProx ? `<p class="nota">🌧 Chuva de ${num(chuvaProx.mm, 0)} mm prevista para ${chuvaProx.t === hoje ? 'hoje' : fmtDate(chuvaProx.t)}: programe aplicações e colheita.</p>` : ''}
    <small class="nota">Critério: vento 3–10 km/h, Delta T 2–8 °C, até 30 °C, umidade ≥ 50% e sem chuva. Orientação — confirme as condições no campo. Previsão Open-Meteo para ${esc(loc.origem)}, atualizada há ${idade < 60 ? idade + ' min' : Math.round(idade / 60) + ' h'}.</small></article>`;
}
Object.assign(ACTIONS, {
  'hoje-mais': () => go('inicio', 'alertas'),
  'clima-atualizar': () => { if (navigator.onLine === false) return showToast('Sem internet agora'); buscarClima(true); showToast('Atualizando a previsão…'); },
  'clima-local': () => {
    if (!navigator.geolocation) return showToast('Este aparelho não oferece a localização ao app.', true);
    showToast('Buscando a localização…');
    navigator.geolocation.getCurrentPosition(p => { db.settings.local = {lat: p.coords.latitude, lon: p.coords.longitude, origem: 'localização da sede'}; save(); render(); buscarClima(true); },
      () => showToast('Não foi possível obter a localização. Libere a localização para o app.', true), {enableHighAccuracy: false, timeout: 20000, maximumAge: 600000});
  }
});

// ---------- Hoje: o que fazer, em ordem de prioridade ----------
function painelHoje() {
  const t = today(), al = alerts();
  const ops = db.operations.filter(o => o.status === 'Em andamento' || (o.status === 'Programada' && o.date && o.date <= t)).sort((a, b) => (a.status === 'Em andamento' ? 0 : 1) - (b.status === 'Em andamento' ? 0 : 1) || (a.date || '').localeCompare(b.date || ''));
  const PESO = {red: 0, orange: 1, purple: 2, blue: 3};
  const itens = [...al.filter(a => a.color === 'red'), ...ops.map(o => ({op: o})), ...al.filter(a => a.color !== 'red').sort((a, b) => (PESO[a.color] ?? 9) - (PESO[b.color] ?? 9))];
  const linha = x => x.op
    ? `<div class="hoje-item"><span class="alert-icon ${x.op.status === 'Em andamento' ? 'green' : x.op.date < t ? 'red' : 'blue'}">◷</span><div><strong>${esc(x.op.type)} — ${esc(opPlace(x.op))}</strong><small>${x.op.status === 'Em andamento' ? 'Em andamento' : x.op.date < t ? `Atrasada (era para ${fmtDate(x.op.date)})` : 'Programada para hoje'}${x.op.machineId ? ' • ' + esc(machineName(x.op.machineId)) : ''}</small></div>${x.op.status === 'Em andamento' ? mini('✓ Concluir', 'op-done', x.op.id, 'ok') : mini('▶ Iniciar', 'op-start', x.op.id)}</div>`
    : `<div class="hoje-item clickable" data-act="nav" data-id="${esc(x.route)}"><span class="alert-icon ${x.color}">${x.icon}</span><div><strong>${esc(x.title)}</strong><small>${esc(x.text)}</small></div><span class="hoje-ir" aria-hidden="true">›</span></div>`;
  const data = new Date().toLocaleDateString('pt-BR', {weekday: 'long', day: 'numeric', month: 'long'});
  return `<section class="hoje"><article class="card panel hoje-fazer"><div class="section-title" style="margin:0 0 6px"><h3>Hoje <small>${esc(data)}</small></h3>${btn('+ Operação', 'op-new', '', 'secondary')}</div>
      ${itens.length ? itens.slice(0, 7).map(linha).join('') + (itens.length > 7 ? `<button class="link" data-act="hoje-mais">Mais ${itens.length - 7} ${itens.length - 7 === 1 ? 'item' : 'itens'} em “Atenção”</button>` : '') : empty('Tudo em dia', 'Nenhuma pendência para hoje.')}</article>
    ${cartaoClima()}</section>`;
}
const inicioSemHoje = VIEWS.inicio;
VIEWS.inicio = anchor => painelHoje() + inicioSemHoje(anchor);
VIEWS.inicio.after = anchor => { inicioSemHoje.after?.(anchor); buscarClima(); };

// ---------- Relatório da safra do talhão ----------
// Safra “2025/26” = 01/07/2025 a 30/06/2026; sem safra informada, últimos 12 meses
// Se a safra informada não tem nenhum registro do talhão (safra desatualizada), usa os últimos 12 meses. O período pode ser trocado na tela.
let safraPeriodo = {}; // fieldId → {ini, fim} escolhido pelo usuário
function periodoSafra(f) {
  if (safraPeriodo[f.id]) return {...safraPeriodo[f.id], nome: 'Período escolhido'};
  const m = String(f.season || '').match(/(\d{4})\s*\/\s*(\d{2,4})/);
  const doze = {ini: daysAgo(365), fim: today(), nome: 'Últimos 12 meses'};
  if (!m) return doze;
  const a = Number(m[1]), p = {ini: `${a}-07-01`, fim: `${a + 1}-06-30`, nome: `Safra ${f.season}`};
  const tem = ['operations', 'aplicacoes', 'monitoramentos', 'colheitas'].some(c => db[c].some(r => r.fieldId === f.id && (r.date || '') >= p.ini && (r.date || '') <= p.fim));
  return tem ? p : doze;
}
VIEWS.safra = id => {
  const f = find('fields', id); if (!f) return empty('Talhão não encontrado', '');
  const p = periodoSafra(f), no = r => (r.date || '') >= p.ini && (r.date || '') <= p.fim;
  const ops = db.operations.filter(o => o.fieldId === id && no(o)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const aps = db.aplicacoes.filter(a => a.fieldId === id && no(a)).sort((a, b) => a.date.localeCompare(b.date));
  const mon = db.monitoramentos.filter(m => m.fieldId === id && no(m)).sort((a, b) => a.date.localeCompare(b.date));
  const chuva = db.chuvas.filter(c => (c.fieldId === id || !c.fieldId) && no(c)).reduce((t, c) => t + (Number(c.mm) || 0), 0);
  const col = db.colheitas.filter(c => c.fieldId === id && no(c));
  const sacas = col.reduce((t, c) => t + Number(c.kg || 0) / 60, 0), area = Number(f.area) || 0;
  const ana = typeof analiseSafra === 'function' && f.season ? analiseSafra(f.season).linhas.find(l => l.id === id) : null;
  const fin = typeof nvVeFinanceiro !== 'function' || nvVeFinanceiro();
  const lib = typeof liberacaoColheita === 'function' ? liberacaoColheita(id) : null;
  const linha = (k, v) => v ? `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>` : '';
  const tabela = (cab, linhas) => linhas.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>` : '<p class="nota">Nenhum registro no período.</p>';
  const brlR = v => v == null ? '—' : `${v < 0 ? '− ' : ''}R$ ${num(Math.abs(v), 2)}`;
  return `<div class="no-print">${head('Relatório da safra', `${f.name} • ${p.nome}`, btn('← Talhão', 'nav', 'talhao/' + id, 'secondary') + btn('Imprimir / PDF', 'af-imprimir', '', 'secondary'))}
    <section class="card panel safra-periodo"><label>De <input type="date" data-safra-ini="${esc(id)}" value="${p.ini}"></label><label>até <input type="date" data-safra-fim="${esc(id)}" value="${p.fim}"></label></section></div>
  <article class="card panel relatorio">
    <header class="rel-head"><div><strong>${esc(db.settings.farm || 'Nexus Agro')}</strong><br><small>Relatório da safra — ${esc(f.name)}</small></div><small>${fmtDate(p.ini)} a ${fmtDate(p.fim)}</small></header>
    <h3>1. Talhão</h3><table class="tbl"><tbody>${linha('Talhão', f.name)}${linha('Área', area ? num(area) + ' ha' : '')}${linha('Cultura', f.crop)}${linha('Cultivar', f.cultivar)}${linha('Safra', f.season)}${linha('Chuva acumulada no período', chuva ? num(chuva, 0) + ' mm' : '')}${linha('Colheita liberada (carência)', lib ? (lib.libera > today() ? 'a partir de ' + fmtDate(lib.libera) : 'liberada') : '')}</tbody></table>
    <h3>2. Operações (${ops.length})</h3>${tabela(['Data', 'Operação', 'Máquina', 'Área / quantidade', 'Horas', 'Situação'], ops.map(o => `<tr><td>${fmtDate(o.date)}</td><td>${esc(o.type)}</td><td>${esc(machineName(o.machineId) || '—')}</td><td>${o.area && opTemArea(o) ? num(o.area) + ' ha' : o.kg ? num(o.kg) + ' kg' : '—'}</td><td>${o.horas ? um1(o.horas) + ' h' : '—'}</td><td>${esc(o.status)}</td></tr>`))}
    <h3>3. Aplicações de defensivos (${aps.length})</h3>${tabela(['Data', 'Produto e dose', 'Receituário', 'Resp. técnico', 'Carência'], aps.map(a => `<tr><td>${fmtDate(a.date)}</td><td><strong>${esc(a.produto)}</strong>${a.dose ? '<br><small>' + esc(a.dose) + '</small>' : ''}</td><td>${esc(a.receituario || '—')}</td><td>${esc(a.responsavel || '—')}</td><td>${num(a.carencia)} d (até ${fmtDate(addDias(a.date, Number(a.carencia) || 0))})</td></tr>`))}
    <h3>4. Monitoramento de pragas e doenças (${mon.length})</h3>${tabela(['Data', 'Alvo', 'Média', 'Nível de ação'], mon.map(m => `<tr><td>${fmtDate(m.date)}</td><td>${esc(m.alvo)}</td><td>${num(m.valor, 2)} ${esc(m.unidade || '')}</td><td>${m.nivelAcao !== '' && m.nivelAcao != null ? num(m.nivelAcao, 2) : '—'}</td></tr>`))}
    <h3>5. Colheita</h3><table class="tbl"><tbody>${col.length ? linha('Produção', `${sacas >= 100 ? num(sacas) : um1(sacas)} sacas de 60 kg`) + linha('Produtividade', area ? `${um1(sacas / area)} sc/ha` : '') : '<tr><td>Sem colheita registrada no período.</td></tr>'}</tbody></table>
    ${fin && ana ? `<h3>6. Custos e resultado</h3><table class="tbl"><tbody>${linha('Custo total', brlR(ana.custo))}${linha('Custo por hectare', ana.custoHa != null ? brlR(ana.custoHa) : '')}${linha('Custo por saca', ana.custoSc != null ? brlR(ana.custoSc) : '')}${linha('Receita (preço médio de venda)', ana.receita != null ? brlR(ana.receita) : '')}${linha('Margem', ana.margem != null ? brlR(ana.margem) : '')}${linha('Ponto de equilíbrio', ana.equilibrio != null ? num(ana.equilibrio, 1) + ' sc/ha' : '')}</tbody></table>` : ''}
    <p class="nota">Gerado pelo Nexus Agro a partir dos registros da fazenda em ${fmtDate(today())}.</p>
  </article>`;
};
TITLES.safra = 'Relatório da safra';
document.addEventListener('change', e => {
  const id = e.target.dataset?.safraIni || e.target.dataset?.safraFim; if (!id) return;
  const ini = $(`[data-safra-ini="${id}"]`)?.value, fim = $(`[data-safra-fim="${id}"]`)?.value;
  if (ini && fim && ini <= fim) { safraPeriodo[id] = {ini, fim}; render(); }
});
if (typeof NV_ROTA_TELA === 'object') NV_ROTA_TELA.safra = 'talhoes'; // mesma permissão da tela de talhões
