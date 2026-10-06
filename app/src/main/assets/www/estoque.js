'use strict';
/* Estoque e insumos: cartões por item com nível × mínimo, custo médio e valor em estoque.
   O custo vem só das entradas com valor (ou do custo informado pelo usuário em Editar). Nada é suposto. */

let estCat = '', estBusca = '';
const PERTO_DO_MINIMO = 1.5; // aviso operacional da tela: saldo até 50% acima do mínimo (não é referência técnica)

function nivelEstoque(s) {
  const qtd = Number(s.qty || 0), min = Number(s.min || 0);
  if (!(min > 0)) return {cls: 'sem', rotulo: 'Sem mínimo', cor: 'gray', txt: 'sem mínimo definido', pct: qtd > 0 ? 100 : 0, marca: null};
  const topo = Math.max(qtd, min * 3);
  const cls = qtd <= min ? 'baixo' : qtd <= min * PERTO_DO_MINIMO ? 'perto' : 'ok';
  return {cls, pct: topo ? qtd / topo * 100 : 0, marca: min / topo * 100,
    rotulo: {baixo: 'Estoque baixo', perto: 'Perto do mínimo', ok: 'OK'}[cls], cor: {baixo: 'red', perto: 'orange', ok: 'green'}[cls],
    txt: {baixo: 'abaixo do mínimo', perto: 'perto do mínimo', ok: 'acima do mínimo'}[cls]};
}
const estoquePerto = s => nivelEstoque(s).cls === 'perto';
const valorItem = s => custoMedio(s) != null ? custoMedio(s) * Number(s.qty || 0) : null;
const brl = v => 'R$ ' + num(v, 2);

function cartaoItem(s) {
  const n = nivelEstoque(s), cm = custoMedio(s), v = valorItem(s);
  return `<article class="card es-item" id="item-${esc(s.id)}">
    <div class="es-topo"><div><strong>${esc(s.name)}</strong><small>${esc([s.category, s.location].filter(Boolean).join(' • ') || 'Sem categoria')}</small></div>
      <div class="es-topo-dir">${chip(n.rotulo, n.cor)}<details class="menu-mais"><summary aria-label="Mais ações" title="Mais ações">⋯</summary><div class="menu-lista">
        <button data-act="st-ajuste" data-id="${esc(s.id)}">⇄ Ajuste de inventário</button><button data-act="st-edit" data-id="${esc(s.id)}">Editar item</button><button class="del" data-act="st-del" data-id="${esc(s.id)}">Excluir</button></div></details></div></div>
    <div class="es-saldo"><b>${num(s.qty)}</b><span>${esc(s.unit)}</span></div>
    <div><div class="es-nivel" role="img" aria-label="${esc(`${num(s.qty)} ${s.unit}, ${n.txt}`)}"><i class="${n.cls}" style="width:${n.pct}%"></i>${n.marca != null ? `<em style="left:${n.marca}%" title="mínimo"></em>` : ''}</div>
      <div class="es-legenda"><span>${n.txt}</span><span>${n.marca != null ? `mínimo ${num(s.min)} ${esc(s.unit)}` : ''}</span></div></div>
    <div class="es-info"><span>Custo médio</span><b>${cm != null ? `${brl(cm)}/${esc(s.unit)}` : '—'}</b><span>Valor em estoque</span><b>${v != null ? brl(v) : '—'}</b></div>
    ${cm == null ? `<p class="es-sem-custo">Sem custo registrado: lance uma entrada com o valor da nota${Number(s.qty) > 0 ? ' ou informe o custo do saldo atual em Editar' : ''}.</p>` : ''}
    <div class="es-acoes"><button class="ent" data-act="st-in" data-id="${esc(s.id)}">+ Entrada</button><button class="sai" data-act="st-out" data-id="${esc(s.id)}">− Saída</button></div>
  </article>`;
}

function filtrarItens() {
  const termos = semAcentoApp(estBusca).split(/\s+/).filter(Boolean);
  const ordem = {baixo: 0, perto: 1, ok: 2, sem: 3};
  return db.stock.filter(s => (!estCat || (s.category || 'Outro') === estCat) && termos.every(t => semAcentoApp(`${s.name} ${s.category} ${s.location}`).includes(t)))
    .sort((a, b) => ordem[nivelEstoque(a).cls] - ordem[nivelEstoque(b).cls] || a.name.localeCompare(b.name, 'pt-BR'));
}
function gradeItens() {
  const l = filtrarItens();
  return l.length ? `<section class="es-grid">${l.map(cartaoItem).join('')}</section>` : `<section class="card">${empty('Nenhum item encontrado', 'Tente outro termo ou outra categoria.')}</section>`;
}

VIEWS.estoque = () => {
  if (!db.stock.length) return head('Estoque e insumos', 'Saldo, mínimo e custo de cada insumo', btn('+ Novo item', 'st-new')) +
    `<section class="card">${empty('Nenhum item cadastrado', 'Cadastre defensivos, fertilizantes, sementes, combustível e peças.', {act: 'st-new', label: '+ Novo item'})}</section>`;
  const comValor = db.stock.filter(s => valorItem(s) != null), semCusto = db.stock.length - comValor.length;
  const total = comValor.reduce((t, s) => t + valorItem(s), 0);
  const baixos = db.stock.filter(stockLow), pertos = db.stock.filter(estoquePerto);
  const iniMes = today().slice(0, 8) + '01';
  const saidasMes = db.movements.filter(m => m.kind === 'Saída' && m.date >= iniMes && m.date <= today());
  const valorSaidas = saidasMes.reduce((t, m) => t + (Number(m.value) || 0), 0), saidasSemCusto = saidasMes.filter(m => !(Number(m.value) > 0)).length;
  const cats = [...new Set(db.stock.map(s => s.category || 'Outro'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const movs = db.movements.slice().sort(byDateDesc).slice(0, 15);
  const nomes = l => l.map(s => s.name).join(', ');
  return head('Estoque e insumos', `${db.stock.length} itens • valores pelo custo médio das entradas`, btn('Movimentar', 'mov-new', '', 'secondary') + btn('+ Novo item', 'st-new')) +
    `<section class="es-kpis">
      <article class="card kpi"><div class="label">Valor em estoque</div><div class="value">${brl(total)}</div><div class="hint">${semCusto ? `${semCusto} ${semCusto === 1 ? 'item' : 'itens'} sem custo registrado` : 'custo médio × saldo'}</div></article>
      <article class="card kpi ${baixos.length ? 'alerta' : ''}"><div class="label">Abaixo do mínimo</div><div class="value">${baixos.length ? '! ' : ''}${baixos.length}</div><div class="hint">${esc(nomes(baixos) || 'nenhum item')}</div></article>
      <article class="card kpi ${pertos.length ? 'aviso' : ''}"><div class="label">Perto do mínimo</div><div class="value">${pertos.length}</div><div class="hint">${esc(nomes(pertos) || 'até 50% acima do mínimo')}</div></article>
      <article class="card kpi"><div class="label">Saídas no mês</div><div class="value">${brl(valorSaidas)}</div><div class="hint">${saidasMes.length} ${saidasMes.length === 1 ? 'saída' : 'saídas'}${saidasSemCusto ? ` • ${saidasSemCusto} sem custo` : ''}</div></article>
    </section>
    <div class="cat-busca"><span aria-hidden="true">⌕</span><input id="estQ" type="search" value="${esc(estBusca)}" placeholder="Buscar item ou local" aria-label="Buscar no estoque"></div>
    <div class="filters" role="group" aria-label="Categoria"><button class="${!estCat ? 'active' : ''}" data-act="est-cat" data-id="">Todos (${db.stock.length})</button>${cats.map(c => `<button class="${estCat === c ? 'active' : ''}" data-act="est-cat" data-id="${esc(c)}">${esc(c)} (${db.stock.filter(s => (s.category || 'Outro') === c).length})</button>`).join('')}</div>
    <div id="esGrade">${gradeItens()}</div>
    <div class="section-title"><h3>Últimas movimentações</h3></div><section class="card list">${movs.length ? movs.map(m => {
      const s = find('stock', m.itemId), color = m.kind === 'Entrada' ? 'green' : m.kind === 'Saída' ? 'orange' : 'blue';
      return `<div class="row"><span class="status ${color}"></span><div><strong>${esc(m.kind)} — ${esc(s?.name || 'Item removido')}</strong><small>${esc([fmtDate(m.date), `${num(m.qty)} ${s?.unit || ''}`, Number(m.value) > 0 ? brl(m.value) : '', `saldo ${num(m.before)} → ${num(m.after)}`, fieldName(m.fieldId), m.supplier, m.doc, m.notes].filter(Boolean).join(' • '))}</small></div>${chip(m.kind, color)}</div>`;
    }).join('') : empty('Nenhuma movimentação', '')}</section>`;
};
VIEWS.estoque.after = () => {
  const q = $('#estQ'); if (!q) return;
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(() => { estBusca = q.value; $('#esGrade').innerHTML = gradeItens(); }, 150); };
};

Object.assign(ACTIONS, {
  'st-in': id => movementForm(id, 'Entrada'),
  'st-out': id => movementForm(id, 'Saída'),
  'est-cat': id => { estCat = id; render(); }
});
