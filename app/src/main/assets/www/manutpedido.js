'use strict';
/* MercaPlant — Checklist da máquina e pedido de manutenção com autorização.
   O operador (usuário comum) não abre ordem nem lança valores: faz o checklist da máquina — avulso ou ao iniciar uma
   operação — e o defeito marcado vira um pedido de manutenção “Aguardando autorização”, com a observação, a foto e se a
   máquina pode trabalhar. Sem duplicar: se a máquina já tem um pedido aguardando, o defeito entra nele; se já tem uma
   ordem autorizada em andamento, entra como pedido de complemento (e o mesmo item não entra duas vezes).
   Quem autoriza (ADM, supervisor ou quem usa o app sem nuvem) autoriza ou recusa o pedido e o complemento, lança
   serviços, peças e valores e conclui. O operador marca o checklist do conserto e envia para conferência.
   Os checklists ficam na coleção própria (cada um de quem fez); a ordem só guarda a decisão de quem autorizou. */

const MCP_COL = 'checklistsMaq';
const MCP_AGUARDA = 'Aguardando autorização', MCP_RECUSADA = 'Recusada', MCP_CONFERIR = 'A conferir';
const MCP_EM_ANDAMENTO = ['Aberta', 'Em execução', MCP_CONFERIR];
// Itens do checklist da máquina (inspeção do dia a dia, antes de trabalhar), pelo tipo
const MC_INSPECAO = {
  'Trator': ['Nível do óleo do motor', 'Água do radiador (arrefecimento)', 'Vazamentos (óleo, hidráulico, combustível)', 'Pneus', 'Luzes e alarmes do painel', 'Freios e direção', 'Filtro de ar / pré-filtro', 'Engates e proteção do cardã'],
  'Caminhão': ['Nível do óleo do motor', 'Água do radiador', 'Pneus e estepe', 'Freios', 'Luzes e sinalização', 'Vazamentos', 'Documentos e tacógrafo'],
  'Colheitadeira': ['Nível do óleo do motor', 'Radiador e colmeia limpos', 'Correias e correntes', 'Plataforma: navalhas e dedos', 'Vazamentos', 'Pneus', 'Luzes e alarmes do painel', 'Extintor'],
  'Pulverizador': ['Vazamentos na calda (bomba, mangueiras, conexões)', 'Bicos entupidos ou gotejando', 'Filtros de linha e de bico', 'Manômetro', 'Barras e suspensão', 'Óleo do motor (autopropelido)', 'Pneus'],
  'Plantadeira': ['Discos de corte e duplos', 'Dosadores de semente e adubo', 'Correntes e engrenagens', 'Mangueiras e hidráulico', 'Pneus', 'Graxa nos pontos de lubrificação'],
  'Implemento': ['Rolamentos', 'Peças de desgaste (discos, ponteiras, facas)', 'Parafusos e soldas', 'Mangueiras e hidráulico', 'Pneus', 'Graxa nos pontos de lubrificação'],
  'Secador': ['Limpeza (pó e palha)', 'Fornalha / queimador', 'Motores e ventiladores', 'Correias e polias', 'Sensores de temperatura'],
  'Moega': ['Grelha e fosso', 'Elevadores, correias e canecas', 'Rosca transportadora', 'Balança'],
  'Silo/Armazém': ['Ventiladores de aeração', 'Cabos de termometria', 'Estrutura e vedação'],
  'Beneficiamento': ['Peneiras', 'Correias e rolamentos', 'Motores', 'Limpeza das máquinas'],
  'Outro': ['Estado geral', 'Vazamentos', 'Ruído ou vibração diferente']
};
{
  const leve = ['Nível do óleo do motor', 'Água do radiador', 'Pneus e estepe', 'Freios', 'Luzes e setas', 'Limpador e para-brisa', 'Documentos no veículo'];
  const pesada = ['Nível do óleo do motor', 'Nível do óleo hidráulico', 'Vazamentos', 'Pinos e articulações (graxa)', 'Dentes, lâmina ou concha', 'Pneus ou esteira', 'Luzes, alarmes e sinal de ré', 'Extintor'];
  Object.assign(MC_INSPECAO, {'Caminhonete': leve, 'Carro': leve, 'Van/Ônibus': [...leve, 'Cintos de segurança'],
    'Moto': ['Pneus', 'Freios', 'Corrente', 'Luzes', 'Nível do óleo'],
    'Quadriciclo/UTV': ['Pneus', 'Freios', 'Nível do óleo', 'Luzes', 'Vazamentos'],
    'Pá carregadeira': pesada, 'Retroescavadeira': pesada, 'Escavadeira': pesada, 'Motoniveladora': pesada, 'Trator de esteira': pesada, 'Minicarregadeira': pesada, 'Manipulador telescópico': pesada, 'Empilhadeira': [...pesada.filter(i => !/Dentes/.test(i)), 'Garfos e corrente de elevação'],
    'Distribuidor autopropelido': ['Nível do óleo do motor', 'Vazamentos', 'Esteira e discos', 'Pneus', 'Luzes e alarmes do painel'],
    'Colhedora de forragem': ['Nível do óleo do motor', 'Facas e contra-faca', 'Correias', 'Vazamentos', 'Radiador limpo', 'Luzes e alarmes do painel'],
    'Drone de pulverização': ['Hélices sem trinca', 'Braços travados', 'Baterias carregadas e sem estufar', 'Bomba e bicos', 'Tanque e filtro', 'GPS e bússola', 'Rádio / controle'],
    'Avião agrícola': ['Inspeção pré-voo conforme o manual', 'Combustível e óleo', 'Sistema de aplicação', 'Bicos'],
    'Gerador': ['Nível do óleo', 'Combustível', 'Bateria', 'Vazamentos', 'Painel'],
    'Motobomba / irrigação': ['Nível do óleo', 'Vazamentos e gaxetas', 'Mangueiras', 'Ruído ou vibração diferente'],
    'Pivô central': ['Pneus', 'Vazamentos', 'Aspersores', 'Painel', 'Alinhamento das torres']});
}
const MCP_ESTADOS = [['ok', '✓ OK'], ['defeito', '⚠ Defeito'], ['na', '— N/A']];
const mcpGestor = () => !(typeof nvComum === 'function' && nvComum());
const mcpVeValores = () => mcpGestor() || (typeof nvVeFinanceiro === 'function' && nvVeFinanceiro());
function mcpItensDe(m) {
  const proprio = typeof mciInspecao === 'function' ? mciInspecao(mcChaveTipo(m)) : null; if (proprio?.length) return proprio;
  if (!m) return MC_INSPECAO.Outro;
  if (m.type === 'Implemento') return MC_INSPECAO[MC_IMPL[m.tipoImpl]] || MC_INSPECAO.Implemento;
  return MC_INSPECAO[m.type] || MC_INSPECAO.Outro;
}
const mcpAgora = () => new Date().toISOString();
const mcpDefeitos = r => (r.itens || []).filter(i => i.estado === 'defeito');
// Itens que este checklist levou para a ordem (no complemento automático, só os que eram novos)
const mcpItensLevados = r => r.itensNovos ? mcpDefeitos(r).filter(i => r.itensNovos.includes(i.item)) : mcpDefeitos(r);

// ---------- Ligação checklist → ordem ----------
const mcpDaOrdem = mt => (db[MCP_COL] || []).filter(r => r.pedidoId === mt.id).sort((a, b) => String(a.em).localeCompare(String(b.em)));
const mcpPedidoInicial = mt => mcpDaOrdem(mt).filter(r => !r.complemento);
const mcpComplementos = mt => mcpDaOrdem(mt).filter(r => r.complemento && mcpItensLevados(r).length);
const mcpCompPendentes = mt => MCP_EM_ANDAMENTO.includes(mt.status) ? mcpComplementos(mt).filter(r => !mt.decisoes?.[r.id]) : [];
// Junta os defeitos de vários checklists: o mesmo item aparece uma vez, com todos os relatos
function mcpAgrupar(lista) {
  const out = [];
  for (const r of lista) for (const d of mcpItensLevados(r)) {
    let g = out.find(x => mcNorm(x.item) === mcNorm(d.item));
    if (!g) out.push(g = {item: d.item, relatos: []});
    g.relatos.push({obs: d.obs, por: r.por, em: r.em, r});
  }
  return out;
}
// Nomes já presentes na ordem (pedido, checklist do conserto e complementos ainda sem decisão): não entram de novo
function mcpConhecidos(mt) {
  const s = new Set();
  mcpPedidoInicial(mt).forEach(r => mcpDefeitos(r).forEach(d => s.add(mcNorm(d.item))));
  (mt.checklist || []).forEach(it => s.add(mcNorm(it.item)));
  mcpComplementos(mt).filter(r => mt.decisoes?.[r.id]?.decisao !== 'recusada').forEach(r => mcpItensLevados(r).forEach(d => s.add(mcNorm(d.item))));
  return s;
}
// Checklist do conserto: diagnóstico, cada defeito pedido (obrigatório), conserto e teste
function mcpChecklistOrdem(mt) {
  const base = mcGerar(mt);
  if (mt.origem !== 'checklist') return base;
  const defs = mcpAgrupar(mcpPedidoInicial(mt)), i = base.findIndex(x => x.item === MC_TESTE);
  const novos = defs.filter(d => !base.some(x => mcNorm(x.item) === mcNorm(d.item))).map(d => ({id: uid(), item: d.item, obrig: true, estado: '', obs: '', pecaId: '', pecaQtd: '', doPedido: true}));
  base.splice(i < 0 ? base.length : i, 0, ...novos);
  return base;
}
function mcpAddItens(mt, nomes, origem) {
  mt.checklist ||= [];
  const ja = new Set(mt.checklist.map(x => mcNorm(x.item))), i = mt.checklist.findIndex(x => x.item === MC_TESTE);
  const novos = nomes.filter(n => !ja.has(mcNorm(n))).map(n => ({id: uid(), item: n, obrig: true, estado: '', obs: '', pecaId: '', pecaQtd: '', [origem]: true}));
  mt.checklist.splice(i < 0 ? mt.checklist.length : i, 0, ...novos);
}

// Defeito marcado → pedido (ou junta ao que já existe). Devolve o que aconteceu, para o aviso.
function mcpPedido(r) {
  const defs = mcpDefeitos(r); if (!defs.length) return null;
  const doMaq = db.maintenances.filter(x => x.machineId === r.machineId);
  const aguarda = doMaq.find(x => x.status === MCP_AGUARDA), andamento = doMaq.find(x => MCP_EM_ANDAMENTO.includes(x.status));
  const gestor = mcpGestor(), quem = quemUsa();
  if (aguarda) {
    r.pedidoId = aguarda.id;
    if (r.podeTrabalhar === 'Não' && aguarda.parada !== 'Sim' && gestor) { aguarda.parada = 'Sim'; aguarda.paradaDesde = r.em; upsert('maintenances', aguarda); }
    return {tipo: 'junto', mt: aguarda};
  }
  if (andamento) {
    const conhecidos = mcpConhecidos(andamento), novos = defs.filter(d => !conhecidos.has(mcNorm(d.item))).map(d => d.item);
    // Durante a manutenção, o checklist só leva para a ordem os itens novos (os repetidos ficam só no histórico)
    r.pedidoId = andamento.id; r.complemento = true; r.itensNovos = novos;
    if (!novos.length) return {tipo: 'ja', mt: andamento};
    if (gestor) { andamento.decisoes = {...(andamento.decisoes || {}), [r.id]: {decisao: 'autorizada', por: quem, em: mcpAgora(), auto: true}}; mcpAddItens(andamento, novos, 'doComplemento'); if (andamento.status === MCP_CONFERIR) andamento.status = 'Em execução'; upsert('maintenances', andamento); }
    return {tipo: 'complemento', mt: andamento, novos};
  }
  const parada = r.podeTrabalhar === 'Não';
  const mt = {id: uid(), machineId: r.machineId, kind: 'Corretiva', date: today(), status: gestor ? 'Aberta' : MCP_AGUARDA, origem: 'checklist',
    description: 'Conserto: ' + defs.map(d => d.item).join(', ').slice(0, 140), sintoma: defs.map(d => `${d.item}: ${d.obs}`).join('; '),
    parada: parada ? 'Sim' : 'Não', ...(parada ? {paradaDesde: r.em} : {}), custoOutros: ''};
  r.pedidoId = mt.id;
  if (gestor) { mt.autorizacao = {decisao: 'autorizada', por: quem, em: mcpAgora(), auto: true}; mt.checklist = mcpChecklistOrdem(mt); }
  upsert('maintenances', mt);
  return {tipo: gestor ? 'ordem' : 'novo', mt};
}
const mcpAvisoPedido = (res, m) => !res ? `Checklist de ${m?.name || 'máquina'} registrado: tudo OK`
  : res.tipo === 'novo' ? `Defeito registrado: pedido de manutenção enviado para o supervisor ou ADM autorizar`
  : res.tipo === 'ordem' ? 'Defeito registrado: ordem de manutenção aberta'
  : res.tipo === 'junto' ? `Defeito juntado ao pedido que já está aguardando autorização (${fmtDate(res.mt.date)}) — não gerou outro`
  : res.tipo === 'complemento' ? (mcpGestor() ? 'Defeito novo incluído na ordem que está em andamento' : 'Defeito novo enviado como complemento da ordem em andamento (aguarda autorização)')
  : 'Este defeito já está na ordem de manutenção em andamento — não gerou outro pedido';

// ---------- Componente do checklist (dentro de um formulário) ----------
let mcpChk = null; // {id, machineId, itens: [{item, estado, obs, livre}], horimetro, pode, comHor}
function mcpNovoChk(machineId, comHorimetro) {
  const m = find('machines', machineId), conhecidos = [];
  db.maintenances.filter(x => x.machineId === machineId && [MCP_AGUARDA, ...MCP_EM_ANDAMENTO].includes(x.status)).forEach(x => {
    mcpAgrupar(mcpDaOrdem(x)).forEach(g => conhecidos.push(`${g.item} (${x.status === MCP_AGUARDA ? 'aguardando autorização' : 'em manutenção'})`));
  });
  return {id: uid(), machineId, itens: mcpItensDe(m).map(item => ({item, estado: '', obs: ''})), horimetro: '', pode: '', comHor: comHorimetro && typeof temHorimetro === 'function' && temHorimetro(m), ja: [...new Set(conhecidos)]};
}
function mcpLerCampos() {
  if (!mcpChk) return;
  $$('[data-chk-obs]', dialog).forEach(el => { const it = mcpChk.itens[el.dataset.chkObs]; if (it) it.obs = el.value.trim(); });
  $$('[data-chk-nome]', dialog).forEach(el => { const it = mcpChk.itens[el.dataset.chkNome]; if (it) it.item = el.value.trim(); });
  const h = $('[data-chk-hor]', dialog); if (h) mcpChk.horimetro = h.value.trim();
  const p = $('[data-chk-pode]', dialog); if (p) mcpChk.pode = p.value;
}
function mcpChkLista() {
  const c = mcpChk, def = c.itens.filter(i => i.estado === 'defeito').length, marc = c.itens.filter(i => i.estado).length, m = find('machines', c.machineId);
  return `<div class="mcp-topo"><div><b>Itens para conferir</b><small>${marc} de ${c.itens.length} marcados${def ? ` • <span class="txt-red">${def} com defeito</span>` : ''}</small></div><button type="button" class="secondary" data-chk="tudo">✓ Tudo OK</button></div>
    ${c.comHor ? `<div class="field full"><label>${NomeMed(m)} agora — ${esc(m.name)} (${unidMed(m)})</label><input data-chk-hor inputmode="decimal" autocomplete="off" value="${esc(c.horimetro)}" placeholder="Último registrado: ${esc(num(m.hours))} ${unidMed(m)}"></div>` : ''}
    ${c.ja.length ? `<p class="mcp-ja">Já informado nesta máquina: ${esc(c.ja.join(', '))}. Se for o mesmo defeito, ele não gera outro pedido.</p>` : ''}
    ${c.itens.map((it, i) => `<div class="mcp-item ${it.estado}">
      ${it.livre ? `<input class="mcp-nome-livre" data-chk-nome="${i}" value="${esc(it.item)}" placeholder="Qual item? Ex.: Mangueira do cilindro">` : `<span class="mcp-nome">${esc(it.item)}</span>`}
      <div class="mcp-bts" role="group" aria-label="${esc(it.item || 'Outro problema')}">${MCP_ESTADOS.filter(([e]) => !it.livre || e !== 'ok').map(([e, r]) => `<button type="button" class="mcp-e ${e} ${it.estado === e ? 'on' : ''}" data-chk="${i}|${e}" aria-pressed="${it.estado === e}">${r}</button>`).join('')}</div>
      ${it.estado === 'defeito' ? `<input class="mcp-obs" data-chk-obs="${i}" value="${esc(it.obs || '')}" placeholder="O que você viu? (obrigatório)">` : ''}</div>`).join('')}
    <button type="button" class="link" data-chk="outro">+ Outro problema</button>`;
}
function mcpChkHtml(opc = {}) {
  const def = mcpChk.itens.some(i => i.estado === 'defeito');
  return `<div class="field full mcp-chk" data-mcp-chk><div data-chk-lista>${mcpChkLista()}</div>
    <div class="mcp-def" data-chk-def ${def ? '' : 'hidden'}>
      <div class="field full"><label>A máquina pode trabalhar assim?</label><select data-chk-pode><option value="">Escolha…</option><option value="Sim" ${mcpChk.pode === 'Sim' ? 'selected' : ''}>Sim — dá para trabalhar até o conserto</option><option value="Não" ${mcpChk.pode === 'Não' ? 'selected' : ''}>Não — a máquina fica parada</option></select>${opc.inicio ? '<span class="hint">Não: a operação não começa e o pedido vai como máquina parada.</span>' : ''}</div>
      ${typeof campoFotos === 'function' ? campoFotos(MCP_COL, mcpChk.id, [], {soCamera: true, obrigatoria: !mcpGestor(), rotulo: 'Foto do defeito', dica: 'Tire a foto agora, mostrando o defeito. Ajuda quem vai autorizar.'}) : ''}
    </div></div>`;
}
function mcpRedesenhar() {
  const box = $('[data-chk-lista]', dialog); if (!box) return;
  box.innerHTML = mcpChkLista();
  const def = mcpChk.itens.some(i => i.estado === 'defeito'), d = $('[data-chk-def]', dialog); if (d) d.hidden = !def;
}
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-chk]'); if (!b || !mcpChk || !dialog.contains(b)) return;
  e.preventDefault(); mcpLerCampos();
  const v = b.dataset.chk;
  if (v === 'tudo') mcpChk.itens.forEach(it => { if (!it.estado && !it.livre) it.estado = 'ok'; });
  else if (v === 'outro') { mcpChk.itens.push({item: '', estado: 'defeito', obs: '', livre: true}); }
  else { const [i, est] = v.split('|'), it = mcpChk.itens[i]; if (it) { it.estado = it.estado === est ? '' : est; if (it.livre && !it.estado) mcpChk.itens.splice(i, 1); } }
  mcpRedesenhar();
  if (v === 'outro') $$('[data-chk-nome]', dialog).at(-1)?.focus();
});
function mcpChkValidar() {
  mcpLerCampos();
  const c = mcpChk, m = find('machines', c.machineId);
  const falta = c.itens.filter(i => !i.estado && !i.livre);
  if (falta.length) return `Marque todos os itens do checklist (faltam ${falta.length}: ${falta.slice(0, 3).map(i => i.item).join(', ')}${falta.length > 3 ? '…' : ''}). Se estiver tudo certo, toque em “Tudo OK”.`;
  const semNome = c.itens.find(i => i.livre && !i.item); if (semNome) return 'Escreva qual é o outro problema (ou tire a linha)';
  const semObs = c.itens.find(i => i.estado === 'defeito' && !i.obs); if (semObs) return `Descreva o defeito em “${semObs.item}”`;
  const def = c.itens.some(i => i.estado === 'defeito');
  if (def && !c.pode) return 'Informe se a máquina pode trabalhar com esse defeito';
  if (def && !mcpGestor() && !(fotosDoForm.get(c.id)?.length)) return 'Tire uma foto do defeito pela câmera';
  if (c.comHor) {
    const h = numeroBR(c.horimetro);
    if (c.horimetro === '' || !(h >= 0)) return `Informe ${porKm(m) ? 'o odômetro' : 'o horímetro'} do ${m.name}`;
    if (h < Number(m.hours || 0)) return `${NomeMed(m)} está menor que o último registrado do ${m.name} (${num(m.hours)} ${unidMed(m)}). Confira o painel.`;
    const salto = typeof conferirSalto === 'function' ? conferirSalto(m, h) : ''; if (salto) return salto;
  }
  return '';
}
// Grava o checklist (e o pedido, se houver defeito). horimetro: já lido no formulário (início de operação) ou o do componente.
function mcpRegistrar(origem, o, horimetro) {
  const c = mcpChk, m = find('machines', c.machineId), em = mcpAgora();
  const h = horimetro != null && horimetro !== '' ? Number(horimetro) : c.comHor ? numeroBR(c.horimetro) : '';
  const r = {id: c.id, machineId: c.machineId, data: today(), hora: nowTime(), em, por: quemUsa(), origem, opId: o?.id || '', horimetro: h,
    itens: c.itens.filter(i => i.estado).map(({item, estado, obs}) => ({item, estado, obs: estado === 'defeito' ? obs : ''})), podeTrabalhar: c.itens.some(i => i.estado === 'defeito') ? c.pode : ''};
  if (origem === 'avulso' && c.comHor && h > Number(m.hours || 0) && typeof aplicarHorimetro === 'function') aplicarHorimetro(m, h, null, 'Checklist da máquina', {id: r.id});
  db[MCP_COL].push(r);
  const res = mcpPedido(r);
  upsert(MCP_COL, r);
  if (typeof fotosAoSalvar === 'function') fotosAoSalvar(MCP_COL, r.id);
  mcpChk = null; mcpUltimo = r.id;
  return res;
}
let mcpUltimo = '';

// ---------- Checklist avulso ----------
function mcpChecklistForm(machineId) {
  const ativas = db.machines.filter(m => !isInactive(m)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  if (!ativas.length) { showToast('Cadastre uma máquina primeiro'); return; }
  const id0 = ativas.some(m => m.id === machineId) ? machineId : ativas[0].id;
  mcpChk = mcpNovoChk(id0, true);
  openForm({title: 'Checklist da máquina', sub: mcpGestor() ? 'Marque cada item. Defeito marcado abre a ordem de manutenção.' : 'Marque cada item. Defeito marcado vira um pedido de manutenção para o supervisor ou o ADM autorizar.', submit: 'Registrar checklist',
    values: {machineId: id0},
    fields: [{k: 'machineId', label: 'Máquina', type: 'select', required: true, full: true, options: () => ativas.map(m => ({value: m.id, label: typeof rotuloMaquina === 'function' ? rotuloMaquina(m) : m.name}))}],
    onSubmit: () => {
      const erro = mcpChkValidar(); if (erro) return erro;
      const m = find('machines', mcpChk.machineId), res = mcpRegistrar('avulso');
      setTimeout(() => showToast(mcpAvisoPedido(res, m)), 50);
      if (res?.mt && res.tipo !== 'ja') setTimeout(() => go('ordem/' + res.mt.id), 0);
    }});
  const form = $('form', dialog); if (!form) return;
  form.querySelector('.form').insertAdjacentHTML('beforeend', mcpChkHtml());
  if (typeof ativarCamposFotos === 'function') ativarCamposFotos(dialog);
  form.elements.machineId.addEventListener('change', e => {
    const fotos = fotosDoForm.get(mcpChk.id) || [];
    mcpChk = mcpNovoChk(e.target.value, true); fotosDoForm.set(mcpChk.id, fotos);
    $('[data-mcp-chk]', dialog).outerHTML = mcpChkHtml();
    if (typeof ativarCamposFotos === 'function') ativarCamposFotos(dialog);
  });
}

// ---------- Ao iniciar uma operação ----------
function mcpAoAbrirInicio(o) {
  mcpChk = null;
  const m = o.machineId ? find('machines', o.machineId) : null;
  // Frequência definida pelo ADM / supervisor: sempre, só quando o checklist da máquina está vencido, ou nunca
  const aj = m ? mcpAjustes() : null;
  if (!m || aj.inicio === 'nunca' || (aj.inicio === 'vencido' && !mcpSituacao(m, 1).venc)) return;
  mcpChk = mcpNovoChk(m.id, false); mcpChk.opId = o.id;
  const form = $('form', dialog); if (!form) return;
  const alvo = form.querySelector('.fotos-campo');
  if (alvo) alvo.insertAdjacentHTML('beforebegin', mcpChkHtml({inicio: true})); else form.querySelector('.form').insertAdjacentHTML('beforeend', mcpChkHtml({inicio: true}));
  if (typeof ativarCamposFotos === 'function') ativarCamposFotos(dialog);
}
const mcpValidarInicio = o => mcpChk && mcpChk.opId === o.id ? mcpChkValidar() : '';
const mcpParadaNoInicio = o => !!(mcpChk && mcpChk.opId === o.id && mcpChk.itens.some(i => i.estado === 'defeito') && mcpChk.pode === 'Não');
function mcpAoIniciar(o, horimetro) {
  if (!mcpChk || mcpChk.opId !== o.id) return null;
  const m = find('machines', o.machineId), res = mcpRegistrar('operacao', o, horimetro);
  o.checklistId = mcpUltimo;
  if (res) setTimeout(() => showToast(mcpAvisoPedido(res, m)), 2900);
  return res;
}

// ---------- Na ordem: pedido, autorização e complementos ----------
function mcpRelato(x) {
  return `<div class="mcp-relato"><span>${esc(x.obs || '—')}</span><small>${esc(x.por || '')} • ${esc(mcDH(x.em))}${x.r.origem === 'operacao' ? ' • ao iniciar a operação' : x.r.origem === 'complemento' ? ' • durante a manutenção' : ''}${x.r.podeTrabalhar === 'Não' ? ' • <b class="txt-red">máquina parada</b>' : ''}</small></div>`;
}
const mcpGaleria = lista => { const g = lista.filter(r => r.fotos?.length).map(r => typeof galeriaFotos === 'function' ? galeriaFotos(MCP_COL, r) : '').join(''); return g ? `<div class="mcp-fotos">${g}</div>` : ''; };
function mcpCartoesOrdem(mt, gestor) {
  const ini = mcpPedidoInicial(mt), comps = mcpComplementos(mt), out = [];
  if (ini.length || mt.status === MCP_AGUARDA || mt.autorizacao) {
    const a = mt.autorizacao, defs = mcpAgrupar(ini);
    const sit = mt.status === MCP_AGUARDA ? `<p class="mcp-aviso">${gestor ? '⏳ Aguardando a sua autorização. Confira os defeitos e as fotos e toque em Autorizar ou Recusar.' : '⏳ Aguardando autorização do supervisor ou do ADM. Você será avisado aqui quando for decidido.'}</p>`
      : a?.decisao === 'recusada' ? `<p class="mcp-aviso recusa">✕ Recusado por ${esc(a.por)} em ${esc(mcDH(a.em))}: ${esc(a.motivo || '')}</p>`
      : a ? `<p class="mcp-ok">✓ ${a.auto ? 'Aberta' : 'Autorizada'} por ${esc(a.por)} em ${esc(mcDH(a.em))}${a.obs ? ` — ${esc(a.obs)}` : ''}</p>` : '';
    out.push(`<section class="card panel mcp-pedido"><div class="section-title" style="margin:0 0 8px"><h3>Pedido de manutenção</h3><small class="nota">${ini.length ? `do checklist • ${ini.length} ${ini.length === 1 ? 'relato' : 'relatos'}` : ''}</small></div>
      ${sit}
      ${defs.length ? defs.map(g => `<div class="mcp-def-item"><strong>⚠ ${esc(g.item)}${g.relatos.length > 1 ? ` <span class="chip orange">${g.relatos.length} relatos</span>` : ''}</strong>${g.relatos.map(mcpRelato).join('')}</div>`).join('') : `<p class="nota" style="margin:0">${esc(mt.sintoma || mt.description || '')}</p>`}
      ${mcpGaleria(ini)}
      ${gestor && mt.status === MCP_AGUARDA && db.maintenances.some(x => x.id !== mt.id && x.machineId === mt.machineId && x.status === MCP_AGUARDA) ? `<p class="nota">Há outro pedido aguardando para esta máquina. ${btn('Juntar os pedidos aqui', 'mcp-juntar', mt.id, 'secondary')}</p>` : ''}</section>`);
  }
  if (comps.length) {
    out.push(`<section class="card panel mcp-comps"><div class="section-title" style="margin:0 0 8px"><h3>Complementos</h3><small class="nota">o que apareceu durante a manutenção</small></div>
      ${comps.map(r => { const d = mt.decisoes?.[r.id], pend = !d && MCP_EM_ANDAMENTO.includes(mt.status);
        return `<div class="mcp-comp ${pend ? 'pend' : d?.decisao || ''}"><div class="mcp-comp-topo"><strong>${mcpItensLevados(r).map(i => esc(i.item)).join(', ')}</strong>${pend ? chip('aguardando autorização', 'red') : d?.decisao === 'recusada' ? chip('recusado', 'gray') : chip(d?.auto ? 'incluído' : 'autorizado', 'green')}</div>
          ${mcpItensLevados(r).map(i => mcpRelato({obs: i.obs, por: r.por, em: r.em, r})).join('')}${mcpGaleria([r])}
          ${d ? `<small class="nota">${d.decisao === 'recusada' ? `Recusado por ${esc(d.por)}: ${esc(d.motivo || '')}` : `${d.auto ? 'Incluído' : 'Autorizado'} por ${esc(d.por)} em ${esc(mcDH(d.em))} — entrou no checklist`}</small>` : ''}
          ${pend && gestor ? `<div class="btn-row">${btn('✓ Autorizar complemento', 'mcp-comp-sim', mt.id + '|' + r.id)}${btn('✕ Recusar', 'mcp-comp-nao', mt.id + '|' + r.id, 'secondary')}</div>` : pend ? '<small class="nota">Aguardando o supervisor ou o ADM.</small>' : ''}</div>`; }).join('')}</section>`);
  }
  const hist = [mt.execucao ? `Enviada para conferência por ${esc(mt.execucao.por)} em ${esc(mcDH(mt.execucao.em))}` : '', ...(mt.devolucoes || []).map(d => `Devolvida por ${esc(d.por)} em ${esc(mcDH(d.em))}: ${esc(d.motivo)}`)].filter(Boolean);
  if (mt.status === MCP_CONFERIR || hist.length) out.push(`<section class="card panel"><h3 style="margin:0 0 6px">Conferência</h3>${mt.status === MCP_CONFERIR ? `<p class="mcp-aviso">${gestor ? 'O serviço foi marcado como terminado. Confira o checklist e as fotos, lance serviços e valores e conclua — ou devolva com o motivo.' : 'Enviada para conferência. O supervisor ou o ADM confere e conclui.'}</p>` : ''}${hist.map(h => `<small class="nota" style="display:block">${h}</small>`).join('')}</section>`);
  return out.join('');
}

// ---------- Ações ----------
const mcpSoGestor = () => { if (mcpGestor()) return true; showToast('Só o supervisor ou o ADM pode fazer isso. Seu nível: Usuário comum.', true); return false; };
function mcpAutorizar(id) {
  const mt = find('maintenances', id); if (!mt || mt.status !== MCP_AGUARDA || !mcpSoGestor()) return;
  const ini = mcpPedidoInicial(mt), parada = ini.filter(r => r.podeTrabalhar === 'Não').map(r => r.em).sort()[0];
  openForm({title: 'Autorizar manutenção', sub: `${machineName(mt.machineId)} • ${mcpAgrupar(ini).map(g => g.item).join(', ') || mt.sintoma || ''}`, submit: 'Autorizar',
    values: {description: mcpAgrupar(ini).length ? ('Conserto: ' + mcpAgrupar(ini).map(g => g.item).join(', ')).slice(0, 160) : mt.description, parada: parada || mt.parada === 'Sim' ? 'Sim' : 'Não'},
    fields: [{k: 'description', label: 'Serviço', required: true, full: true},
      {k: 'parada', label: 'A máquina está parada?', type: 'select', options: ['Não', 'Sim'], required: true, hint: 'Sim: o app conta o tempo parado até concluir.'},
      {k: 'obs', label: 'Orientação para quem vai fazer (opcional)', type: 'textarea', placeholder: 'Ex.: usar a correia do estoque; chamar o mecânico da revenda'}],
    onSubmit: v => {
      Object.assign(mt, {description: v.description, status: 'Aberta', parada: v.parada, autorizacao: {decisao: 'autorizada', por: quemUsa(), em: mcpAgora(), obs: v.obs}});
      if (v.parada === 'Sim') mt.paradaDesde ||= parada || mcpAgora(); else delete mt.paradaDesde;
      mt.checklist = mcpChecklistOrdem(mt);
      upsert('maintenances', mt); showToast('Manutenção autorizada: o checklist do conserto já está na ordem');
    }});
}
function mcpRecusar(id) {
  const mt = find('maintenances', id); if (!mt || mt.status !== MCP_AGUARDA || !mcpSoGestor()) return;
  openForm({title: 'Recusar o pedido', sub: machineName(mt.machineId), submit: 'Recusar pedido', fields: [{k: 'motivo', label: 'Motivo (quem pediu vai ver)', type: 'textarea', required: true, placeholder: 'Ex.: não é defeito, é regulagem; vamos fazer na revisão de 500 h'}],
    onSubmit: v => {
      if (!v.motivo) return 'Escreva o motivo';
      Object.assign(mt, {status: MCP_RECUSADA, autorizacao: {decisao: 'recusada', por: quemUsa(), em: mcpAgora(), motivo: v.motivo}});
      if (mt.paradaDesde && !mt.paradaFim) mt.paradaFim = mcpAgora();
      upsert('maintenances', mt); showToast('Pedido recusado');
    }});
}
function mcpCompDecidir(chave, sim) {
  const [mid, rid] = String(chave).split('|'), mt = find('maintenances', mid), r = find(MCP_COL, rid);
  if (!mt || !r || mt.decisoes?.[rid] || !mcpSoGestor()) return;
  const gravar = d => { mt.decisoes = {...(mt.decisoes || {}), [rid]: {...d, por: quemUsa(), em: mcpAgora()}}; if (d.decisao === 'autorizada') { mcpAddItens(mt, mcpItensLevados(r).map(i => i.item), 'doComplemento'); if (mt.status === MCP_CONFERIR) mt.status = 'Em execução'; } upsert('maintenances', mt); };
  if (sim) { gravar({decisao: 'autorizada'}); showToast('Complemento autorizado: entrou no checklist'); render(); return; }
  openForm({title: 'Recusar complemento', sub: mcpItensLevados(r).map(i => i.item).join(', '), submit: 'Recusar', fields: [{k: 'motivo', label: 'Motivo', type: 'textarea', required: true}],
    onSubmit: v => { if (!v.motivo) return 'Escreva o motivo'; gravar({decisao: 'recusada', motivo: v.motivo}); showToast('Complemento recusado'); }});
}
function mcpPedirComplemento(id) {
  const mt = find('maintenances', id); if (!mt || !['Aberta', 'Em execução'].includes(mt.status)) return;
  if (typeof mcGuardarCampos === 'function') mcGuardarCampos(mt);
  const rid = uid();
  openForm({title: 'Pedir complemento', sub: `${machineName(mt.machineId)} • apareceu mais alguma coisa para trocar ou consertar`, submit: mcpGestor() ? 'Incluir na ordem' : 'Enviar pedido',
    // (“item” não serve de nome de campo: form.elements.item é um método do navegador)
    fields: [{k: 'oque', label: 'O que mais precisa', required: true, full: true, placeholder: 'Ex.: Rolamento do ventilador'},
      {k: 'porque', label: 'O que você viu / por que precisa', type: 'textarea', required: true, placeholder: 'Ex.: com folga e fazendo barulho, vai travar'}],
    onSubmit: f => {
      const v = {item: f.oque, obs: f.porque};
      if (!v.item || !v.obs) return 'Preencha o item e o motivo';
      if (mcpConhecidos(mt).has(mcNorm(v.item))) return `“${v.item}” já está nesta ordem`;
      if (!mcpGestor() && !(fotosDoForm.get(rid)?.length)) return 'Tire uma foto mostrando o problema';
      const r = {id: rid, machineId: mt.machineId, data: today(), hora: nowTime(), em: mcpAgora(), por: quemUsa(), origem: 'complemento', itens: [{item: v.item, estado: 'defeito', obs: v.obs}], podeTrabalhar: '', pedidoId: mt.id, complemento: true};
      upsert(MCP_COL, r);
      if (typeof fotosAoSalvar === 'function') fotosAoSalvar(MCP_COL, rid);
      if (mcpGestor()) { mt.decisoes = {...(mt.decisoes || {}), [rid]: {decisao: 'autorizada', por: quemUsa(), em: mcpAgora(), auto: true}}; mcpAddItens(mt, [v.item], 'doComplemento'); upsert('maintenances', mt); showToast('Incluído no checklist da ordem'); }
      else { upsert('maintenances', mt); showToast('Complemento enviado: aguarda o supervisor ou o ADM autorizar'); }
    }});
  if (typeof anexarCampoFotos === 'function') anexarCampoFotos(MCP_COL, rid, [], {soCamera: true, obrigatoria: !mcpGestor(), rotulo: 'Foto do problema', dica: 'Tire a foto agora, mostrando a peça ou o defeito.'});
}
function mcpEnviarConferencia(id) {
  const mt = find('maintenances', id); if (!mt || mt.status !== 'Em execução') return;
  mcGuardarCampos(mt);
  const erro = mcValidar(mt, true); if (erro) { upsert('maintenances', mt); showToast(erro, true); return; }
  mt.status = MCP_CONFERIR; mt.execucao = {por: quemUsa(), em: mcpAgora()};
  upsert('maintenances', mt); showToast('Enviada para conferência: o supervisor ou o ADM confere e conclui'); render();
}
function mcpDevolver(id) {
  const mt = find('maintenances', id); if (!mt || mt.status !== MCP_CONFERIR || !mcpSoGestor()) return;
  openForm({title: 'Devolver para ajuste', sub: machineName(mt.machineId), submit: 'Devolver', fields: [{k: 'motivo', label: 'O que precisa ajustar', type: 'textarea', required: true}],
    onSubmit: v => { if (!v.motivo) return 'Escreva o que precisa ajustar'; mt.status = 'Em execução'; mt.devolucoes = [...(mt.devolucoes || []), {motivo: v.motivo, por: quemUsa(), em: mcpAgora()}]; upsert('maintenances', mt); showToast('Devolvida: volta para em execução'); }});
}
function mcpJuntar(id) {
  const mt = find('maintenances', id); if (!mt || !mcpSoGestor()) return;
  const outros = db.maintenances.filter(x => x.id !== mt.id && x.machineId === mt.machineId && x.status === MCP_AGUARDA);
  outros.forEach(x => {
    db[MCP_COL].filter(r => r.pedidoId === x.id).forEach(r => { r.pedidoId = mt.id; });
    Object.assign(x, {status: MCP_RECUSADA, autorizacao: {decisao: 'recusada', por: quemUsa(), em: mcpAgora(), motivo: 'Juntado a outro pedido da mesma máquina', juntadoEm: mt.id}});
    if (x.parada === 'Sim' && mt.parada !== 'Sim') { mt.parada = 'Sim'; mt.paradaDesde = x.paradaDesde; }
  });
  save(); showToast(`${outros.length} ${outros.length === 1 ? 'pedido juntado' : 'pedidos juntados'} a este`); render();
}
// Usuário comum: “Abrir manutenção” vira o checklist; a ordem já aberta é acompanhada pela tela da ordem
function mcpSoChecklist(mt = {}) {
  if (mcpGestor()) return false;
  if (mt.id) { showToast('Usuário comum acompanha a manutenção pela ordem. Para informar um problema, faça o checklist da máquina.'); if (find('maintenances', mt.id)) go('ordem/' + mt.id); return true; }
  mcpChecklistForm(mt.machineId);
  return true;
}

// Lançar serviços, valores e itens extras: só quem autoriza
['mc-mo-add', 'mc-mo-del', 'mc-mo-valor', 'mc-servicos', 'mc-add'].forEach(act => { const fn = ACTIONS[act]; if (fn) ACTIONS[act] = id => mcpSoGestor() && fn(id); });

// ---------- Frequência do checklist (definida por ADM / supervisor, vale para a fazenda toda) ----------
// Fica num registro da própria coleção (sincroniza para os aparelhos dos operadores)
const MCP_CFG = 'config-checklist';
const MCP_PRAZOS = [[0, 'Sem prazo'], [1, 'Todo dia'], [2, 'A cada 2 dias'], [3, 'A cada 3 dias'], [7, 'Toda semana'], [15, 'A cada 15 dias'], [30, 'Todo mês']];
const MCP_INICIO = [['sempre', 'Sempre'], ['vencido', 'Só se vencido'], ['nunca', 'Não pedir']];
const mcpTextoPrazo = p => (MCP_PRAZOS.find(([d]) => d === p) || [0, `A cada ${p} dias`])[1];
function mcpAjustes() {
  const c = find(MCP_COL, MCP_CFG) || {};
  return {inicio: MCP_INICIO.some(([k]) => k === c.inicio) ? c.inicio : 'sempre', prazo: Number(c.prazo) || 0, prazos: {...(c.prazos || {})}};
}
function mcpGravarAjustes(a) {
  const atual = find(MCP_COL, MCP_CFG) || {id: MCP_CFG, tipo: 'config'};
  upsert(MCP_COL, {...atual, ...a, tipo: 'config', por: quemUsa(), em: mcpAgora()});
}
const mcpPrazoDe = m => { const a = mcpAjustes(), v = a.prazos[m.id]; return v != null && v !== '' ? Number(v) : a.prazo; };
const mcpUltimoDe = id => (db[MCP_COL] || []).filter(r => r.machineId === id && r.origem !== 'complemento' && r.tipo !== 'config').reduce((u, r) => !u || String(r.em) > String(u.em) ? r : u, null);
const mcpDias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
// Situação de uma máquina: prazo (dias), último checklist e se está vencido. prazoMin: prazo usado quando a máquina não tem prazo
function mcpSituacao(m, prazoMin = 0) {
  const p = mcpPrazoDe(m) || prazoMin, u = mcpUltimoDe(m.id);
  if (!p) return {p, u, venc: false, cor: u ? 'gray' : 'gray', txt: u ? `último ${fmtDate(u.data)}` : 'nenhum ainda'};
  if (!u) return {p, u, venc: true, cor: 'red', txt: 'nunca feito'};
  const d = mcpDias(u.data, today()), falta = p - d;
  return {p, u, venc: falta <= 0, cor: falta <= 0 ? 'red' : falta === 1 && p > 1 ? 'orange' : 'green',
    txt: falta <= 0 ? (p === 1 ? 'não feito hoje' : `vencido há ${-falta + 1} ${-falta + 1 === 1 ? 'dia' : 'dias'}`) : p === 1 ? 'feito hoje' : falta === 1 ? 'vence amanhã' : `em dia (vence em ${falta} dias)`};
}
const mcpMaquinasAtivas = () => db.machines.filter(m => !isInactive(m)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
const mcpVencidas = () => mcpMaquinasAtivas().filter(m => machineStatus(m) !== 'Em manutenção' && mcpSituacao(m).venc);

// ---------- PDF ----------
// Foto do registro → JPEG para o PDF (o PDF não aceita WebP); null se a foto não está neste aparelho
async function mcpFotoJpeg(colecao, recordId, fotoId) {
  try {
    const u = typeof urlDaFoto === 'function' ? await urlDaFoto(colecao, recordId, fotoId, true) : null; if (!u) return null;
    const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = u; });
    const lado = 900, k = Math.min(1, lado / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return {src: c.toDataURL('image/jpeg', .82), w: c.width, h: c.height};
  } catch { return null; }
}
const mcpOrigem = r => r.origem === 'operacao' ? 'Ao iniciar a operação' : r.origem === 'complemento' ? 'Durante a manutenção (complemento)' : 'Avulso';
const mcpSlug = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
async function mcpPdfChecklist(id, enviar) {
  const r = find(MCP_COL, id); if (!r) return;
  if (typeof window.pdfMercaPlant !== 'function') { showToast('Gerador de PDF indisponível', true); return; }
  showToast('Gerando o PDF…');
  const m = find('machines', r.machineId), nomeM = m?.name || 'Máquina removida', defs = mcpDefeitos(r), mt = r.pedidoId ? find('maintenances', r.pedidoId) : null, o = r.opId ? find('operations', r.opId) : null;
  const fotos = []; for (const f of r.fotos || []) { const j = await mcpFotoJpeg(MCP_COL, r.id, f.id); if (j) fotos.push({...j, legenda: mcDH(f.em)}); }
  const P = window.pdfMercaPlant({titulo: 'Checklist da máquina', linha2: `${nomeM} - ${fmtDate(r.data)} ${r.hora || ''}`.trim(), continuacao: `Checklist · ${nomeM}`});
  const C = P.COR;
  P.secao(nomeM, [m?.type, m?.model].filter(Boolean).join(' - '));
  P.cartoes([['Resultado', defs.length ? `${defs.length} ${defs.length === 1 ? 'defeito' : 'defeitos'}` : 'Tudo OK', defs.length ? (r.podeTrabalhar === 'Não' ? 'máquina parada' : 'pode trabalhar') : 'nenhum defeito', defs.length ? C.laranja : C.verde],
    ['Itens conferidos', String((r.itens || []).length), `${(r.itens || []).filter(i => i.estado === 'ok').length} OK`, C.azul],
    [m && porKm(m) ? 'Odômetro' : 'Horímetro', r.horimetro !== '' && r.horimetro != null ? `${num(r.horimetro)} ${unidMed(m)}` : '-', 'na hora do checklist', C.verde]]);
  P.ficha([['Máquina', [nomeM, m?.type, m?.model].filter(Boolean).join(' - ')], ['Data e hora', `${fmtDate(r.data)} ${r.hora || ''}`], ['Feito por', r.por || ''], ['Quando', mcpOrigem(r)],
    ['Operação', o ? [o.type, typeof opPlace === 'function' ? opPlace(o) : ''].filter(Boolean).join(' - ') : ''], ['A máquina pode trabalhar?', r.podeTrabalhar || ''],
    ['Pedido de manutenção', mt ? `${mt.description || 'Ordem de manutenção'} - ${mt.status}` : defs.length ? '' : 'não foi necessário']]);
  P.secao('Itens', `${(r.itens || []).length} itens`);
  P.tabela([{t: 'Item', w: 2.6}, {t: 'Situação', w: 1}, {t: 'Observação', w: 2.6}], (r.itens || []).map(i => [i.item, i.estado === 'ok' ? 'OK' : i.estado === 'defeito' ? 'Defeito' : 'N/A', i.obs || '']));
  if (fotos.length) { P.secao('Fotos', 'tiradas pela câmera na hora, com data e local', 50); P.fotos(fotos); }
  else if (r.fotos?.length) P.nota(`${r.fotos.length} ${r.fotos.length === 1 ? 'foto guardada' : 'fotos guardadas'} no MercaPlant (ainda não disponível neste aparelho).`);
  P.assinaturas([[r.por || 'Operador', 'Feito por'], [db.settings.owner || 'Responsável pela propriedade', 'Conferido por']]);
  window.entregarPdf(P.finalizar(), `mercaplant-checklist-${mcpSlug(nomeM)}-${r.data}.pdf`, enviar === true, `Checklist da máquina - ${nomeM} - ${fmtDate(r.data)}`);
}
function mcpRelatorioForm() {
  const ms = mcpMaquinasAtivas();
  openForm({title: 'Relatório de checklists (PDF)', sub: 'Resumo por máquina, defeitos encontrados e todos os checklists do período.', submit: 'Gerar PDF',
    values: {maq: '', de: typeof daysAgo === 'function' ? daysAgo(30) : today(), ate: today(), entregar: 'Baixar'},
    fields: [{k: 'maq', label: 'Máquina', type: 'select', options: [{value: '*', label: 'Todas as máquinas'}, ...ms.map(m => ({value: m.id, label: m.name}))], required: true, full: true},
      {k: 'de', label: 'De', type: 'date', required: true}, {k: 'ate', label: 'Até', type: 'date', required: true},
      {k: 'entregar', label: 'Depois de gerar', type: 'select', options: ['Baixar', 'Enviar (WhatsApp, e-mail…)'], required: true, full: true}],
    onSubmit: v => { if (v.de > v.ate) return 'A data inicial é depois da final'; setTimeout(() => mcpPdfPeriodo(v.maq === '*' ? '' : v.maq, v.de, v.ate, v.entregar !== 'Baixar'), 0); }});
}
function mcpPdfPeriodo(maq, de, ate, enviar) {
  if (typeof window.pdfMercaPlant !== 'function') { showToast('Gerador de PDF indisponível', true); return; }
  const lista = (db[MCP_COL] || []).filter(r => r.tipo !== 'config' && r.machineId && (!maq || r.machineId === maq) && r.data >= de && r.data <= ate).sort((a, b) => String(a.em).localeCompare(String(b.em)));
  const nomeM = maq ? machineName(maq) || 'Máquina removida' : 'Todas as máquinas', periodo = `${fmtDate(de)} a ${fmtDate(ate)}`;
  const comDef = lista.filter(r => mcpDefeitos(r).length), pedidos = new Set(comDef.map(r => r.pedidoId).filter(Boolean));
  const P = window.pdfMercaPlant({titulo: 'Relatório de checklists das máquinas', linha2: `${nomeM} - ${periodo}`, continuacao: `Checklists · ${periodo}`});
  const C = P.COR;
  P.secao('Resumo', periodo);
  P.cartoes([['Checklists feitos', String(lista.length), `${new Set(lista.map(r => r.machineId)).size} máquinas`, C.azul], ['Com defeito', String(comDef.length), `${lista.length ? Math.round(comDef.length / lista.length * 100) : 0}% dos checklists`, comDef.length ? C.laranja : C.verde],
    ['Pedidos de manutenção', String(pedidos.size), 'gerados ou juntados', C.laranja]]);
  const ms = maq ? [find('machines', maq)].filter(Boolean) : mcpMaquinasAtivas();
  P.secao('Por máquina', 'prazo definido para o checklist e situação hoje');
  P.tabela([{t: 'Máquina', w: 2.2}, {t: 'Prazo', w: 1.3}, {t: 'No período', w: 1, dir: true}, {t: 'Com defeito', w: 1, dir: true}, {t: 'Situação hoje', w: 1.8}],
    ms.map(m => { const s = mcpSituacao(m), d = lista.filter(r => r.machineId === m.id); return [m.name, mcpTextoPrazo(s.p), String(d.length), String(d.filter(r => mcpDefeitos(r).length).length), s.txt]; }));
  if (comDef.length) {
    P.secao('Defeitos encontrados', `${comDef.reduce((t, r) => t + mcpDefeitos(r).length, 0)} itens`);
    P.tabela([{t: 'Data', w: 1}, {t: 'Máquina', w: 1.6}, {t: 'Item', w: 2}, {t: 'Observação', w: 2.4}, {t: 'Por', w: 1.3}],
      comDef.flatMap(r => mcpDefeitos(r).map(i => [`${fmtDate(r.data)} ${r.hora || ''}`, machineName(r.machineId), i.item, i.obs || '', r.por || ''])));
  }
  P.secao('Todos os checklists', `${lista.length} no período`);
  if (lista.length) P.tabela([{t: 'Data', w: 1.1}, {t: 'Máquina', w: 1.7}, {t: 'Quando', w: 1.5}, {t: 'Horas / km', w: .9, dir: true}, {t: 'Resultado', w: 1.1}, {t: 'Por', w: 1.4}],
    lista.map(r => [`${fmtDate(r.data)} ${r.hora || ''}`, machineName(r.machineId), mcpOrigem(r), r.horimetro !== '' && r.horimetro != null ? `${num(r.horimetro)} ${unidMed(find('machines', r.machineId))}` : '-', mcpDefeitos(r).length ? `${mcpDefeitos(r).length} defeito(s)` : 'Tudo OK', r.por || '']));
  else P.nada('Nenhum checklist neste período.');
  P.nota('Cada checklist tem as fotos e os detalhes no MercaPlant (Máquinas → Checklists). Para o PDF de um checklist com as fotos, abra o checklist e toque em PDF.');
  P.assinaturas([[db.settings.owner || 'Responsável pela propriedade', 'Responsável']]);
  window.entregarPdf(P.finalizar(), `mercaplant-checklists-${mcpSlug(nomeM)}-${de}-a-${ate}.pdf`, enviar, `Checklists das máquinas - ${nomeM} - ${periodo}`);
}

Object.assign(ACTIONS, {
  'mcp-novo': id => mcpChecklistForm(id), 'mcp-autorizar': mcpAutorizar, 'mcp-recusar': mcpRecusar,
  'mcp-comp-sim': k => mcpCompDecidir(k, true), 'mcp-comp-nao': k => mcpCompDecidir(k, false), 'mcp-comp-pedir': mcpPedirComplemento,
  'mcp-conferir': mcpEnviarConferencia, 'mcp-devolver': mcpDevolver, 'mcp-juntar': mcpJuntar,
  'mcp-inicio': k => { if (!mcpSoGestor()) return; mcpGravarAjustes({inicio: k}); showToast('Ajuste salvo para a fazenda toda'); render(); },
  'mcp-pdf': id => mcpPdfChecklist(id, false), 'mcp-enviar': id => mcpPdfChecklist(id, true), 'mcp-relatorio': mcpRelatorioForm
});

// ---------- Tela: checklists das máquinas ----------
const mcpOpcoesPrazo = (atual, padrao) => `${padrao != null ? `<option value="" ${atual === '' ? 'selected' : ''}>Padrão da fazenda (${esc(mcpTextoPrazo(padrao))})</option>` : ''}${MCP_PRAZOS.map(([d, t]) => `<option value="${d}" ${String(atual) === String(d) ? 'selected' : ''}>${esc(t)}</option>`).join('')}`;
VIEWS.checklists = () => {
  const gestor = mcpGestor(), aj = mcpAjustes();
  const lista = (db[MCP_COL] || []).filter(r => r.tipo !== 'config' && r.machineId).sort((a, b) => String(b.em).localeCompare(String(a.em)));
  const aguardando = db.maintenances.filter(x => x.status === MCP_AGUARDA), comp = db.maintenances.filter(x => mcpCompPendentes(x).length), conf = db.maintenances.filter(x => x.status === MCP_CONFERIR);
  const fila = [...aguardando.map(x => [x, 'red', 'Aguardando autorização']), ...comp.map(x => [x, 'red', 'Complemento aguardando']), ...conf.map(x => [x, 'purple', 'A conferir'])];
  const linha = r => { const m = find('machines', r.machineId), defs = mcpDefeitos(r), mt = r.pedidoId ? find('maintenances', r.pedidoId) : null;
    return `<details class="mcp-linha"><summary><span class="status ${defs.length ? 'red' : 'green'}"></span><div><strong>${esc(m?.name || 'Máquina removida')}</strong><small>${esc(fmtDate(r.data))} ${esc(r.hora || '')} • ${esc(r.por || '')} • ${r.origem === 'operacao' ? 'ao iniciar operação' : r.origem === 'complemento' ? 'complemento' : 'avulso'}${r.horimetro !== '' && r.horimetro != null ? ` • ${num(r.horimetro)} ${unidMed(m)}` : ''}${r.fotos?.length ? ` • 📷 ${r.fotos.length}` : ''}</small></div>${defs.length ? chip(defs.length === 1 ? '1 defeito' : defs.length + ' defeitos', 'red') : chip('Tudo OK', 'green')}</summary>
      <div class="mcp-linha-corpo">${(r.itens || []).map(i => `<div class="mcp-li ${i.estado}"><span>${i.estado === 'ok' ? '✓' : i.estado === 'defeito' ? '⚠' : '—'} ${esc(i.item)}</span>${i.obs ? `<small>${esc(i.obs)}</small>` : ''}</div>`).join('')}
        ${r.podeTrabalhar ? `<p class="nota">Pode trabalhar: ${esc(r.podeTrabalhar)}</p>` : ''}${typeof galeriaFotos === 'function' ? galeriaFotos(MCP_COL, r) : ''}
        <div class="row-actions" style="justify-content:flex-start">${mini('PDF', 'mcp-pdf', r.id)}${mini('Enviar', 'mcp-enviar', r.id)}${mt ? mini(`Ver ordem (${mt.status})`, 'nav', 'ordem/' + mt.id) : ''}</div></div></details>`; };
  const maqs = mcpMaquinasAtivas();
  const linhaMaq = m => { const s = mcpSituacao(m), emManut = machineStatus(m) === 'Em manutenção', v = aj.prazos[m.id];
    return `<div class="row mcp-maq"><span class="status ${emManut ? 'orange' : s.cor}"></span><div><strong>${esc(m.name)}</strong><small>${esc([m.type, s.p ? mcpTextoPrazo(s.p).toLowerCase() : 'sem prazo', s.u ? `último ${fmtDate(s.u.data)} por ${s.u.por || '—'}` : ''].filter(Boolean).join(' • '))}</small></div>
      <div class="row-actions">${gestor ? `<select class="mcp-prazo-sel" data-mcp-prazo="${esc(m.id)}" aria-label="Prazo do checklist de ${esc(m.name)}">${mcpOpcoesPrazo(v == null ? '' : v, aj.prazo)}</select>` : ''}${emManut ? chip('em manutenção', 'orange') : s.p ? chip(s.txt, s.cor) : ''}${mini('☑ Fazer', 'mcp-novo', m.id, s.venc && !emManut ? 'ok' : '')}</div></div>`; };
  const venc = mcpVencidas().length;
  return head('Checklists das máquinas', 'Inspeção antes de trabalhar. Defeito marcado vira pedido de manutenção, sem duplicar.', btn('← Máquinas', 'nav', 'maquinas', 'secondary') + (gestor ? btn('Editar itens', 'nav', 'modeloschk', 'secondary') : '') + btn('PDF do período', 'mcp-relatorio', '', 'secondary') + btn('☑ Fazer checklist', 'mcp-novo')) +
    (gestor && fila.length ? `<div class="section-title"><h3>Para você decidir</h3></div><section class="card list">${fila.map(([x, cor, t]) => `<div class="row"><span class="status ${cor}"></span><div><strong>${esc(machineName(x.machineId) || 'Máquina removida')}</strong><small>${esc([x.description, x.parada === 'Sim' ? 'máquina parada' : ''].filter(Boolean).join(' • '))}</small></div><div class="row-actions">${chip(t, cor)}${mini('Abrir', 'nav', 'ordem/' + x.id, 'ok')}</div></div>`).join('')}</section>` : '') +
    (gestor ? `<section class="card panel mcp-ajustes"><h3 style="margin:0 0 4px">Quando o checklist deve ser feito</h3><p class="nota" style="margin:0 0 6px">Vale para a fazenda toda e chega aos aparelhos de todos. Só o ADM e o supervisor mudam.</p>
      <div class="mcp-aj"><div><b>Prazo padrão</b><small>De quanto em quanto tempo cada máquina precisa de um checklist. Vencido: aparece o aviso para todos.</small></div><select class="mcp-prazo-sel" data-mcp-prazo="*" aria-label="Prazo padrão">${mcpOpcoesPrazo(aj.prazo, null)}</select></div>
      <div class="mcp-aj"><div><b>Ao iniciar uma operação</b><small>${aj.inicio === 'vencido' ? `Pede o checklist só quando o da máquina está vencido${aj.prazo ? '' : ' (máquina sem prazo: uma vez por dia)'}.` : aj.inicio === 'nunca' ? 'Não pede o checklist ao iniciar (continua o prazo e o aviso).' : 'Pede o checklist em toda operação, antes de começar.'}</small></div><div class="mcp-seg" role="group" aria-label="Checklist ao iniciar uma operação">${MCP_INICIO.map(([k, t]) => btn(t, 'mcp-inicio', k, aj.inicio === k ? 'primary' : 'secondary')).join('')}</div></div>
      <p class="nota" style="margin:8px 0 0">Prazo diferente para uma máquina (ex.: secador todo dia, implemento toda semana): escolha na lista abaixo.</p></section>` : '') +
    `<div class="section-title"><h3>Máquinas</h3><small class="nota">${venc ? `${venc} com checklist vencido` : 'checklists em dia'}</small></div><section class="card list">${maqs.length ? maqs.map(linhaMaq).join('') : empty('Nenhuma máquina ativa', '')}</section>` +
    `<div class="section-title"><h3>Últimos checklists</h3><small class="nota">${lista.length}</small></div>` +
    (lista.length ? `<section class="card list mcp-lista">${lista.slice(0, 80).map(linha).join('')}</section>` : `<section class="card">${empty('Nenhum checklist ainda', 'Faça o checklist da máquina antes de trabalhar. Também aparece ao iniciar uma operação.', {act: 'mcp-novo', label: '☑ Fazer checklist'})}</section>`);
};
VIEWS.checklists.after = () => {
  $$('[data-mcp-prazo]').forEach(sel => sel.addEventListener('change', () => {
    if (!mcpSoGestor()) return;
    const a = mcpAjustes(), k = sel.dataset.mcpPrazo;
    if (k === '*') a.prazo = Number(sel.value) || 0; else if (sel.value === '') delete a.prazos[k]; else a.prazos[k] = Number(sel.value);
    mcpGravarAjustes(a); showToast('Prazo salvo para a fazenda toda'); render();
  }));
};
TITLES.checklists = 'Checklists das máquinas';
if (typeof GRUPO_DA_ROTA === 'object') GRUPO_DA_ROTA.checklists = 'maquinas';

// ---------- Avisos ----------
const alertasSemPedido = alerts;
alerts = function () {
  const l = alertasSemPedido();
  if (mcpGestor()) {
    db.maintenances.filter(x => x.status === MCP_AGUARDA).forEach(x => l.unshift({color: x.parada === 'Sim' ? 'red' : 'orange', icon: '⚙', title: `Manutenção aguardando autorização: ${machineName(x.machineId) || 'máquina'}`, text: `${mcpAgrupar(mcpPedidoInicial(x)).map(g => g.item).join(', ') || x.description || ''}${x.parada === 'Sim' ? ' — máquina parada' : ''}.`, route: 'ordem/' + x.id}));
    db.maintenances.filter(x => mcpCompPendentes(x).length).forEach(x => l.unshift({color: 'orange', icon: '⚙', title: `Complemento aguardando autorização: ${machineName(x.machineId) || 'máquina'}`, text: mcpCompPendentes(x).flatMap(r => mcpItensLevados(r).map(i => i.item)).join(', ') + '.', route: 'ordem/' + x.id}));
    db.maintenances.filter(x => x.status === MCP_CONFERIR).forEach(x => l.push({color: 'purple', icon: '⚙', title: `Manutenção para conferir: ${machineName(x.machineId) || 'máquina'}`, text: `${x.description || ''} — terminada por ${x.execucao?.por || 'operador'}.`, route: 'ordem/' + x.id}));
  }
  // Checklist vencido (pelo prazo definido): aviso para todos — o operador vê e faz
  const venc = mcpVencidas();
  if (venc.length) l.push({color: 'orange', icon: '☑', title: `Checklist vencido: ${venc.length === 1 ? venc[0].name : venc.length + ' máquinas'}`, text: `${venc.slice(0, 5).map(m => `${m.name} (${mcpSituacao(m).txt})`).join(', ')}${venc.length > 5 ? '…' : ''}.`, route: 'checklists', acao: venc.length === 1 ? {act: 'mcp-novo', id: venc[0].id, label: 'Fazer checklist'} : null});
  return l;
};
