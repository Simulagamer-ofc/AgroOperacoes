'use strict';
/* MercaPlant — Checklist da manutenção (ordem de manutenção).
   Preventiva: checklist da revisão pelo tipo de máquina (modelos prontos, como ponto de partida).
   Corretiva: o que aconteceu, causa, máquina parada (tempo parado) e checklist curto: diagnóstico → conserto → teste.
   Concluir exige os itens obrigatórios marcados e o teste de funcionamento OK.
   Peça trocada pode sair do estoque (baixa na conclusão). O valor das peças do estoque aparece na ordem, mas não soma
   no custo da ordem: o gasto já foi lançado na compra (mesma regra do diesel do tanque da fazenda). */

const MC_TESTE = 'Teste de funcionamento';
const MC_ESTADOS = [['ok', '✓ OK'], ['trocado', '🔧 Trocado'], ['ajustado', '⚙ Ajustado'], ['problema', '⚠ Problema'], ['na', '— N/A']];
// Modelos: [item, obrigatório]
const MC_MODELOS = {
  'Trator': [['Óleo do motor', 1], ['Filtro de óleo', 1], ['Filtro de combustível', 1], ['Filtro de ar', 1], ['Nível e limpeza do arrefecimento (radiador)', 0], ['Correias', 0], ['Graxa nos pontos de lubrificação', 1], ['Óleo hidráulico e da transmissão', 0], ['Pneus (pressão e desgaste)', 0], ['Bateria e cabos', 0], ['Luzes e alarmes do painel', 0]],
  'Caminhão': [['Óleo do motor', 1], ['Filtros (óleo, combustível e ar)', 1], ['Freios', 1], ['Pneus (pressão e desgaste)', 1], ['Suspensão e direção', 0], ['Arrefecimento', 0], ['Luzes e sinalização', 0], ['Tacógrafo e documentos', 0]],
  'Colheitadeira': [['Óleo do motor', 1], ['Filtros (óleo, combustível e ar)', 1], ['Correias', 1], ['Plataforma: navalhas, dedos e caracol', 1], ['Peneiras e saca-palhas', 0], ['Picador e espalhador', 0], ['Rolamentos e mancais', 0], ['Elevadores e roscas', 0], ['Limpeza do radiador e do motor (pó e palha)', 1], ['Graxa nos pontos de lubrificação', 0]],
  'Pulverizador': [['Bomba', 1], ['Filtros (linha e bicos)', 1], ['Bicos / pontas', 0], ['Mangueiras e conexões', 0], ['Manômetro', 0], ['Vazamentos', 1], ['Barras e suspensão', 0], ['Óleo e filtros do motor (autopropelido)', 0]],
  'Plantadeira': [['Discos de corte e duplos', 1], ['Dosadores de semente e adubo', 1], ['Correntes e engrenagens', 0], ['Rolamentos', 0], ['Mangueiras e hidráulico', 0], ['Pneus', 0], ['Graxa nos pontos de lubrificação', 0]],
  'Implemento': [['Rolamentos', 1], ['Graxa nos pontos de lubrificação', 1], ['Peças de desgaste (discos, ponteiras, facas)', 0], ['Parafusos e soldas', 0], ['Pneus', 0], ['Mangueiras e hidráulico', 0]],
  'Secador': [['Limpeza de pó e palha (fornalha, colunas e dutos)', 1], ['Rolamentos e mancais (lubrificação)', 1], ['Correias e polias', 0], ['Motores e ventiladores', 0], ['Sensores de temperatura', 0], ['Fornalha / queimador', 0]],
  'Moega': [['Limpeza do fosso e da grelha', 1], ['Elevadores, correias e canecas', 1], ['Rosca transportadora', 0], ['Conferência da balança', 0]],
  'Silo/Armazém': [['Limpeza interna', 1], ['Ventiladores de aeração', 0], ['Cabos de termometria', 0], ['Estrutura e vedação', 0]],
  'Beneficiamento': [['Limpeza das máquinas', 1], ['Peneiras', 0], ['Correias e rolamentos', 1], ['Motores', 0]],
  'Outro': [['Inspeção geral', 1], ['Lubrificação', 0], ['Limpeza', 0]]
};
const MC_CORRETIVA = [['Diagnóstico do defeito', 1], ['Conserto / troca da peça com defeito', 1], ['Limpeza e reaperto da área do conserto', 0]];
const MC_IMPL = {'Plantadeira': 'Plantadeira', 'Semeadora': 'Plantadeira', 'Pulverizador de arrasto': 'Pulverizador'};
function mcModelo(m, kind) {
  if (kind === 'Corretiva') return MC_CORRETIVA;
  if (!m) return MC_MODELOS.Outro;
  if (m.type === 'Implemento') return MC_MODELOS[MC_IMPL[m.tipoImpl]] || MC_MODELOS.Implemento;
  return MC_MODELOS[m.type] || MC_MODELOS.Outro;
}
function mcGerar(mt) {
  const m = find('machines', mt.machineId), itens = [];
  // Tarefa do plano de manutenção (secador, moega, silo) vem primeiro
  const tarefa = mt.planoId && m?.plano?.find(t => t.id === mt.planoId);
  if (tarefa) itens.push([tarefa.nome, 1]);
  mcModelo(m, mt.kind).forEach(x => { if (!itens.some(y => y[0] === x[0])) itens.push(x); });
  itens.push([MC_TESTE, 1]);
  return itens.map(([item, obrig]) => ({id: uid(), item, obrig: !!obrig, estado: '', obs: '', pecaId: '', pecaQtd: ''}));
}
const mcMarcado = it => !!it.estado;
const mcProgresso = mt => { const l = mt.checklist || []; return {feitos: l.filter(mcMarcado).length, total: l.length, faltam: l.filter(it => it.obrig && !mcMarcado(it))}; };
// Chamado ao salvar a ordem no formulário: gera o checklist (ou refaz, se mudou o tipo/máquina e nada foi marcado ainda)
// Custo da ordem (o que entra em Gastos → Manutenção): serviço de terceiros + outros custos.
// Mão de obra da equipe entra em Mão de obra (pelo apontamento) e peças do estoque já foram lançadas na compra: aparecem na ordem, sem duplicar.
const mcTerceiros = mt => (mt.maoObra || []).filter(x => x.tipo === 'terceiro').reduce((t, x) => t + (Number(x.valor) || 0), 0);
const mcEquipeValor = mt => (mt.maoObra || []).filter(x => x.tipo === 'equipe').reduce((t, x) => t + (Number(x.valor) || 0), 0);
const mcEquipeHoras = mt => (mt.maoObra || []).filter(x => x.tipo === 'equipe' && x.unidade !== 'dia').reduce((t, x) => t + (Number(x.qtd) || 0), 0);
const mcOutros = mt => mt.custoOutros != null && mt.custoOutros !== '' ? Number(mt.custoOutros) || 0 : (mt.maoObra?.length ? 0 : Number(mt.cost) || 0);
function mcRecalcular(mt) { if (mt.custoOutros == null) mt.custoOutros = mcOutros(mt); const c = Math.round((mcTerceiros(mt) + (Number(mt.custoOutros) || 0)) * 100) / 100; mt.cost = c > 0 ? c : ''; }
const mcCustoTotal = mt => (Number(mt.cost) || 0) + mcEquipeValor(mt) + (Number(mt.custoPecas) || 0);
function mcAoSalvarOrdem(item, antes, doForm = true) {
  // No formulário o campo de custo é “Outros custos”; o custo da ordem soma também os serviços de terceiros
  if (doForm) { item.custoOutros = item.cost === '' || item.cost == null ? '' : Number(item.cost); mcRecalcular(item); }
  if (item.status === 'Concluída' || item.status === 'Programada') return;
  const nada = !(item.checklist || []).some(mcMarcado), mudou = antes.kind !== item.kind || antes.machineId !== item.machineId;
  if (!item.checklist?.length || (mudou && nada)) item.checklist = mcGerar(item);
  if (item.kind === 'Corretiva' && item.parada === 'Sim' && !item.paradaDesde) item.paradaDesde = new Date().toISOString();
  if (item.parada !== 'Sim') { delete item.paradaDesde; }
}
function mcAbrirOrdem(id) {
  const mt = find('maintenances', id); if (!mt) return;
  if (mt.status !== 'Concluída' && mt.status !== 'Programada' && !mt.checklist?.length) { mt.checklist = mcGerar(mt); save(); }
  go('ordem/' + id);
}
const mcHoras = (a, b) => Math.max(0, (new Date(b || Date.now()) - new Date(a)) / 36e5);
const mcTempo = h => h >= 48 ? `${num(Math.round(h / 24 * 10) / 10)} dias` : `${num(Math.round(h * 10) / 10)} h`;
const mcDH = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${fmtDate(iso.slice(0, 10)).slice(0, 5)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// ---------- Tela da ordem de manutenção ----------
function mcLinhaItem(mt, it, aberta) {
  const s = it.pecaId ? find('stock', it.pecaId) : null;
  const estados = MC_ESTADOS.filter(([e]) => !(it.item === MC_TESTE && ['trocado', 'ajustado', 'na'].includes(e)));
  return `<div class="mc-item ${it.estado ? 'feito ' + it.estado : ''}" data-mc="${esc(it.id)}">
    <div class="mc-nome"><strong>${esc(it.item)}${it.obrig ? ' <span class="mc-obrig" title="Obrigatório">*</span>' : ''}</strong>${!aberta && it.estado ? `<span class="chip ${it.estado === 'problema' ? 'red' : it.estado === 'na' ? 'gray' : 'green'}">${esc((MC_ESTADOS.find(([e]) => e === it.estado) || [])[1] || '')}</span>` : ''}</div>
    ${aberta ? `<div class="mc-estados" role="group" aria-label="${esc(it.item)}">${estados.map(([e, r]) => `<button type="button" class="mc-e ${e} ${it.estado === e ? 'on' : ''}" data-act="mc-estado" data-id="${esc(mt.id + '|' + it.id + '|' + e)}" aria-pressed="${it.estado === e}">${r}</button>`).join('')}</div>` : ''}
    ${['problema', 'trocado', 'ajustado'].includes(it.estado) || it.obs ? (aberta ? `<input class="mc-obs" data-mc-obs="${esc(it.id)}" value="${esc(it.obs || '')}" placeholder="${it.estado === 'problema' ? 'Descreva o problema (obrigatório)' : 'Observação (opcional)'}">` : it.obs ? `<small class="nota">${esc(it.obs)}</small>` : '') : ''}
    ${it.estado === 'trocado' ? (aberta ? `<div class="mc-peca"><select data-mc-peca="${esc(it.id)}" aria-label="Peça do estoque"><option value="">Peça do estoque (opcional)</option>${db.stock.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(x => `<option value="${esc(x.id)}" ${x.id === it.pecaId ? 'selected' : ''}>${esc(x.name)} — ${num(x.qty)} ${esc(x.unit)}</option>`).join('')}</select><input data-mc-qtd="${esc(it.id)}" inputmode="decimal" value="${esc(it.pecaQtd ?? '')}" placeholder="Qtd"${it.pecaId ? '' : ' disabled'}><span class="nota">${esc(s?.unit || '')}</span></div>`
      : s ? `<small class="nota">Peça: ${esc(s.name)} — ${num(it.pecaQtd)} ${esc(s.unit)}${it.movId ? ' (baixada do estoque)' : ''}</small>` : '') : ''}
  </div>`;
}
VIEWS.ordem = id => {
  const mt = find('maintenances', id);
  if (!mt) return head('Ordem de manutenção', 'Ordem não encontrada', btn('← Máquinas', 'nav', 'maquinas', 'secondary')) + `<section class="card">${empty('Ordem não encontrada', 'Ela pode ter sido excluída.')}</section>`;
  const m = find('machines', mt.machineId), aberta = !['Concluída', 'Programada'].includes(mt.status), p = mcProgresso(mt);
  const prev = mt.kind !== 'Corretiva', chipTipo = chip(mt.kind || 'Preventiva', prev ? 'green' : 'orange');
  const parada = mt.paradaDesde ? `<div><small>Máquina parada</small><b class="${aberta ? 'txt-red' : ''}">${aberta ? 'há ' : ''}${mcTempo(mcHoras(mt.paradaDesde, mt.paradaFim))}</b><small>desde ${esc(mcDH(mt.paradaDesde))}${mt.paradaFim ? ' até ' + esc(mcDH(mt.paradaFim)) : ''}</small></div>` : '';
  const acao = mt.status === 'Programada' ? btn('▶ Iniciar', 'mt-iniciar', mt.id) : mt.status === 'Aberta' ? btn('▶ Iniciar manutenção', 'mc-iniciar', mt.id) + btn('✓ Concluir', 'mc-concluir', mt.id, 'secondary') : mt.status === 'Em execução' ? btn('✓ Concluir manutenção', 'mc-concluir', mt.id) : '';
  const custoPecas = '';
  return head(`${mt.description || 'Ordem de manutenção'}`, `${m?.name || 'Máquina removida'} • aberta em ${fmtDate(mt.date)}`, btn('← Máquinas', 'nav', m?.type === 'Implemento' ? 'implementos' : 'maquinas', 'secondary') + btn('Editar', 'mt-edit', mt.id, 'secondary') + (mt.checklist?.length || mt.maoObra?.length ? btn('PDF', 'mc-pdf', mt.id, 'secondary') + btn('Enviar', 'mc-enviar', mt.id, 'secondary') : '') + acao).replace('<section class="view-head">', '<section class="view-head" data-eyebrow="Ordem de manutenção">') +
    `<section class="card panel mc-info"><div class="mc-chips">${chipTipo}${chip(mt.status, mt.status === 'Concluída' ? 'gray' : mt.status === 'Em execução' ? 'blue' : mt.status === 'Programada' ? 'purple' : 'orange')}</div>
      <div class="mc-nums"><div><small>Máquina</small><b>${esc(m?.name || '—')}</b><small>${esc([m?.type, m && Number(m.hours) > 0 ? num(m.hours) + ' h' : ''].filter(Boolean).join(' • '))}</small></div>
        ${mt.inicioEm ? `<div><small>Início</small><b>${esc(mcDH(mt.inicioEm))}</b><small>${mt.doneDate ? 'concluída ' + fmtDate(mt.doneDate) : 'em andamento'}</small></div>` : ''}${parada}
        <div><small>Custo total da manutenção</small><b>${mcCustoTotal(mt) > 0 ? 'R$ ' + num(mcCustoTotal(mt), 2) : '—'}</b><small>peças, mão de obra e serviços</small></div></div>
      ${mt.kind === 'Corretiva' ? `<div class="mc-corretiva"><div><small>O que aconteceu</small><p>${esc(mt.sintoma || '—')}</p></div>${mt.causa ? `<div><small>Causa provável</small><p>${esc(mt.causa)}</p></div>` : ''}</div>` : ''}
      ${mt.semChecklist ? '<p class="nota" style="margin:8px 0 0">Registrada como já feita, sem checklist.</p>' : ''}</section>
    ${mt.checklist?.length ? `<section class="card panel mc-lista"><div class="section-title" style="margin:0 0 8px"><h3>Checklist ${prev ? 'da revisão' : 'do conserto'}</h3><small class="nota">${p.feitos} de ${p.total} itens${p.faltam.length && aberta ? ` • faltam ${p.faltam.length} obrigatórios` : ''}</small></div>
      <div class="mc-barra"><span style="width:${p.total ? Math.round(p.feitos / p.total * 100) : 0}%"></span></div>
      ${mt.checklist.map(it => mcLinhaItem(mt, it, aberta)).join('')}
      ${aberta ? `<div class="btn-row" style="margin-top:10px">${btn('+ Item', 'mc-add', mt.id, 'secondary')}</div><p class="nota">* obrigatório. O teste de funcionamento precisa estar OK para concluir. Peça trocada pode sair do estoque: a baixa acontece ao concluir.</p>` : ''}</section>`
      : mt.status === 'Programada' ? `<section class="card">${empty('Manutenção programada', `Para ${fmtDate(mt.dataPrevista)}. Ao iniciar, o checklist aparece aqui.`)}</section>` : ''}
    ${mcCartaoCustos(mt)}
    <section class="card panel"><h3 style="margin:0 0 6px">Fotos (antes e depois)</h3>${typeof campoFotos === 'function' ? campoFotos('maintenances', mt.id, mt.fotos || [], {rotulo: 'Fotos da manutenção', dica: 'Tire uma foto antes de começar e outra depois do serviço feito.'}) : ''}</section>`;
};
TITLES.ordem = 'Ordem de manutenção';
if (typeof GRUPO_DA_ROTA === 'object') GRUPO_DA_ROTA.ordem = 'maquinas';
// Salva o que foi digitado (observação, peça e quantidade) e as fotos novas, sem redesenhar a tela
function mcGuardarCampos(mt) {
  $$('[data-mc-obs]').forEach(el => { const it = mt.checklist.find(x => x.id === el.dataset.mcObs); if (it) it.obs = el.value.trim(); });
  $$('[data-mc-peca]').forEach(el => { const it = mt.checklist.find(x => x.id === el.dataset.mcPeca); if (it) it.pecaId = el.value; });
  $$('[data-mc-qtd]').forEach(el => { const it = mt.checklist.find(x => x.id === el.dataset.mcQtd); if (it) it.pecaQtd = el.value.trim(); });
}
VIEWS.ordem.after = () => {
  const mt = find('maintenances', parseRoute().arg); if (!mt) return;
  const salvar = () => { mcGuardarCampos(mt); upsert('maintenances', mt); };
  $$('[data-mc-obs], [data-mc-qtd]').forEach(el => el.addEventListener('change', salvar));
  $$('[data-mc-peca]').forEach(el => el.addEventListener('change', () => { salvar(); const q = $(`[data-mc-qtd="${el.dataset.mcPeca}"]`); if (q) { q.disabled = !el.value; const s = find('stock', el.value); q.nextElementSibling.textContent = s?.unit || ''; if (el.value) q.focus(); } }));
  // Foto tirada: entra na ordem assim que fica pronta (não depende de outro botão)
  $$('[data-foto-input]').forEach(inp => inp.addEventListener('change', () => {
    const antes = fotosDoForm.get(mt.id)?.length || 0; let n = 0;
    const t = setInterval(() => { n++; if ((fotosDoForm.get(mt.id)?.length || 0) > antes || n > 40) { clearInterval(t); fotosAoSalvar('maintenances', mt.id); } }, 250);
  }));
};

// ---------- Mão de obra, serviços e custos ----------
function mcCartaoCustos(mt) {
  const mo = mt.maoObra || [], linha = x => `<div class="mc-mo"><span><b>${esc(x.nome)}</b><small>${x.tipo === 'terceiro' ? `serviço de terceiro${x.doc ? ' • ' + esc(x.doc) : ''}` : `${num(x.qtd)} ${x.unidade === 'dia' ? (Number(x.qtd) > 1 ? 'diárias' : 'diária') : 'h'}${x.fixo ? ' • fixo (salário em Financeiro)' : ''}`}</small></span><b>${Number(x.valor) > 0 ? 'R$ ' + num(x.valor, 2) : '—'}</b>${mini('×', 'mc-mo-del', mt.id + '|' + x.id, 'del')}</div>`;
  const outros = Number(mt.custoOutros ?? (mo.length ? 0 : mt.cost)) || 0, eq = mcEquipeValor(mt), ter = mcTerceiros(mt), pe = Number(mt.custoPecas) || 0;
  return `<section class="card panel mc-custos"><div class="section-title" style="margin:0 0 8px"><h3>Mão de obra e custos</h3>${btn('+ Mão de obra / serviço', 'mc-mo-add', mt.id, 'secondary')}</div>
    ${mo.length ? mo.map(linha).join('') : '<p class="nota" style="margin:0 0 8px">Lance quem trabalhou (horas da equipe) e serviços de mecânico ou oficina de fora.</p>'}
    <div class="mc-tot">
      <div><small>Serviço de terceiros</small><b>R$ ${num(ter, 2)}</b></div>
      <div><small>Mão de obra da equipe</small><b>R$ ${num(eq, 2)}</b><small>${mcEquipeHoras(mt) ? num(mcEquipeHoras(mt)) + ' h • ' : ''}lançada em Mão de obra</small></div>
      <div><small>Peças do estoque</small><b>R$ ${num(pe, 2)}</b><small>lançadas na compra</small></div>
      <div><small>Outros custos</small><b>R$ ${num(outros, 2)}</b><small>em Editar</small></div>
      <div class="mc-tot-total"><small>Total da manutenção</small><b>R$ ${num(mcCustoTotal(mt), 2)}</b><small>gasto desta ordem: R$ ${num(Number(mt.cost) || 0, 2)} (terceiros + outros)</small></div>
    </div></section>`;
}
function mcMaoObraForm(id) {
  const mt = find('maintenances', id); if (!mt) return; mcGuardarCampos(mt);
  const m = find('machines', mt.machineId);
  openForm({title: 'Mão de obra ou serviço', sub: `${mt.description || 'Ordem'} — ${m?.name || ''}`, values: {quem: db.equipe[0]?.id || 'terceiro', date: today()},
    fields: [
      {k: 'quem', label: 'Quem fez', type: 'select', required: true, full: true, options: () => [...db.equipe.map(p => ({value: p.id, label: `${p.nome} — ${p.tipo}${p.funcao ? ' (' + p.funcao + ')' : ''}`})), {value: 'terceiro', label: 'Mecânico ou oficina de fora (terceiro)'}]},
      {k: 'qtd', label: 'Horas trabalhadas (diarista: dias)', type: 'number', min: 0, mostrarSe: ['quem', '!terceiro']},
      {k: 'nome', label: 'Nome do mecânico ou da oficina', mostrarSe: ['quem', 'terceiro'], full: true},
      {k: 'valor', label: 'Valor do serviço (R$)', type: 'number', min: 0, mostrarSe: ['quem', 'terceiro']},
      {k: 'doc', label: 'Nota ou recibo', mostrarSe: ['quem', 'terceiro']},
      {k: 'date', label: 'Data', type: 'date', required: true}],
    onSubmit: v => {
      mt.maoObra = mt.maoObra || []; if (mt.custoOutros == null) mt.custoOutros = mcOutros(mt);
      if (v.quem === 'terceiro') {
        if (!String(v.nome || '').trim()) return 'Informe o nome do mecânico ou da oficina';
        if (!(v.valor > 0)) return 'Informe o valor do serviço';
        mt.maoObra.push({id: uid(), tipo: 'terceiro', nome: v.nome.trim(), valor: v.valor, doc: v.doc || '', date: v.date});
      } else {
        const p = find('equipe', v.quem); if (!p) return 'Escolha quem fez';
        if (!(v.qtd > 0)) return 'Informe as horas trabalhadas';
        const fixo = p.tipo === 'Fixo (mensal)', dia = p.tipo === 'Diarista', valor = !fixo && Number(p.valor) > 0 ? Math.round(v.qtd * Number(p.valor) * 100) / 100 : 0;
        // Igual ao apontamento de Mão de obra: diarista e por hora geram o gasto; fixo registra só as horas (o salário já está em Financeiro)
        const ap = {id: uid(), pessoaId: p.id, date: v.date, quantidade: v.qtd, atividade: `Manutenção — ${m?.name || ''}: ${mt.description || mt.kind}`, tipo: p.tipo, valor, maintenanceId: mt.id};
        if (valor) { const g = {id: uid(), date: v.date, category: 'Mão de obra', description: `${p.nome} — ${num(v.qtd)} ${dia ? (v.qtd > 1 ? 'diárias' : 'diária') : 'h'} • manutenção ${m?.name || ''}`, value: valor, machineId: mt.machineId, maintenanceId: mt.id}; db.expenses.push(g); ap.gastoId = g.id; }
        db.apontamentos.push(ap);
        mt.maoObra.push({id: uid(), tipo: 'equipe', pessoaId: p.id, nome: p.nome, qtd: v.qtd, unidade: dia ? 'dia' : 'h', valor, fixo, apontamentoId: ap.id, gastoId: ap.gastoId || '', date: v.date});
      }
      mcRecalcular(mt); upsert('maintenances', mt); showToast('Lançado na ordem');
    }});
}
function mcMaoObraExcluir(chave) {
  const [mid, eid] = String(chave).split('|'), mt = find('maintenances', mid), x = mt?.maoObra?.find(y => y.id === eid); if (!x) return;
  confirmDialog(`Tirar “${x.nome}” desta ordem?${x.gastoId ? ' O gasto de mão de obra lançado junto também sai.' : ''}`, () => {
    mt.maoObra = mt.maoObra.filter(y => y.id !== eid);
    if (x.apontamentoId) db.apontamentos = db.apontamentos.filter(a => a.id !== x.apontamentoId);
    if (x.gastoId) db.expenses = db.expenses.filter(g => g.id !== x.gastoId);
    mcRecalcular(mt); upsert('maintenances', mt);
  }, 'Tirar');
}
// ---------- Relatório da ordem (PDF) ----------
function mcRelatorio(id, enviar) {
  const mt = find('maintenances', id); if (!mt) return;
  if (typeof window.pdfMercaPlant !== 'function') { showToast('Gerador de PDF indisponível', true); return; }
  mcGuardarCampos(mt);
  const m = find('machines', mt.machineId), nomeM = m?.name || 'Máquina removida', p = mcProgresso(mt), brl2 = v => `R$ ${num(Number(v) || 0, 2)}`;
  const P = window.pdfMercaPlant({titulo: 'Ordem de manutenção', linha2: `${nomeM} - ${fmtDate(mt.date)}`, continuacao: `Ordem de manutenção · ${nomeM}`});
  const C = P.COR;
  P.secao(mt.description || 'Ordem de manutenção', `${mt.kind || 'Preventiva'} • ${mt.status}`);
  P.cartoes([['Tipo', mt.kind || 'Preventiva', mt.status, mt.kind === 'Corretiva' ? C.laranja : C.verde], ['Checklist', p.total ? `${p.feitos} de ${p.total}` : '-', p.faltam.length && mt.status !== 'Concluída' ? `faltam ${p.faltam.length} obrigatórios` : 'itens marcados', C.azul],
    ['Custo total', brl2(mcCustoTotal(mt)), 'peças, mão de obra e serviços', C.laranja]]);
  P.ficha([['Máquina', [nomeM, m?.type, m?.model].filter(Boolean).join(' - ')], ['Abertura', fmtDate(mt.date)], ['Início', mt.inicioEm ? mcDH(mt.inicioEm) : ''], ['Conclusão', mt.doneDate ? fmtDate(mt.doneDate) : 'em aberto'],
    ['Horímetro na conclusão', Number(mt.doneHours) > 0 ? `${num(mt.doneHours)} h` : ''], ['Máquina parada', mt.paradaDesde ? `${mcTempo(mcHoras(mt.paradaDesde, mt.paradaFim))} (desde ${mcDH(mt.paradaDesde)}${mt.paradaFim ? ' até ' + mcDH(mt.paradaFim) : ''})` : ''],
    ['O que aconteceu', mt.sintoma || ''], ['Causa provável', mt.causa || ''], ['Observações', mt.notes || '']]);
  if (mt.checklist?.length) {
    P.secao('Checklist', `${p.feitos} de ${p.total} itens`);
    P.tabela([{t: 'Item', w: 2.6}, {t: 'Situação', w: 1.1}, {t: 'Observação / peça', w: 2.6}], mt.checklist.map(it => {
      const s = it.pecaId ? find('stock', it.pecaId) : null;
      return [(it.obrig ? '* ' : '') + it.item, ((MC_ESTADOS.find(([e]) => e === it.estado) || [])[1] || 'não marcado').replace(/^[^A-Za-zÀ-ú]+/, ''), [it.obs, s ? `${s.name}: ${num(it.pecaQtd)} ${s.unit}` : ''].filter(Boolean).join(' - ')];
    }));
  }
  const pecas = (mt.checklist || []).filter(it => it.movId), movs = pecas.map(it => db.movements.find(x => x.id === it.movId)).filter(Boolean);
  if (movs.length) { P.secao('Peças do estoque', 'baixadas na conclusão'); P.tabela([{t: 'Peça', w: 2.6}, {t: 'Quantidade', w: 1, dir: true}, {t: 'Valor', w: 1.2, dir: true}], movs.map(x => { const s = find('stock', x.itemId); return [s?.name || 'item removido', `${num(x.qty)} ${s?.unit || ''}`, Number(x.value) > 0 ? brl2(x.value) : '-']; })); }
  if (mt.maoObra?.length) { P.secao('Mão de obra e serviços'); P.tabela([{t: 'Quem', w: 2.4}, {t: 'Tipo', w: 1.4}, {t: 'Horas / dias', w: 1, dir: true}, {t: 'Valor', w: 1.1, dir: true}], mt.maoObra.map(x => [x.nome, x.tipo === 'terceiro' ? 'Terceiro' + (x.doc ? ` (${x.doc})` : '') : x.fixo ? 'Equipe (fixo)' : 'Equipe', x.tipo === 'terceiro' ? '-' : `${num(x.qtd)} ${x.unidade === 'dia' ? 'dia(s)' : 'h'}`, Number(x.valor) > 0 ? brl2(x.valor) : '-'])); }
  P.secao('Custos');
  P.ficha([['Serviço de terceiros', brl2(mcTerceiros(mt))], ['Mão de obra da equipe', brl2(mcEquipeValor(mt))], ['Peças do estoque', brl2(mt.custoPecas)], ['Outros custos', brl2(mt.custoOutros ?? (mt.maoObra?.length ? 0 : mt.cost))], ['Total da manutenção', brl2(mcCustoTotal(mt))]]);
  P.nota('Peças do estoque e mão de obra da equipe aparecem aqui para o custo total, mas são lançadas como gasto na compra e no apontamento (não se somam duas vezes).');
  if (mt.fotos?.length) P.nota(`${mt.fotos.length} ${mt.fotos.length === 1 ? 'foto guardada' : 'fotos guardadas'} no MercaPlant, nesta ordem.`);
  const exec = (mt.maoObra || []).map(x => x.nome).filter(Boolean)[0];
  P.assinaturas([[exec || 'Mecânico / responsável pelo serviço', 'Executado por'], [db.settings.owner || 'Responsável pela propriedade', 'Conferido por']]);
  const doc = P.finalizar(), slug = String(nomeM).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  window.entregarPdf(doc, `mercaplant-ordem-${slug}-${mt.date}.pdf`, enviar === true, `Ordem de manutenção - ${nomeM} - ${mt.description || ''}`);
}

// ---------- Ações ----------
function mcValidar(mt) {
  const l = mt.checklist || [];
  if (!l.length) return '';
  const faltam = l.filter(it => it.obrig && !mcMarcado(it));
  if (faltam.length) return `Marque os itens obrigatórios: ${faltam.map(it => it.item).slice(0, 4).join(', ')}${faltam.length > 4 ? '…' : ''}`;
  const teste = l.find(it => it.item === MC_TESTE);
  if (teste && teste.estado !== 'ok') return 'O teste de funcionamento precisa estar OK para concluir. Se ainda há problema, mantenha a ordem aberta.';
  const semObs = l.find(it => it.estado === 'problema' && !it.obs);
  if (semObs) return `Descreva o problema em “${semObs.item}”`;
  for (const it of l.filter(x => x.estado === 'trocado' && x.pecaId)) {
    const s = find('stock', it.pecaId), q = numeroBR(String(it.pecaQtd || ''));
    if (!s) return `A peça de “${it.item}” não está mais no estoque`;
    if (!(q > 0)) return `Informe a quantidade da peça usada em “${it.item}”`;
    if (q > Number(s.qty || 0)) return `Saldo insuficiente de ${s.name} (${num(s.qty)} ${s.unit}) para “${it.item}”`;
  }
  return '';
}
function mcConcluir(id) {
  const mt = find('maintenances', id); if (!mt) return;
  if (!mt.checklist?.length) mt.checklist = mcGerar(mt);
  mcGuardarCampos(mt);
  const erro = mcValidar(mt); if (erro) { upsert('maintenances', mt); showToast(erro, true); return; }
  const m = find('machines', mt.machineId); let custo = 0;
  mt.checklist.filter(it => it.estado === 'trocado' && it.pecaId && !it.movId).forEach(it => {
    const s = find('stock', it.pecaId), q = numeroBR(String(it.pecaQtd)), mov = aplicarMovimento(s, 'Saída', q, 0);
    it.movId = uid(); it.pecaQtd = q; custo += Number(mov.value) || 0;
    db.movements.push({id: it.movId, itemId: s.id, kind: 'Saída', qty: q, date: today(), notes: `Manutenção — ${m?.name || ''}: ${it.item}`, machineId: mt.machineId, maintenanceId: mt.id, ...mov});
  });
  if (custo) mt.custoPecas = Math.round(((Number(mt.custoPecas) || 0) + custo) * 100) / 100;
  if (mt.paradaDesde && !mt.paradaFim) mt.paradaFim = new Date().toISOString();
  finishMaintenance(mt); render();
}
const mtDoneSemChecklist = ACTIONS['mt-done'], mtIniciarSemChecklist = ACTIONS['mt-iniciar'];
Object.assign(ACTIONS, {
  // Concluir pela lista abre o checklist da ordem (concluir exige o checklist)
  'mt-done': id => { const mt = find('maintenances', id); if (!mt) return; mcAbrirOrdem(id); showToast('Preencha o checklist e toque em Concluir'); },
  'mt-iniciar': id => { mtIniciarSemChecklist?.(id); const mt = find('maintenances', id); if (mt) { mcAoSalvarOrdem(mt, {}, false); upsert('maintenances', mt); mcAbrirOrdem(id); } },
  'mc-iniciar': id => { const mt = find('maintenances', id); if (!mt) return; mcGuardarCampos(mt); mt.status = 'Em execução'; mt.inicioEm = mt.inicioEm || new Date().toISOString(); upsert('maintenances', mt); showToast('Manutenção em execução'); render(); },
  'mc-concluir': mcConcluir,
  'mc-mo-add': mcMaoObraForm, 'mc-mo-del': mcMaoObraExcluir,
  'mc-pdf': id => mcRelatorio(id, false), 'mc-enviar': id => mcRelatorio(id, true),
  'mc-estado': chave => {
    const [mid, iid, e] = String(chave).split('|'), mt = find('maintenances', mid); if (!mt) return;
    mcGuardarCampos(mt);
    const it = mt.checklist?.find(x => x.id === iid); if (!it) return;
    it.estado = it.estado === e ? '' : e;
    if (it.estado !== 'trocado') { it.pecaId = ''; it.pecaQtd = ''; }
    if (mt.status === 'Aberta') { mt.status = 'Em execução'; mt.inicioEm = mt.inicioEm || new Date().toISOString(); }
    upsert('maintenances', mt);
    const y = scrollY; render(); scrollTo(0, y);
  },
  'mc-add': id => {
    const mt = find('maintenances', id); if (!mt) return; mcGuardarCampos(mt);
    openForm({title: 'Novo item no checklist', fields: [{k: 'item', label: 'Item', required: true, full: true, placeholder: 'Ex.: Trocar a correia do ventilador'}, {k: 'obrig', label: 'Obrigatório?', type: 'select', options: ['Não', 'Sim'], required: true}],
      onSubmit: v => { const i = mt.checklist.findIndex(x => x.item === MC_TESTE); mt.checklist.splice(i < 0 ? mt.checklist.length : i, 0, {id: uid(), item: v.item, obrig: v.obrig === 'Sim', estado: '', obs: '', pecaId: '', pecaQtd: ''}); upsert('maintenances', mt); }});
  }
});
