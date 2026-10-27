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
function mcAoSalvarOrdem(item, antes) {
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
  const custoPecas = Number(mt.custoPecas) > 0 ? `<div><small>Peças do estoque</small><b>R$ ${num(mt.custoPecas, 2)}</b><small>já lançadas na compra</small></div>` : '';
  return head(`${mt.description || 'Ordem de manutenção'}`, `${m?.name || 'Máquina removida'} • aberta em ${fmtDate(mt.date)}`, btn('← Máquinas', 'nav', m?.type === 'Implemento' ? 'implementos' : 'maquinas', 'secondary') + btn('Editar', 'mt-edit', mt.id, 'secondary') + acao).replace('<section class="view-head">', '<section class="view-head" data-eyebrow="Ordem de manutenção">') +
    `<section class="card panel mc-info"><div class="mc-chips">${chipTipo}${chip(mt.status, mt.status === 'Concluída' ? 'gray' : mt.status === 'Em execução' ? 'blue' : mt.status === 'Programada' ? 'purple' : 'orange')}</div>
      <div class="mc-nums"><div><small>Máquina</small><b>${esc(m?.name || '—')}</b><small>${esc([m?.type, m && Number(m.hours) > 0 ? num(m.hours) + ' h' : ''].filter(Boolean).join(' • '))}</small></div>
        ${mt.inicioEm ? `<div><small>Início</small><b>${esc(mcDH(mt.inicioEm))}</b><small>${mt.doneDate ? 'concluída ' + fmtDate(mt.doneDate) : 'em andamento'}</small></div>` : ''}${parada}
        <div><small>Custo do serviço</small><b>${Number(mt.cost) > 0 ? 'R$ ' + num(mt.cost, 2) : '—'}</b><small>mão de obra e terceiros</small></div>${custoPecas}</div>
      ${mt.kind === 'Corretiva' ? `<div class="mc-corretiva"><div><small>O que aconteceu</small><p>${esc(mt.sintoma || '—')}</p></div>${mt.causa ? `<div><small>Causa provável</small><p>${esc(mt.causa)}</p></div>` : ''}</div>` : ''}
      ${mt.semChecklist ? '<p class="nota" style="margin:8px 0 0">Registrada como já feita, sem checklist.</p>' : ''}</section>
    ${mt.checklist?.length ? `<section class="card panel mc-lista"><div class="section-title" style="margin:0 0 8px"><h3>Checklist ${prev ? 'da revisão' : 'do conserto'}</h3><small class="nota">${p.feitos} de ${p.total} itens${p.faltam.length && aberta ? ` • faltam ${p.faltam.length} obrigatórios` : ''}</small></div>
      <div class="mc-barra"><span style="width:${p.total ? Math.round(p.feitos / p.total * 100) : 0}%"></span></div>
      ${mt.checklist.map(it => mcLinhaItem(mt, it, aberta)).join('')}
      ${aberta ? `<div class="btn-row" style="margin-top:10px">${btn('+ Item', 'mc-add', mt.id, 'secondary')}</div><p class="nota">* obrigatório. O teste de funcionamento precisa estar OK para concluir. Peça trocada pode sair do estoque: a baixa acontece ao concluir.</p>` : ''}</section>`
      : mt.status === 'Programada' ? `<section class="card">${empty('Manutenção programada', `Para ${fmtDate(mt.dataPrevista)}. Ao iniciar, o checklist aparece aqui.`)}</section>` : ''}
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
  'mt-iniciar': id => { mtIniciarSemChecklist?.(id); const mt = find('maintenances', id); if (mt) { mcAoSalvarOrdem(mt, {}); upsert('maintenances', mt); mcAbrirOrdem(id); } },
  'mc-iniciar': id => { const mt = find('maintenances', id); if (!mt) return; mcGuardarCampos(mt); mt.status = 'Em execução'; mt.inicioEm = mt.inicioEm || new Date().toISOString(); upsert('maintenances', mt); showToast('Manutenção em execução'); render(); },
  'mc-concluir': mcConcluir,
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
