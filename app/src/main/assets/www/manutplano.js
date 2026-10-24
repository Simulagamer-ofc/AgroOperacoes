'use strict';
/* MercaPlant — plano de manutenção da unidade de grãos (secador, moega e silos).
   Cada equipamento tem tarefas que vencem por uso (horas de secagem, toneladas, dias de uso) ou por data
   (a cada X dias, ou todo ano numa data — ex.: antes da safra). O plano sugerido é só ponto de partida:
   valem os intervalos do manual do fabricante. Concluir a manutenção ligada à tarefa recomeça a contagem. */

const PM_TIPOS = {
  horas: {rot: 'Horas de secagem', un: 'h', so: ['Secador']},
  toneladas: {rot: 'Toneladas', un: 't'},
  diasUso: {rot: 'Dias de uso', un: 'dias de uso'},
  dias: {rot: 'A cada X dias', un: 'dias'},
  data: {rot: 'Todo ano numa data', un: ''}
};
const PM_EQUIP = ['Secador', 'Moega', 'Silo/Armazém'];
// Plano sugerido por tipo de equipamento (ajuste pelo manual do fabricante)
const PM_SUGERIDO = {
  'Secador': [
    ['Lubrificação de rolamentos e mancais', 'horas', 200],
    ['Revisão de correias, polias e motores', 'horas', 500],
    ['Conferência dos sensores de temperatura (termômetros)', 'horas', 300],
    ['Revisão geral do secador e da fornalha antes da safra', 'data', '01/02']],
  'Moega': [
    ['Limpeza do fosso, grelha e moega', 'diasUso', 7],
    ['Revisão de elevadores, correias e canecas', 'toneladas', 5000],
    ['Aferição da balança rodoviária', 'dias', 365]],
  'Silo/Armazém': [
    ['Limpeza e vazio sanitário antes da safra', 'data', '01/02'],
    ['Revisão dos ventiladores da aeração', 'dias', 365],
    ['Conferência dos cabos de termometria', 'data', '01/02'],
    ['Inspeção da estrutura (chapas, escadas e guarda-corpo)', 'dias', 365]]
};
const pmEquipamentos = tipo => db.machines.filter(m => (tipo ? m.type === tipo : PM_EQUIP.includes(m.type)) && !isInactive(m));
const pmDiaMes = s => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})$/); return m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12 ? [+m[1], +m[2]] : null; };

// Uso do equipamento desde uma data (inclusive): horas de secagem, toneladas, dias com uso
function pmUso(m, desde, tipo) {
  const d0 = desde || '0000';
  if (m.type === 'Secador') {
    const ls = db.lotesSecagem.filter(l => l.secadorId === m.id && (l.fim || agoraISO()).slice(0, 10) >= d0);
    if (tipo === 'horas') return ls.reduce((s, l) => { const ini = (l.inicio || '') < d0 ? d0 + 'T00:00' : l.inicio; return s + horasEntre(ini, l.fim || agoraISO()); }, 0);
    if (tipo === 'toneladas') return ls.filter(l => (l.inicio || '').slice(0, 10) >= d0).reduce((s, l) => s + (Number(l.massaEntradaKg) || 0), 0) / 1000;
    if (tipo === 'diasUso') { const dias = new Set(); ls.forEach(l => { let d = (l.inicio || d0).slice(0, 10); const f = (l.fim || agoraISO()).slice(0, 10); if (d < d0) d = d0; for (let k = 0; d <= f && k < 400; k++) { dias.add(d); d = addDias(d, 1); } }); return dias.size; }
  }
  if (m.type === 'Moega') {
    const rs = db.romaneios.filter(r => (r.date || '') >= d0);
    if (tipo === 'toneladas') return rs.reduce((s, r) => s + (r.calc?.liquido || Math.max(0, (Number(r.pesoBruto) || 0) - (Number(r.tara) || 0))), 0) / 1000;
    if (tipo === 'diasUso') return new Set(rs.map(r => r.date)).size;
  }
  if (m.type === 'Silo/Armazém' && typeof movimentosSilo === 'function') {
    const {ent, sai} = movimentosSilo(m.id), mov = [...ent, ...sai].filter(x => (x.date || '') >= d0);
    if (tipo === 'toneladas') return ent.filter(x => (x.date || '') >= d0).reduce((s, x) => s + (Number(x.kg) || 0), 0) / 1000;
    if (tipo === 'diasUso') return new Set(mov.map(x => x.date)).size;
  }
  return 0;
}
// Situação de uma tarefa: {nivel: ok|perto|vencida, texto, pct, ultima, vence}
function pmSituacao(m, t) {
  const feitas = db.maintenances.filter(x => x.machineId === m.id && x.planoId === t.id && x.status === 'Concluída').map(x => x.doneDate || x.date).sort();
  const ultima = feitas.at(-1) || '', base = ultima || t.desde || today(), int = Number(t.intervalo) || 0;
  const aberta = db.maintenances.find(x => x.machineId === m.id && x.planoId === t.id && x.status !== 'Concluída');
  let nivel = 'ok', pct = 0, texto = '', vence = '';
  if (t.tipo === 'data') {
    const dm = pmDiaMes(t.intervalo); if (!dm) return {nivel: 'sem', texto: 'Data inválida', pct: 0, ultima, aberta};
    // Próxima data (dd/mm) depois da última vez feita (ou do início do plano)
    let ano = Number(base.slice(0, 4)); const dt = a => `${a}-${String(dm[1]).padStart(2, '0')}-${String(dm[0]).padStart(2, '0')}`;
    if (dt(ano) <= base) ano++;
    vence = dt(ano); const dias = diasEntre(today(), vence);
    nivel = dias < 0 ? 'vencida' : dias <= 30 ? 'perto' : 'ok'; pct = Math.max(0, Math.min(1, 1 - dias / 365));
    texto = dias < 0 ? `venceu em ${fmtDate(vence)}` : `até ${fmtDate(vence)} (${dias === 0 ? 'hoje' : `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`})`;
  } else if (t.tipo === 'dias') {
    vence = addDias(base, int); const dias = diasEntre(today(), vence);
    nivel = dias < 0 ? 'vencida' : dias <= Math.max(7, int * 0.1) ? 'perto' : 'ok'; pct = int ? Math.max(0, Math.min(1, diasEntre(base, today()) / int)) : 0;
    texto = dias < 0 ? `venceu em ${fmtDate(vence)}` : `até ${fmtDate(vence)} (${dias === 0 ? 'hoje' : `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`})`;
  } else {
    const uso = pmUso(m, base, t.tipo), un = PM_TIPOS[t.tipo]?.un || '';
    pct = int ? uso / int : 0; nivel = pct >= 1 ? 'vencida' : pct >= 0.9 ? 'perto' : 'ok';
    texto = `${num(uso, uso < 10 && t.tipo !== 'diasUso' ? 1 : 0)} de ${num(int)} ${un}`;
    pct = Math.min(1, pct);
  }
  return {nivel, pct, texto, ultima, vence, aberta};
}

// ---------- Formulário de tarefa ----------
function pmTarefaForm(machineId, tarefaId) {
  const m = find('machines', machineId); if (!m) return;
  const t = (m.plano || []).find(x => x.id === tarefaId) || {};
  const tipos = Object.entries(PM_TIPOS).filter(([, v]) => !v.so || v.so.includes(m.type)).map(([k, v]) => ({value: k, label: v.rot}));
  openForm({title: t.id ? 'Editar tarefa do plano' : `Nova tarefa — ${m.name}`, sub: 'Use o intervalo do manual do fabricante.', values: {tipo: tipos[0].value, ...t},
    fields: [
      {k: 'nome', label: 'Tarefa', required: true, full: true, placeholder: 'Ex.: Lubrificação dos mancais'},
      {k: 'tipo', label: 'Vence por', type: 'select', options: tipos, required: true},
      {k: 'intervalo', label: 'A cada', required: true, hint: 'Número (horas, toneladas, dias) ou, em “Todo ano numa data”, o dia/mês (ex.: 01/02).'}
    ],
    onSubmit: v => {
      v.nome = String(v.nome || '').trim(); if (!v.nome) return 'Dê um nome para a tarefa';
      if (v.tipo === 'data') { if (!pmDiaMes(v.intervalo)) return 'Informe a data como dia/mês, ex.: 01/02'; }
      else { const n = numeroBR(String(v.intervalo).trim()); if (!(n > 0)) return 'Informe um número maior que zero no intervalo'; v.intervalo = n; }
      const plano = (m.plano || []).slice(), i = plano.findIndex(x => x.id === t.id);
      const nova = {...t, ...v, id: t.id || uid(), desde: t.desde || today()};
      if (i >= 0) plano[i] = nova; else plano.push(nova);
      upsert('machines', {...m, plano}); showToast('Tarefa salva');
    }});
}
function pmUsarSugerido(machineId) {
  const m = find('machines', machineId); if (!m) return;
  const plano = (PM_SUGERIDO[m.type] || []).map(([nome, tipo, intervalo]) => ({id: uid(), nome, tipo, intervalo, desde: today()}));
  upsert('machines', {...m, plano}); showToast(`Plano sugerido aplicado em ${m.name}: ajuste os intervalos pelo manual`); render();
}
const pmChave = (mid, tid) => `${mid}|${tid}`;
const pmDe = arg => { const [mid, tid] = String(arg).split('|'); const m = find('machines', mid), t = (m?.plano || []).find(x => x.id === tid); return {m, t}; };

// ---------- Cartão do plano (telas Moega, Secador e Silos) ----------
function cartaoPlanoManut(tipo) {
  const eqs = pmEquipamentos(tipo); if (!eqs.length) return '';
  const linha = (m, t) => {
    const s = pmSituacao(m, t), cor = s.nivel === 'vencida' ? 'rev-vencida' : s.nivel === 'perto' ? 'rev-alerta' : 'rev-ok', k = pmChave(m.id, t.id);
    return `<div class="pm-tarefa"><div class="pm-txt"><strong>${esc(t.nome)}</strong><small>${esc(PM_TIPOS[t.tipo]?.rot || '')} • ${esc(s.texto)}${s.ultima ? ` • última ${fmtDate(s.ultima)}` : ''}${s.aberta ? ` • <b>${s.aberta.status === 'Programada' ? `programada para ${fmtDate(s.aberta.dataPrevista)}` : 'em manutenção'}</b>` : ''}</small>
      <div class="maq-rev ${cor}"><div class="progress"><span style="width:${Math.round(s.pct * 100)}%"></span></div></div></div>
      <div class="row-actions">${s.aberta ? (s.aberta.status === 'Programada' ? mini('▶ Iniciar', 'mt-iniciar', s.aberta.id) : mini('✓ Concluir', 'mt-done', s.aberta.id, 'ok')) : mini('Abrir', 'pm-abrir', k) + mini('Programar', 'pm-programar', k)}
        <details class="menu-mais"><summary aria-label="Mais ações">⋯</summary><div class="menu-lista">${mini('Editar tarefa', 'pm-editar', k)}${mini('Tirar do plano', 'pm-excluir', k, 'del')}</div></details></div></div>`;
  };
  return `<div class="section-title"><h3>Plano de manutenção</h3><button class="link" data-act="mt-new">+ Manutenção avulsa</button></div>
    ${eqs.map(m => `<section class="card panel pm-equip"><div class="section-title" style="margin:0 0 6px"><h3>${esc(m.name)}</h3>${(m.plano || []).length ? btn('+ Tarefa', 'pm-nova', m.id, 'secondary') : ''}</div>
      ${(m.plano || []).length ? m.plano.map(t => linha(m, t)).join('') : `<p class="nota" style="margin:0 0 10px">Nenhuma tarefa programada. Use o plano sugerido para ${esc(m.type === 'Silo/Armazém' ? 'silos' : m.type.toLowerCase())} e ajuste pelo manual do fabricante, ou monte o seu.</p><div class="btn-row">${btn('Usar plano sugerido', 'pm-sugerido', m.id)}${btn('+ Tarefa', 'pm-nova', m.id, 'secondary')}</div>`}
      ${manutProgramadas(m.id).filter(x => !x.planoId).map(x => `<div class="pm-tarefa pm-avulsa"><div class="pm-txt"><strong>${esc(x.description || x.kind)}</strong><small>avulsa • programada para ${fmtDate(x.dataPrevista)}</small></div><div class="row-actions">${mini('▶ Iniciar', 'mt-iniciar', x.id)}${mini('Editar', 'mt-edit', x.id)}</div></div>`).join('')}</section>`).join('')}
    <p class="nota">Intervalos sugeridos são ponto de partida: valem os do manual do fabricante. “Abrir” cria a ordem de manutenção agora; “Programar” marca para uma data. Ao concluir, a contagem recomeça.</p>`;
}
const viewGraosSemPlano = VIEWS.graos;
VIEWS.graos = arg => {
  const html = viewGraosSemPlano(arg), tipo = {moega: 'Moega', secador: 'Secador', silos: 'Silo/Armazém'}[arg || ''];
  return tipo ? html + cartaoPlanoManut(tipo) : html;
};

Object.assign(ACTIONS, {
  'pm-sugerido': pmUsarSugerido,
  'pm-nova': id => pmTarefaForm(id),
  'pm-editar': k => { const {m, t} = pmDe(k); if (m && t) pmTarefaForm(m.id, t.id); },
  'pm-excluir': k => { const {m, t} = pmDe(k); if (!m || !t) return; confirmDialog(`Tirar “${t.nome}” do plano de ${m.name}? As manutenções já feitas continuam no histórico.`, () => { upsert('machines', {...m, plano: m.plano.filter(x => x.id !== t.id)}); showToast('Tarefa retirada do plano'); }, 'Tirar'); },
  'pm-abrir': k => { const {m, t} = pmDe(k); if (m && t) maintenanceForm({machineId: m.id, kind: 'Preventiva', description: t.nome, planoId: t.id, status: 'Aberta'}); },
  'pm-programar': k => { const {m, t} = pmDe(k); if (!m || !t) return; const s = pmSituacao(m, t); maintenanceForm({machineId: m.id, kind: 'Preventiva', description: t.nome, planoId: t.id, status: 'Programada', dataPrevista: s.vence && s.vence >= today() ? s.vence : today()}); }
});

// Avisos: tarefa do plano chegando ou vencida (sem manutenção aberta ou programada para ela)
const alertasSemPlano = alerts;
// eslint-disable-next-line no-global-assign
alerts = function () {
  const lista = alertasSemPlano();
  if (typeof nvPodeRota === 'function' && !nvPodeRota('graos') && !nvPodeRota('maquinas')) return lista;
  pmEquipamentos().forEach(m => (m.plano || []).forEach(t => {
    const s = pmSituacao(m, t); if (s.aberta || (s.nivel !== 'vencida' && s.nivel !== 'perto')) return;
    lista.push({color: s.nivel === 'vencida' ? 'red' : 'orange', icon: '⚙', title: `${s.nivel === 'vencida' ? 'Manutenção vencida' : 'Manutenção chegando'}: ${m.name}`, text: `${t.nome} — ${s.texto}.`,
      route: m.type === 'Secador' ? 'graos/secador' : m.type === 'Moega' ? 'graos/moega' : 'graos/silos', acao: {act: 'pm-abrir', id: pmChave(m.id, t.id), label: 'Abrir manutenção'}});
  }));
  return lista;
};
