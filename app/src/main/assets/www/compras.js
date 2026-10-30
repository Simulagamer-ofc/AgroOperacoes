'use strict';
/* MercaPlant — Setor de Compras.
   Tudo que a fazenda precisa comprar vira um pedido de compra, guardado na nuvem da fazenda (coleção “pedidosCompra”).
   O pedido nasce na peça, no catálogo do fabricante, na ordem de manutenção, no estoque abaixo do mínimo ou avulso.
   Etapas: Aguardando aprovação → A comprar → Em cotação → Pedido ao fornecedor (previsão de entrega) → Recebido.
   Cancelar e recusar pedem o motivo e ficam no histórico (quem e quando). Outras opções: editar, urgente, adiar, dividir,
   juntar pedidos iguais, trocar o fornecedor, reabrir, repetir e recebimento parcial (com entrada no estoque).
   Sem preço: cotação é disponibilidade e prazo. O valor da nota só aparece no recebimento, opcional, para quem vê o financeiro.
   Quem decide (aprova, cota, compra, cancela qualquer pedido): ADM, supervisor ou quem tem a tela Compras liberada.
   O usuário comum faz o pedido e acompanha os seus; o pedido dele espera aprovação, e ele pode cancelar enquanto espera. */

const CPR_COL = 'pedidosCompra';
const CPR_ST = {
  solicitado: ['Aguardando aprovação', 'orange'], aprovado: ['A comprar', 'purple'], cotando: ['Em cotação', 'purple'],
  pedido: ['Pedido ao fornecedor', 'blue'], recebido: ['Recebido', 'green'], cancelado: ['Cancelado', 'gray'], recusado: ['Recusado', 'gray']};
const CPR_ABERTOS = ['solicitado', 'aprovado', 'cotando', 'pedido'];
const CPR_URG = {normal: 'Normal', urgente: 'Urgente', parada: 'Máquina parada'};
const CPR_PESO_URG = {parada: 0, urgente: 1, normal: 2};
// Filtros da tela (também usados nos avisos: compras/aprovar, compras/pedido…)
const CPR_FILTROS = [['abertos', 'Abertos'], ['aprovar', 'A aprovar'], ['comprar', 'A comprar'], ['cotando', 'Em cotação'], ['pedido', 'Pedidos'], ['recebidos', 'Recebidos'], ['cancelados', 'Cancelados'], ['todos', 'Todos']];

const cprAgora = () => new Date().toISOString();
const cprDia = iso => iso ? isoDate(new Date(iso)) : ''; // dia local (o ISO é UTC: à noite já seria o dia seguinte)
const cprEuId = () => (typeof nv !== 'undefined' && nv?.sessao?.usuario) || '';
const cprEu = () => typeof quemUsa === 'function' ? quemUsa() : (db.settings.owner || 'Usuário do aparelho');
// Quem decide: ADM e supervisor (ou o app sem nuvem), e o usuário comum com a tela Compras liberada (comprador)
const cprDecide = () => !(typeof nvComum === 'function' && nvComum()) || (typeof nv !== 'undefined' && Array.isArray(nv.modulos) && nv.modulos.includes('compras'));
const cprMeu = c => !c.porId || !cprEuId() || c.porId === cprEuId();
const cprNum = c => '#' + String(c.id).slice(-4).toUpperCase();
const cprPeca = c => c?.pecaId ? find('pecas', c.pecaId) : null;
const cprItemEst = c => c?.itemId ? find('stock', c.itemId) : (cprPeca(c)?.itemId ? find('stock', cprPeca(c).itemId) : null);
const cprDesc = c => c.descricao || cprPeca(c)?.nome || cprItemEst(c)?.name || 'Item';
const cprCod = c => c.codigo || cprPeca(c)?.codigo || cprItemEst(c)?.codigo || '';
const cprUnid = c => c.unid || cprItemEst(c)?.unit || 'un';
const cprRecebido = c => (c.recebidos || []).reduce((t, r) => t + (Number(r.qtd) || 0), 0);
const cprFalta = c => Math.max(0, (Number(c.qtd) || 0) - cprRecebido(c));
const cprAdiado = c => !!c.adiadoAte && c.adiadoAte > today();
const cprAtrasado = c => c.status === 'pedido' && !!c.previsao && c.previsao < today();
const cprForn = id => id ? find('fornecedores', id) : null;
const cprMaqNome = c => c.maquinaId ? (find('machines', c.maquinaId)?.name || 'máquina removida') : '';
// Mesmo item: a mesma peça, o mesmo item do estoque, ou mesmo código/descrição no avulso
const cprChave = c => c.pecaId ? 'p:' + c.pecaId : c.itemId ? 's:' + c.itemId : 'd:' + (typeof pcNorm === 'function' ? pcNorm(cprCod(c) + ' ' + cprDesc(c)) : cprDesc(c));
const cprAtivos = () => db[CPR_COL].filter(c => CPR_ABERTOS.includes(c.status));
const cprAtivoDaPeca = pid => cprAtivos().filter(c => c.pecaId === pid).sort((a, b) => String(b.criadoEm).localeCompare(a.criadoEm))[0] || null;
function cprHist(c, txt) { c.historico = [...(c.historico || []), {em: cprAgora(), por: cprEu(), txt}]; }
function cprGravar(c, txt) { if (txt) cprHist(c, txt); upsert(CPR_COL, c); }
const cprSoDecide = () => { if (cprDecide()) return true; showToast('Só o ADM, o supervisor ou o comprador pode fazer isso.', true); return false; };

// ---------------- Novo pedido ----------------
// o: {origem, pecaId, itemId, maquinaId, ordemId, qtd, descricao, codigo}
function cprNovo(o = {}) {
  const p = o.pecaId ? find('pecas', o.pecaId) : null, s = o.itemId ? find('stock', o.itemId) : null, avulso = !p && !s;
  const id = uid(), decide = cprDecide();
  const maqs = db.machines.filter(m => !isInactive(m) || m.id === o.maquinaId).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', {numeric: true}))
    .map(m => ({value: m.id, label: m.name + (m.model ? ` — ${m.model}` : ''), grupo: m.type === 'Implemento' ? 'Implementos' : 'Máquinas'}));
  const ja = cprAtivos().filter(c => (p && c.pecaId === p.id) || (s && c.itemId === s.id));
  const titulo = p ? `${p.codigo ? p.codigo + ' — ' : ''}${p.nome}` : s ? s.name : '';
  openForm({
    title: avulso ? 'Novo pedido de compra' : `Pedir compra — ${titulo}`,
    sub: (decide ? 'Vai direto para “A comprar”.' : 'O pedido vai para aprovação do ADM, do supervisor ou do comprador. Você acompanha em Compras.') + (ja.length ? ` Atenção: já há ${ja.length === 1 ? 'um pedido aberto' : ja.length + ' pedidos abertos'} deste item (${ja.map(c => `${cprNum(c)} ${CPR_ST[c.status][0].toLowerCase()}`).join(', ')}).` : ''),
    submit: decide ? 'Salvar pedido' : 'Enviar pedido',
    values: {descricao: o.descricao || '', codigo: o.codigo || '', qtd: o.qtd || (p && Number(p.qtd) > 0 ? Number(p.qtd) : 1), unid: s?.unit || 'un', maquinaId: o.maquinaId || '', urgencia: o.urgencia || 'normal'},
    fields: [
      ...(avulso ? [{k: 'descricao', label: 'O que comprar', required: true, full: true, placeholder: 'Ex.: Óleo 15W40 balde 20 L, luva nitrílica, bico leque 110-02'}, {k: 'codigo', label: 'Código (se souber)'},
        {k: 'itemId', label: 'Item do estoque', type: 'select', options: () => db.stock.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR')).map(x => ({value: x.id, label: x.name + (x.category ? ' — ' + x.category : '')})), hint: 'Opcional: ao receber, dá entrada neste item.'}] : []),
      {k: 'qtd', label: 'Quantidade', type: 'number', min: 0, required: true},
      ...(avulso ? [{k: 'unid', label: 'Unidade', placeholder: 'un, L, kg, cx…'}] : []),
      {k: 'maquinaId', label: 'Para qual máquina', type: 'select', options: maqs},
      {k: 'urgencia', label: 'Urgência', type: 'select', required: true, options: Object.entries(CPR_URG).map(([value, label]) => ({value, label}))},
      {k: 'obs', label: 'Observação', type: 'textarea', placeholder: 'Ex.: quebrou no talhão 5; trazer junto o kit de vedação'}],
    onSubmit: v => {
      if (!(v.qtd > 0)) return 'Informe a quantidade';
      if (avulso && !v.descricao) return 'Diga o que comprar';
      const it = avulso && v.itemId ? find('stock', v.itemId) : s;
      const c = {id, criadoEm: cprAgora(), por: cprEu(), porId: cprEuId(), origem: o.origem || (avulso ? 'avulso' : p ? 'peca' : 'estoque'),
        pecaId: p?.id || '', itemId: it?.id || '', descricao: avulso ? v.descricao : '', codigo: avulso ? (v.codigo || '').toUpperCase() : '', unid: avulso ? (v.unid || it?.unit || 'un') : '',
        qtd: v.qtd, maquinaId: v.maquinaId || '', ordemId: o.ordemId || '', urgencia: v.urgencia || 'normal', obs: v.obs || '',
        status: decide ? 'aprovado' : 'solicitado', historico: []};
      if (decide) c.aprovacao = {por: cprEu(), em: c.criadoEm, auto: true};
      cprHist(c, decide ? 'Pedido feito (já aprovado)' : 'Pedido feito — aguardando aprovação');
      upsert(CPR_COL, c);
      if (typeof fotosAoSalvar === 'function') fotosAoSalvar(CPR_COL, id);
      showToast(decide ? `Pedido ${cprNum(c)} em Compras — a comprar` : `Pedido ${cprNum(c)} enviado para aprovação`);
    }
  });
  if (typeof anexarCampoFotos === 'function') anexarCampoFotos(CPR_COL, id, [], {rotulo: 'Foto da peça ou do defeito'});
}

// ---------------- Mensagem para o fornecedor (cotação ou pedido) ----------------
function cprLinhaMsg(c, fid) {
  const p = cprPeca(c), fo = (p?.fornecedores || []).find(x => x.fornecedorId === fid);
  const eq = (p?.equivalentes || []).slice(0, 2).map(e => [e.marca, e.codigo].filter(Boolean).join(' ')).join(', ');
  const mq = c.maquinaId ? find('machines', c.maquinaId) : null;
  // Para o fornecedor vale o modelo; o nome da máquina é da fazenda
  const maq = (mq ? (mq.model ? `${mq.model} (${mq.name})` : mq.name) : '') || (p && typeof pcAplicaTexto === 'function' ? pcAplicaTexto(p, true).slice(0, 2).join(', ') : '') || p?.origem?.titulo || '';
  const cod = cprCod(c);
  return `• ${num(cprFalta(c) || c.qtd)} ${cprUnid(c)} — ${cod || 's/ código'}${fo?.codigo && fo.codigo !== cod ? ` (seu código ${fo.codigo})` : ''} — ${cprDesc(c)}${p?.marca ? ' ' + p.marca : ''}${maq ? ` — para ${maq}` : ''}${p?.origem?.grupo ? ` (${p.origem.grupo}${p.origem.rep ? `, nº ${p.origem.rep}` : ''})` : ''}${eq ? ` [equivalente: ${eq}]` : ''}${p?.codigoRepetido ? ' [confirmar: código igual a outra peça]' : ''}`;
}
function cprMensagem(tipo, forn, lista, previsao) {
  const faz = db.settings.farm || 'nossa fazenda', quem = db.settings.owner || '';
  const ola = `Olá${forn ? ', ' + forn.nome : ''}!`;
  const corpo = lista.map(c => cprLinhaMsg(c, forn?.id)).join('\n');
  return tipo === 'pedido'
    ? `${ola} Confirmo o pedido destas peças para a ${faz}:\n${corpo}\n\n${previsao ? `Previsão de entrega combinada: ${fmtDate(previsao)}. ` : ''}Por favor, confirme o recebimento do pedido.${quem ? `\nObrigado, ${quem}.` : ' Obrigado.'}`
    : `${ola} Preciso destas peças para a ${faz}:\n${corpo}\n\nPor favor, confirme se tem e o prazo de entrega.${quem ? `\nObrigado, ${quem}.` : ' Obrigado.'}`;
}
const cprFone = s => typeof pcFone === 'function' ? pcFone(s) : String(s || '').replace(/\D/g, '');
let cprMsgs = [];
// Janela com a mensagem pronta para cada fornecedor (WhatsApp, e-mail ou copiar)
function cprMostrarMensagens(titulo, sub, envios) {
  cprMsgs = envios.map(e => e.msg);
  dialog.innerHTML = `<h3>${esc(titulo)}</h3><p class="sub">${esc(sub)}</p><div class="cpr-envios">${envios.map((e, i) => { const fone = cprFone(e.forn?.whatsapp);
    return `<section class="cpr-envio"><strong>${esc(e.forn?.nome || 'Sem fornecedor')}</strong><small>${esc([e.forn?.whatsapp, e.forn?.email].filter(Boolean).join(' • ') || 'Copie e mande por onde preferir')}</small>
      <details><summary>Ver a mensagem</summary><pre>${esc(e.msg)}</pre></details>
      <div class="btn-row">${fone ? `<a class="btn primary" href="https://wa.me/${fone}?text=${encodeURIComponent(e.msg)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${e.forn?.email ? `<a class="btn secondary" href="mailto:${esc(e.forn.email)}?subject=${encodeURIComponent('Peças — ' + (db.settings.farm || 'fazenda'))}&body=${encodeURIComponent(e.msg)}">E-mail</a>` : ''}<button type="button" class="secondary" data-act="cpr-copiar-msg" data-id="${i}">Copiar</button></div></section>`; }).join('')}</div>
    <div class="actions"><button type="button" class="primary" data-close>Pronto</button></div>`;
  $('[data-close]', dialog).onclick = closeModal;
  modal.classList.add('open');
}

// ---------------- Lista ----------------
let cprSel = new Set(), cprBusca = '';
function cprFiltrar(l, f) {
  const t = today();
  switch (f) {
    case 'aprovar': return l.filter(c => c.status === 'solicitado');
    case 'comprar': return l.filter(c => c.status === 'aprovado');
    case 'cotando': return l.filter(c => c.status === 'cotando');
    case 'pedido': return l.filter(c => c.status === 'pedido');
    case 'recebidos': return l.filter(c => c.status === 'recebido');
    case 'cancelados': return l.filter(c => ['cancelado', 'recusado'].includes(c.status));
    case 'paradas': return l.filter(c => CPR_ABERTOS.includes(c.status) && c.urgencia === 'parada');
    case 'todos': return l;
    default: return l.filter(c => CPR_ABERTOS.includes(c.status));
  }
}
const cprOrdem = (a, b) => (cprAdiado(a) - cprAdiado(b)) || ((CPR_PESO_URG[a.urgencia] ?? 2) - (CPR_PESO_URG[b.urgencia] ?? 2)) || (cprAtrasado(b) - cprAtrasado(a)) ||
  (CPR_ABERTOS.includes(a.status) ? String(a.criadoEm).localeCompare(b.criadoEm) : String(b.fechadoEm || b.criadoEm).localeCompare(a.fechadoEm || a.criadoEm));
const cprTextoBusca = c => semAcentoApp([cprNum(c), cprCod(c), cprDesc(c), cprMaqNome(c), c.por, cprForn(c.fornecedorId)?.nome, c.obs, CPR_ST[c.status]?.[0]].filter(Boolean).join(' '));
// Ações de cada etapa (botões à vista) e as outras opções (menu ⋯)
function cprAcoes(c, detalhe) {
  const d = cprDecide(), meu = cprMeu(c), a = [], mais = [];
  const st = c.status;
  if (d) {
    if (st === 'solicitado') a.push(mini('✓ Aprovar', 'cpr-aprovar', c.id, 'primary'), mini('Recusar', 'cpr-recusar', c.id));
    if (st === 'aprovado') a.push(mini('Pedir cotação', 'cpr-cotar', c.id), mini('Pedido ao fornecedor', 'cpr-enviar', c.id, 'primary'));
    if (st === 'cotando') a.push(mini('Resposta da cotação', 'cpr-resposta', c.id), mini('Pedido ao fornecedor', 'cpr-enviar', c.id, 'primary'));
    if (st === 'pedido') a.push(mini('📦 Receber', 'cpr-receber', c.id, 'primary'));
    if (['cancelado', 'recusado'].includes(st)) a.push(mini('Reabrir', 'cpr-reabrir', c.id));
    if (CPR_ABERTOS.includes(st)) {
      mais.push(mini('Editar', 'cpr-editar', c.id), mini(c.urgencia === 'normal' ? '⚡ Marcar urgente' : 'Tirar a urgência', 'cpr-urgente', c.id));
      if (st !== 'pedido') mais.push(mini(cprAdiado(c) ? 'Tirar o adiamento' : 'Adiar', 'cpr-adiar', c.id));
      if (Number(c.qtd) > 1 && st !== 'solicitado') mais.push(mini('Dividir', 'cpr-dividir', c.id));
      if (st !== 'solicitado') mais.push(mini('Trocar o fornecedor', 'cpr-fornecedor', c.id));
      if (st === 'pedido') mais.push(mini('Mudar a previsão', 'cpr-previsao', c.id), mini('Mandar o pedido de novo', 'cpr-reenviar', c.id));
      mais.push(mini('Cancelar o pedido', 'cpr-cancelar', c.id, 'del'));
    }
  } else if (meu && st === 'solicitado') a.push(mini('Cancelar o pedido', 'cpr-cancelar', c.id, 'del'));
  if (['recebido', 'cancelado', 'recusado'].includes(st) && (d || meu)) (d ? mais : a).push(mini('Repetir o pedido', 'cpr-repetir', c.id));
  if (!detalhe) a.push(mini('Detalhes', 'nav', 'compra/' + c.id));
  return `<div class="maq-acoes cpr-acoes">${a.join('')}${mais.length ? `<details class="menu-mais"><summary aria-label="Mais opções" title="Mais opções">⋯</summary><div class="menu-lista">${mais.join('')}</div></details>` : ''}</div>`;
}
function cprInfo(c) {
  const f = cprForn(c.fornecedorId), rec = cprRecebido(c), out = [];
  if (c.obs) out.push(`“${esc(c.obs)}”`);
  if (c.status === 'pedido') out.push(`${esc(f?.nome || 'Fornecedor não informado')}${c.previsao ? ` • previsão ${fmtDate(c.previsao)}` : ''}${cprAtrasado(c) ? ' <b class="cpr-atraso">• atrasado</b>' : ''}`);
  else if (f && CPR_ABERTOS.includes(c.status)) out.push(`Fornecedor: ${esc(f.nome)}`);
  if ((c.cotacoes || []).length && ['cotando', 'aprovado'].includes(c.status)) out.push('Cotação: ' + c.cotacoes.map(q => `${esc(cprForn(q.fornecedorId)?.nome || 'fornecedor')} ${q.tem ? `<b>${esc({sim: 'tem', nao: 'não tem', parcial: 'tem parte'}[q.tem] || q.tem)}</b>${q.prazo ? ` (${esc(q.prazo)})` : ''}` : '— aguardando'}`).join(' • '));
  if (rec > 0) out.push(`Recebido ${num(rec)} de ${num(c.qtd)} ${esc(cprUnid(c))}${c.status === 'pedido' ? ` — faltam ${num(cprFalta(c))}` : ''}`);
  if (cprAdiado(c)) out.push(`⏸ Adiado até ${fmtDate(c.adiadoAte)}${c.adiadoMotivo ? ` — ${esc(c.adiadoMotivo)}` : ''}`);
  if (['cancelado', 'recusado'].includes(c.status)) out.push(`${c.status === 'recusado' ? 'Recusado' : 'Cancelado'} por ${esc(c.fechadoPor || '—')} em ${fmtDate(cprDia(c.fechadoEm))}${c.motivo ? `: ${esc(c.motivo)}` : ''}`);
  if (c.status === 'recebido') out.push(`Recebido em ${fmtDate(cprDia(c.fechadoEm))}${f ? ` • ${esc(f.nome)}` : ''}`);
  return out;
}
function cprCartao(c, selecionavel) {
  const [stTxt, stCor] = CPR_ST[c.status] || [c.status, 'gray'];
  const urg = c.urgencia === 'parada' ? chip('⛔ Máquina parada', 'red') : c.urgencia === 'urgente' ? chip('⚡ Urgente', 'orange') : '';
  const sel = selecionavel && ['aprovado', 'cotando'].includes(c.status);
  const cod = cprCod(c), maq = cprMaqNome(c);
  return `<article class="card item-card cpr-card ${c.urgencia === 'parada' ? 'cpr-parada' : ''}" data-cpr-item data-busca="${esc(cprTextoBusca(c))}">
    <header>${sel ? `<label class="cpr-sel" title="Selecionar"><input type="checkbox" data-cpr-sel value="${esc(c.id)}" ${cprSel.has(c.id) ? 'checked' : ''} aria-label="Selecionar ${esc(cprDesc(c))}"></label>` : ''}
      <div class="cpr-tit"><h4>${cod ? `<span class="pc-cod">${esc(cod)}</span> ` : ''}${esc(cprDesc(c))}</h4>
        <div class="meta">${esc([`${num(c.qtd)} ${cprUnid(c)}`, maq ? 'para ' + maq : '', cprNum(c), `pedido por ${c.por || '—'} em ${fmtDate(cprDia(c.criadoEm))}`].filter(Boolean).join(' • '))}${contFotosCmp(c)}</div></div>
      <div class="cpr-chips">${urg}${chip(stTxt, stCor)}</div></header>
    ${cprInfo(c).length ? `<div class="meta cpr-info">${cprInfo(c).map(x => `<span>${x}</span>`).join('')}</div>` : ''}
    ${cprAcoes(c)}</article>`;
}
const contFotosCmp = c => c.fotos?.length ? ` • 📷 ${c.fotos.length}` : '';
// Estoque abaixo do mínimo sem pedido aberto
function cprFaltandoEstoque() {
  const comPedido = new Set(cprAtivos().map(c => cprItemEst(c)?.id).filter(Boolean));
  return db.stock.filter(s => Number(s.min) > 0 && (Number(s.qty) || 0) <= Number(s.min) && !comPedido.has(s.id) && !s.inativo);
}
// Pedidos iguais em aberto (ainda não pedidos ao fornecedor): podem virar um só (os divididos de propósito ficam fora)
function cprIguais() {
  const g = new Map();
  db[CPR_COL].filter(c => ['solicitado', 'aprovado', 'cotando'].includes(c.status) && !c.dividido && !c.divididoDe).forEach(c => { const k = cprChave(c); if (!g.has(k)) g.set(k, []); g.get(k).push(c); });
  return [...g.values()].filter(l => l.length > 1);
}
VIEWS.compras = arg => {
  const d = cprDecide(), filtro = CPR_FILTROS.some(([k]) => k === arg) || arg === 'paradas' ? arg : 'abertos';
  const novo = btn('+ Novo pedido', 'cpr-novo');
  if (!d) {
    const meus = db[CPR_COL].filter(cprMeu).sort(cprOrdem), f2 = arg === 'todos' ? 'todos' : 'abertos', lista = cprFiltrar(meus, f2);
    return head('Meus pedidos de compra', 'O que você pediu e em que etapa está. Quem aprova é o ADM, o supervisor ou o comprador.', novo) +
      `<div class="filters cpr-filtros">${[['abertos', 'Abertos'], ['todos', 'Todos']].map(([k, t]) => `<button class="${k === f2 ? 'active' : ''}" data-act="nav" data-id="compras/${k}">${t} (${cprFiltrar(meus, k).length})</button>`).join('')}</div>` +
      (lista.length ? `<section class="cards cpr-lista">${lista.map(c => cprCartao(c, false)).join('')}</section>` : `<section class="card">${empty(f2 === 'abertos' ? 'Nenhum pedido aberto' : 'Nenhum pedido ainda', 'Peça uma compra pelo botão “+ Novo pedido”, pelo 🛒 Pedir na peça ou no catálogo da máquina.', {act: 'cpr-novo', label: '+ Novo pedido'})}</section>`);
  }
  const todos = db[CPR_COL].slice().sort(cprOrdem), lista = cprFiltrar(todos, filtro);
  cprSel = new Set([...cprSel].filter(id => lista.some(c => c.id === id && ['aprovado', 'cotando'].includes(c.status))));
  const n = k => cprFiltrar(todos, k).length, atras = todos.filter(cprAtrasado).length;
  const paradas = todos.filter(c => CPR_ABERTOS.includes(c.status) && c.urgencia === 'parada');
  const kpi = (k, t, v, cor, extra = '') => `<button class="cpr-kpi ${cor} ${filtro === k ? 'on' : ''}" data-act="nav" data-id="compras/${k}"><b>${v}</b><span>${t}</span>${extra}</button>`;
  const kpis = `<section class="cpr-kpis">${kpi('aprovar', 'A aprovar', n('aprovar'), n('aprovar') ? 'laranja' : '')}${kpi('comprar', 'A comprar', n('comprar'), '')}${kpi('cotando', 'Em cotação', n('cotando'), '')}${kpi('pedido', 'Pedidos ao fornecedor', n('pedido'), atras ? 'vermelho' : '', atras ? `<small>${atras} ${atras === 1 ? 'atrasado' : 'atrasados'}</small>` : '')}${kpi('paradas', 'Máquinas paradas', new Set(paradas.map(c => c.maquinaId || c.id)).size, paradas.length ? 'vermelho' : '')}</section>`;
  const falt = cprFaltandoEstoque(), iguais = cprIguais();
  const avisos = [
    falt.length ? `<section class="card panel cpr-aviso"><div><strong>📦 ${falt.length} ${falt.length === 1 ? 'item do estoque está' : 'itens do estoque estão'} no mínimo ou abaixo, sem pedido</strong><small>${esc(falt.slice(0, 4).map(s => `${s.name} (${num(s.qty)} ${s.unit || ''})`).join(', '))}${falt.length > 4 ? '…' : ''}</small></div>${btn('Pedir esses itens', 'cpr-estoque', '', 'secondary')}</section>` : '',
    ...iguais.map(l => `<section class="card panel cpr-aviso"><div><strong>🔁 ${l.length} pedidos iguais: ${esc(cprDesc(l[0]))}</strong><small>${esc(l.map(c => `${cprNum(c)} ${num(c.qtd)} ${cprUnid(c)} (${c.por})`).join(' • '))}</small></div>${btn(`Juntar em um (${num(l.reduce((t, c) => t + Number(c.qtd || 0), 0))} ${cprUnid(l[0])})`, 'cpr-juntar', cprChave(l[0]), 'secondary')}</section>`)].join('');
  const filtros = `<div class="filters cpr-filtros">${CPR_FILTROS.map(([k, t]) => `<button class="${k === filtro ? 'active' : ''}" data-act="nav" data-id="compras/${k}">${t} (${n(k)})</button>`).join('')}</div>`;
  const busca = `<div class="catm-busca"><input type="search" data-cpr-busca value="${esc(cprBusca)}" placeholder="Buscar por peça, código, máquina, fornecedor ou quem pediu" aria-label="Buscar nos pedidos de compra" autocomplete="off" enterkeyhint="search"></div>`;
  const temSel = lista.some(c => ['aprovado', 'cotando'].includes(c.status));
  const barra = temSel ? `<div class="cpr-barra" id="cprBarra" ${cprSel.size ? '' : 'hidden'}><span id="cprBarraN">${cprSel.size} ${cprSel.size === 1 ? 'selecionado' : 'selecionados'}</span><button class="secondary" data-act="cpr-cotar-sel">Pedir cotação</button><button class="primary" data-act="cpr-enviar-sel">Pedido ao fornecedor</button><button class="link" data-act="cpr-sel-limpar">Limpar</button></div>
    <p class="nota cpr-dica">Marque os itens “A comprar” ou “Em cotação” para pedir cotação ou fazer o pedido de vários de uma vez.</p>` : '';
  const porForn = (() => { const m = new Map(); todos.filter(c => c.status === 'pedido').forEach(c => { const k = c.fornecedorId || ''; m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); })();
  const resumoForn = porForn.length ? `<details class="cpr-forn"><summary>Pedidos em aberto por fornecedor (${porForn.length})</summary><div class="list cpr-lst">${porForn.map(([fid, q]) => `<div class="list-row"><div><strong>${esc(cprForn(fid)?.nome || 'Sem fornecedor')}</strong><small>${q} ${q === 1 ? 'item' : 'itens'} • ${todos.filter(c => c.status === 'pedido' && (c.fornecedorId || '') === fid && cprAtrasado(c)).length} atrasado(s)</small></div></div>`).join('')}</div></details>` : '';
  const corpo = lista.length ? `<section class="cards cpr-lista">${lista.map(c => cprCartao(c, true)).join('')}</section><section class="card cpr-nada" hidden>${empty('Nada encontrado', 'Nenhum pedido com essas palavras.')}</section>`
    : `<section class="card">${empty(filtro === 'abertos' ? 'Nenhum pedido em aberto' : 'Nada nesta etapa', 'Os pedidos chegam pelo 🛒 Pedir nas peças, no catálogo do fabricante, nas ordens de manutenção, no estoque abaixo do mínimo, ou pelo “+ Novo pedido”.', {act: 'cpr-novo', label: '+ Novo pedido'})}</section>`;
  return head('Compras', 'Todos os pedidos da fazenda: aprovar, cotar, pedir ao fornecedor e receber.', btn('Fornecedores', 'nav', 'fornecedores', 'secondary') + novo) + kpis + avisos + filtros + busca + barra + resumoForn + corpo;
};
VIEWS.compras.after = () => { if (cprBusca) cprAplicarBusca(); };
TITLES.compras = 'Compras';
function cprAplicarBusca() {
  const termos = semAcentoApp(cprBusca).split(/\s+/).filter(Boolean); let n = 0;
  $$('[data-cpr-item]').forEach(el => { const ok = termos.every(t => el.dataset.busca.includes(t)); el.hidden = !ok; if (ok) n++; });
  const nada = $('.cpr-nada'); if (nada) nada.hidden = !!n || !termos.length;
}
document.addEventListener('input', e => { if (!e.target?.matches?.('[data-cpr-busca]')) return; cprBusca = e.target.value; cprAplicarBusca(); });
document.addEventListener('change', e => {
  if (!e.target?.matches?.('[data-cpr-sel]')) return;
  if (e.target.checked) cprSel.add(e.target.value); else cprSel.delete(e.target.value);
  const b = $('#cprBarra'); if (b) { b.hidden = !cprSel.size; $('#cprBarraN').textContent = `${cprSel.size} ${cprSel.size === 1 ? 'selecionado' : 'selecionados'}`; }
});

// ---------------- Detalhe ----------------
VIEWS.compra = id => {
  const c = find(CPR_COL, id), volta = btn('← Compras', 'nav', 'compras', 'secondary');
  if (!c) return head('Pedido de compra', '', volta) + `<section class="card">${empty('Pedido não encontrado', 'Ele pode ter sido removido.')}</section>`;
  if (!cprDecide() && !cprMeu(c)) return head('Pedido de compra', '', volta) + `<section class="card">${empty('Sem acesso', 'Você vê só os pedidos que fez.')}</section>`;
  const [stTxt, stCor] = CPR_ST[c.status] || [c.status, 'gray'], p = cprPeca(c), s = cprItemEst(c), m = c.maquinaId ? find('machines', c.maquinaId) : null, mt = c.ordemId ? find('maintenances', c.ordemId) : null;
  const linha = (r, v) => v ? `<div class="list-row"><div><small>${esc(r)}</small><strong>${v}</strong></div></div>` : '';
  const etapas = ['solicitado', 'aprovado', 'cotando', 'pedido', 'recebido'], iEt = etapas.indexOf(c.status);
  const trilha = ['cancelado', 'recusado'].includes(c.status) ? '' : `<ol class="cpr-trilha">${etapas.map((e, i) => `<li class="${i < iEt ? 'feito' : i === iEt ? 'agora' : ''}">${esc(CPR_ST[e][0])}</li>`).join('')}</ol>`;
  return head(`${cprCod(c) ? cprCod(c) + ' — ' : ''}${cprDesc(c)}`, `Pedido de compra ${cprNum(c)} • ${num(c.qtd)} ${cprUnid(c)}`, volta) +
    `<section class="card panel cpr-det"><div class="cpr-chips">${c.urgencia !== 'normal' ? chip(c.urgencia === 'parada' ? '⛔ Máquina parada' : '⚡ Urgente', c.urgencia === 'parada' ? 'red' : 'orange') : ''}${chip(stTxt, stCor)}${cprAtrasado(c) ? chip('Atrasado', 'red') : ''}</div>${trilha}
      ${cprInfo(c).length ? `<div class="meta cpr-info">${cprInfo(c).map(x => `<span>${x}</span>`).join('')}</div>` : ''}${cprAcoes(c, true)}</section>
    <section class="card list cpr-lst">${linha('Quantidade', `${num(c.qtd)} ${esc(cprUnid(c))}`)}${linha('Para a máquina', m ? `<a href="#/pecas/${esc(m.id)}">${esc(m.name)}</a>` : '')}${linha('Ordem de manutenção', mt ? `<a href="#/ordem/${esc(mt.id)}">${esc(mt.description || 'Ordem')}</a>` : '')}
      ${linha('Peça do catálogo', p ? `${p.codigo ? `<span class="pc-cod">${esc(p.codigo)}</span> ` : ''}${esc(p.nome)}${p.origem?.titulo ? ` <small>(${esc(p.origem.titulo)}: ${esc(p.origem.grupo || '')}${p.origem.rep ? `, nº ${esc(p.origem.rep)}` : ''})</small>` : ''}` : '')}
      ${linha('Item do estoque', s ? `${esc(s.name)} <small>(saldo ${num(s.qty)} ${esc(s.unit || '')})</small>` : '')}${linha('Pedido por', `${esc(c.por || '—')} em ${fmtDate(cprDia(c.criadoEm))}`)}
      ${linha('Aprovado', c.aprovacao ? `${esc(c.aprovacao.por)} em ${fmtDate(cprDia(c.aprovacao.em))}${c.aprovacao.auto ? ' (pedido de quem aprova)' : ''}` : '')}${linha('Observação', esc(c.obs || ''))}</section>
    ${c.fotos?.length && typeof galeriaFotos === 'function' ? `<section class="card panel"><h3>Fotos</h3>${galeriaFotos(CPR_COL, c)}</section>` : ''}
    ${(c.cotacoes || []).length ? `<div class="section-title"><h3>Cotação</h3></div><section class="card list cpr-lst">${c.cotacoes.map(q => `<div class="list-row"><div><strong>${esc(cprForn(q.fornecedorId)?.nome || 'Fornecedor')}</strong><small>${esc([q.tem ? {sim: 'Tem', nao: 'Não tem', parcial: 'Tem parte'}[q.tem] : 'Aguardando resposta', q.prazo ? 'prazo ' + q.prazo : '', q.obs, 'pedida em ' + fmtDate(cprDia(q.em))].filter(Boolean).join(' • '))}</small></div>${c.fornecedorId === q.fornecedorId ? chip('escolhido', 'green') : ''}</div>`).join('')}</section>` : ''}
    ${(c.recebidos || []).length ? `<div class="section-title"><h3>Recebimentos</h3></div><section class="card list cpr-lst">${c.recebidos.map(r => `<div class="list-row"><div><strong>${num(r.qtd)} ${esc(cprUnid(c))} em ${fmtDate(r.data)}</strong><small>${esc([r.por, r.nf ? 'NF ' + r.nf : '', r.movId ? 'entrada no estoque' : 'sem entrada no estoque'].filter(Boolean).join(' • '))}</small></div></div>`).join('')}</section>` : ''}
    <div class="section-title"><h3>Histórico</h3></div><section class="card list cpr-lst cpr-hist">${(c.historico || []).slice().reverse().map(h => `<div class="list-row"><div><strong>${esc(h.txt)}</strong><small>${esc(h.por || '')} • ${new Date(h.em).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'})}</small></div></div>`).join('')}</section>`;
};
TITLES.compra = 'Compras';

// ---------------- Ações ----------------
const cprPega = id => find(CPR_COL, id);
function cprMotivo(titulo, sub, rotulo, fazer) {
  openForm({title: titulo, sub, submit: rotulo, fields: [{k: 'motivo', label: 'Motivo', type: 'textarea', required: true, placeholder: 'Ex.: peça já chegou por outro pedido; máquina vendida; compramos na cidade'}],
    onSubmit: v => { if (!v.motivo) return 'Escreva o motivo'; fazer(v.motivo); }});
}
function cprFechar(c, status, motivo, txt) {
  Object.assign(c, {status, motivo, fechadoPor: cprEu(), fechadoEm: cprAgora()});
  cprSel.delete(c.id); cprGravar(c, `${txt}: ${motivo}`);
}
// Escolha de fornecedores (várias caixas) para a cotação
function cprEscolherFornecedores(lista, depois) {
  const forns = db.fornecedores.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  const sugeridos = new Set(lista.flatMap(c => (cprPeca(c)?.fornecedores || []).map(f => f.fornecedorId)));
  dialog.innerHTML = `<h3>Pedir cotação</h3><p class="sub">${lista.length} ${lista.length === 1 ? 'item' : 'itens'}: ${esc(lista.slice(0, 3).map(cprDesc).join(', '))}${lista.length > 3 ? '…' : ''}. Marque os fornecedores que vão receber a lista.</p>
    <form novalidate><div class="cpr-forns">${forns.length ? forns.map(f => `<label class="pce-mod"><input type="checkbox" value="${esc(f.id)}" ${sugeridos.has(f.id) || forns.length === 1 ? 'checked' : ''}><span><b>${esc(f.nome)}</b><small>${esc([f.cidade, f.whatsapp, f.email].filter(Boolean).join(' • ') || 'sem contato cadastrado')}</small></span></label>`).join('') : '<p class="nota">Nenhum fornecedor cadastrado: a lista sai para copiar e mandar por onde preferir.</p>'}</div>
    <button type="button" class="link" data-cpr-forn-novo>+ Cadastrar fornecedor</button>
    <div class="actions"><button type="button" class="secondary" data-close>Cancelar</button><button type="submit" class="primary">Continuar</button></div></form>`;
  $('[data-close]', dialog).onclick = closeModal;
  $('[data-cpr-forn-novo]', dialog).onclick = () => { closeModal(); if (typeof fornecedorForm === 'function') fornecedorForm({}, () => setTimeout(() => cprEscolherFornecedores(lista, depois), 0)); };
  $('form', dialog).onsubmit = e => { e.preventDefault(); const ids = $$('input:checked', dialog).map(i => i.value); if (forns.length && !ids.length) { showToast('Marque pelo menos um fornecedor', true); return; } closeModal(); depois(ids); };
  modal.classList.add('open');
}
function cprCotar(ids) {
  if (!cprSoDecide()) return;
  const lista = ids.map(cprPega).filter(c => c && ['aprovado', 'cotando'].includes(c.status)); if (!lista.length) { showToast('Escolha itens “A comprar” ou “Em cotação”', true); return; }
  cprEscolherFornecedores(lista, fids => {
    const em = cprAgora();
    lista.forEach(c => { c.status = 'cotando'; const ja = c.cotacoes || [];
      c.cotacoes = [...ja, ...fids.filter(f => !ja.some(q => q.fornecedorId === f)).map(fornecedorId => ({fornecedorId, em}))];
      cprGravar(c, `Cotação pedida${fids.length ? ' a ' + fids.map(f => cprForn(f)?.nome).filter(Boolean).join(', ') : ''}`); });
    cprSel.clear(); render();
    const envios = (fids.length ? fids : ['']).map(fid => ({forn: cprForn(fid), msg: cprMensagem('cotacao', cprForn(fid), lista)}));
    cprMostrarMensagens('Cotação: mande para cada fornecedor', 'Os itens ficaram “Em cotação”. Quando o fornecedor responder, toque em “Resposta da cotação”.', envios);
  });
}
function cprEnviar(ids) {
  if (!cprSoDecide()) return;
  const lista = ids.map(cprPega).filter(c => c && ['aprovado', 'cotando'].includes(c.status)); if (!lista.length) { showToast('Escolha itens “A comprar” ou “Em cotação”', true); return; }
  // Fornecedor sugerido: o já escolhido, o da cotação que tem, ou o da peça
  const sug = lista.map(c => c.fornecedorId || (c.cotacoes || []).find(q => q.tem === 'sim')?.fornecedorId || cprPeca(c)?.fornecedores?.[0]?.fornecedorId).find(Boolean) || '';
  openForm({title: 'Pedido ao fornecedor', sub: `${lista.length} ${lista.length === 1 ? 'item' : 'itens'}: ${lista.slice(0, 3).map(cprDesc).join(', ')}${lista.length > 3 ? '…' : ''}`, submit: 'Fazer o pedido',
    values: {fornecedorId: sug},
    fields: [{k: 'fornecedorId', label: 'Fornecedor', type: 'select', options: () => db.fornecedores.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')).map(f => ({value: f.id, label: f.nome})), hint: db.fornecedores.length ? '' : 'Cadastre os fornecedores em Compras › Fornecedores.'},
      {k: 'previsao', label: 'Previsão de entrega', type: 'date', hint: 'Passou da data sem receber: aparece como atrasado.'},
      {k: 'obs', label: 'Observação do pedido', type: 'textarea', placeholder: 'Ex.: retirar na loja; vem pela transportadora'}],
    onSubmit: v => {
      const em = cprAgora();
      lista.forEach(c => { Object.assign(c, {status: 'pedido', fornecedorId: v.fornecedorId || '', previsao: v.previsao || '', enviadoEm: em, obsPedido: v.obs || c.obsPedido || '', adiadoAte: ''});
        cprGravar(c, `Pedido ao fornecedor ${cprForn(v.fornecedorId)?.nome || '(sem fornecedor)'}${v.previsao ? `, previsão ${fmtDate(v.previsao)}` : ''}`); });
      cprSel.clear();
      setTimeout(() => cprMostrarMensagens('Mande o pedido ao fornecedor', 'Os itens estão em “Pedidos ao fornecedor”. Quando chegar, toque em “📦 Receber”.', [{forn: cprForn(v.fornecedorId), msg: cprMensagem('pedido', cprForn(v.fornecedorId), lista, v.previsao)}]), 0);
    }});
}
function cprReceber(c) {
  if (!cprSoDecide() || c.status !== 'pedido') return;
  const s = cprItemEst(c), p = cprPeca(c), fin = typeof nvVeFinanceiro === 'function' ? nvVeFinanceiro() : true;
  const opcoes = s ? [{value: 'sim', label: `Sim — ${s.name} (saldo ${num(s.qty)} ${s.unit || ''})`}, {value: 'nao', label: 'Não dar entrada'}]
    : [{value: 'novo', label: 'Criar o item no estoque e dar entrada'}, {value: 'nao', label: 'Não dar entrada'}];
  openForm({title: `Receber — ${cprDesc(c)}`, sub: `Pedido ${cprNum(c)} • ${cprForn(c.fornecedorId)?.nome || 'fornecedor'} • faltam ${num(cprFalta(c))} de ${num(c.qtd)} ${cprUnid(c)}`, submit: 'Registrar recebimento',
    values: {qtd: cprFalta(c), data: today(), estoque: s ? 'sim' : p ? 'novo' : 'nao', gasto: 'Sim'},
    fields: [{k: 'qtd', label: 'Quantidade recebida', type: 'number', min: 0, required: true, hint: 'Se veio só uma parte, o resto continua no pedido.'},
      {k: 'data', label: 'Data', type: 'date', required: true}, {k: 'nf', label: 'Nota fiscal / documento'},
      {k: 'estoque', label: 'Dar entrada no estoque', type: 'select', required: true, options: opcoes},
      ...(fin ? [{k: 'valor', label: 'Valor da nota (R$) — opcional', type: 'number', min: 0, mais: true, hint: 'Só para o custo médio do estoque e o controle de gastos.'},
        {k: 'gasto', label: 'Lançar o valor em Controle de gastos', type: 'select', options: ['Sim', 'Não'], mais: true}] : [])],
    maisRotulo: 'Valor da nota (opcional)',
    onSubmit: v => {
      if (!(v.qtd > 0)) return 'Informe a quantidade recebida';
      const rec = {qtd: v.qtd, data: v.data, nf: v.nf || '', por: cprEu(), em: cprAgora()};
      let item = s;
      if (v.estoque === 'novo') {
        item = {id: uid(), name: cprDesc(c), category: 'Peças', unit: cprUnid(c), qty: 0, min: '', codigo: cprCod(c), fornecedor: cprForn(c.fornecedorId)?.nome || ''};
        db.stock.push(item); c.itemId = item.id;
        if (p && !p.itemId) { p.itemId = item.id; upsert('pecas', p); }
      }
      if (item && v.estoque !== 'nao') {
        const valor = Number(v.valor) > 0 ? Number(v.valor) : 0, mov = aplicarMovimento(item, 'Entrada', Number(v.qtd), valor);
        const reg = {id: uid(), itemId: item.id, kind: 'Entrada', qty: v.qtd, date: v.data, supplier: cprForn(c.fornecedorId)?.nome || '', doc: v.nf || '', notes: `Compra ${cprNum(c)}${cprMaqNome(c) ? ' — ' + cprMaqNome(c) : ''}`, compraId: c.id, ...mov};
        db.movements.push(reg); rec.movId = reg.id;
        if (valor && v.gasto === 'Sim') db.expenses.push({id: uid(), date: v.data, category: CAT_GASTO_DO_ITEM[item.category] || 'Insumos', description: `Compra: ${item.name} — ${num(v.qtd)} ${item.unit}`, value: valor, supplier: reg.supplier, doc: reg.doc, movementId: reg.id, ...(c.maquinaId ? {machineId: c.maquinaId} : {})});
      }
      c.recebidos = [...(c.recebidos || []), rec];
      const tudo = cprFalta(c) <= 0;
      if (tudo) Object.assign(c, {status: 'recebido', fechadoPor: cprEu(), fechadoEm: cprAgora()});
      cprGravar(c, `${tudo ? 'Recebido' : 'Recebido em parte'}: ${num(v.qtd)} ${cprUnid(c)}${v.nf ? ` (NF ${v.nf})` : ''}${rec.movId ? ' — entrada no estoque' : ''}`);
      showToast(tudo ? `${cprDesc(c)} recebido${rec.movId ? ` • saldo ${num(item.qty)} ${item.unit}` : ''}` : `Recebido em parte: faltam ${num(cprFalta(c))} ${cprUnid(c)}`);
    }});
}
Object.assign(ACTIONS, {
  'cpr-novo': () => cprNovo({origem: 'avulso'}),
  'cpr-pedir-peca': id => { const [pid, mid] = String(id).split('|'); cprNovo({origem: 'peca', pecaId: pid, maquinaId: mid || ''}); },
  'cpr-pedir-ordem': id => { const mt = find('maintenances', id); if (mt) cprNovo({origem: 'ordem', ordemId: mt.id, maquinaId: mt.machineId, urgencia: mt.parada === 'Sim' ? 'parada' : 'normal'}); },
  'cpr-pedir-item': id => cprNovo({origem: 'estoque', itemId: id}),
  'cpr-copiar-msg': i => { const msg = cprMsgs[Number(i)] || ''; (navigator.clipboard?.writeText(msg) || Promise.reject()).then(() => showToast('Mensagem copiada'), () => showToast('Não deu para copiar: abra “Ver a mensagem” e copie', true)); },
  'cpr-aprovar': id => { const c = cprPega(id); if (!c || c.status !== 'solicitado' || !cprSoDecide()) return; Object.assign(c, {status: 'aprovado', aprovacao: {por: cprEu(), em: cprAgora()}}); cprGravar(c, 'Aprovado'); showToast(`${cprNum(c)} aprovado: está em “A comprar”`); render(); },
  'cpr-recusar': id => { const c = cprPega(id); if (!c || c.status !== 'solicitado' || !cprSoDecide()) return; cprMotivo(`Recusar ${cprNum(c)}`, `${cprDesc(c)} — pedido por ${c.por}. Quem pediu vê o motivo.`, 'Recusar', m => { cprFechar(c, 'recusado', m, 'Recusado'); showToast('Pedido recusado'); }); },
  'cpr-cancelar': id => {
    const c = cprPega(id); if (!c || !CPR_ABERTOS.includes(c.status)) return;
    if (!cprDecide() && !(cprMeu(c) && c.status === 'solicitado')) { showToast('Depois de aprovado, só quem compra pode cancelar. Fale com o ADM ou o comprador.', true); return; }
    cprMotivo(`Cancelar o pedido ${cprNum(c)}`, `${cprDesc(c)} — ${num(c.qtd)} ${cprUnid(c)}. ${c.status === 'pedido' ? 'Já foi pedido ao fornecedor: avise ele também. ' : ''}O pedido fica em “Cancelados” e pode ser reaberto.`, 'Cancelar o pedido', m => { cprFechar(c, 'cancelado', m, 'Cancelado'); showToast(`Pedido ${cprNum(c)} cancelado`); });
  },
  'cpr-reabrir': id => { const c = cprPega(id); if (!c || !cprSoDecide()) return; Object.assign(c, {status: c.enviadoEm ? 'pedido' : c.cotacoes?.length ? 'cotando' : 'aprovado', motivo: '', fechadoPor: '', fechadoEm: '', aprovacao: c.aprovacao || {por: cprEu(), em: cprAgora()}}); cprGravar(c, 'Reaberto'); showToast(`${cprNum(c)} reaberto: ${CPR_ST[c.status][0]}`); render(); },
  'cpr-repetir': id => {
    const c = cprPega(id); if (!c) return; const d = cprDecide();
    const n = {id: uid(), criadoEm: cprAgora(), por: cprEu(), porId: cprEuId(), origem: c.origem, pecaId: c.pecaId, itemId: c.itemId, descricao: c.descricao, codigo: c.codigo, unid: c.unid, qtd: c.qtd, maquinaId: c.maquinaId, ordemId: '', urgencia: 'normal', obs: c.obs, fornecedorId: d ? c.fornecedorId || '' : '', status: d ? 'aprovado' : 'solicitado', historico: []};
    if (d) n.aprovacao = {por: cprEu(), em: n.criadoEm, auto: true};
    cprHist(n, `Repetido do pedido ${cprNum(c)}`); upsert(CPR_COL, n); showToast(`Novo pedido ${cprNum(n)} — ${CPR_ST[n.status][0]}`); go('compra/' + n.id);
  },
  'cpr-editar': id => {
    const c = cprPega(id); if (!c || !cprSoDecide()) return;
    openForm({title: `Editar ${cprNum(c)}`, sub: cprDesc(c), values: {descricao: c.descricao, codigo: c.codigo, qtd: c.qtd, maquinaId: c.maquinaId, urgencia: c.urgencia, obs: c.obs},
      fields: [...(c.pecaId || c.itemId ? [] : [{k: 'descricao', label: 'O que comprar', required: true, full: true}, {k: 'codigo', label: 'Código'}]),
        {k: 'qtd', label: 'Quantidade', type: 'number', min: 0, required: true},
        {k: 'maquinaId', label: 'Para qual máquina', type: 'select', options: () => db.machines.filter(m => !isInactive(m) || m.id === c.maquinaId).map(m => ({value: m.id, label: m.name}))},
        {k: 'urgencia', label: 'Urgência', type: 'select', required: true, options: Object.entries(CPR_URG).map(([value, label]) => ({value, label}))},
        {k: 'obs', label: 'Observação', type: 'textarea'}],
      onSubmit: v => {
        if (!(v.qtd > 0)) return 'Informe a quantidade';
        if (v.qtd < cprRecebido(c)) return `Já foram recebidos ${num(cprRecebido(c))}`;
        const mud = [Number(v.qtd) !== Number(c.qtd) ? `quantidade ${num(c.qtd)} → ${num(v.qtd)}` : '', v.urgencia !== c.urgencia ? `urgência ${CPR_URG[v.urgencia]}` : '', (v.maquinaId || '') !== (c.maquinaId || '') ? 'máquina' : '', (v.obs || '') !== (c.obs || '') ? 'observação' : '', 'descricao' in v && v.descricao !== c.descricao ? 'descrição' : ''].filter(Boolean);
        Object.assign(c, {qtd: v.qtd, maquinaId: v.maquinaId || '', urgencia: v.urgencia, obs: v.obs || ''}, 'descricao' in v ? {descricao: v.descricao, codigo: (v.codigo || '').toUpperCase()} : {});
        cprGravar(c, mud.length ? 'Editado: ' + mud.join(', ') : '');
      }});
  },
  'cpr-urgente': id => { const c = cprPega(id); if (!c || !cprSoDecide()) return; c.urgencia = c.urgencia === 'normal' ? 'urgente' : 'normal'; cprGravar(c, c.urgencia === 'urgente' ? 'Marcado como urgente' : 'Urgência retirada'); render(); },
  'cpr-adiar': id => {
    const c = cprPega(id); if (!c || !cprSoDecide()) return;
    if (cprAdiado(c)) { c.adiadoAte = ''; c.adiadoMotivo = ''; cprGravar(c, 'Adiamento retirado'); render(); return; }
    openForm({title: `Adiar ${cprNum(c)}`, sub: `${cprDesc(c)}. Fica no fim da lista até a data, com o aviso de adiado.`, submit: 'Adiar', values: {ate: daysAgo(-7)},
      fields: [{k: 'ate', label: 'Adiar até', type: 'date', required: true}, {k: 'motivo', label: 'Motivo', placeholder: 'Ex.: comprar junto com a revisão; esperar a safra'}],
      onSubmit: v => { if (!v.ate || v.ate <= today()) return 'Escolha uma data depois de hoje'; Object.assign(c, {adiadoAte: v.ate, adiadoMotivo: v.motivo || ''}); cprGravar(c, `Adiado até ${fmtDate(v.ate)}${v.motivo ? ': ' + v.motivo : ''}`); }});
  },
  'cpr-dividir': id => {
    const c = cprPega(id); if (!c || !cprSoDecide()) return; const total = Number(c.qtd) - cprRecebido(c);
    openForm({title: `Dividir ${cprNum(c)}`, sub: `${cprDesc(c)} — ${num(total)} ${cprUnid(c)} a receber. Útil para comprar parte em outro fornecedor.`, submit: 'Dividir',
      fields: [{k: 'parte', label: `Quantidade do novo pedido (menos de ${num(total)})`, type: 'number', min: 0, required: true}],
      onSubmit: v => {
        if (!(v.parte > 0 && v.parte < total)) return `Informe entre 0 e ${num(total)}`;
        const n = {...JSON.parse(JSON.stringify(c)), id: uid(), criadoEm: cprAgora(), qtd: v.parte, recebidos: [], historico: [], status: c.status === 'pedido' ? 'aprovado' : c.status, fornecedorId: c.status === 'pedido' ? '' : c.fornecedorId, previsao: '', enviadoEm: '', fotos: [], divididoDe: c.id};
        cprHist(n, `Dividido do pedido ${cprNum(c)}`); upsert(CPR_COL, n);
        c.qtd = Number(c.qtd) - v.parte; c.dividido = true; cprGravar(c, `Dividido: ${num(v.parte)} ${cprUnid(c)} foram para o pedido ${cprNum(n)}`);
        showToast(`Novo pedido ${cprNum(n)} com ${num(v.parte)} ${cprUnid(c)}`);
      }});
  },
  'cpr-juntar': chave => {
    if (!cprSoDecide()) return;
    const l = cprIguais().find(g => cprChave(g[0]) === chave); if (!l) return;
    const alvo = l.slice().sort((a, b) => (CPR_ABERTOS.indexOf(b.status) - CPR_ABERTOS.indexOf(a.status)) || String(a.criadoEm).localeCompare(b.criadoEm))[0], resto = l.filter(c => c !== alvo);
    const total = l.reduce((t, c) => t + Number(c.qtd || 0), 0);
    confirmDialog(`Juntar ${l.length} pedidos de ${cprDesc(alvo)} no pedido ${cprNum(alvo)}, com ${num(total)} ${cprUnid(alvo)}? Os outros ficam como cancelados (juntados).`, () => {
      const urg = l.map(c => c.urgencia).sort((a, b) => (CPR_PESO_URG[a] ?? 2) - (CPR_PESO_URG[b] ?? 2))[0];
      const maqs = [...new Set(l.map(c => c.maquinaId).filter(Boolean))];
      alvo.qtd = total; alvo.urgencia = urg; if (!alvo.maquinaId && maqs.length === 1) alvo.maquinaId = maqs[0];
      const obs = [...new Set(l.map(c => c.obs).filter(Boolean))]; if (obs.length > 1) alvo.obs = obs.join(' | ');
      if (alvo.status === 'solicitado') { alvo.status = 'aprovado'; alvo.aprovacao = {por: cprEu(), em: cprAgora()}; }
      resto.forEach(c => { c.juntadoEm = alvo.id; cprFechar(c, 'cancelado', `Juntado ao pedido ${cprNum(alvo)}`, 'Juntado'); });
      cprGravar(alvo, `Juntou ${resto.map(cprNum).join(', ')} (${maqs.map(id => find('machines', id)?.name).filter(Boolean).join(', ') || 'mesmo item'}): total ${num(total)} ${cprUnid(alvo)}`);
      showToast(`Juntados em ${cprNum(alvo)}: ${num(total)} ${cprUnid(alvo)}`);
    }, 'Juntar');
  },
  'cpr-fornecedor': id => {
    const c = cprPega(id); if (!c || !cprSoDecide()) return;
    openForm({title: `Fornecedor — ${cprNum(c)}`, sub: cprDesc(c), values: {fornecedorId: c.fornecedorId || ''},
      fields: [{k: 'fornecedorId', label: 'Fornecedor', type: 'select', options: () => db.fornecedores.map(f => ({value: f.id, label: f.nome}))}],
      onSubmit: v => { c.fornecedorId = v.fornecedorId || ''; cprGravar(c, `Fornecedor: ${cprForn(v.fornecedorId)?.nome || 'nenhum'}`); }});
  },
  'cpr-previsao': id => {
    const c = cprPega(id); if (!c || !cprSoDecide()) return;
    openForm({title: `Previsão de entrega — ${cprNum(c)}`, sub: cprDesc(c), values: {previsao: c.previsao || ''}, fields: [{k: 'previsao', label: 'Nova previsão', type: 'date'}, {k: 'obs', label: 'Motivo', placeholder: 'Ex.: fornecedor sem estoque, chega na sexta'}],
      onSubmit: v => { const ant = c.previsao; c.previsao = v.previsao || ''; cprGravar(c, `Previsão ${ant ? fmtDate(ant) + ' → ' : ''}${v.previsao ? fmtDate(v.previsao) : 'sem data'}${v.obs ? ': ' + v.obs : ''}`); }});
  },
  'cpr-reenviar': id => { const c = cprPega(id); if (!c) return; const f = cprForn(c.fornecedorId); cprMostrarMensagens('Mandar o pedido de novo', cprDesc(c), [{forn: f, msg: cprMensagem('pedido', f, [c], c.previsao)}]); },
  'cpr-resposta': id => {
    const c = cprPega(id); if (!c || !cprSoDecide()) return;
    const qs = c.cotacoes || []; if (!qs.length) { cprCotar([id]); return; }
    openForm({title: `Resposta da cotação — ${cprNum(c)}`, sub: cprDesc(c), submit: 'Salvar resposta', values: {fornecedorId: qs.find(q => !q.tem)?.fornecedorId || qs[0].fornecedorId, tem: 'sim', escolher: 'Não'},
      fields: [{k: 'fornecedorId', label: 'Fornecedor', type: 'select', required: true, options: qs.map(q => ({value: q.fornecedorId, label: cprForn(q.fornecedorId)?.nome || 'Fornecedor'}))},
        {k: 'tem', label: 'Tem a peça?', type: 'select', required: true, options: [{value: 'sim', label: 'Tem'}, {value: 'parcial', label: 'Tem parte'}, {value: 'nao', label: 'Não tem'}]},
        {k: 'prazo', label: 'Prazo de entrega', placeholder: 'Ex.: 2 dias, sexta-feira, pronta entrega'}, {k: 'obs', label: 'Observação', placeholder: 'Ex.: só original; similar Fleetguard'},
        {k: 'escolher', label: 'Escolher este fornecedor para o pedido', type: 'select', options: ['Não', 'Sim']}],
      onSubmit: v => {
        const q = qs.find(x => x.fornecedorId === v.fornecedorId); if (!q) return 'Escolha o fornecedor';
        Object.assign(q, {tem: v.tem, prazo: v.prazo || '', obs: v.obs || '', respEm: cprAgora()});
        if (v.escolher === 'Sim') c.fornecedorId = v.fornecedorId;
        cprGravar(c, `Cotação ${cprForn(v.fornecedorId)?.nome || ''}: ${{sim: 'tem', parcial: 'tem parte', nao: 'não tem'}[v.tem]}${v.prazo ? ', ' + v.prazo : ''}${v.escolher === 'Sim' ? ' (escolhido)' : ''}`);
      }});
  },
  'cpr-cotar': id => cprCotar([id]),
  'cpr-enviar': id => cprEnviar([id]),
  'cpr-cotar-sel': () => cprCotar([...cprSel]),
  'cpr-enviar-sel': () => cprEnviar([...cprSel]),
  'cpr-sel-limpar': () => { cprSel.clear(); render(); },
  'cpr-receber': id => { const c = cprPega(id); if (c) cprReceber(c); },
  'cpr-estoque': () => {
    if (!cprSoDecide()) return; const l = cprFaltandoEstoque(); if (!l.length) return;
    confirmDialog(`Criar ${l.length} ${l.length === 1 ? 'pedido' : 'pedidos'} para repor o estoque até o mínimo? ${l.slice(0, 5).map(s => s.name).join(', ')}${l.length > 5 ? '…' : ''}`, () => {
      l.forEach(s => { const falta = Math.max(1, Number(s.min) - (Number(s.qty) || 0)), p = db.pecas.find(x => x.itemId === s.id);
        const c = {id: uid(), criadoEm: cprAgora(), por: cprEu(), porId: cprEuId(), origem: 'estoque', pecaId: p?.id || '', itemId: s.id, descricao: '', codigo: '', unid: '', qtd: Math.ceil(falta * 100) / 100, maquinaId: '', ordemId: '', urgencia: (Number(s.qty) || 0) <= 0 ? 'urgente' : 'normal', obs: `Estoque ${num(s.qty)} ${s.unit || ''}, mínimo ${num(s.min)}`, status: 'aprovado', aprovacao: {por: cprEu(), em: cprAgora(), auto: true}, historico: []};
        cprHist(c, 'Pedido para repor o estoque mínimo'); db[CPR_COL].push(c); });
      save(); showToast(`${l.length} ${l.length === 1 ? 'pedido criado' : 'pedidos criados'} em “A comprar”`);
    }, 'Criar pedidos');
  }
});

// ---------------- Avisos (sino) ----------------
const alertasSemCompras = alerts;
alerts = function () {
  const l = alertasSemCompras(), t = today(), rec = daysAgo(3);
  if (cprDecide()) {
    const ap = db[CPR_COL].filter(c => c.status === 'solicitado');
    if (ap.length) l.unshift({color: ap.some(c => c.urgencia === 'parada') ? 'red' : 'orange', icon: '🛒', title: `${ap.length} ${ap.length === 1 ? 'pedido de compra aguardando aprovação' : 'pedidos de compra aguardando aprovação'}`, text: ap.slice(0, 3).map(c => `${cprDesc(c)} (${c.por})`).join(' • '), route: 'compras/aprovar'});
    const at = db[CPR_COL].filter(cprAtrasado);
    if (at.length) l.unshift({color: 'red', icon: '🛒', title: `${at.length} ${at.length === 1 ? 'compra atrasada' : 'compras atrasadas'}`, text: at.slice(0, 3).map(c => `${cprDesc(c)} — ${cprForn(c.fornecedorId)?.nome || 'fornecedor'}, previsão ${fmtDate(c.previsao)}`).join(' • '), route: 'compras/pedido'});
    const par = db[CPR_COL].filter(c => ['aprovado', 'cotando'].includes(c.status) && c.urgencia === 'parada');
    if (par.length) l.unshift({color: 'red', icon: '⛔', title: `Máquina parada esperando compra: ${[...new Set(par.map(c => cprMaqNome(c) || cprDesc(c)))].slice(0, 3).join(', ')}`, text: par.slice(0, 3).map(cprDesc).join(' • ') + ' — ainda não pedido ao fornecedor', route: 'compras/paradas'});
  }
  // Quem pediu: chegou, recusado ou cancelado por outra pessoa (últimos 3 dias)
  db[CPR_COL].filter(c => cprMeu(c) && c.porId && ['recebido', 'recusado', 'cancelado'].includes(c.status) && cprDia(c.fechadoEm) >= rec && c.fechadoPor !== cprEu() && !c.juntadoEm).forEach(c =>
    l.unshift(c.status === 'recebido' ? {color: 'green', icon: '📦', title: `Chegou: ${cprDesc(c)}`, text: `Seu pedido ${cprNum(c)} foi recebido${cprMaqNome(c) ? ' — ' + cprMaqNome(c) : ''}.`, route: 'compra/' + c.id}
      : {color: 'orange', icon: '🛒', title: `${c.status === 'recusado' ? 'Recusado' : 'Cancelado'}: ${cprDesc(c)}`, text: `${c.fechadoPor}: ${c.motivo || ''}`, route: 'compra/' + c.id}));
  return l;
};

// ---------------- Ordem de manutenção: peças pedidas para ela ----------------
{
  const ordemSemCompras = VIEWS.ordem;
  if (ordemSemCompras) VIEWS.ordem = id => {
    const html = ordemSemCompras(id), mt = find('maintenances', id); if (!mt) return html;
    const l = db[CPR_COL].filter(c => c.ordemId === id).sort((a, b) => String(a.criadoEm).localeCompare(b.criadoEm));
    const linha = c => `<div class="list-row clickable" data-act="nav" data-id="compra/${esc(c.id)}" style="cursor:pointer"><div><strong>${cprCod(c) ? `<span class="pc-cod">${esc(cprCod(c))}</span> ` : ''}${esc(cprDesc(c))} — ${num(c.qtd)} ${esc(cprUnid(c))}</strong><small>${esc([cprNum(c), c.status === 'pedido' && c.previsao ? 'previsão ' + fmtDate(c.previsao) : '', cprRecebido(c) && c.status !== 'recebido' ? `recebido ${num(cprRecebido(c))}` : ''].filter(Boolean).join(' • '))}</small></div>${chip(CPR_ST[c.status][0], c.status === 'recebido' ? 'green' : cprAtrasado(c) ? 'red' : CPR_ST[c.status][1])}</div>`;
    const bloco = `<section class="card panel cpr-ordem"><div class="ctp-cab"><div><h3>🛒 Compras desta ordem</h3><small>${l.length ? `${l.filter(c => c.status === 'recebido').length} de ${l.length} ${l.length === 1 ? 'chegou' : 'chegaram'}` : 'Peça a compra das peças que faltam para o conserto.'}</small></div>${['Concluída'].includes(mt.status) ? '' : btn('🛒 Pedir peça', 'cpr-pedir-ordem', mt.id, 'secondary')}</div>${l.length ? `<div class="list cpr-lst">${l.map(linha).join('')}</div>` : ''}</section>`;
    const i = html.indexOf('</section>', html.indexOf('class="view-head"')) + '</section>'.length;
    return i > 9 ? html.slice(0, i) + bloco + html.slice(i) : html + bloco;
  };
}

// ---------------- Pedido antigo deste aparelho → Compras ----------------
// Até a 0.83 o “🛒 Pedido” ficava só no aparelho: passa para Compras (na nuvem), já aprovado
function cprMigrarPedidoLocal() {
  let l = []; try { l = JSON.parse(localStorage.getItem('mp-pedido-pecas') || '[]') || []; } catch { return; }
  if (!Array.isArray(l) || !l.length) return;
  const em = cprAgora();
  l.filter(x => find('pecas', x.pecaId)).forEach(x => {
    if (cprAtivos().some(c => c.pecaId === x.pecaId)) return;
    const c = {id: uid(), criadoEm: em, por: cprEu(), porId: cprEuId(), origem: 'peca', pecaId: x.pecaId, itemId: '', descricao: '', codigo: '', unid: '', qtd: Number(x.qtd) || 1, maquinaId: '', ordemId: '', urgencia: 'normal', obs: '', fornecedorId: x.fornecedorId || '', status: 'aprovado', aprovacao: {por: cprEu(), em, auto: true}, historico: []};
    cprHist(c, 'Veio do 🛒 Pedido antigo deste aparelho'); db[CPR_COL].push(c);
  });
  save(); try { localStorage.removeItem('mp-pedido-pecas'); } catch { /* sem armazenamento */ }
}
try { cprMigrarPedidoLocal(); } catch (e) { console.warn(e); }
