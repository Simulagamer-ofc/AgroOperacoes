'use strict';
/* MercaPlant — Edy proativo: avisa antes de a pessoa perguntar.
   • Avisos que cruzam os dados (calculados no aparelho, sem gastar IA):
     chuva forte + operação programada no dia (sugere o melhor dia) • aplicação feita + chuva logo depois (produto pode ter
     sido lavado) • pulverização programada num dia sem janela boa • colheita marcada antes de acabar a carência •
     máquina com revisão vencida escalada para operação • vigor do satélite (NDVI) que caiu num talhão em ciclo.
     Aparecem no sino como "Edy: …", no resumo da tela do Edy e como notificação no celular (Ajustes → Alertas).
   • Resumo da manhã: tempo do dia, janela de pulverização, o que está programado e o que precisa de atenção —
     notificação às 6h30 e cartão no topo da tela do Edy.
   • Registros prontos (IA que age): o Edy devolve o registro e aqui ele vira formulário preenchido para conferir e salvar.
   • Histórico do vigor (NDVI) por talhão, para comparar a imagem atual com a anterior.
   Testado em referencias/tests/edy.test.js. */
const EDY_CHUVA_FORTE = 20, EDY_LAVA_MM = 5, EDY_NDVI_HIST = 'agro-ndvi-hist', EDY_QUEDA_NDVI = 0.1;
const EDY_SENSIVEL = /plantio|aplica|pulveri|dessec|aduba|colheita|preparo/i, EDY_PULV = /aplica|pulveri|dessec/i;
const edyAdd = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const edyDm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const edyN = (v, c = 0) => { const r = Math.round(Number(v) * 10 ** c) / 10 ** c; return typeof num === 'function' ? num(r, 0) : String(r).replace('.', ','); };
function edyDiaTxt(d, hoje) {
  if (d === hoje) return 'hoje';
  if (d === edyAdd(hoje, 1)) return 'amanhã';
  if (d === edyAdd(hoje, -1)) return 'ontem';
  return `${new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', {weekday: 'long'}).replace('-feira', '')} (${edyDm(d)})`;
}
const edyLocal = o => (typeof fieldName === 'function' && fieldName(o.fieldId)) || o.place || 'sede';
// "no Talhão 08" / "na sede" / "em Unidade de beneficiamento"
const edyNo = o => { const t = typeof fieldName === 'function' && fieldName(o.fieldId); return t ? `no ${t}` : o.place ? `em ${o.place}` : 'na sede'; };
const edyClima = () => { try { const c = typeof lerClima === 'function' ? lerClima() : null; return c?.dados?.daily?.time ? c : null; } catch { return null; } };
const edyLista = c => Array.isArray(db?.[c]) ? db[c] : [];

// ---------- Vigor por satélite: histórico das imagens por talhão ----------
function edyNdviLer() { try { const h = JSON.parse(safeStorage.get(EDY_NDVI_HIST) || '[]'); return Array.isArray(h) ? h : []; } catch { return []; } }
function edyNdviGuardar(n) {
  if (!n?.data || !Array.isArray(n.talhoes)) return;
  const dia = String(n.data).slice(0, 10), h = edyNdviLer().filter(x => x.data !== dia);
  const v = Object.fromEntries(n.talhoes.filter(t => t && t.ndvi != null && Number.isFinite(Number(t.ndvi))).map(t => [t.id, Math.round(Number(t.ndvi) * 1000) / 1000]));
  if (!Object.keys(v).length) return;
  h.push({data: dia, v}); h.sort((a, b) => a.data.localeCompare(b.data));
  safeStorage.set(EDY_NDVI_HIST, JSON.stringify(h.slice(-24)));
}
/** Vigor do talhão: imagem atual e a anterior (para a IA e para o aviso de queda). */
function edyNdviTalhao(id) {
  const h = edyNdviLer().filter(x => x.v && x.v[id] != null); if (!h.length) return null;
  const a = h[h.length - 1], b = h[h.length - 2];
  return {atual: a.v[id], data: a.data, ...(b ? {anterior: b.v[id], dataAnterior: b.data, variacao: Math.round((a.v[id] - b.v[id]) * 1000) / 1000} : {})};
}
if (typeof tecNdvi === 'function') {
  const _tecNdvi = tecNdvi;
  // eslint-disable-next-line no-global-assign
  tecNdvi = function (...a) { return _tecNdvi(...a).then(n => { try { edyNdviGuardar(n); } catch { /* sem armazenamento */ } return n; }); };
  try { edyNdviGuardar(typeof tecLerNdvi === 'function' ? tecLerNdvi() : null); } catch { /* */ }
}

// ---------- Tempo: melhor dia e chuva depois de uma hora ----------
/** Primeiro dia depois de `depois` (até 7 dias) sem chuva (< 5 mm) e, se for pulverização, com janela boa. */
function edyMelhorDia(c, depois, pulv, hoje) {
  const d = c?.dados?.daily; if (!d) return null;
  for (let i = 0; i < d.time.length; i++) {
    const t = d.time[i]; if (t <= depois || t < hoje || t > edyAdd(hoje, 7)) continue;
    if (!(Number(d.precipitation_sum?.[i]) < EDY_LAVA_MM)) continue;
    if (!pulv) return {dia: t};
    if (c.dados.hourly?.time && typeof janelasDoDia === 'function') { const j = janelasDoDia(c.dados, t); if (j.janelas.length) return {dia: t, janela: j.janelas.map(([a, b]) => `${a}h–${b}h`).join(', ')}; }
  }
  return null;
}
/** Chuva prevista (mm) por hora entre dois instantes 'AAAA-MM-DDTHH:MM' (só horas que ainda vêm). */
function edyChuvaPrevista(c, de, ate) {
  const h = c?.dados?.hourly; if (!h?.time || !h.precipitation) return 0;
  let s = 0; h.time.forEach((t, i) => { if (t >= de && t < ate) s += Number(h.precipitation[i]) || 0; });
  return Math.round(s * 10) / 10;
}
const edyAgoraIso = agora => { const d = new Date(agora); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 13) + ':00'; };

// ---------- Avisos que cruzam os dados ----------
/** Lista de avisos [{id, tipo, cor, icone, dia, titulo, texto, rota, acao}] (mais urgentes primeiro). */
function edyAvisos(hoje = today(), agora = Date.now()) {
  const out = [], c = edyClima(), d = c?.dados?.daily, jaAvisada = new Set();
  const prog = edyLista('operations').filter(o => o.status === 'Programada' && o.date >= hoje && o.date <= edyAdd(hoje, 3));
  const sugestao = (m, hoje2) => m ? ` Melhor dia: ${edyDiaTxt(m.dia, hoje2)}${m.janela ? `, ${m.janela}` : ''}.` : '';
  // 1. Chuva forte no dia de uma operação de campo programada
  if (d) d.time.forEach((dia, i) => {
    const mm = Number(d.precipitation_sum?.[i]); if (dia < hoje || dia > edyAdd(hoje, 3) || !(mm >= EDY_CHUVA_FORTE)) return;
    prog.filter(o => o.date === dia && EDY_SENSIVEL.test(o.type || '')).forEach(o => {
      const m = edyMelhorDia(c, dia, EDY_PULV.test(o.type), hoje); jaAvisada.add(o.id);
      out.push({id: `edy-chuva-${o.id}-${dia}`, tipo: 'chuva-op', cor: 'red', icone: 'chuva', dia, rota: 'operacoes',
        titulo: `${edyN(mm)} mm ${edyDiaTxt(dia, hoje)} + ${String(o.type).toLowerCase()} programado ${edyNo(o)}`,
        texto: `Reprogramar?${sugestao(m, hoje)}`, acao: {act: 'edy-reprog', id: `${o.id}|${m?.dia || ''}`, label: 'Reprogramar'}});
    });
  });
  // 2. Aplicação feita e chuva logo depois (registrada ou prevista nas 24 h seguintes)
  const aps = [];
  edyLista('aplicacoes').forEach(a => { const dt = a.date || a.data; if (dt >= edyAdd(hoje, -2) && dt <= hoje) aps.push({fieldId: a.fieldId, date: dt, hora: a.hora || a.time || '', produto: a.produto || a.product || ''}); });
  edyLista('operations').filter(o => o.status === 'Concluída' && EDY_PULV.test(o.type || '') && o.date >= edyAdd(hoje, -2) && o.date <= hoje).forEach(o => {
    const fim = o.climaFim?.hora || o.fimHora || o.time || ''; const igual = aps.find(a => a.fieldId === o.fieldId && a.date === o.date);
    if (igual) { if (!igual.hora) igual.hora = fim; } else aps.push({fieldId: o.fieldId, date: o.date, hora: fim, produto: o.produto || ''});
  });
  aps.forEach(a => {
    const chuvas = edyLista('chuvas').filter(x => (!x.fieldId || x.fieldId === a.fieldId) && x.date <= hoje && (x.date > a.date || (x.date === a.date && a.hora && x.hora && x.hora > a.hora)) && x.date <= edyAdd(a.date, 1));
    const porDia = {}; chuvas.forEach(x => { porDia[x.date] = Math.max(porDia[x.date] || 0, Number(x.mm) || 0); });
    const caiu = Math.round(Object.values(porDia).reduce((s, v) => s + v, 0) * 10) / 10;
    const ini = `${a.date}T${(a.hora || '12:00').slice(0, 2)}:00`, fim = `${edyAdd(a.date, 1)}T${(a.hora || '12:00').slice(0, 2)}:00`, agoraIso = edyAgoraIso(agora);
    const vem = c && fim > agoraIso ? edyChuvaPrevista(c, ini > agoraIso ? ini : agoraIso, fim) : 0;
    if (!(caiu >= EDY_LAVA_MM) && !(vem >= EDY_LAVA_MM)) return;
    const onde = (typeof fieldName === 'function' && fieldName(a.fieldId)) || 'talhão';
    out.push({id: `edy-lava-${a.fieldId || 'sede'}-${a.date}`, tipo: 'lavagem', cor: 'orange', icone: 'gota', dia: a.date, rota: 'aplicacoes',
      titulo: caiu >= EDY_LAVA_MM ? `Aplicou ${edyDiaTxt(a.date, hoje)} no ${onde} e choveu ${edyN(caiu, 1)} mm depois` : `Aplicou ${edyDiaTxt(a.date, hoje)} no ${onde} e vem ${edyN(vem, 1)} mm de chuva`,
      texto: `${a.produto ? a.produto + ': o' : 'O'} produto pode ter sido lavado. Veja com o agrônomo o tempo sem chuva que o produto pede e se precisa reaplicar.`,
      acao: {act: 'nav', id: 'aplicacoes', label: 'Ver aplicações'}});
  });
  // 3. Pulverização programada num dia sem janela boa
  if (c?.dados?.hourly?.time && typeof janelasDoDia === 'function') prog.filter(o => EDY_PULV.test(o.type || '') && !jaAvisada.has(o.id) && o.date <= edyAdd(hoje, 2)).forEach(o => {
    if (!c.dados.hourly.time.some(t => t.startsWith(o.date))) return;
    const j = janelasDoDia(c.dados, o.date); if (j.janelas.length) return;
    const m = edyMelhorDia(c, o.date, true, hoje);
    out.push({id: `edy-janela-${o.id}-${o.date}`, tipo: 'sem-janela', cor: 'orange', icone: 'vento', dia: o.date, rota: 'operacoes',
      titulo: `${o.type} ${edyNo(o)} ${edyDiaTxt(o.date, hoje)} sem janela boa${j.principal ? ` (${j.principal})` : ''}`,
      texto: `Reprogramar?${sugestao(m, hoje)}`, acao: {act: 'edy-reprog', id: `${o.id}|${m?.dia || ''}`, label: 'Reprogramar'}});
  });
  // 4. Colheita marcada antes de terminar a carência
  if (typeof liberacaoColheita === 'function') edyLista('operations').filter(o => o.status === 'Programada' && o.type === 'Colheita' && o.fieldId && o.date >= hoje).forEach(o => {
    const l = liberacaoColheita(o.fieldId); if (!l || !(l.libera > o.date)) return;
    out.push({id: `edy-carencia-${o.id}`, tipo: 'carencia', cor: 'red', icone: 'escudo', dia: o.date, rota: 'operacoes',
      titulo: `Colheita do ${edyLocal(o)} marcada para ${edyDm(o.date)}, antes de acabar a carência`,
      texto: `${l.a.produto || 'A última aplicação'} libera a colheita só em ${edyDm(l.libera)}.`, acao: {act: 'edy-reprog', id: `${o.id}|${l.libera}`, label: 'Passar para ' + edyDm(l.libera)}});
  });
  // 5. Máquina com revisão vencida escalada para operação
  if (typeof hoursToService === 'function') prog.filter(o => o.machineId).forEach(o => {
    const m = edyLista('machines').find(x => x.id === o.machineId); if (!m || !(Number(m.nextService) > 0) || hoursToService(m) > 0) return;
    out.push({id: `edy-rev-${o.id}`, tipo: 'revisao', cor: 'orange', icone: 'trator', dia: o.date, rota: 'maquinas',
      titulo: `${m.name} com revisão vencida e ${String(o.type).toLowerCase()} ${edyDiaTxt(o.date, hoje)}`,
      texto: `Horímetro ${edyN(m.hours)}; revisão era em ${edyN(m.nextService)}. Faça a revisão ou troque a máquina da operação.`, acao: {act: 'op-edit', id: o.id, label: 'Trocar máquina'}});
  });
  // 6. Vigor do satélite caiu num talhão em ciclo
  edyLista('fields').filter(f => !f.inactive && !f.inativo && (typeof emCiclo !== 'function' || emCiclo(f))).forEach(f => {
    const n = edyNdviTalhao(f.id); if (!n || n.variacao == null || !(n.variacao <= -EDY_QUEDA_NDVI)) return;
    const dias = (new Date(n.data) - new Date(n.dataAnterior)) / 864e5, idade = (new Date(hoje) - new Date(n.data)) / 864e5;
    if (dias > 30 || idade > 15) return;
    out.push({id: `edy-ndvi-${f.id}-${n.data}`, tipo: 'vigor', cor: 'orange', icone: 'escudo', dia: n.data, rota: 'talhoes',
      titulo: `Vigor caiu no ${f.name}: ${edyN(n.anterior, 2)} → ${edyN(n.atual, 2)}`,
      texto: `Imagens de ${edyDm(n.dataAnterior)} e ${edyDm(n.data)}. Vale ir a campo: falta d'água, praga, doença ou falha de plantio.`, acao: {act: 'nav', id: 'talhoes', label: 'Ver talhões'}});
  });
  const peso = {red: 0, orange: 1};
  return out.sort((a, b) => (peso[a.cor] ?? 2) - (peso[b.cor] ?? 2) || (a.dia || '').localeCompare(b.dia || ''));
}

// ---------- Resumo da manhã ----------
/** Resumo de um dia: tempo, janela, programado e o que precisa de atenção. {titulo, linhas, curto} */
function edyResumo(dia = today(), agora = Date.now()) {
  const c = edyClima(), d = c?.dados?.daily, i = d ? d.time.indexOf(dia) : -1, linhas = [];
  if (i >= 0) {
    const mm = Number(d.precipitation_sum?.[i]) || 0, prob = d.precipitation_probability_max?.[i];
    const j = c.dados.hourly?.time && typeof janelasDoDia === 'function' ? janelasDoDia(c.dados, dia) : null;
    linhas.push(`🌤 ${edyN(d.temperature_2m_min?.[i])}–${edyN(d.temperature_2m_max?.[i])} °C, ${mm >= 0.5 ? `${edyN(mm, mm < 10 ? 1 : 0)} mm de chuva${prob != null ? ` (${Math.round(prob)}%)` : ''}` : 'sem chuva'}${j ? (j.janelas.length ? `; pulverizar: ${j.janelas.map(([a, b]) => `${a}h–${b}h`).join(', ')}` : '; sem janela boa para pulverizar') : ''}.`);
    const i2 = d.time.indexOf(edyAdd(dia, 1)), mm2 = i2 >= 0 ? Number(d.precipitation_sum?.[i2]) : 0;
    if (mm2 >= EDY_CHUVA_FORTE) linhas.push(`🌧 Amanhã: ${edyN(mm2)} mm previstos.`);
  }
  const ops = edyLista('operations').filter(o => o.date === dia && o.status === 'Programada').sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  if (ops.length) linhas.push(`📋 ${ops.length} ${ops.length === 1 ? 'operação programada' : 'operações programadas'}: ${ops.slice(0, 3).map(o => `${o.type} ${edyNo(o)}${o.time ? ' às ' + o.time : ''}`).join('; ')}${ops.length > 3 ? `; +${ops.length - 3}` : ''}.`);
  else linhas.push('📋 Nada programado.');
  const and = edyLista('operations').filter(o => o.status === 'Em andamento');
  if (and.length) linhas.push(`▶ ${and.length} em andamento: ${and.slice(0, 2).map(o => `${o.type} ${edyNo(o)}`).join('; ')}${and.length > 2 ? '…' : ''}.`);
  const av = edyAvisos(dia, agora);
  if (av.length) linhas.push(`⚠️ ${av.length === 1 ? 'Atenção' : `${av.length} pontos de atenção`}: ${av[0].titulo}${av.length > 1 ? '…' : '.'}`);
  const hoje = today();
  return {titulo: dia === hoje ? 'Bom dia! O seu dia na fazenda' : `Resumo de ${edyDiaTxt(dia, hoje)}`, linhas, avisos: av,
    curto: `${ops.length ? `${ops.length} programada${ops.length > 1 ? 's' : ''}` : 'Nada programado'}${av.length ? ` · ${av.length} ${av.length === 1 ? 'atenção' : 'atenções'}` : ''}`};
}

/** Notificações do Edy para o celular (alertas.js agenda): resumo às 6h30 de hoje e de amanhã + avisos novos. */
function edyNotificacoes(agora = Date.now(), quandoJa = agora) {
  const hoje = today(), lista = [], hora = (dia, h, m) => new Date(`${dia}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
  [hoje, edyAdd(hoje, 1)].forEach(dia => {
    const q = hora(dia, 6, 30); if (dia === hoje && agora > hora(dia, 10, 0)) return;
    const r = edyResumo(dia, agora);
    lista.push({id: `edy-manha-${dia}`, tipo: 'edy', rota: 'assistente', icone: 'calendario', titulo: 'Edy: bom dia! Resumo da fazenda', texto: r.linhas.join(' '),
      curto: 'Bom dia — resumo do Edy', sub: r.curto, valor: '', unid: '', selo: 'EDY · RESUMO DA MANHÃ', dia: edyDm(dia), acoes: [{t: 'Abrir o Edy', rota: 'assistente'}], quando: q});
  });
  edyAvisos(hoje, agora).forEach(a => lista.push({id: a.id, tipo: 'edy', rota: a.rota, icone: a.icone, cor: a.cor === 'red' ? '#E05A5A' : undefined, titulo: `Edy: ${a.titulo}`, texto: a.texto,
    curto: a.titulo, sub: a.texto, valor: '', unid: '', selo: 'EDY · ATENÇÃO', acoes: [{t: 'Abrir', rota: a.rota}, {t: 'Falar com o Edy', rota: 'assistente'}], quando: quandoJa}));
  return lista.map(a => { if (a.cor === undefined) delete a.cor; return a; });
}

// Sino: os avisos do Edy junto com os outros
if (typeof alerts === 'function') {
  const _alertsEdy = alerts;
  // eslint-disable-next-line no-global-assign
  alerts = function () {
    const l = _alertsEdy();
    const pode = r => typeof nvPodeRota !== 'function' || !(typeof nvVinculado === 'function' && nvVinculado()) || nvPodeRota(String(r).split('/')[0]);
    try { edyAvisos().filter(a => pode(a.rota)).forEach(a => l.push({color: a.cor, icon: '✨', title: `Edy: ${a.titulo}`, text: a.texto, route: a.rota, acao: a.acao})); } catch { /* sem dados */ }
    return l;
  };
}

/** Cartão do topo da tela do Edy: resumo do dia e avisos com botão. */
function edyCartaoResumo(aberto = true) {
  let r; try { r = edyResumo(); } catch { return ''; }
  const mini2 = (rot, act, id) => `<button type="button" class="edy-btn" data-act="${act}" data-id="${esc(id || '')}">${esc(rot)}</button>`;
  return `<details class="card edy-resumo" ${aberto ? 'open' : ''}><summary><span class="edy-sol" aria-hidden="true">☀️</span><b>${esc(r.titulo)}</b><small>${esc(r.curto)}</small></summary>
    <ul class="edy-linhas">${r.linhas.filter(l => !l.startsWith('⚠️')).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    ${r.avisos.length ? `<div class="edy-avisos">${r.avisos.map(a => `<div class="edy-aviso ${a.cor}"><span class="edy-aviso-ic" aria-hidden="true">✨</span><div><strong>${esc(a.titulo)}</strong><small>${esc(a.texto)}</small></div>${a.acao ? mini2(a.acao.label, a.acao.act, a.acao.id) : ''}</div>`).join('')}</div>` : ''}
    <button type="button" class="chip edy-pedir" data-act="ia-sug" data-id="Edy, me dá o resumo do dia: o que fazer primeiro e o que precisa de atenção?">✨ Peça ao Edy o plano do dia</button>
  </details>`;
}

// ---------- Registros prontos (IA que age) ----------
const EDY_ACAO_IC = {operacao: '📋', reprogramar: '📅', abastecimento: '⛽', chuva: '🌧', monitoramento: '🔍'};
/** Texto de um registro proposto pela IA, com os nomes no lugar dos códigos. */
function edyAcaoTxt(a, hoje = today()) {
  const t = a.talhaoId && edyLista('fields').find(f => f.id === a.talhaoId), m = a.maquinaId && edyLista('machines').find(x => x.id === a.maquinaId);
  const nomeT = t ? t.name : a.talhaoId ? 'talhão não encontrado' : '', nomeM = m ? m.name : a.maquinaId ? 'máquina não encontrada' : '';
  const quando = a.data ? `${edyDiaTxt(a.data, hoje)}${a.hora ? ' às ' + a.hora : ''}` : '';
  if (a.tipo === 'operacao') return {titulo: [a.tipoOperacao, nomeT].filter(Boolean).join(' no '), linha: [a.area != null ? `${edyN(a.area, 1)} ha` : '', nomeM, a.status || 'Programada', quando].filter(Boolean).join(' · ')};
  if (a.tipo === 'reprogramar') {
    const o = edyLista('operations').find(x => x.id === a.operacaoId);
    return o ? {titulo: `Passar ${String(o.type).toLowerCase()} do ${edyLocal(o)}`, linha: `de ${edyDm(o.date)}${o.time ? ' ' + o.time : ''} para ${quando}`} : {titulo: 'Reprogramar operação', linha: 'operação não encontrada', erro: true};
  }
  if (a.tipo === 'abastecimento') return {titulo: `Abastecimento — ${nomeM || 'máquina'}`, linha: [`${edyN(a.litros, 1)} L`, a.horimetro != null ? `horímetro ${edyN(a.horimetro, 1)}` : '', quando].filter(Boolean).join(' · ')};
  if (a.tipo === 'chuva') return {titulo: `Chuva de ${edyN(a.mm, 1)} mm`, linha: [nomeT || 'Sede/geral', quando || 'hoje'].join(' · ')};
  if (a.tipo === 'monitoramento') return {titulo: `Registrar no monitoramento: ${a.alvo}`, linha: [a.tipoAlvo, nomeT || 'escolha o talhão', 'com a foto', quando || 'hoje'].join(' · ')};
  return {titulo: 'Registro', linha: ''};
}
/** Abre o formulário do registro já preenchido (a pessoa confere e salva). */
function edyAbrirAcao(a, arquivos = []) {
  const campo = (k, v) => { const el = document.querySelector(`#dialog #f_${k}`); if (el && v != null && v !== '') { el.value = String(v); el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); el.classList.add('ia-lido'); } };
  const t = a.talhaoId && edyLista('fields').some(f => f.id === a.talhaoId) ? a.talhaoId : '', m = a.maquinaId && edyLista('machines').some(x => x.id === a.maquinaId) ? a.maquinaId : '';
  if (a.tipo === 'operacao') operationForm({type: OP_TYPES.includes(a.tipoOperacao) ? a.tipoOperacao : 'Outra', fieldId: t, machineId: m, area: a.area ?? '', date: a.data || today(), time: a.hora || nowTime(), status: a.status || 'Programada', notes: a.obs || ''});
  else if (a.tipo === 'reprogramar') { const o = find('operations', a.operacaoId); if (!o) return showToast('Operação não encontrada', true); operationForm({...o, date: a.data || o.date, time: a.hora || o.time}); }
  else if (a.tipo === 'abastecimento') { abastecimentoForm(m); campo('date', a.data); campo('liters', a.litros); campo('hours', a.horimetro); }
  else if (a.tipo === 'chuva') chuvaForm({date: a.data || today(), hora: a.hora || nowTime(), mm: a.mm, fieldId: t, notes: a.obs || ''});
  else if (a.tipo === 'monitoramento') {
    const f = t && find('fields', t), est = f && typeof estadioTalhao === 'function' ? (() => { try { return estadioTalhao(f)?.cod || ''; } catch { return ''; } })() : '';
    monitoramentoForm({tipo: ['Praga', 'Doença', 'Planta daninha'].includes(a.tipoAlvo) ? a.tipoAlvo : 'Praga', alvo: a.alvo || '', fieldId: t, date: a.data || today(), estadio: est,
      notes: 'Identificado pela foto pelo Edy (IA). Conferir no campo.'});
    edyAnexarFotos(arquivos);
  }
  showToast('Preparado pelo Edy: confira e salve');
}
/** Põe no formulário aberto as fotos que foram ao Edy (ficam no registro como as outras fotos). */
async function edyAnexarFotos(arquivos) {
  const box = document.querySelector('#dialog .fotos-campo'); if (!box || !arquivos.length || typeof reduzirFoto !== 'function') return;
  const [colecao, recordId] = box.dataset.fotos.split('|');
  for (const arq of arquivos.slice(0, typeof FOTOS_MAX === 'number' ? FOTOS_MAX : 6)) {
    try {
      const red = await reduzirFoto(arq), id = uid();
      await guardarFotoLocal({id, colecao, recordId, blob: red.blob, mini: red.mini, tipo: red.tipo, ext: red.ext, fazendaId: nv?.fazenda?.id || null, enviada: false, miniEnviada: !red.mini, criadaEm: Date.now()});
      if (!fotosDoForm.has(recordId)) fotosDoForm.set(recordId, []);
      fotosDoForm.get(recordId).push({id, em: new Date().toISOString(), por: nv?.sessao?.usuario || '', ext: red.ext, ...(red.mini ? {mini: true} : {})});
      box.querySelector('.fotos-lista')?.insertAdjacentHTML('beforeend', `<span class="foto-mini nova" data-foto-id="${esc(id)}"></span>`);
    } catch { /* foto fica só na conversa */ }
  }
  if (typeof carregarMiniaturas === 'function') carregarMiniaturas(box, colecao, recordId);
}
function edyCartaoAcao(a, ref, estado = '') {
  const x = edyAcaoTxt(a);
  return `<div class="edy-acao ${estado}"><span class="edy-acao-ic" aria-hidden="true">${EDY_ACAO_IC[a.tipo] || '📋'}</span><div><strong>${esc(x.titulo)}</strong><small>${esc(x.linha)}</small></div>
    ${estado === 'aberto' ? '<span class="edy-acao-ok">aberto para conferir</span>' : x.erro ? '' : `<button type="button" class="edy-btn ok" data-act="edy-acao" data-id="${esc(ref)}">Conferir e salvar</button>`}</div>`;
}
Object.assign(ACTIONS, {
  'edy-reprog': id => {
    const [opId, dia] = String(id).split('|'), o = find('operations', opId); if (!o) return;
    operationForm({...o, date: dia || o.date});
    if (dia) showToast(`Edy sugeriu ${edyDm(dia)}: confira e salve`);
  },
});
