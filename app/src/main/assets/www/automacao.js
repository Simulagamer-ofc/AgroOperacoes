'use strict';
/* MercaPlant — automação do dia a dia: o sistema faz as contas para o produtor.
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

// ---------- Custo por hora de cada máquina (combustível + manutenção nos últimos 12 meses) ----------
function custoHoraMaquina(machineId) {
  const desde = daysAgo(365);
  const comb = db.fuel.filter(f => f.machineId === machineId && (f.date || '') >= desde).reduce((t, f) => t + (typeof custoAbast === 'function' ? custoAbast(f).v || 0 : Number(f.value) || 0), 0);
  const man = db.maintenances.filter(m => m.machineId === machineId && (m.doneDate || m.date || '') >= desde).reduce((t, m) => t + (Number(m.cost) || 0), 0);
  const logs = db.hourLogs.filter(h => h.machineId === machineId && (h.date || '') >= desde && Number(h.hours) > 0).sort((a, b) => a.date.localeCompare(b.date) || a.hours - b.hours);
  if (logs.length < 2) return null;
  const horas = Number(logs[logs.length - 1].hours) - Math.min(Number(logs[0].previous) || Number(logs[0].hours), Number(logs[0].hours));
  if (!(horas >= 10) || !(comb + man > 0)) return null;
  return {porHora: (comb + man) / horas, comb, man, horas};
}
// Custo de máquina de uma operação concluída (horas × custo por hora), só para quem vê o financeiro
function custoOperacao(o) {
  if (!(Number(o.horas) > 0) || !o.machineId || (typeof nvVeFinanceiro === 'function' && !nvVeFinanceiro())) return null;
  const c = custoHoraMaquina(o.machineId);
  return c ? o.horas * c.porHora : null;
}
// ---------- Duração prevista das operações, pelo rendimento das anteriores da mesma máquina e tipo ----------
function rendimentoMaquina(machineId, tipo) {
  const porArea = opTemArea({type: tipo});
  const ops = db.operations.filter(o => o.machineId === machineId && o.type === tipo && o.status === 'Concluída' && Number(o.horas) > 0 && (porArea ? Number(o.area) > 0 : Number(o.kg) > 0))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(-10);
  if (!ops.length) return null;
  const qtd = ops.reduce((t, o) => t + Number(porArea ? o.area : o.kg), 0), h = ops.reduce((t, o) => t + Number(o.horas), 0);
  return {porHora: qtd / h, unidade: porArea ? 'ha' : 'kg', n: ops.length};
}
function duracaoPrevista(o) {
  if (!o.machineId || !['Programada', 'Em andamento'].includes(o.status)) return null;
  const r = rendimentoMaquina(o.machineId, o.type); if (!r) return null;
  const qtd = r.unidade === 'ha' ? Number(o.area) || Number(find('fields', o.fieldId)?.area) || 0 : Number(o.kg) || 0;
  return qtd > 0 ? {horas: qtd / r.porHora, rendimento: r} : null;
}

// ---------- Talhão: dias após o plantio, chuva desde o plantio e colheita prevista ----------
// Talhão em ciclo: plantado há até 200 dias e sem colheita concluída depois do plantio
function emCiclo(f) {
  if (!f.plantingDate) return false;
  const dap = diasEntreAuto(f.plantingDate, today());
  return dap >= 0 && dap <= 200 && !db.operations.some(o => o.fieldId === f.id && o.type === 'Colheita' && o.status === 'Concluída' && (o.date || '') >= f.plantingDate);
}
function cicloTalhao(f) {
  if (!emCiclo(f)) return null;
  const dap = diasEntreAuto(f.plantingDate, today());
  const chuva = db.chuvas.filter(c => (c.fieldId === f.id || !c.fieldId) && (c.date || '') >= f.plantingDate);
  // Pluviômetro do talhão quando há; senão, o da sede
  const doTalhao = chuva.filter(c => c.fieldId === f.id), mm = (doTalhao.length ? doTalhao : chuva).reduce((t, c) => t + (Number(c.mm) || 0), 0);
  const ciclo = Number(f.ciclo) > 0 ? Number(f.ciclo) : null;
  return {dap, mm, colheita: ciclo ? addDias(f.plantingDate, ciclo) : null, faltam: ciclo ? ciclo - dap : null};
}
const infoCiclo = f => { const c = cicloTalhao(f); if (!c) return ''; return ` (${c.dap} ${c.dap === 1 ? 'dia' : 'dias'} após o plantio) • chuva desde o plantio: ${num(c.mm)} mm${c.colheita ? ` • colheita prevista ~${fmtDate(c.colheita)}` : ''}`; };

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

// ---------- Conferências que evitam erro de digitação e lançamento repetido (o segundo toque confirma) ----------
let confirmado = '';
const pedirConfirmacao = (chave, msg) => { if (confirmado === chave) { confirmado = ''; return ''; } confirmado = chave; return `${msg}. Se estiver certo, toque em salvar de novo.`; };
// Horímetro que sobe mais de 24 h por dia desde a última leitura: provável erro de digitação (ex.: 1250 em vez de 125,0)
function conferirSalto(m, novo, data = today()) {
  const atual = Number(m.hours) || 0, sobe = Number(novo) - atual; if (!(sobe > 0) || !(atual > 0)) return '';
  const ult = db.hourLogs.filter(h => h.machineId === m.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  if (!ult?.date) return sobe > 500 ? pedirConfirmacao(`salto|${m.id}|${novo}`, `Atenção: o horímetro de ${m.name} subiria ${num(sobe)} h de uma vez. Confira se não houve erro de digitação`) : '';
  const dias = Math.max(1, diasEntreAuto(ult.date, data));
  return sobe > 24 * dias ? pedirConfirmacao(`salto|${m.id}|${novo}`, `Atenção: o horímetro de ${m.name} subiria ${num(sobe)} h em ${dias} ${dias === 1 ? 'dia' : 'dias'} (mais de 24 h por dia). Confira se não houve erro de digitação`) : '';
}
function conferirRepetido(colecao, igual, descricao) {
  return db[colecao].some(igual) ? pedirConfirmacao(`dup|${colecao}|${descricao}`, `Atenção: ${descricao}`) : '';
}

// ---------- Avisos novos ----------
const alertasSemAutomacao = alerts;
alerts = function () {
  const lista = alertasSemAutomacao();
  // Talhão plantado sem monitoramento de pragas há mais de 7 dias; colheita prevista em até 10 dias
  db.fields.filter(emCiclo).forEach(f => {
    const c = cicloTalhao(f);
    const ult = db.monitoramentos.filter(m => m.fieldId === f.id && (m.date || '') >= f.plantingDate).sort((a, b) => b.date.localeCompare(a.date))[0];
    const desde = diasEntreAuto(ult?.date || f.plantingDate, today());
    if (c.dap >= 7 && desde > 7) lista.push({color: 'orange', icon: '✱', title: `Monitorar pragas: ${f.name}`, text: `${ult ? `Último monitoramento há ${desde} dias` : 'Nenhum monitoramento desde o plantio'} (${c.dap} dias após o plantio).`, route: 'pragas', acao: {act: 'mip-talhao', id: f.id, label: 'Monitorar'}});
    if (c.faltam != null && c.faltam <= 10) {
      const lib = typeof liberacaoColheita === 'function' ? liberacaoColheita(f.id) : null;
      lista.push({color: 'blue', icon: '🌾', title: c.faltam < 0 ? `Colheita prevista já passou: ${f.name}` : `Colheita prevista em ${c.faltam} ${c.faltam === 1 ? 'dia' : 'dias'}: ${f.name}`,
        text: `Pelo ciclo de ${num(f.ciclo)} dias, por volta de ${fmtDate(c.colheita)}.${lib && lib.libera > today() ? ` Atenção: carência de ${lib.a.produto} até ${fmtDate(addDias(lib.libera, -1))}.` : ''}`, route: 'talhao/' + f.id});
    }
  });
  db.stock.filter(s => !stockLow(s)).forEach(s => {
    const p = previsaoEstoque(s);
    if (p && p.dias <= 21) lista.push({color: p.dias <= 7 ? 'red' : 'orange', icon: '□', title: `${s.name} acaba em cerca de ${p.dias} ${p.dias === 1 ? 'dia' : 'dias'}`,
      text: `Saldo ${num(s.qty)} ${s.unit}; consumo médio de ${num(p.porDia, p.porDia >= 10 ? 0 : 1)} ${s.unit}/dia nas últimas semanas. Compre até ${fmtDate(p.compraAte)}.`, route: 'estoque/' + s.id, acao: {act: 'compras', label: 'Lista de compras'}});
  });
  // Só as telas liberadas para a função de quem usa (mesma regra dos outros avisos)
  return typeof nvPodeRota === 'function' ? lista.filter(a => !a.route || nvPodeRota(String(a.route).split('/')[0])) : lista;
};

// ---------- Operações: iniciar e concluir já registram o horímetro e a área ----------
const pulverizacao = o => /pulveriz|aplica|defensiv|fungic|herbic|inseticid|dessec/i.test(o?.type || '');
// Máquina com horímetro (motor próprio): trator, colheitadeira, pulverizador, plantadeira, caminhão — ou que já tenha horas lançadas
const temHorimetro = m => !!m && m.type !== 'Implemento' && (TIPOS_COM_HORIMETRO.includes(m.type) || Number(m.hours) > 0);
// Lê e confere o horímetro digitado; atualiza a máquina quando subiu. Devolve erro (texto) ou ''.
function aplicarHorimetro(m, valor, minimo, nota, o) {
  const h = Number(valor);
  if (minimo != null && h < Number(minimo)) return `O horímetro não pode ser menor que ${num(minimo)} h`;
  const salto = conferirSalto(m, h); if (salto) return salto;
  if (h > Number(m.hours || 0)) { db.hourLogs.push({id: uid(), machineId: m.id, date: today(), hours: h, previous: Number(m.hours || 0), notes: nota, opId: o.id}); m.hours = h; }
  return '';
}
function iniciarOperacao(id) {
  const o = find('operations', id); if (!o) return;
  const abrir = () => {
    const m = o.machineId ? find('machines', o.machineId) : null, comHor = temHorimetro(m);
    const fields = [];
    if (comHor) fields.push({k: 'horimetro', label: `Horímetro inicial — ${m.name} (h)`, type: 'number', min: 0, required: true, full: true, hint: `Digite o que o painel está marcando agora. Último registrado: ${num(m.hours)} h.`});
    openForm({title: `Iniciar: ${o.type}`, sub: [opPlace(o), m?.name].filter(Boolean).join(' • '), submit: 'Iniciar operação', values: {}, fields,
      onSubmit: v => {
        if (comHor && (v.horimetro === '' || v.horimetro == null)) return `Informe o horímetro inicial do ${m.name}`;
        if (comHor && Number(v.horimetro) < Number(m.hours || 0)) return `O horímetro está menor que o último registrado do ${m.name} (${num(m.hours)} h). Confira o painel.`;
        // Checklist da máquina (quando ligado): defeito vira pedido; máquina que não pode trabalhar não começa a operação
        const faltaChk = typeof mcpValidarInicio === 'function' ? mcpValidarInicio(o) : ''; if (faltaChk) return faltaChk;
        if (typeof mcpParadaNoInicio === 'function' && mcpParadaNoInicio(o)) { mcpAoIniciar(o, comHor ? v.horimetro : ''); save(); setTimeout(() => showToast(`Operação não iniciada: ${m.name} ficou parada com o defeito informado. O pedido de manutenção foi enviado.`, true), 50); return; }
        const faltaFoto = typeof confValidarInicio === 'function' ? confValidarInicio(o) : ''; if (faltaFoto) return faltaFoto;
        if (comHor) { const e = aplicarHorimetro(m, v.horimetro, null, `Início: ${o.type}`, o); if (e) return e; o.horimetroIni = Number(v.horimetro); }
        if (typeof mcpAoIniciar === 'function') mcpAoIniciar(o, comHor ? v.horimetro : '');
        o.status = 'Em andamento'; o.startedAt = new Date().toISOString(); if (!o.time) o.time = nowTime();
        if (typeof confAoIniciar === 'function') confAoIniciar(o);
        save(); showToast('Operação iniciada');
      }});
    if (typeof confAoAbrirInicio === 'function') confAoAbrirInicio(o);
    if (typeof mcpAoAbrirInicio === 'function') mcpAoAbrirInicio(o);
  };
  const aviso = o.machineId && pulverizacao(o) && typeof avisoPulverizador === 'function' ? avisoPulverizador(o.machineId) : '';
  if (aviso) return confirmDialog(`${machineName(o.machineId)}: ${aviso}. Iniciar a pulverização mesmo assim?`, abrir, 'Iniciar mesmo assim');
  abrir();
}
function concluirOperacao(id) {
  const o = find('operations', id); if (!o) return;
  const m = o.machineId ? find('machines', o.machineId) : null, f = o.fieldId ? find('fields', o.fieldId) : null;
  const fields = [];
  const comHor = temHorimetro(m);
  if (m && comHor) fields.push({k: 'horimetro', label: `Horímetro final — ${m.name} (h)`, type: 'number', min: 0, required: true, full: true, hint: `Digite o que o painel está marcando agora.${o.horimetroIni != null ? ` No início: ${num(o.horimetroIni)} h.` : ` Último registrado: ${num(m.hours)} h.`} Atualiza a máquina, as revisões e o consumo.`});
  if (opTemArea(o)) fields.push({k: 'area', label: 'Área trabalhada (ha)', type: 'number', min: 0, hint: f && Number(f.area) > 0 ? `Talhão ${f.name}: ${num(f.area)} ha` : ''});
  if (OP_COM_KG.includes(o.type)) fields.push({k: 'kg', label: 'Quantidade de sementes (kg)', type: 'number', min: 0, hint: 'Para calcular o rendimento em kg/h.'});
  fields.push({k: 'notes', label: 'Observações', type: 'textarea'});
  openForm({title: `Concluir: ${o.type}`, sub: [opPlace(o), m?.name].filter(Boolean).join(' • '), submit: 'Concluir operação',
    values: {horimetro: '', area: o.area || (f ? f.area : ''), kg: o.kg || '', notes: o.notes || ''}, fields,
    onSubmit: v => {
      if (comHor && (v.horimetro === '' || v.horimetro == null)) return `Informe o horímetro final do ${m.name}`;
      const faltaComprovar = typeof confValidarConclusao === 'function' ? confValidarConclusao(o) : ''; if (faltaComprovar) return faltaComprovar;
      if (m && v.horimetro !== '' && Number(v.horimetro) < Number(o.horimetroIni || 0)) return `O horímetro final não pode ser menor que o do início (${num(o.horimetroIni)} h)`;
      if (m && v.horimetro !== '') { const salto = conferirSalto(m, v.horimetro); if (salto) return salto; }
      if (m && v.horimetro !== '' && Number(v.horimetro) > Number(m.hours || 0)) {
        db.hourLogs.push({id: uid(), machineId: m.id, date: today(), hours: Number(v.horimetro), previous: Number(m.hours || 0), notes: `Operação: ${o.type}`, opId: o.id});
        m.hours = Number(v.horimetro);
      }
      if (m && v.horimetro !== '') { o.horimetroFim = Number(v.horimetro); if (o.horimetroIni) o.horas = Math.round((o.horimetroFim - o.horimetroIni) * 10) / 10; }
      if (opTemArea(o) && v.area !== '' && v.area != null) o.area = Number(v.area);
      if (OP_COM_KG.includes(o.type) && v.kg !== '' && v.kg != null) o.kg = Number(v.kg);
      o.notes = v.notes; o.status = 'Concluída'; o.finishedAt = new Date().toISOString();
      if (typeof confAoConcluir === 'function') confAoConcluir(o);
      // Plantio concluído: a data de plantio do talhão é preenchida sozinha (nova safra quando a anterior tem mais de 150 dias)
      const ft = o.type === 'Plantio' && o.fieldId ? find('fields', o.fieldId) : null;
      if (ft && (!ft.plantingDate || diasEntreAuto(ft.plantingDate, o.date || today()) > 150)) { ft.plantingDate = o.date || today(); setTimeout(() => showToast(`Plantio de ${ft.name} registrado em ${fmtDate(ft.plantingDate)}`), 2900); }
      save();
      showToast(`Operação concluída${o.horas > 0 ? ` — ${um1(o.horas)} h` : ''}${o.horas > 0 && o.area > 0 && opTemArea(o) ? `, ${um1(o.area / o.horas)} ha/h` : o.horas > 0 && o.kg > 0 ? `, ${num(o.kg / o.horas)} kg/h` : ''}`);
    }});
  if (typeof confAoAbrirConclusao === 'function') confAoAbrirConclusao(o);
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
// Previsão combinada de 4 modelos globais (a mesma ideia dos apps de clima grandes, como o Clima & Radar):
// a média erra menos que um modelo sozinho, e a concordância entre eles diz o quanto confiar na previsão.
const CLIMA_MODELOS = [['ecmwf_ifs025', 'ECMWF'], ['gfs_seamless', 'GFS'], ['icon_seamless', 'ICON'], ['gem_seamless', 'GEM']];
const CLIMA_HORA = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_gusts_10m', 'precipitation_probability', 'precipitation', 'cloud_cover'];
const CLIMA_DIA = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'sunshine_duration'];
const mediaDe = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
function combinarModelos(bruto) {
  const modelos = CLIMA_MODELOS.filter(([m]) => bruto.hourly?.[`temperature_2m_${m}`]?.some(v => v != null));
  if (!modelos.length) { if (!bruto.daily?.temperature_2m_max) throw new Error('formato inesperado'); if (bruto.hourly?.weather_code) bruto.hourly.trovoada = bruto.hourly.weather_code.map(c => c >= 95 ? 1 : 0); return bruto; } // resposta de um modelo só
  const valores = (sec, v, i) => modelos.map(([m]) => sec[`${v}_${m}`]?.[i]).filter(x => x != null && Number.isFinite(x));
  const h = {time: bruto.hourly.time}, d = {time: bruto.daily.time};
  CLIMA_HORA.forEach(v => { h[v] = h.time.map((_, i) => mediaDe(valores(bruto.hourly, v, i))); });
  // Chance de chuva: média entre a probabilidade dos modelos que a informam e a parcela de modelos que preveem chuva na hora
  h.precipitation_probability = h.time.map((_, i) => {
    const prob = mediaDe(valores(bruto.hourly, 'precipitation_probability', i)), mm = valores(bruto.hourly, 'precipitation', i);
    const acordo = mm.length ? mm.filter(x => x >= 0.1).length / mm.length * 100 : null;
    return Math.round(prob != null && acordo != null ? (prob + acordo) / 2 : prob ?? acordo ?? 0);
  });
  // Trovoada: parcela dos modelos com código de tempo de trovoada (95–99) na hora
  h.trovoada = h.time.map((_, i) => { const cs = valores(bruto.hourly, 'weather_code', i); return cs.length ? cs.filter(c => c >= 95).length / cs.length : 0; });
  CLIMA_DIA.forEach(v => { d[v] = d.time.map((_, i) => mediaDe(valores(bruto.daily, v, i))); });
  d.precipitation_probability_max = d.time.map(t => Math.max(0, ...h.time.map((x, i) => x.startsWith(t) ? h.precipitation_probability[i] : 0)));
  // Confiança do dia: os modelos concordam sobre chover (≥ 2 mm) e a máxima não varia mais de 4 °C entre eles
  d.confianca = d.time.map((_, i) => {
    const mm = valores(bruto.daily, 'precipitation_sum', i), tx = valores(bruto.daily, 'temperature_2m_max', i);
    const comChuva = mm.filter(x => x >= 2).length, difT = tx.length > 1 ? Math.max(...tx) - Math.min(...tx) : 0;
    const chuvaIncerta = mm.length > 1 && comChuva > 0 && comChuva < mm.length;
    return {n: mm.length, comChuva, chuvaIncerta, difT: Math.round(difT), firme: !chuvaIncerta && difT <= 4};
  });
  return {...bruto, hourly: h, daily: d, modelos: modelos.map(([, nome]) => nome)};
}
async function buscarClima(forcar = false) {
  const loc = localDaFazenda(); if (!loc || climaBuscando || navigator.onLine === false) return;
  const atual = lerClima();
  if (!forcar && atual && Date.now() - atual.em < 3600000 && Math.abs(atual.lat - loc.lat) < 0.01 && Math.abs(atual.lon - loc.lon) < 0.01) return;
  climaBuscando = true;
  try {
    const base = {latitude: loc.lat.toFixed(4), longitude: loc.lon.toFixed(4), timezone: 'auto', forecast_days: '7', past_days: '1', hourly: [...CLIMA_HORA, 'weather_code'].join(','), daily: CLIMA_DIA.join(',')};
    const pedir = extra => fetch('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({...base, ...extra})).then(r => r.ok ? r.json() : Promise.reject(new Error('clima ' + r.status)));
    // 4 modelos; se o serviço recusar, usa o modelo automático (como antes)
    const dados = await pedir({models: CLIMA_MODELOS.map(([m]) => m).join(',')}).then(combinarModelos).catch(() => pedir({}));
    safeStorage.set(CLIMA_KEY, JSON.stringify({em: Date.now(), lat: loc.lat, lon: loc.lon, dados}));
    if (parseRoute().name === 'inicio') nvAtualizarOuRender();
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
// ---------- Exibição no estilo dos apps de clima: períodos do dia (madrugada, manhã, tarde, noite) e dias com ícone ----------
const PERIODOS_DIA = [['madrugada', 0, 6], ['manhã', 6, 12], ['tarde', 12, 18], ['noite', 18, 24]];
// Ícone pelo céu, chance de chuva e trovoada (de noite e madrugada, lua no lugar do sol)
function iconeTempo({prob = 0, mm = 0, nuvens = 50, trov = 0, noite = false}) {
  if (trov >= 0.4 && prob >= 40) return '⛈️';
  if (prob >= 60 || mm >= 2) return '🌧️';
  if (prob >= 35) return noite ? '☁️' : '🌦️';
  if (nuvens >= 75) return '☁️';
  if (nuvens >= 40) return noite ? '☁️' : '⛅';
  if (nuvens >= 15) return noite ? '🌙' : '🌤️';
  return noite ? '🌙' : '☀️';
}
const maxDe = xs => xs.length ? Math.max(...xs) : null, minDe = xs => xs.length ? Math.min(...xs) : null;
// Próximos 4 períodos a partir de agora
function periodosClima(dados) {
  const h = dados.hourly, agora = new Date(), hora = agora.getHours(), lista = [];
  for (let k = 0; k < 3 && lista.length < 4; k++) {
    const dia = new Date(agora); dia.setDate(dia.getDate() + k); const data = k ? isoLocal(dia) : today();
    PERIODOS_DIA.forEach(([nome, ini, fim]) => {
      if (lista.length >= 4 || (k === 0 && fim <= hora)) return;
      const idx = h.time.map((t, i) => [t, i]).filter(([t]) => t.startsWith(data) && Number(t.slice(11, 13)) >= ini && Number(t.slice(11, 13)) < fim).map(([, i]) => i);
      const temps = idx.map(i => h.temperature_2m[i]).filter(x => x != null); if (!temps.length) return;
      const temp = nome === 'tarde' ? maxDe(temps) : nome === 'madrugada' ? minDe(temps) : mediaDe(temps);
      const prob = maxDe(idx.map(i => h.precipitation_probability?.[i] ?? 0)), mm = idx.reduce((t, i) => t + (h.precipitation?.[i] || 0), 0);
      lista.push({nome, temp, prob, icone: iconeTempo({prob, mm, nuvens: mediaDe(idx.map(i => h.cloud_cover?.[i]).filter(x => x != null)) ?? 50, trov: maxDe(idx.map(i => h.trovoada?.[i] || 0)), noite: nome === 'noite' || nome === 'madrugada'})});
    });
  }
  return lista;
}
// Os 4 períodos de um dia escolhido na lista de 7 dias
// Horários de chuva de um dia: horas com chuva prevista (≥ 0,2 mm ou chance ≥ 60%) agrupadas em faixas.
// Hoje: só a partir da hora atual. Cada faixa: início, fim, mm somados e maior chance.
const CHUVA_HORA_MM = 0.2, CHUVA_HORA_PROB = 60;
function horariosChuva(dados, data, agoraArg) {
  const h = dados?.hourly; if (!h?.time) return [];
  const agora = agoraArg || new Date(), diaRef = agoraArg ? isoLocal(agora) : today();
  const hAgora = `${diaRef}T${String(agora.getHours()).padStart(2, '0')}:00`;
  const faixas = [];
  h.time.forEach((t, i) => {
    if (!t.startsWith(data) || (data === diaRef && t < hAgora)) return;
    const mm = h.precipitation?.[i] || 0, prob = h.precipitation_probability?.[i] ?? 0;
    if (!(mm >= CHUVA_HORA_MM || prob >= CHUVA_HORA_PROB)) return;
    const hora = Number(t.slice(11, 13)), u = faixas.at(-1);
    if (u && hora - u.fim <= 1) { u.fim = hora; u.mm += mm; u.prob = Math.max(u.prob, prob); }
    else faixas.push({ini: hora, fim: hora, mm, prob, agora: t === hAgora});
  });
  return faixas;
}
const hh2 = n => String(n).padStart(2, '0') + 'h';
const txtFaixa = f => `${f.ini === 0 && f.fim === 23 ? 'o dia todo' : `${f.agora ? 'agora' : 'das ' + hh2(f.ini)} ${f.fim > f.ini || f.agora ? 'até ' + (f.fim === 23 ? 'o fim do dia' : hh2(f.fim + 1)) : '(cerca de 1 h)'}`}${f.mm >= 0.5 ? `, ${num(f.mm, f.mm < 10 ? 1 : 0)} mm` : ''}${f.prob ? `, ${Math.round(f.prob)}%` : ''}`;
function txtHorariosChuva(faixas) {
  if (!faixas.length) return '';
  return faixas.slice(0, 3).map(txtFaixa).join('; ') + (faixas.length > 3 ? '…' : '');
}
function periodosDoDia(dados, data) {
  const h = dados.hourly, lista = [];
  PERIODOS_DIA.forEach(([nome, ini, fim]) => {
    const idx = h.time.map((t, i) => [t, i]).filter(([t]) => t.startsWith(data) && Number(t.slice(11, 13)) >= ini && Number(t.slice(11, 13)) < fim).map(([, i]) => i);
    const temps = idx.map(i => h.temperature_2m[i]).filter(x => x != null); if (!temps.length) return;
    const temp = nome === 'tarde' ? maxDe(temps) : nome === 'madrugada' ? minDe(temps) : mediaDe(temps);
    const prob = maxDe(idx.map(i => h.precipitation_probability?.[i] ?? 0)), mm = idx.reduce((t, i) => t + (h.precipitation?.[i] || 0), 0);
    lista.push({nome, temp, prob, icone: iconeTempo({prob, mm, nuvens: mediaDe(idx.map(i => h.cloud_cover?.[i]).filter(x => x != null)) ?? 50, trov: maxDe(idx.map(i => h.trovoada?.[i] || 0)), noite: nome === 'noite' || nome === 'madrugada'})});
  });
  return lista;
}
// Dia escolhido na lista (0 = hoje); volta para hoje ao recarregar
let climaDiaSel = 0;
const isoLocal = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
function iconeDia(dados, i) {
  const h = dados.hourly, d = dados.daily, t = d.time[i], idx = h.time.map((x, k) => [x, k]).filter(([x]) => x.startsWith(t) && Number(x.slice(11, 13)) >= 6 && Number(x.slice(11, 13)) < 19).map(([, k]) => k);
  return iconeTempo({prob: d.precipitation_probability_max[i] ?? 0, mm: d.precipitation_sum[i] || 0, nuvens: mediaDe(idx.map(k => h.cloud_cover?.[k]).filter(x => x != null)) ?? 50, trov: maxDe(idx.map(k => h.trovoada?.[k] || 0)) || 0});
}
const hh = n => String(n).padStart(2, '0') + 'h';
const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'], DIA_SEMANA_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const climaAberto = () => safeStorage.get('agro-clima-aberto') === '1';
// A chamada parte do toque, inclusive no Safari; não depende da Permissions API.
// O navegador decide se mostra a confirmação. Um bloqueio salvo exige ajuste pelo usuário.
let climaLocalEstado = '', climaLocalMensagem = '';
function controleLocalClima() {
  const buscando = climaLocalEstado === 'buscando';
  return `<div class="btn-row"><button type="button" class="secondary" data-act="clima-local"${buscando ? ' disabled' : ''}>${buscando ? 'Buscando localização…' : '📍 Ativar localização'}</button></div>
    <p class="nota" role="status" aria-live="polite">${esc(climaLocalMensagem || 'Toque em Ativar localização e, se o navegador solicitar, escolha Permitir para usar sua posição na previsão do tempo.')}</p>
    ${climaLocalEstado === 'negada' ? `<details class="nota"><summary>Como liberar no Safari do iPhone</summary><p>No Safari, abra o menu da página ao lado do endereço (aA em algumas versões), entre em Ajustes do Site ou Mais → Ajustes do Site e selecione Localização → Permitir. Volte e toque em Ativar localização.</p><p>Se continuar bloqueado, confira Ajustes → Privacidade e Segurança → Serviços de Localização → Sites do Safari e permita durante o uso. Os Serviços de Localização também precisam estar ativados.</p><p>O MercaPlant não consegue alterar uma permissão bloqueada pelo navegador.</p></details>` : ''}`;
}
function atualizarLocalClima() {
  const el = document.getElementById('climaLocalControle');
  if (el) el.innerHTML = controleLocalClima();
}
function solicitarLocalClima() {
  if (climaLocalEstado === 'buscando') return;
  const falha = (estado, mensagem) => { climaLocalEstado = estado; climaLocalMensagem = mensagem; atualizarLocalClima(); };
  if (globalThis.isSecureContext === false) return falha('indisponivel', 'Abra o MercaPlant pelo endereço HTTPS para usar a localização.');
  if (!navigator.geolocation) return falha('indisponivel', 'Este navegador não disponibiliza localização. Confira os ajustes do aparelho.');
  climaLocalEstado = 'buscando'; climaLocalMensagem = 'Aguardando a localização. Se o Safari pedir autorização, toque em Permitir.'; atualizarLocalClima();
  try {
    navigator.geolocation.getCurrentPosition(p => {
      climaLocalEstado = ''; climaLocalMensagem = '';
      db.settings.local = {lat: p.coords.latitude, lon: p.coords.longitude, origem: 'localização da sede'};
      save(); render(); buscarClima(true);
    }, erro => {
      if (erro.code === 1) falha('negada', 'O acesso à localização foi negado ou está bloqueado. Tente novamente pelo botão; se o Safari não perguntar, siga as instruções abaixo.');
      else if (erro.code === 3) falha('tempo', 'A localização demorou a responder. Vá para uma área aberta e toque em Ativar localização para tentar novamente.');
      else falha('sinal', 'A posição está indisponível no momento. Confira os Serviços de Localização e tente novamente em uma área aberta.');
    }, {enableHighAccuracy: false, timeout: 20000, maximumAge: 600000});
  } catch (erro) {
    falha('indisponivel', 'Não foi possível iniciar a localização neste navegador. Confira os ajustes do aparelho e tente novamente.');
  }
}
function cartaoClima() {
  const loc = localDaFazenda(), c = lerClima();
  if (!loc) return `<article class="card panel hoje-clima" id="hojeClima"><h3>Clima e pulverização</h3><p class="nota">Para ver a previsão do tempo e as melhores horas para pulverizar, informe onde fica a fazenda.</p><div id="climaLocalControle">${controleLocalClima()}</div><small class="nota">Ou meça o contorno de um talhão pelo GPS: o app usa o centro dele.</small></article>`;
  if (!c?.dados?.daily) return `<article class="card panel hoje-clima" id="hojeClima"><h3>Clima e pulverização</h3><p class="nota">${navigator.onLine === false ? 'Sem internet: a previsão aparece quando o sinal voltar.' : 'Buscando a previsão…'}</p></article>`;
  const d = c.dados.daily, hoje = today(), i0 = Math.max(0, d.time.indexOf(hoje));
  const jan = janelasDoDia(c.dados, d.time[i0]), amanha = d.time[i0 + 1] ? janelasDoDia(c.dados, d.time[i0 + 1]) : null;
  const txtJan = (j, quando) => j.janelas.length ? `<strong>Boas horas para pulverizar ${quando}:</strong> ${j.janelas.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(', ')}` : `<strong>Sem janela boa para pulverizar ${quando}</strong>${j.principal ? ` (principalmente ${j.principal})` : ''}`;
  const chuvaProx = d.time.map((t, i) => ({t, mm: d.precipitation_sum[i]})).find((x, i) => i >= i0 && x.mm >= 5);
  const idade = Math.round((Date.now() - c.em) / 60000), conf = d.confianca || [], fonte = c.dados.modelos?.length > 1 ? `média de ${c.dados.modelos.length} modelos (${c.dados.modelos.join(', ')})` : 'Open-Meteo';
  // Previsão incerta (modelos discordam): avisa para conferir de novo mais tarde
  const txtConf = k => { const x = conf[k]; if (!x || x.firme) return ''; return x.chuvaIncerta ? `${x.comChuva} de ${x.n} modelos preveem chuva` : `modelos variam ${x.difT} °C na máxima`; };
  const incertaHoje = conf[i0] && !conf[i0].firme;
  // Recolhido (padrão): uma linha com o resumo de hoje; o botão expande os 4 dias, as janelas, a chuva e o critério
  const nDias = Math.min(7, d.time.length - i0), sel = Math.min(Math.max(0, climaDiaSel), Math.max(0, nDias - 1)), iS = i0 + sel, tS = d.time[iS];
  const nomeDia = k => { const dt = new Date(d.time[i0 + k] + 'T12:00:00'); return k === 0 ? 'hoje' : k === 1 ? 'amanhã' : DIA_SEMANA_LONGO[dt.getDay()]; };
  const janSel = sel === 0 ? jan : janelasDoDia(c.dados, tS), periodos = sel === 0 ? periodosClima(c.dados) : periodosDoDia(c.dados, tS);
  const tituloSel = sel === 0 ? '' : `<p class="clima-sel-tit"><strong>${esc(nomeDia(sel).replace(/^./, x => x.toUpperCase()))}, ${fmtDate(tS).slice(0, 5)}</strong> <button type="button" class="link" data-act="clima-dia" data-id="0">voltar para hoje</button></p>`;
  const chHoje = horariosChuva(c.dados, hoje), chSel = sel === 0 ? chHoje : horariosChuva(c.dados, tS);
  const chuvaHojeCurto = chHoje.length ? (chHoje[0].agora ? ' • chovendo agora' : ` • chuva às ${hh2(chHoje[0].ini)}`) : '';
  const aberto = climaAberto(), hj = Math.round(d.temperature_2m_max[i0]) + '° / ' + Math.round(d.temperature_2m_min[i0]) + '°';
  const resumo = jan.janelas.length ? `Pulverizar: ${jan.janelas.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(', ')}` : 'Sem janela boa para pulverizar hoje';
  return `<article class="card panel hoje-clima ${aberto ? 'aberto' : ''}" id="hojeClima">
    <button type="button" class="clima-linha" data-act="clima-expandir" aria-expanded="${aberto}" aria-controls="climaCorpo">
      <span class="clima-ic" aria-hidden="true">${iconeDia(c.dados, i0)}</span>
      <span class="clima-txt"><strong>Hoje ${hj}</strong><small class="${jan.janelas.length ? 'ok' : 'nao'}">${esc(resumo)}${chuvaHojeCurto || (chuvaProx ? ` • chuva ${chuvaProx.t === hoje ? 'hoje' : fmtDate(chuvaProx.t).slice(0, 5)}` : '')}${incertaHoje ? ' • previsão incerta' : ''}</small></span>
      <span class="clima-seta" aria-hidden="true">${aberto ? '▴' : '▾'}</span><span class="sr-only">${aberto ? 'Recolher' : 'Ver'} a previsão</span></button>
    ${aberto ? `<div id="climaCorpo">
    ${tituloSel}<div class="clima-periodos">${periodos.map(p => `<div class="clima-per"><small>${p.nome}</small><b class="clima-t">${Math.round(p.temp)}°</b><span class="clima-icone" aria-hidden="true">${p.icone}</span><small>💧 ${Math.round(p.prob)}%</small></div>`).join('')}</div>
    <div class="clima-dias" role="group" aria-label="Previsão dos próximos dias: toque em um dia para ver os detalhes">${d.time.slice(i0, i0 + 7).map((t, k) => { const i = i0 + k, sol = d.sunshine_duration?.[i]; return `<button type="button" class="clima-dia ${k === 0 ? 'hoje' : ''} ${k === sel ? 'sel' : ''}" data-act="clima-dia" data-id="${k}" aria-pressed="${k === sel}"><small><b>${nomeDia(k)}</b><br>${fmtDate(t).slice(0, 5)}</small><b class="clima-max">${Math.round(d.temperature_2m_max[i])}°</b><b class="clima-min">${Math.round(d.temperature_2m_min[i])}°</b><span class="clima-icone" aria-hidden="true">${iconeDia(c.dados, i)}</span>${sol != null ? `<small>☀ ${Math.round(sol / 3600)} h</small>` : ''}<small>💧 ${Math.round(d.precipitation_probability_max[i] ?? 0)}%</small>${d.precipitation_sum[i] >= 1 ? `<small>${num(d.precipitation_sum[i], 0)} mm</small>` : ''}<small>💨 ${Math.round(d.wind_speed_10m_max[i])} km/h</small>${conf[i] ? `<small class="clima-conf ${conf[i].firme ? 'firme' : 'incerta'}" title="${esc(txtConf(i) || 'Os modelos concordam')}">${conf[i].firme ? '✓ firme' : '⚠ incerta'}</small>` : ''}</button>`; }).join('')}</div>
    ${sel === 0 && chHoje.length ? `<p class="hoje-chuva">🌧 <strong>Chuva hoje:</strong> ${esc(txtHorariosChuva(chHoje))}</p>` : ''}
    ${sel === 0 ? `<p class="hoje-jan ${jan.janelas.length ? 'ok' : 'nao'}">${txtJan(jan, 'hoje')}</p>${amanha ? `<p class="hoje-jan ${amanha.janelas.length ? 'ok' : 'nao'}">${txtJan(amanha, 'amanhã')}</p>` : ''}` : `<p class="hoje-jan ${janSel.janelas.length ? 'ok' : 'nao'}">${txtJan(janSel, sel === 1 ? 'amanhã' : 'neste dia')}</p>${chSel.length ? `<p class="hoje-chuva">🌧 <strong>Chuva ${sel === 1 ? 'amanhã' : 'neste dia'}:</strong> ${esc(txtHorariosChuva(chSel))}${d.precipitation_sum[iS] >= 1 ? ` <small class="nota">(total do dia ${num(d.precipitation_sum[iS], 0)} mm)</small>` : ''}</p>` : d.precipitation_sum[iS] >= 1 ? `<p class="nota">🌧 ${num(d.precipitation_sum[iS], 0)} mm previstos neste dia (chance de ${Math.round(d.precipitation_probability_max[iS] ?? 0)}%).</p>` : ''}${conf[iS] && !conf[iS].firme ? `<p class="nota clima-aviso">⚠ Previsão incerta para este dia (${esc(txtConf(iS))}).</p>` : ''}`}
    ${incertaHoje ? `<p class="nota clima-aviso">⚠ Previsão de hoje incerta (${esc(txtConf(i0))}): confira de novo mais tarde antes de pulverizar ou plantar.</p>` : ''}
    ${chuvaProx ? `<p class="nota">🌧 Chuva de ${num(chuvaProx.mm, 0)} mm prevista para ${chuvaProx.t === hoje ? 'hoje' : fmtDate(chuvaProx.t)}: programe aplicações e colheita.</p>` : ''}
    <small class="nota">Critério: vento 3–10 km/h, Delta T 2–8 °C, até 30 °C, umidade ≥ 50% e sem chuva. Orientação — confirme as condições no campo. Previsão: ${esc(fonte)}, via Open-Meteo, para ${esc(loc.origem)}, atualizada há ${idade < 60 ? idade + ' min' : Math.round(idade / 60) + ' h'}. <button class="link" data-act="clima-atualizar">Atualizar agora</button></small></div>` : ''}</article>`;
}
Object.assign(ACTIONS, {
  'hoje-mais': () => { hojeTodos = true; render(); },
  'clima-expandir': () => { safeStorage.set('agro-clima-aberto', climaAberto() ? '0' : '1'); const el = document.getElementById('hojeClima'); if (el) el.outerHTML = cartaoClima(); },
  'chuva-ontem': mm => chuvaForm({date: daysAgo(1), mm, fonte: 'estimativa', notes: 'Estimativa da previsão do tempo (média dos modelos) — conferir no pluviômetro'}),
  'clima-atualizar': () => { if (navigator.onLine === false) return showToast('Sem internet agora'); buscarClima(true); showToast('Atualizando a previsão…'); },
  'clima-local': solicitarLocalClima,
  'clima-dia': k => {
    climaDiaSel = Number(k) || 0;
    const el = document.getElementById('hojeClima'); if (!el) return;
    const rol = el.querySelector('.clima-dias')?.scrollLeft || 0;
    el.outerHTML = cartaoClima();
    const lista = document.querySelector('#hojeClima .clima-dias'); if (lista) lista.scrollLeft = rol;
  }
});

const nvAtualizarOuRender = () => typeof nvAtualizarTela === 'function' ? nvAtualizarTela() : render();
// Choveu ontem pela previsão e ninguém registrou: sugere registrar (o produtor confere no pluviômetro)
function chuvaDeOntem() {
  const c = lerClima(), ontem = daysAgo(1);
  if (!c?.dados?.daily || (typeof nvPodeRota === 'function' && !nvPodeRota('chuva'))) return null;
  const i = c.dados.daily.time.indexOf(ontem), mm = i >= 0 ? c.dados.daily.precipitation_sum[i] : null;
  if (!(mm >= 1) || db.chuvas.some(x => x.date === ontem)) return null;
  return {mm: Math.round(mm), data: ontem};
}

// ---------- Hoje: o que fazer, em ordem de prioridade ----------
function painelHoje() {
  const t = today(), al = alerts();
  const ops = db.operations.filter(o => o.status === 'Em andamento' || (o.status === 'Programada' && o.date && o.date <= t)).sort((a, b) => (a.status === 'Em andamento' ? 0 : 1) - (b.status === 'Em andamento' ? 0 : 1) || (a.date || '').localeCompare(b.date || ''));
  const PESO = {red: 0, orange: 1, purple: 2, blue: 3};
  const ch = chuvaDeOntem();
  const itens = [...al.filter(a => a.color === 'red'), ...ops.map(o => ({op: o})), ...(ch ? [{chuva: ch}] : []), ...al.filter(a => a.color !== 'red').sort((a, b) => (PESO[a.color] ?? 9) - (PESO[b.color] ?? 9))];
  const linha = x => x.chuva
    ? `<div class="hoje-item"><span class="alert-icon blue">🌧</span><div><strong>Choveu cerca de ${num(x.chuva.mm)} mm ontem</strong><small>Estimativa da previsão do tempo. Confira o pluviômetro e registre.</small></div>${mini('Registrar', 'chuva-ontem', x.chuva.mm)}</div>`
    : x.op
    ? `<div class="hoje-item"><span class="alert-icon ${x.op.status === 'Em andamento' ? 'green' : x.op.date < t ? 'red' : 'blue'}">◷</span><div><strong>${esc(x.op.type)} — ${esc(opPlace(x.op))}</strong><small>${x.op.status === 'Em andamento' ? 'Em andamento' : x.op.date < t ? `Atrasada (era para ${fmtDate(x.op.date)})` : 'Programada para hoje'}${x.op.machineId ? ' • ' + esc(machineName(x.op.machineId)) : ''}${(() => { const p = duracaoPrevista(x.op); return p ? ` • previsto ~${um1(p.horas)} h` : ''; })()}</small></div>${x.op.status === 'Em andamento' ? mini('✓ Concluir', 'op-done', x.op.id, 'ok') : mini('▶ Iniciar', 'op-start', x.op.id)}</div>`
    : x.acao ? `<div class="hoje-item"><span class="alert-icon ${x.color}">${x.icon}</span><div><strong>${esc(x.title)}</strong><small>${esc(x.text)}</small></div>${mini(x.acao.label, x.acao.act, x.acao.id || '')}</div>`
    : `<div class="hoje-item clickable" data-act="nav" data-id="${esc(x.route)}"><span class="alert-icon ${x.color}">${x.icon}</span><div><strong>${esc(x.title)}</strong><small>${esc(x.text)}</small></div><span class="hoje-ir" aria-hidden="true">›</span></div>`;
  const data = new Date().toLocaleDateString('pt-BR', {weekday: 'long', day: 'numeric', month: 'long'});
  // Recolhido (padrão): resumo + só o que é crítico (avisos vermelhos/laranja e operações atrasadas). Expandido: tudo.
  const aberto = hojeAberto(), atrasadas = ops.filter(o => o.status === 'Programada' && o.date < t).length, andamento = ops.filter(o => o.status === 'Em andamento').length;
  const critico = x => x.op ? x.op.status === 'Programada' && x.op.date < t : !x.chuva && (x.color === 'red' || x.color === 'orange');
  const criticos = itens.filter(critico), avisos = itens.length - ops.length - (ch ? 1 : 0);
  const partes = [atrasadas ? `${atrasadas} ${atrasadas === 1 ? 'atrasada' : 'atrasadas'}` : '', andamento ? `${andamento} em andamento` : '', avisos > 0 ? `${avisos} ${avisos === 1 ? 'aviso' : 'avisos'}` : ''].filter(Boolean);
  const temUrgente = atrasadas > 0 || al.some(a => a.color === 'red');
  const LIM = 12, lista = aberto ? (hojeTodos ? itens : itens.slice(0, LIM)) : criticos.slice(0, 5);
  const resto = itens.length - lista.length;
  const rodape = !itens.length ? '' : aberto
    ? (resto > 0 ? `<button class="link hoje-vermais" data-act="hoje-mais">Ver mais ${resto} ${resto === 1 ? 'item' : 'itens'}</button>` : '')
    : (resto > 0 ? `<button class="link hoje-vermais" data-act="hoje-expandir">Ver ${lista.length ? 'todas' : 'as'} ${itens.length} ${itens.length === 1 ? 'pendência' : 'pendências'} ▾</button>` : '');
  return `<section class="hoje">${cartaoClima()}<article class="card panel hoje-fazer ${aberto ? 'aberto' : ''}" id="hojeFazer">
    <button type="button" class="clima-linha" data-act="hoje-expandir" aria-expanded="${aberto}" aria-controls="hojeCorpo">
      <span class="alert-icon ${itens.length ? (temUrgente ? 'red' : 'blue') : 'green'} hoje-ic" aria-hidden="true">${typeof iconeLinha === 'function' ? iconeLinha(itens.length ? (temUrgente ? 'alerta' : 'lista') : 'check', 20) : ''}</span>
      <span class="clima-txt"><strong>Hoje <small class="hoje-data">${esc(data)}</small></strong><small class="${temUrgente ? 'nao' : 'ok'}">${itens.length ? `${itens.length} ${itens.length === 1 ? 'pendência' : 'pendências'}${partes.length ? ' • ' + esc(partes.join(' • ')) : ''}` : 'Tudo em dia'}</small></span>
      <span class="clima-seta" aria-hidden="true">${aberto ? '▴' : '▾'}</span><span class="sr-only">${aberto ? 'Mostrar só o crítico' : 'Ver todas as pendências de hoje'}</span></button>
    <div id="hojeCorpo">${aberto ? `<div class="btn-row hoje-botoes">${btn('Resumo da semana', 'resumo-semana', '', 'secondary')}${btn('+ Operação', 'op-new', '', 'secondary')}${typeof alertaCfg === 'function' && !alertaCfg().ativo && suporteAlertas() ? btn('🔔 Avisar no celular', 'alertas-ligar', '', 'secondary') : ''}</div>` : ''}
      ${lista.length ? `${!aberto ? '<p class="hoje-crit-tit">Precisa de atenção</p>' : ''}${lista.map(linha).join('')}` : aberto && !itens.length ? empty('Tudo em dia', 'Nenhuma pendência para hoje.') : ''}${rodape}</div></article>
    </section>${resumoDia()}<!--fim-hoje-->`;
}
// Resumo do dia: só operação (nada de custo ou estoque); cada número leva à tela dele
function resumoDia() {
  const t = today(), pode = r => typeof nvPodeRota !== 'function' || nvPodeRota(r), tiles = [];
  const opsHoje = db.operations.filter(o => o.status === 'Em andamento' || o.date === t);
  if (pode('operacoes')) {
    const and = opsHoje.filter(o => o.status === 'Em andamento').length, prog = opsHoje.filter(o => o.status === 'Programada').length, conc = opsHoje.filter(o => o.status === 'Concluída').length;
    const atr = db.operations.filter(o => o.status === 'Programada' && o.date && o.date < t).length;
    tiles.push(['operacoes', 'Operações hoje', opsHoje.filter(o => o.status !== 'Cancelada').length, [and ? `${and} em andamento` : '', prog ? `${prog} programada${prog > 1 ? 's' : ''}` : '', conc ? `${conc} concluída${conc > 1 ? 's' : ''}` : ''].filter(Boolean).join(' • ') || 'nada programado', atr ? `${atr} atrasada${atr > 1 ? 's' : ''}` : '']);
    const equipe = [...new Set(opsHoje.filter(o => o.status !== 'Cancelada').map(o => String(o.operator || '').trim()).filter(Boolean))];
    tiles.push(['operacoes', 'Equipe nas operações', equipe.length, equipe.length ? equipe.slice(0, 3).join(', ') + (equipe.length > 3 ? ` e mais ${equipe.length - 3}` : '') : 'nenhum operador nas operações de hoje', '']);
  }
  if (pode('maquinas') && db.machines.length) {
    const ativas = db.machines.filter(m => !isInactive(m)), emUso = new Set(db.operations.filter(o => o.status === 'Em andamento' && o.machineId).map(o => o.machineId));
    const manut = ativas.filter(m => machineStatus(m) === 'Em manutenção').length, uso = ativas.filter(m => emUso.has(m.id)).length;
    tiles.push(['maquinas', 'Máquinas', ativas.length, [`${uso} em uso`, `${ativas.length - uso - manut} disponíve${ativas.length - uso - manut === 1 ? 'l' : 'is'}`].join(' • '), manut ? `${manut} em manutenção` : '']);
  }
  const secando = (db.lotesSecagem || []).filter(l => l.status === 'Em andamento');
  if (secando.length && pode('graos')) tiles.push(['graos/secador', 'Secagem', secando.length, secando.slice(0, 2).map(l => { const u = (l.leituras || []).filter(x => x.umidade != null).at(-1)?.umidade ?? l.umidadeEntrada; return `${typeof nomeEquip === 'function' ? nomeEquip(l.secadorId) : 'Secador'}${u != null ? ` ${num(u, 1)}%` : ''}`; }).join(' • '), '']);
  if (pode('chuva') && db.chuvas.length) {
    const desde = daysAgo(6), mm = db.chuvas.filter(c => c.date >= desde && c.date <= t).reduce((s, c) => s + (Number(c.mm) || 0), 0), ult = db.chuvas.slice().sort(byDateDesc)[0];
    tiles.push(['chuva', 'Chuva em 7 dias', `${num(mm)} mm`, ult ? `última: ${fmtDate(ult.date).slice(0, 5)}, ${num(ult.mm)} mm` : '', '']);
  }
  if (!tiles.length) return '';
  return `<section class="dia-tiles" aria-label="Resumo do dia">${tiles.map(([rota, rot, val, sub, alerta]) => `<button type="button" class="dia-tile" data-act="nav" data-id="${rota}"><small>${esc(rot)}</small><strong>${typeof val === 'number' ? num(val) : esc(val)}</strong><span>${esc(sub)}</span>${alerta ? `<em>${esc(alerta)}</em>` : ''}</button>`).join('')}</section>`;
}
let hojeTodos = false;
const hojeAberto = () => safeStorage.get('agro-hoje-aberto') === '1';
ACTIONS['hoje-expandir'] = () => { hojeTodos = false; safeStorage.set('agro-hoje-aberto', hojeAberto() ? '0' : '1'); render(); };
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
// Safra mostrada no relatório: a do talhão quando o período é o dela; com outro período escolhido, a safra do meio do período
// (custos, margem e planejado x realizado precisam ser da mesma safra das operações listadas)
function safraDoPeriodo(f, p) {
  if (!p || p.nome === `Safra ${f.season}`) return f.season || '';
  const meio = new Date((new Date(p.ini + 'T12:00:00').getTime() + new Date(p.fim + 'T12:00:00').getTime()) / 2);
  return (typeof safraDaData === 'function' && safraDaData(isoDate(meio), f.season)) || f.season || '';
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
  const sf = safraDoPeriodo(f, p), ana = typeof analiseSafra === 'function' && sf ? analiseSafra(sf).linhas.find(l => l.id === id) : null;
  const fin = typeof nvVeFinanceiro !== 'function' || nvVeFinanceiro();
  const lib = typeof liberacaoColheita === 'function' ? liberacaoColheita(id) : null;
  const linha = (k, v) => v ? `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>` : '';
  const tabela = (cab, linhas) => linhas.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>` : '<p class="nota">Nenhum registro no período.</p>';
  const brlR = v => v == null ? '—' : `${v < 0 ? '− ' : ''}R$ ${num(Math.abs(v), 2)}`;
  return `<div class="no-print">${head('Relatório da safra', `${f.name} • ${p.nome}`, btn('← Talhão', 'nav', 'talhao/' + id, 'secondary') + btn('Imprimir', 'af-imprimir', '', 'secondary') + btn('Enviar PDF (WhatsApp)', 'safra-pdf-enviar', id, 'secondary') + btn('Baixar PDF', 'safra-pdf', id))}
    <section class="card panel safra-periodo"><label>De <input type="date" data-safra-ini="${esc(id)}" value="${p.ini}"></label><label>até <input type="date" data-safra-fim="${esc(id)}" value="${p.fim}"></label></section></div>
  <article class="card panel relatorio">
    <header class="rel-head"><div><strong>${esc(db.settings.farm || 'MercaPlant')}</strong><br><small>Relatório da safra — ${esc(f.name)}</small></div><small>${fmtDate(p.ini)} a ${fmtDate(p.fim)}</small></header>
    <h3>1. Talhão</h3><table class="tbl"><tbody>${linha('Talhão', f.name)}${linha('Área', area ? num(area) + ' ha' : '')}${linha('Cultura', f.crop)}${linha('Cultivar', f.cultivar)}${linha('Safra', sf)}${linha('Chuva acumulada no período', chuva ? num(chuva, 0) + ' mm' : '')}${linha('Colheita liberada (carência)', lib ? (lib.libera > today() ? 'a partir de ' + fmtDate(lib.libera) : 'liberada') : '')}</tbody></table>
    <h3>2. Operações (${ops.length})</h3>${tabela(['Data', 'Operação', 'Máquina', 'Área / quantidade', 'Horas', 'Situação'], ops.map(o => `<tr><td>${fmtDate(o.date)}</td><td>${esc(o.type)}</td><td>${esc(machineName(o.machineId) || '—')}</td><td>${o.area && opTemArea(o) ? num(o.area) + ' ha' : o.kg ? num(o.kg) + ' kg' : '—'}</td><td>${o.horas ? um1(o.horas) + ' h' : '—'}</td><td>${esc(o.status)}</td></tr>`))}
    <h3>3. Aplicações de defensivos (${aps.length})</h3>${tabela(['Data', 'Produto e dose', 'Receituário', 'Resp. técnico', 'Carência'], aps.map(a => `<tr><td>${fmtDate(a.date)}</td><td><strong>${esc(a.produto)}</strong>${a.dose ? '<br><small>' + esc(a.dose) + '</small>' : ''}</td><td>${esc(a.receituario || '—')}</td><td>${esc(a.responsavel || '—')}</td><td>${num(a.carencia)} d (até ${fmtDate(addDias(a.date, Number(a.carencia) || 0))})</td></tr>`))}
    <h3>4. Monitoramento de pragas e doenças (${mon.length})</h3>${tabela(['Data', 'Alvo', 'Média', 'Nível de ação'], mon.map(m => `<tr><td>${fmtDate(m.date)}</td><td>${esc(m.alvo)}</td><td>${num(m.valor, 2)} ${esc(m.unidade || '')}</td><td>${m.nivelAcao !== '' && m.nivelAcao != null ? num(m.nivelAcao, 2) : '—'}</td></tr>`))}
    <h3>5. Colheita</h3><table class="tbl"><tbody>${col.length ? linha('Produção', `${sacas >= 100 ? num(sacas) : um1(sacas)} sacas de 60 kg`) + linha('Produtividade', area ? `${um1(sacas / area)} sc/ha` : '') : '<tr><td>Sem colheita registrada no período.</td></tr>'}</tbody></table>
    ${fin && ana ? `<h3>6. Custos e resultado</h3><table class="tbl"><tbody>${linha('Custo total', brlR(ana.custo))}${linha('Custo por hectare', ana.custoHa != null ? brlR(ana.custoHa) : '')}${linha('Custo por saca', ana.custoSc != null ? brlR(ana.custoSc) : '')}${linha('Receita (preço médio de venda)', ana.receita != null ? brlR(ana.receita) : '')}${linha('Margem', ana.margem != null ? brlR(ana.margem) : '')}${linha('Ponto de equilíbrio', ana.equilibrio != null ? num(ana.equilibrio, 1) + ' sc/ha' : '')}${(() => { const cm = ops.reduce((t, o) => t + (custoOperacao(o) || 0), 0); return cm > 0 ? linha('Custo estimado das máquinas nas operações (horas × custo/h; não somado acima)', brlR(cm)) : ''; })()}</tbody></table>` : ''}
    <p class="nota">Gerado pelo MercaPlant a partir dos registros da fazenda em ${fmtDate(today())}.</p>
  </article>`;
};
TITLES.safra = 'Relatório da safra';

// ---------- Compartilhar (WhatsApp, e-mail…) ----------
async function compartilharTexto(titulo, texto) {
  try { if (navigator.share) { await navigator.share({title: titulo, text: texto}); return; } } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(texto); showToast('Texto copiado: cole no WhatsApp ou no e-mail'); }
  catch { const ta = $('#textoCompartilhar'); if (ta) { ta.select(); showToast('Selecione e copie o texto'); } }
}
function dialogoTexto(titulo, sub, texto) {
  dialog.innerHTML = `<h3>${esc(titulo)}</h3><p class="sub">${esc(sub)}</p><textarea id="textoCompartilhar" class="texto-compartilhar" rows="14" readonly>${esc(texto)}</textarea>
    <div class="actions"><button class="secondary" data-close>Fechar</button><a class="btn-whats" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">WhatsApp</a><button class="primary" data-compartilhar>Compartilhar</button></div>`;
  $('[data-close]', dialog).onclick = closeModal;
  $('[data-compartilhar]', dialog).onclick = () => compartilharTexto(titulo, texto);
  modal.classList.add('open');
}

// ---------- Lista de compras (estoque baixo e itens que acabam em até 30 dias) ----------
function listaCompras() {
  return db.stock.map(s => {
    const p = previsaoEstoque(s), min = Number(s.min) || 0, qtd = Number(s.qty) || 0;
    const baixo = stockLow(s), acaba = p && p.dias <= 30;
    if (!baixo && !acaba) return null;
    // Quanto comprar: o que falta para 30 dias de consumo (se houver ritmo) e nunca menos que o mínimo
    const precisa = Math.max(min - qtd, p ? p.porDia * 30 - qtd : 0, baixo ? min * 2 - qtd : 0);
    return {s, qtd: Math.ceil(Math.max(precisa, 0)), motivo: baixo ? `abaixo do mínimo (${num(min)} ${s.unit})` : `acaba em ~${p.dias} dias`};
  }).filter(x => x && x.qtd > 0).sort((a, b) => a.s.name.localeCompare(b.s.name, 'pt-BR'));
}
function abrirListaCompras() {
  const l = listaCompras();
  if (!l.length) { showToast('Nada a comprar: nenhum item abaixo do mínimo ou acabando em 30 dias'); return; }
  const texto = `🛒 Lista de compras — ${db.settings.farm || 'Fazenda'} (${fmtDate(today())})\n\n` + l.map(x => `• ${x.s.name}: ${num(x.qtd)} ${x.s.unit}  (${x.motivo}; saldo ${num(x.s.qty)} ${x.s.unit})`).join('\n') +
    `\n\nQuantidades para cerca de 30 dias de consumo, pelo uso das últimas semanas. Gerado pelo MercaPlant.`;
  dialogoTexto('Lista de compras', `${l.length} ${l.length === 1 ? 'item' : 'itens'} — confira e compartilhe com quem compra.`, texto);
}

// ---------- Resumo da semana (para o dono ou o grupo da fazenda) ----------
function resumoSemana() {
  const ini = daysAgo(6), fim = today(), no = r => (r.date || '') >= ini && (r.date || '') <= fim;
  const fin = typeof nvVeFinanceiro !== 'function' || nvVeFinanceiro();
  const ops = db.operations.filter(o => o.status === 'Concluída' && no(o));
  const ha = ops.filter(opTemArea).reduce((t, o) => t + (Number(o.area) || 0), 0), horas = ops.reduce((t, o) => t + (Number(o.horas) || 0), 0);
  const porTipo = Object.entries(ops.reduce((acc, o) => { acc[o.type] = (acc[o.type] || 0) + 1; return acc; }, {})).map(([t, n]) => `${t} (${n})`).join(', ');
  const chuvas = db.chuvas.filter(no), mm = chuvas.length ? Math.max(...Object.values(chuvas.reduce((acc, c) => { const k = c.fieldId || ''; acc[k] = (acc[k] || 0) + Number(c.mm || 0); return acc; }, {}))) : 0;
  const litros = db.fuel.filter(no).reduce((t, f) => t + (Number(f.liters) || 0), 0);
  const aps = db.aplicacoes.filter(no), colh = db.colheitas.filter(no).reduce((t, c) => t + Number(c.kg || 0) / 60, 0);
  const gastos = fin ? db.expenses.filter(no).reduce((t, g) => t + (Number(g.value) || 0), 0) : 0;
  const prox = db.operations.filter(o => o.status === 'Programada' && o.date > fim && o.date <= addDias(fim, 7));
  const al = alerts(), urg = al.filter(a => a.color === 'red');
  const linhas = [`📋 Resumo da semana — ${db.settings.farm || 'Fazenda'}`, `${fmtDate(ini)} a ${fmtDate(fim)}`, '',
    `✅ Operações concluídas: ${ops.length}${porTipo ? ` — ${porTipo}` : ''}`,
    ha ? `🌱 Área trabalhada: ${num(ha)} ha${horas ? ` em ${um1(horas)} h de máquina` : ''}` : '',
    colh ? `🌾 Colheita: ${num(colh)} sacas` : '',
    aps.length ? `🧪 Aplicações: ${aps.length} (${[...new Set(aps.map(a => a.produto))].slice(0, 4).join(', ')})` : '',
    `🌧 Chuva: ${mm ? num(mm, 0) + ' mm' : 'sem registro'}`,
    litros ? `⛽ Diesel: ${num(litros)} L` : '',
    fin && gastos ? `💰 Gastos lançados: R$ ${num(gastos, 2)}` : '',
    '', `📅 Próximos 7 dias: ${prox.length ? prox.slice(0, 6).map(o => `${o.type} (${fmtDate(o.date).slice(0, 5)})`).join(', ') : 'nenhuma operação programada'}`,
    urg.length ? `⚠ Pendências urgentes: ${urg.slice(0, 5).map(a => a.title).join('; ')}` : '✔ Sem pendências urgentes',
    '', 'Gerado pelo MercaPlant.'];
  return linhas.filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0)).join('\n');
}
Object.assign(ACTIONS, {
  'compras': () => abrirListaCompras(),
  'mip-talhao': id => monitoramentoForm({fieldId: id}),
  'resumo-semana': () => dialogoTexto('Resumo da semana', 'Confira e compartilhe com o dono ou o grupo da fazenda.', resumoSemana()),
  'rev-abrir': id => { const m = find('machines', id); if (!m) return; maintenanceForm({machineId: id, kind: 'Preventiva', description: `Revisão de ${num(m.nextService)} h`}); }
});
document.addEventListener('change', e => {
  const id = e.target.dataset?.safraIni || e.target.dataset?.safraFim; if (!id) return;
  const ini = $(`[data-safra-ini="${id}"]`)?.value, fim = $(`[data-safra-fim="${id}"]`)?.value;
  if (ini && fim && ini <= fim) { safraPeriodo[id] = {ini, fim}; render(); }
});
if (typeof NV_ROTA_TELA === 'object') NV_ROTA_TELA.safra = 'talhoes'; // mesma permissão da tela de talhões
