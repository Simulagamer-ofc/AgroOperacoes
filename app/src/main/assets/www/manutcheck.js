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
// Tipo do modelo de checklist de uma máquina (implemento: plantadeira, pulverizador de arrasto ou implemento)
const mcChaveTipo = m => !m ? 'Outro' : m.type === 'Implemento' ? (MC_IMPL[m.tipoImpl] || 'Implemento') : (MC_MODELOS[m.type] ? m.type : 'Outro');
function mcModelo(m, kind) {
  if (kind === 'Corretiva') return MC_CORRETIVA;
  // Modelo editado pelo ADM / supervisor (vale para a fazenda toda)
  const proprio = typeof mciRevisao === 'function' ? mciRevisao(mcChaveTipo(m)) : null; if (proprio?.length) return proprio;
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
const mcTerceiros = mt => (mt.maoObra || []).filter(x => x.tipo === 'terceiro' || x.tipo === 'servico').reduce((t, x) => t + (Number(x.valor) || 0), 0);
const mcEquipeValor = mt => (mt.maoObra || []).filter(x => x.tipo === 'equipe').reduce((t, x) => t + (Number(x.valor) || 0), 0);
const mcEquipeHoras = mt => (mt.maoObra || []).filter(x => x.tipo === 'equipe' && x.unidade !== 'dia').reduce((t, x) => t + (Number(x.qtd) || 0), 0);
const mcOutros = mt => mt.custoOutros != null && mt.custoOutros !== '' ? Number(mt.custoOutros) || 0 : (mt.maoObra?.length ? 0 : Number(mt.cost) || 0);
function mcRecalcular(mt) { if (mt.custoOutros == null) mt.custoOutros = mcOutros(mt); const c = Math.round((mcTerceiros(mt) + (Number(mt.custoOutros) || 0)) * 100) / 100; mt.cost = c > 0 ? c : ''; }
const mcCustoTotal = mt => (Number(mt.cost) || 0) + mcEquipeValor(mt) + (Number(mt.custoPecas) || 0);
function mcAoSalvarOrdem(item, antes, doForm = true) {
  // No formulário o campo de custo é “Outros custos”; o custo da ordem soma também os serviços de terceiros
  if (doForm) { item.custoOutros = item.cost === '' || item.cost == null ? '' : Number(item.cost); mcRecalcular(item); }
  if (['Concluída', 'Programada', 'Aguardando autorização', 'Recusada'].includes(item.status)) return;
  const nada = !(item.checklist || []).some(mcMarcado), mudou = antes.kind !== item.kind || antes.machineId !== item.machineId;
  if (!item.checklist?.length || (mudou && nada)) item.checklist = mcGerar(item);
  if (item.kind === 'Corretiva' && item.parada === 'Sim' && !item.paradaDesde) item.paradaDesde = new Date().toISOString();
  if (item.parada !== 'Sim') { delete item.paradaDesde; }
}
function mcAbrirOrdem(id) {
  const mt = find('maintenances', id); if (!mt) return;
  if (['Aberta', 'Em execução', 'A conferir'].includes(mt.status) && !mt.checklist?.length) { mt.checklist = typeof mcpChecklistOrdem === 'function' ? mcpChecklistOrdem(mt) : mcGerar(mt); save(); }
  go('ordem/' + id);
}
const mcHoras = (a, b) => Math.max(0, (new Date(b || Date.now()) - new Date(a)) / 36e5);
const mcTempo = h => h >= 48 ? `${num(Math.round(h / 24 * 10) / 10)} dias` : `${num(Math.round(h * 10) / 10)} h`;
// Dia e hora no horário do aparelho (o ISO gravado é UTC: de noite, a data do ISO já é a do dia seguinte)
const mcDH = iso => { const d = new Date(iso), p = n => String(n).padStart(2, '0'); return !iso || isNaN(d) ? '' : `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };

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
  // Quem autoriza (ADM, supervisor, quem usa sem nuvem) lança valores e conclui; o usuário comum faz o checklist e envia para conferência
  const gestor = typeof mcpGestor !== 'function' || mcpGestor(), vePreco = typeof mcpVeValores !== 'function' || mcpVeValores();
  const m = find('machines', mt.machineId), aberta = ['Aberta', 'Em execução'].includes(mt.status) || (mt.status === 'A conferir' && gestor), p = mcProgresso(mt);
  const pedidoAberto = ['Aguardando autorização', 'Recusada'].includes(mt.status), doChecklist = mt.origem === 'checklist';
  const podeComp = ['Aberta', 'Em execução'].includes(mt.status) ? btn('+ Pedir complemento', 'mcp-comp-pedir', mt.id, 'secondary') : '';
  const prev = mt.kind !== 'Corretiva', chipTipo = chip(mt.kind || 'Preventiva', prev ? 'green' : 'orange');
  const parada = mt.paradaDesde ? `<div><small>Máquina parada</small><b class="${aberta ? 'txt-red' : ''}">${aberta ? 'há ' : ''}${mcTempo(mcHoras(mt.paradaDesde, mt.paradaFim))}</b><small>desde ${esc(mcDH(mt.paradaDesde))}${mt.paradaFim ? ' até ' + esc(mcDH(mt.paradaFim)) : ''}</small></div>` : '';
  const acao = mt.status === 'Programada' ? btn('▶ Iniciar', 'mt-iniciar', mt.id)
    : mt.status === 'Aguardando autorização' ? (gestor ? btn('✓ Autorizar', 'mcp-autorizar', mt.id) + btn('✕ Recusar', 'mcp-recusar', mt.id, 'secondary') : '')
    : mt.status === 'Aberta' ? btn('▶ Iniciar manutenção', 'mc-iniciar', mt.id) + (gestor ? btn('✓ Concluir', 'mc-concluir', mt.id, 'secondary') : '') + podeComp
    : mt.status === 'Em execução' ? (gestor ? btn('✓ Concluir manutenção', 'mc-concluir', mt.id) : btn('✓ Terminei — enviar para conferência', 'mcp-conferir', mt.id)) + podeComp
    : mt.status === 'A conferir' && gestor ? btn('✓ Conferir e concluir', 'mc-concluir', mt.id) + btn('↩ Devolver', 'mcp-devolver', mt.id, 'secondary') : '';
  const custoPecas = '';
  return head(`${mt.description || 'Ordem de manutenção'}`, `${m?.name || 'Máquina removida'} • aberta em ${fmtDate(mt.date)}`, btn('← Máquinas', 'nav', m?.type === 'Implemento' ? 'implementos' : 'maquinas', 'secondary') + (gestor ? btn('Editar', 'mt-edit', mt.id, 'secondary') : '') + (mt.checklist?.length || mt.maoObra?.length ? btn('PDF', 'mc-pdf', mt.id, 'secondary') + btn('Enviar', 'mc-enviar', mt.id, 'secondary') : '') + acao).replace('<section class="view-head">', '<section class="view-head" data-eyebrow="Ordem de manutenção">') +
    `<section class="card panel mc-info"><div class="mc-chips">${chipTipo}${mcPendentes(mt).length ? chip('valor a informar', 'orange') : ''}${chip(mt.status, mt.status === 'Concluída' || mt.status === 'Recusada' ? 'gray' : mt.status === 'Em execução' ? 'blue' : mt.status === 'Programada' || mt.status === 'A conferir' ? 'purple' : mt.status === 'Aguardando autorização' ? 'red' : 'orange')}${typeof mcpCompPendentes === 'function' && mcpCompPendentes(mt).length ? chip('complemento aguardando', 'red') : ''}</div>
      <div class="mc-nums"><div><small>Máquina</small><b>${esc(m?.name || '—')}</b><small>${esc([m?.type, m && Number(m.hours) > 0 ? num(m.hours) + ' h' : ''].filter(Boolean).join(' • '))}</small></div>
        ${mt.inicioEm ? `<div><small>Início</small><b>${esc(mcDH(mt.inicioEm))}</b><small>${mt.doneDate ? 'concluída ' + fmtDate(mt.doneDate) : 'em andamento'}</small></div>` : ''}${parada}
        ${vePreco && !pedidoAberto ? `<div><small>Custo total da manutenção</small><b>${mcCustoTotal(mt) > 0 ? 'R$ ' + num(mcCustoTotal(mt), 2) : '—'}</b><small>peças, mão de obra e serviços</small></div>` : ''}</div>
      ${mt.kind === 'Corretiva' && (!doChecklist || mt.causa) ? `<div class="mc-corretiva">${doChecklist ? '' : `<div><small>O que aconteceu</small><p>${esc(mt.sintoma || '—')}</p></div>`}${mt.causa ? `<div><small>Causa provável</small><p>${esc(mt.causa)}</p></div>` : ''}</div>` : ''}
      ${mt.semChecklist ? '<p class="nota" style="margin:8px 0 0">Registrada como já feita, sem checklist.</p>' : ''}</section>
    ${typeof mcpCartoesOrdem === 'function' ? mcpCartoesOrdem(mt, gestor) : ''}
    ${mt.checklist?.length ? `<section class="card panel mc-lista"><div class="section-title" style="margin:0 0 8px"><h3>Checklist ${prev ? 'da revisão' : 'do conserto'}</h3><small class="nota">${p.feitos} de ${p.total} itens${p.faltam.length && aberta ? ` • faltam ${p.faltam.length} obrigatórios` : ''}</small></div>
      <div class="mc-barra"><span style="width:${p.total ? Math.round(p.feitos / p.total * 100) : 0}%"></span></div>
      ${mt.checklist.map(it => mcLinhaItem(mt, it, aberta)).join('')}
      ${aberta ? `<div class="btn-row" style="margin-top:10px">${gestor ? btn('+ Item', 'mc-add', mt.id, 'secondary') : podeComp}</div><p class="nota">* obrigatório. O teste de funcionamento precisa estar OK para concluir. Peça trocada pode sair do estoque: a baixa acontece ao concluir${gestor ? '' : ', feita por quem autoriza'}.${gestor ? '' : ' Apareceu mais alguma coisa para trocar ou consertar? Toque em Pedir complemento.'}</p>` : ''}</section>`
      : mt.status === 'Programada' ? `<section class="card">${empty('Manutenção programada', `Para ${fmtDate(mt.dataPrevista)}. Ao iniciar, o checklist aparece aqui.`)}</section>` : ''}
    ${gestor && !pedidoAberto ? mcCartaoCustos(mt) : ''}
    ${pedidoAberto ? '' : `<section class="card panel"><h3 style="margin:0 0 6px">Fotos (antes e depois)</h3>${typeof campoFotos === 'function' ? campoFotos('maintenances', mt.id, mt.fotos || [], {rotulo: 'Fotos da manutenção', dica: 'Tire uma foto antes de começar e outra depois do serviço feito.'}) : ''}</section>`}`;
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
  const mo = mt.maoObra || [], linha = x => `<div class="mc-mo"><span><b>${esc(x.tipo === 'servico' ? x.servico : x.nome)}</b><small>${x.tipo === 'servico' ? [x.nome ? (x.quem === 'terceiro' ? 'feito por ' + esc(x.nome) + ' (de fora)' : 'feito por ' + esc(x.nome)) : 'por serviço', x.doc ? esc(x.doc) : ''].filter(Boolean).join(' • ') : x.tipo === 'terceiro' ? `${x.qtd ? `${num(x.qtd)} h × R$ ${num(x.valorHora, 2)} • ` : ''}de fora${x.doc ? ' • ' + esc(x.doc) : ''}` : `${num(x.qtd)} ${x.unidade === 'dia' ? (Number(x.qtd) > 1 ? 'diárias' : 'diária') : 'h'}${x.fixo ? ' • fixo (salário em Financeiro)' : ''}`}</small></span>${x.pendente ? `<span class="mc-pend">${mini('Informar valor', 'mc-mo-valor', mt.id + '|' + x.id, 'ok')}</span>` : `<b>${Number(x.valor) > 0 ? 'R$ ' + num(x.valor, 2) : '—'}</b>`}${mini('×', 'mc-mo-del', mt.id + '|' + x.id, 'del')}</div>`;
  const outros = Number(mt.custoOutros ?? (mo.length ? 0 : mt.cost)) || 0, eq = mcEquipeValor(mt), ter = mcTerceiros(mt), pe = Number(mt.custoPecas) || 0;
  return `<section class="card panel mc-custos"><div class="section-title" style="margin:0 0 8px"><h3>Mão de obra e custos</h3><span class="btn-row">${btn('Tabela de serviços', 'mc-servicos', '', 'secondary')}${btn('+ Mão de obra / serviço', 'mc-mo-add', mt.id, 'secondary')}</span></div>
    ${mcPendentes(mt).length ? `<p class="mc-aviso-pend">⚠ ${mcPendentes(mt).length === 1 ? '1 serviço com valor a informar' : mcPendentes(mt).length + ' serviços com valor a informar'}: preencha para concluir a ordem.</p>` : ''}
    ${mo.length ? mo.map(linha).join('') : '<p class="nota" style="margin:0 0 8px">Lance cada serviço feito (troca de óleo, embreagem, solda…) com o preço da tabela, ou as horas da equipe.</p>'}
    <div class="mc-tot">
      <div><small>Mão de obra (serviços e de fora)</small><b>R$ ${num(ter, 2)}</b><small>entra no custo da ordem</small></div>
      <div><small>Horas da equipe</small><b>R$ ${num(eq, 2)}</b><small>${mcEquipeHoras(mt) ? num(mcEquipeHoras(mt)) + ' h • ' : ''}lançada em Mão de obra</small></div>
      <div><small>Peças do estoque</small><b>R$ ${num(pe, 2)}</b><small>lançadas na compra</small></div>
      <div><small>Outros custos</small><b>R$ ${num(outros, 2)}</b><small>em Editar</small></div>
      <div class="mc-tot-total"><small>Total da manutenção</small><b>R$ ${num(mcCustoTotal(mt), 2)}</b><small>gasto desta ordem: R$ ${num(Number(mt.cost) || 0, 2)} (serviços + outros)</small></div>
    </div></section>`;
}
// Tabela de serviços de manutenção (preço por tipo de serviço) — vale para a fazenda toda, sincroniza na nuvem
const mcServicos = () => (db.servicosManut || []).filter(x => !x.inativo).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
// Serviços comuns já na lista (sem preço): o primeiro valor digitado vira o preço sugerido das próximas vezes
const MC_SERV_COMUNS = ['Troca de óleo e filtros', 'Revisão geral', 'Embreagem', 'Freios', 'Solda', 'Rolamentos', 'Correias', 'Parte elétrica', 'Hidráulico (mangueiras e cilindros)', 'Pneus (troca ou conserto)', 'Arrefecimento (radiador)', 'Injeção / bomba injetora', 'Lubrificação geral'];
const mcNorm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const mcComunsLivres = () => { const ja = new Set((db.servicosManut || []).map(x => mcNorm(x.nome))); return MC_SERV_COMUNS.filter(n => !ja.has(mcNorm(n))); };
const mcPendentes = mt => (mt.maoObra || []).filter(x => x.pendente);
function mcMaoObraForm(id) {
  const mt = find('maintenances', id); if (!mt) return; mcGuardarCampos(mt);
  const m = find('machines', mt.machineId), servs = mcServicos();
  const pessoas = () => db.equipe.map(p => ({value: p.id, label: `${p.nome} — ${p.tipo}${p.funcao ? ' (' + p.funcao + ')' : ''}`}));
  const comuns = mcComunsLivres();
  openForm({title: 'Mão de obra ou serviço', sub: `${mt.description || 'Ordem'} — ${m?.name || ''}`, values: {cobranca: 'Por serviço', servico: servs[0]?.id || (comuns[0] ? '__c:' + comuns[0] : '__novo'), valor: servs[0]?.valor ?? '', quem: '-', pessoa: db.equipe[0]?.id || 'terceiro', date: today(), guardar: 'Sim'},
    fields: [
      {k: 'cobranca', label: 'Como é cobrado', type: 'select', options: ['Por serviço', 'Por hora'], required: true, full: true},
      {k: 'servico', label: 'Serviço', type: 'select', required: true, full: true, mostrarSe: ['cobranca', 'Por serviço'], options: () => [...servs.map(x => ({value: x.id, label: `${x.nome}${Number(x.valor) > 0 ? ' — R$ ' + num(x.valor, 2) : ''}`})), ...comuns.map(n => ({value: '__c:' + n, label: `${n} (sem preço ainda)`})), {value: '__novo', label: '+ Outro serviço (digitar)'}]},
      {k: 'servicoNome', label: 'Nome do serviço', full: true, placeholder: 'Ex.: Troca de óleo e filtros, Troca da embreagem', mostrarSe: [['cobranca', 'Por serviço'], ['servico', '__novo']]},
      {k: 'guardar', label: 'Guardar na tabela de serviços (com o preço)?', type: 'select', options: ['Sim', 'Não'], mostrarSe: [['cobranca', 'Por serviço'], ['servico', '__novo']]},
      {k: 'valor', label: 'Valor do serviço (R$)', type: 'number', min: 0, mostrarSe: ['cobranca', 'Por serviço'], hint: 'Vem da tabela; dá para mudar só nesta ordem. Ainda não sabe? Deixe em branco: fica “valor a informar” e precisa ser preenchido para concluir.'},
      {k: 'quem', label: 'Quem fez', type: 'select', required: true, full: true, mostrarSe: ['cobranca', 'Por serviço'], options: () => [{value: '-', label: 'Não informar'}, {value: 'terceiro', label: 'Mecânico ou oficina de fora'}, ...pessoas()]},
      {k: 'nome', label: 'Nome do mecânico ou da oficina', full: true, mostrarSe: [['cobranca', 'Por serviço'], ['quem', 'terceiro']]},
      {k: 'pessoa', label: 'Quem fez', type: 'select', required: true, full: true, mostrarSe: ['cobranca', 'Por hora'], options: () => [...pessoas(), {value: 'terceiro', label: 'Mecânico ou oficina de fora'}]},
      {k: 'nomeHora', label: 'Nome do mecânico ou da oficina', full: true, mostrarSe: [['cobranca', 'Por hora'], ['pessoa', 'terceiro']]},
      {k: 'qtd', label: 'Horas trabalhadas (diarista: dias)', type: 'number', min: 0, mostrarSe: ['cobranca', 'Por hora']},
      {k: 'valorHora', label: 'Valor da hora (R$)', type: 'number', min: 0, mostrarSe: [['cobranca', 'Por hora'], ['pessoa', 'terceiro']]},
      {k: 'docHora', label: 'Nota ou recibo', mostrarSe: [['cobranca', 'Por hora'], ['pessoa', 'terceiro']]},
      {k: 'doc', label: 'Nota ou recibo', mostrarSe: ['cobranca', 'Por serviço']},
      {k: 'date', label: 'Data', type: 'date', required: true}],
    onSubmit: v => {
      mt.maoObra = mt.maoObra || []; if (mt.custoOutros == null) mt.custoOutros = mcOutros(mt);
      if (v.cobranca === 'Por serviço') {
        const comum = String(v.servico).startsWith('__c:') ? v.servico.slice(4) : '';
        let sv = v.servico !== '__novo' && !comum ? find('servicosManut', v.servico) : null;
        const nomeServ = sv ? sv.nome : comum || String(v.servicoNome || '').trim();
        if (!nomeServ) return 'Informe o nome do serviço';
        const temValor = v.valor > 0;
        // Serviço comum ou novo (com “guardar”): entra na tabela com o valor digitado, que vira o preço sugerido
        if (!sv && temValor && (comum || v.guardar === 'Sim')) { sv = {id: uid(), nome: nomeServ, valor: v.valor}; upsert('servicosManut', sv); }
        const p = v.quem && !['terceiro', '-'].includes(v.quem) ? find('equipe', v.quem) : null;
        if (v.quem === 'terceiro' && !String(v.nome || '').trim()) return 'Informe o nome do mecânico ou da oficina';
        mt.maoObra.push({id: uid(), tipo: 'servico', servico: nomeServ, servicoId: sv?.id || '', valor: temValor ? v.valor : '', pendente: !temValor, guardarPreco: !sv && (comum || v.guardar === 'Sim') ? true : undefined, quem: v.quem === 'terceiro' ? 'terceiro' : p ? 'equipe' : '', nome: v.quem === 'terceiro' ? v.nome.trim() : p?.nome || '', pessoaId: p?.id || '', doc: v.doc || '', date: v.date});
      } else if (v.pessoa === 'terceiro') {
        // Mecânico ou oficina de fora cobrando por hora: horas × valor da hora entram no custo da ordem
        if (!String(v.nomeHora || '').trim()) return 'Informe o nome do mecânico ou da oficina';
        if (!(v.qtd > 0)) return 'Informe as horas trabalhadas';
        if (!(v.valorHora > 0)) return 'Informe o valor da hora';
        mt.maoObra.push({id: uid(), tipo: 'terceiro', nome: v.nomeHora.trim(), qtd: v.qtd, unidade: 'h', valorHora: v.valorHora, valor: Math.round(v.qtd * v.valorHora * 100) / 100, doc: v.docHora || '', date: v.date});
      } else {
        const p = find('equipe', v.pessoa); if (!p) return db.equipe.length ? 'Escolha quem fez' : 'Cadastre a equipe em Mão de obra para lançar por hora';
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
  // Escolheu o serviço: o valor vem da tabela
  const sel = $('#f_servico', dialog), val = $('#f_valor', dialog);
  if (sel && val) sel.addEventListener('change', () => { const x = find('servicosManut', sel.value); val.value = x && Number(x.valor) > 0 ? String(x.valor).replace('.', ',') : ''; });
}
// Tabela de serviços: lista com preço, editar, tirar e incluir
function mcTabelaServicos() {
  const l = mcServicos();
  dialog.innerHTML = `<h3>Tabela de serviços de manutenção</h3><p class="sub">Preço de cada tipo de serviço. Ao lançar a mão de obra na ordem, o valor já vem preenchido (dá para mudar na hora).</p>
    <div class="mc-serv-lista">${l.length ? l.map(x => `<div class="mc-serv"><span>${esc(x.nome)}</span><b>R$ ${num(x.valor || 0, 2)}</b><button type="button" class="secondary" data-serv-edit="${esc(x.id)}">Editar</button><button type="button" class="danger" data-serv-del="${esc(x.id)}">Tirar</button></div>`).join('') : '<p class="nota">Nenhum serviço ainda. Inclua aqui ou ao lançar a mão de obra numa ordem.</p>'}</div>
    <div class="actions"><button type="button" class="secondary" data-close>Fechar</button><button type="button" class="primary" data-serv-novo>+ Serviço</button></div>`;
  $('[data-close]', dialog).onclick = closeModal;
  $('[data-serv-novo]', dialog).onclick = () => mcServicoForm();
  $$('[data-serv-edit]', dialog).forEach(b => { b.onclick = () => mcServicoForm(find('servicosManut', b.dataset.servEdit)); });
  $$('[data-serv-del]', dialog).forEach(b => { b.onclick = () => { const x = find('servicosManut', b.dataset.servDel); if (x) { x.inativo = true; upsert('servicosManut', x); mcTabelaServicos(); } }; });
  modal.classList.add('open');
}
function mcServicoForm(x = {}) {
  openForm({title: x.id ? 'Editar serviço' : 'Novo serviço', values: x, fields: [{k: 'nome', label: 'Serviço', required: true, full: true, placeholder: 'Ex.: Troca de óleo e filtros'}, {k: 'valor', label: 'Preço (R$)', type: 'number', min: 0, required: true}],
    onSubmit: v => { if (!(v.valor > 0)) return 'Informe o preço'; upsert('servicosManut', {...x, ...v, id: x.id || uid(), inativo: false}); setTimeout(mcTabelaServicos, 0); }});
}
function mcMaoObraValor(chave) {
  const [mid, eid] = String(chave).split('|'), mt = find('maintenances', mid), x = mt?.maoObra?.find(y => y.id === eid); if (!x) return;
  openForm({title: 'Valor do serviço', sub: x.servico || x.nome, values: {valor: x.valor || ''}, fields: [{k: 'valor', label: 'Valor (R$)', type: 'number', min: 0, required: true}],
    onSubmit: v => {
      if (!(v.valor > 0)) return 'Informe o valor';
      x.valor = v.valor; x.pendente = false;
      // Primeiro preço de um serviço comum/novo: vira o preço sugerido na tabela
      if (x.guardarPreco && !x.servicoId) { const sv = {id: uid(), nome: x.servico, valor: v.valor}; upsert('servicosManut', sv); x.servicoId = sv.id; delete x.guardarPreco; }
      mcRecalcular(mt); upsert('maintenances', mt); showToast('Valor informado');
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
  const vePreco = typeof mcpVeValores !== 'function' || mcpVeValores();
  const P = window.pdfMercaPlant({titulo: 'Ordem de manutenção', linha2: `${nomeM} - ${fmtDate(mt.date)}`, continuacao: `Ordem de manutenção · ${nomeM}`});
  const C = P.COR;
  P.secao(mt.description || 'Ordem de manutenção', `${mt.kind || 'Preventiva'} • ${mt.status}`);
  P.cartoes([['Tipo', mt.kind || 'Preventiva', mt.status, mt.kind === 'Corretiva' ? C.laranja : C.verde], ['Checklist', p.total ? `${p.feitos} de ${p.total}` : '-', p.faltam.length && mt.status !== 'Concluída' ? `faltam ${p.faltam.length} obrigatórios` : 'itens marcados', C.azul],
    vePreco ? ['Custo total', brl2(mcCustoTotal(mt)), 'peças, mão de obra e serviços', C.laranja] : ['Situação', mt.status, mt.autorizacao?.por ? 'autorizada por ' + mt.autorizacao.por : '', C.laranja]]);
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
  if (vePreco) {
    if (movs.length) { P.secao('Peças do estoque', 'baixadas na conclusão'); P.tabela([{t: 'Peça', w: 2.6}, {t: 'Quantidade', w: 1, dir: true}, {t: 'Valor', w: 1.2, dir: true}], movs.map(x => { const s = find('stock', x.itemId); return [s?.name || 'item removido', `${num(x.qty)} ${s?.unit || ''}`, Number(x.value) > 0 ? brl2(x.value) : '-']; })); }
    if (mt.maoObra?.length) { P.secao('Mão de obra e serviços'); P.tabela([{t: 'Serviço', w: 2.2}, {t: 'Quem fez', w: 1.8}, {t: 'Horas / dias', w: .9, dir: true}, {t: 'Valor', w: 1.1, dir: true}], mt.maoObra.map(x => [x.tipo === 'servico' ? x.servico + (x.doc ? ` (${x.doc})` : '') : x.tipo === 'terceiro' ? (x.qtd ? `Por hora (R$ ${num(x.valorHora, 2)}/h)` : 'Serviço de terceiro') + (x.doc ? ` (${x.doc})` : '') : 'Horas da equipe' + (x.fixo ? ' (fixo)' : ''), x.nome ? x.nome + (x.quem === 'terceiro' || x.tipo === 'terceiro' ? ' (de fora)' : '') : '-', x.qtd ? `${num(x.qtd)} ${x.unidade === 'dia' ? 'dia(s)' : 'h'}` : '-', x.pendente ? 'a informar' : Number(x.valor) > 0 ? brl2(x.valor) : '-'])); }
    P.secao('Custos');
    P.ficha([['Serviços (mão de obra)', brl2(mcTerceiros(mt))], ['Horas da equipe', brl2(mcEquipeValor(mt))], ['Peças do estoque', brl2(mt.custoPecas)], ['Outros custos', brl2(mt.custoOutros ?? (mt.maoObra?.length ? 0 : mt.cost))], ['Total da manutenção', brl2(mcCustoTotal(mt))]]);
    P.nota('Peças do estoque e mão de obra da equipe aparecem aqui para o custo total, mas são lançadas como gasto na compra e no apontamento (não se somam duas vezes).');
  } else if (movs.length) { P.secao('Peças do estoque', 'baixadas na conclusão'); P.tabela([{t: 'Peça', w: 3}, {t: 'Quantidade', w: 1.2, dir: true}], movs.map(x => { const s = find('stock', x.itemId); return [s?.name || 'item removido', `${num(x.qty)} ${s?.unit || ''}`]; })); }
  if (mt.fotos?.length) P.nota(`${mt.fotos.length} ${mt.fotos.length === 1 ? 'foto guardada' : 'fotos guardadas'} no MercaPlant, nesta ordem.`);
  const exec = (mt.maoObra || []).map(x => x.nome).filter(Boolean)[0];
  P.assinaturas([[exec || 'Mecânico / responsável pelo serviço', 'Executado por'], [db.settings.owner || 'Responsável pela propriedade', 'Conferido por']]);
  const doc = P.finalizar(), slug = String(nomeM).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  window.entregarPdf(doc, `mercaplant-ordem-${slug}-${mt.date}.pdf`, enviar === true, `Ordem de manutenção - ${nomeM} - ${mt.description || ''}`);
}

// ---------- Ações ----------
function mcValidar(mt, semValores = false) {
  const l = mt.checklist || [];
  if (!l.length) return semValores ? 'O checklist desta ordem está vazio' : mcPendentes(mt).length ? `Informe o valor de “${mcPendentes(mt)[0].servico}” (mão de obra) antes de concluir` : '';
  const faltam = l.filter(it => it.obrig && !mcMarcado(it));
  if (faltam.length) return `Marque os itens obrigatórios: ${faltam.map(it => it.item).slice(0, 4).join(', ')}${faltam.length > 4 ? '…' : ''}`;
  const teste = l.find(it => it.item === MC_TESTE);
  if (teste && teste.estado !== 'ok') return 'O teste de funcionamento precisa estar OK para concluir. Se ainda há problema, mantenha a ordem aberta.';
  const pend = semValores ? [] : mcPendentes(mt); if (pend.length) return `Informe o valor de “${pend[0].servico || pend[0].nome}” (mão de obra) antes de concluir`;
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
  if (typeof mcpGestor === 'function' && !mcpGestor()) { showToast('Quem conclui a manutenção é o supervisor ou o ADM. Toque em “Terminei — enviar para conferência”.', true); return; }
  if (typeof mcpCompPendentes === 'function' && mcpCompPendentes(mt).length) { showToast('Há um pedido de complemento aguardando: autorize ou recuse antes de concluir.', true); return; }
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
  'mc-mo-add': mcMaoObraForm, 'mc-mo-del': mcMaoObraExcluir, 'mc-mo-valor': mcMaoObraValor, 'mc-servicos': mcTabelaServicos,
  'mc-pdf': id => mcRelatorio(id, false), 'mc-enviar': id => mcRelatorio(id, true),
  'mc-estado': chave => {
    const [mid, iid, e] = String(chave).split('|'), mt = find('maintenances', mid); if (!mt) return;
    mcGuardarCampos(mt);
    const it = mt.checklist?.find(x => x.id === iid); if (!it) return;
    if (!['Aberta', 'Em execução'].includes(mt.status) && !(mt.status === 'A conferir' && (typeof mcpGestor !== 'function' || mcpGestor()))) { showToast('Esta ordem não está em execução', true); return; }
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
