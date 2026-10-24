'use strict';
/* MercaPlant — cadastro de implementos (plantadeira, grade, pulverizador de arrasto…), separado das máquinas.
   Ficam na mesma lista de máquinas (tipo “Implemento”), então aferição, catálogo e manutenção continuam valendo.
   Implemento não tem horímetro: a revisão é por hectares trabalhados (somados das operações) e/ou por dias. */

const TIPOS_IMPL = ['Plantadeira', 'Semeadora', 'Pulverizador de arrasto', 'Distribuidor de adubo/calcário', 'Grade', 'Subsolador', 'Escarificador', 'Rolo-faca', 'Plataforma de colheita', 'Carreta graneleira', 'Outro'];
// Quais implementos servem para cada tipo de operação (os demais tipos mostram todos)
const IMPL_DA_OP = {
  'Plantio': ['Plantadeira', 'Semeadora'],
  'Aplicação': ['Pulverizador de arrasto'],
  'Adubação': ['Distribuidor de adubo/calcário', 'Plantadeira', 'Semeadora'],
  'Preparo de solo': ['Grade', 'Subsolador', 'Escarificador', 'Rolo-faca'],
  'Colheita': ['Plataforma de colheita', 'Carreta graneleira'],
  'Transporte': ['Carreta graneleira']
};
const ehImplemento = m => m?.type === 'Implemento';
const implementos = () => db.machines.filter(ehImplemento);
function implementoOptions(tipoOp) {
  const serve = IMPL_DA_OP[tipoOp];
  return implementos().filter(m => !isInactive(m) && (!serve || serve.includes(m.tipoImpl) || m.tipoImpl === 'Outro' || !m.tipoImpl))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', {numeric: true}))
    .map(m => ({value: m.id, label: `${m.name}${m.tipoImpl ? ' — ' + m.tipoImpl : ''}${Number(m.largura) > 0 ? ` (${num(m.largura, 1)} m)` : ''}`}));
}

// Uso: hectares e horas das operações concluídas com o implemento; desde a última revisão concluída
function usoImplemento(m) {
  const ops = db.operations.filter(o => o.implementoId === m.id && o.status === 'Concluída');
  const ultRev = db.maintenances.filter(x => x.machineId === m.id && x.status === 'Concluída').map(x => x.doneDate || x.date || '').sort().at(-1) || '';
  const ha = l => l.reduce((s, o) => s + (Number(o.area) > 0 ? Number(o.area) : 0), 0);
  const desde = ops.filter(o => !ultRev || (o.date || '') > ultRev);
  const comHoras = ops.filter(o => Number(o.horas) > 0 && Number(o.area) > 0), horas = comHoras.reduce((s, o) => s + Number(o.horas), 0);
  const inicio = ultRev || (m.criadoEm || '').slice(0, 10);
  const dias = inicio ? Math.floor((new Date(today() + 'T12:00:00') - new Date(inicio + 'T12:00:00')) / 864e5) : null;
  // Custo das manutenções do implemento (concluídas e em aberto com valor) e por hectare trabalhado
  const mts = db.maintenances.filter(x => x.machineId === m.id), custo = mts.reduce((s, x) => s + (Number(x.cost) || 0), 0);
  const haT = ha(ops);
  return {haTotal: haT, haDesde: ha(desde), ultRev, dias, haPorHora: horas ? ha(comHoras) / horas : null, ultimaOp: ops.sort(byDateDesc)[0] || null,
    custo, custoHa: custo > 0 && haT > 0 ? custo / haT : null, abertas: mts.filter(x => x.status !== 'Concluída' && x.status !== 'Programada').length};
}
// Situação da revisão: {nivel: ok|perto|vencida, texto, pct}
function revisaoImplemento(m) {
  const u = usoImplemento(m), porHa = Number(m.revisaoHa) > 0, porDia = Number(m.revisaoDias) > 0;
  if (!porHa && !porDia) return {nivel: 'sem', texto: 'Sem revisão programada', pct: 0, u};
  const pctHa = porHa ? u.haDesde / Number(m.revisaoHa) : 0, pctDia = porDia && u.dias != null ? u.dias / Number(m.revisaoDias) : 0, pct = Math.max(pctHa, pctDia);
  const partes = [porHa ? `${num(u.haDesde)} de ${num(m.revisaoHa)} ha` : '', porDia && u.dias != null ? `${u.dias} de ${num(m.revisaoDias)} dias` : ''].filter(Boolean).join(' • ');
  const nivel = pct >= 1 ? 'vencida' : pct >= 0.9 ? 'perto' : 'ok';
  return {nivel, pct: Math.min(1, pct), texto: `${nivel === 'vencida' ? '! Revisão vencida' : nivel === 'perto' ? 'Revisão chegando' : 'Revisão'}: ${partes}`, u};
}

function implementForm(m = {}) {
  const tratores = () => db.machines.filter(x => !ehImplemento(x) && !isInactive(x) && ['Trator', 'Colheitadeira', 'Outro'].includes(x.type)).map(x => ({value: x.id, label: x.name}));
  openForm({
    title: m.id ? 'Editar implemento' : 'Novo implemento',
    sub: 'Implemento não tem horímetro: a revisão é contada pelos hectares das operações em que ele foi usado.',
    values: {state: 'Ativa', tipoImpl: 'Plantadeira', ...m},
    fields: [
      {k: 'name', label: 'Identificação', required: true, placeholder: 'Ex.: Plantadeira 13 linhas', full: true},
      {k: 'tipoImpl', label: 'Tipo', type: 'select', options: TIPOS_IMPL, required: true},
      {k: 'model', label: 'Marca / modelo', placeholder: 'Ex.: Stara Absoluta'},
      {k: 'largura', label: 'Largura de trabalho (m)', type: 'number', min: 0, step: '0.1', hint: 'Usada para estimar o rendimento (ha/h).'},
      {k: 'linhas', label: 'Número de linhas', type: 'number', min: 0, mostrarSe: ['tipoImpl', ['Plantadeira', 'Semeadora']]},
      {k: 'espacamento', label: 'Espaçamento entre linhas (cm)', type: 'number', min: 0, mostrarSe: ['tipoImpl', ['Plantadeira', 'Semeadora']]},
      {k: 'capacidade', label: 'Capacidade do tanque / caixa', placeholder: 'Ex.: 3.000 L ou 8 t', mostrarSe: ['tipoImpl', ['Pulverizador de arrasto', 'Distribuidor de adubo/calcário', 'Carreta graneleira', 'Plantadeira', 'Semeadora']]},
      {k: 'tratorId', label: 'Trator que costuma puxar', type: 'select', options: tratores, labelAusente: maquinaAusente, mais: true},
      {k: 'revisaoHa', label: 'Revisão a cada (ha)', type: 'number', min: 0, hint: 'Ex.: troca de discos ou lubrificação geral. Vazio = sem controle por área.'},
      {k: 'revisaoDias', label: 'Revisão a cada (dias)', type: 'number', min: 0, hint: 'Opcional, para o que vence pelo tempo (ex.: antes de cada safra).', mais: true},
      {k: 'state', label: 'Situação', type: 'select', options: ['Ativa', 'Inativa'], required: true}
    ],
    maisRotulo: 'Mais opções (trator e revisão por dias)',
    onSubmit: v => {
      if (Number(v.linhas) > 0 && Number(v.espacamento) > 0 && !(Number(v.largura) > 0)) v.largura = Math.round(v.linhas * v.espacamento) / 100;
      upsert('machines', {...m, ...v, type: 'Implemento', hours: 0, interval: '', nextService: '', id: m.id || uid(), criadoEm: m.criadoEm || new Date().toISOString()});
      showToast('Implemento salvo');
    }
  });
}
// Editar um implemento abre o formulário dele; o cadastro de máquina não oferece mais “Implemento”
const machineFormSemImpl = machineForm;
// eslint-disable-next-line no-global-assign
machineForm = (m = {}) => ehImplemento(m) ? implementForm(m) : machineFormSemImpl(m);

VIEWS.implementos = () => {
  const lista = implementos().sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', {numeric: true}));
  const topo = head('Máquinas e manutenção', 'Implementos: plantadeiras, grades, pulverizadores de arrasto e outros — revisão por hectare trabalhado.', btn('Abrir manutenção', 'mt-new', '', 'secondary') + btn('+ Novo implemento', 'im-new'));
  if (!lista.length) return topo + `<section class="card">${empty('Nenhum implemento cadastrado', 'Cadastre plantadeiras, grades, pulverizadores de arrasto, distribuidores e carretas. Na operação, você escolhe o trator e o implemento.', {act: 'im-new', label: '+ Novo implemento'})}</section>`;
  return topo + `<section class="cards">${lista.map(m => {
    const r = revisaoImplemento(m), u = r.u, st = machineStatus(m), cor = st === 'Em manutenção' ? 'orange' : st === 'Inativa' ? 'gray' : 'green';
    const ficha = [m.tipoImpl, m.model, Number(m.largura) > 0 ? `${num(m.largura, 1)} m` : '', Number(m.linhas) > 0 ? `${num(m.linhas)} linhas${Number(m.espacamento) > 0 ? ` a ${num(m.espacamento)} cm` : ''}` : '', m.capacidade].filter(Boolean).join(' • ');
    const custoTxt = u.custo > 0 ? `Manutenção: R$ ${num(u.custo, 2)}${u.custoHa ? ` • R$ ${num(u.custoHa, 2)}/ha` : ''}` : 'Manutenção: nenhum custo lançado';
    const extras = [custoTxt, u.abertas ? `<b style="color:var(--orange)">${u.abertas} ${u.abertas === 1 ? 'manutenção aberta' : 'manutenções abertas'}</b>` : '', u.haPorHora ? `Rendimento: ${um1(u.haPorHora)} ha/h` : (Number(m.largura) > 0 ? `Rende ~${um1(m.largura * 7 * 0.7 / 10)} ha/h a 7 km/h (estimativa)` : ''), m.tratorId ? `Trator: ${esc(machineName(m.tratorId))}` : '', u.ultimaOp ? `Último uso: ${esc(u.ultimaOp.type)} — ${esc(opPlace(u.ultimaOp))} em ${fmtDate(u.ultimaOp.date)}` : 'Ainda não usado em operações', u.ultRev ? `Última revisão: ${fmtDate(u.ultRev)}` : ''].filter(Boolean);
    return `<article class="card item-card maq-card"><header><div><h4>${esc(m.name)}</h4><div class="meta">${esc(ficha || 'Implemento')}</div></div>${chip(st, cor)}</header>
      <div class="maq-horas"><span class="big">${num(u.haTotal)} ha</span><small>trabalhados no total</small></div>
      <div class="maq-rev ${r.nivel === 'vencida' ? 'rev-vencida' : r.nivel === 'perto' ? 'rev-alerta' : r.nivel === 'ok' ? 'rev-ok' : ''}"><small>${esc(r.texto)}</small>${r.nivel !== 'sem' ? `<div class="progress"><span style="width:${Math.round(r.pct * 100)}%"></span></div>` : ''}</div>
      <div class="meta">${extras.map(x => `<span>${x}</span>`).join('')}</div>
      <div class="maq-acoes">${mini('⚙ Manutenção', 'mt-new', m.id)}${['Plantadeira', 'Semeadora', 'Pulverizador de arrasto', 'Distribuidor de adubo/calcário'].includes(m.tipoImpl) ? mini('◎ Aferição', 'af-nova', m.id) : ''}
        <details class="menu-mais"><summary aria-label="Mais ações" title="Mais ações">⋯</summary><div class="menu-lista">${mini('Editar', 'im-edit', m.id)}${mini('Excluir', 'mc-del', m.id, 'del')}</div></details></div></article>`;
  }).join('')}</section>` + ordensImplementos(lista);
};
// Ordens de manutenção só dos implementos (as das máquinas ficam na aba Máquinas)
function ordensImplementos(lista) {
  const ids = new Set(lista.map(m => m.id));
  const mts = db.maintenances.filter(mt => ids.has(mt.machineId)).sort(ordemManut);
  const total = mts.reduce((s, x) => s + (Number(x.cost) || 0), 0);
  return `<div class="section-title"><h3>Ordens de manutenção dos implementos</h3>${total ? `<small class="nota">total R$ ${num(total, 2)}</small>` : ''}</div><section class="card list">${mts.length ? mts.map(mt => linhaManutencao(mt, 'Implemento removido')).join('') : empty('Nenhuma manutenção de implemento', 'Use “⚙ Manutenção” no cartão do implemento para abrir uma ordem (troca de discos, rolamentos, lubrificação…).')}</section>`;
}
// Concluir manutenção de implemento: não há horímetro — a contagem de hectares recomeça
const concluirManutSemImpl = finishMaintenance;
// eslint-disable-next-line no-global-assign
finishMaintenance = (mt, persist = true) => {
  const m = find('machines', mt?.machineId);
  if (!ehImplemento(m)) return concluirManutSemImpl(mt, persist);
  mt.status = 'Concluída'; mt.doneDate = mt.doneDate || today();
  if (persist) { upsert('maintenances', mt); showToast(Number(m.revisaoHa) > 0 ? `Manutenção concluída — a contagem recomeça: próxima revisão em ${num(m.revisaoHa)} ha` : 'Manutenção concluída'); }
};
TITLES.implementos = 'Máquinas e manutenção';
Object.assign(ACTIONS, {'im-new': () => implementForm(), 'im-edit': id => implementForm(find('machines', id))});

// Aviso de revisão do implemento (mesmo lugar dos avisos das máquinas)
const alertasSemImpl = alerts;
// eslint-disable-next-line no-global-assign
alerts = function () {
  const lista = alertasSemImpl();
  if (typeof nvPodeRota === 'function' && !nvPodeRota('maquinas')) return lista;
  implementos().filter(m => !isInactive(m)).forEach(m => {
    const r = revisaoImplemento(m); if (r.nivel !== 'vencida' && r.nivel !== 'perto') return;
    if (openMaintenances(m.id).length) return; // já tem manutenção aberta
    lista.push({color: 'orange', icon: '⚙', title: `${r.nivel === 'vencida' ? 'Revisão vencida' : 'Revisão chegando'}: ${m.name}`, text: r.texto.replace(/^[^:]*: /, '') + '.', route: 'implementos', acao: {act: 'mt-new', id: m.id, label: 'Abrir revisão'}});
  });
  return lista;
};
