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

// Saldo por lote: entradas com lote menos saídas do lote; saídas sem lote baixam do lote que vence primeiro (PVPS)
const AVISO_VALIDADE_DIAS = 60; // aviso da tela: lote vencendo em até 60 dias
function lotesDoItem(itemId) {
  const movs = db.movements.filter(m => m.itemId === itemId).sort((a, b) => a.date.localeCompare(b.date));
  const lotes = {};
  for (const m of movs) if (m.kind === 'Entrada' && m.lote) { const l = (lotes[m.lote] ||= {lote: m.lote, validade: m.validade || '', saldo: 0}); l.saldo += Number(m.qty) || 0; if (m.validade && (!l.validade || m.validade < l.validade)) l.validade = m.validade; }
  for (const m of movs) {
    if (m.kind !== 'Saída') continue;
    let resta = Number(m.qty) || 0;
    if (m.lote && lotes[m.lote]) { const tira = Math.min(resta, lotes[m.lote].saldo); lotes[m.lote].saldo -= tira; resta -= tira; }
    for (const l of Object.values(lotes).sort((a, b) => (a.validade || '9999').localeCompare(b.validade || '9999'))) { if (resta <= 0) break; const tira = Math.min(resta, l.saldo); l.saldo -= tira; resta -= tira; }
  }
  return Object.values(lotes).filter(l => l.saldo > 1e-9).sort((a, b) => (a.validade || '9999').localeCompare(b.validade || '9999'));
}
const diasAte = d => Math.round((new Date(d + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5);
function lotesVencendo() {
  return db.stock.flatMap(s => lotesDoItem(s.id).filter(l => l.validade && diasAte(l.validade) <= AVISO_VALIDADE_DIAS).map(l => ({s, ...l, dias: diasAte(l.validade)})));
}

function cartaoItem(s) {
  const n = nivelEstoque(s), cm = custoMedio(s), v = valorItem(s);
  return `<article class="card es-item" id="item-${esc(s.id)}">
    <div class="es-topo"><div><strong>${esc(s.name)}</strong><small>${esc([s.category, s.location].filter(Boolean).join(' • ') || 'Sem categoria')}</small></div>
      <div class="es-topo-dir">${chip(n.rotulo, n.cor)}<details class="menu-mais"><summary aria-label="Mais ações" title="Mais ações">⋯</summary><div class="menu-lista">
        <button data-act="nav" data-id="estoque/${esc(s.id)}">Extrato e lotes</button><button data-act="st-ajuste" data-id="${esc(s.id)}">⇄ Ajuste de inventário</button><button data-act="st-edit" data-id="${esc(s.id)}">Editar item</button><button class="del" data-act="st-del" data-id="${esc(s.id)}">Excluir</button></div></details></div></div>
    <div class="es-saldo"><b>${num(s.qty)}</b><span>${esc(s.unit)}</span></div>
    <div><div class="es-nivel" role="img" aria-label="${esc(`${num(s.qty)} ${s.unit}, ${n.txt}`)}"><i class="${n.cls}" style="width:${n.pct}%"></i>${n.marca != null ? `<em style="left:${n.marca}%" title="mínimo"></em>` : ''}</div>
      <div class="es-legenda"><span>${n.txt}</span><span>${n.marca != null ? `mínimo ${num(s.min)} ${esc(s.unit)}` : ''}</span></div></div>
    <div class="es-info"><span>Custo médio</span><b>${cm != null ? `${brl(cm)}/${esc(s.unit)}` : '—'}</b><span>Valor em estoque</span><b>${v != null ? brl(v) : '—'}</b></div>
    ${(() => { const l = lotesDoItem(s.id)[0]; if (!l) return ''; const d = l.validade ? diasAte(l.validade) : null; return `<div class="es-lote ${d != null && d <= AVISO_VALIDADE_DIAS ? 'vence' : ''} ${d != null && d < 0 ? 'vencido' : ''}"><span>Lote ${esc(l.lote)} • ${num(l.saldo)} ${esc(s.unit)}</span><span>${l.validade ? (d < 0 ? `vencido há ${-d} d` : d <= AVISO_VALIDADE_DIAS ? `vence em ${d} d (${fmtDate(l.validade)})` : 'validade ' + fmtDate(l.validade)) : 'sem validade'}</span></div>`; })()}
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

VIEWS.estoque = arg => {
  if (arg === 'inventario') return telaInventario();
  if (arg) return extratoItem(arg);
  if (!db.stock.length) return head('Estoque e insumos', 'Saldo, mínimo e custo de cada insumo', btn('Importar NF-e (XML)', 'nfe-abrir', '', 'secondary') + btn('+ Novo item', 'st-new')) +
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
  return head('Estoque e insumos', `${db.stock.length} itens • valores pelo custo médio das entradas`, btn('Importar NF-e (XML)', 'nfe-abrir', '', 'secondary') + btn('Inventário', 'nav', 'estoque/inventario', 'secondary') + btn('Movimentar', 'mov-new', '', 'secondary') + btn('+ Novo item', 'st-new')) +
    (() => { const v = lotesVencendo(); return v.length ? `<div class="es-validade-aviso">⚠ ${v.length} ${v.length === 1 ? 'lote vencido ou vencendo' : 'lotes vencidos ou vencendo'} em até ${AVISO_VALIDADE_DIAS} dias: ${esc(v.slice(0, 4).map(x => `${x.s.name} (lote ${x.lote}, ${x.dias < 0 ? 'vencido' : fmtDate(x.validade)})`).join('; '))}</div>` : ''; })() +
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
function extratoItem(id) {
  const s = find('stock', id); if (!s) return empty('Item não encontrado', '');
  const movs = db.movements.filter(m => m.itemId === id).sort((a, b) => b.date.localeCompare(a.date) || 0);
  const lotes = lotesDoItem(id), cor = k => k === 'Entrada' ? 'green' : k === 'Saída' ? 'orange' : 'blue';
  return head(`Extrato — ${s.name}`, `${num(s.qty)} ${s.unit} em estoque${custoMedio(s) != null ? ` • custo médio R$ ${num(custoMedio(s), 2)}/${s.unit}` : ''}`, btn('← Estoque', 'nav', 'estoque', 'secondary') + btn('− Saída', 'st-out', id, 'secondary') + btn('+ Entrada', 'st-in', id)) +
    (lotes.length ? `<div class="section-title"><h3>Lotes em estoque</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lote</th><th>Validade</th><th class="num">Saldo</th></tr></thead><tbody>${lotes.map(l => { const d = l.validade ? diasAte(l.validade) : null; return `<tr><td><strong>${esc(l.lote)}</strong></td><td>${l.validade ? fmtDate(l.validade) + ' ' + (d < 0 ? chip('vencido', 'red') : d <= AVISO_VALIDADE_DIAS ? chip(`vence em ${d} d`, 'orange') : '') : '—'}</td><td class="num">${num(l.saldo)} ${esc(s.unit)}</td></tr>`; }).join('')}</tbody></table></div><p class="nota">Saídas sem lote informado são baixadas do lote que vence primeiro.</p></section>` : '') +
    `<div class="section-title"><h3>Movimentações (${movs.length})</h3></div><section class="card panel">${movs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Movimento</th><th class="num">Quantidade</th><th class="num">Saldo</th><th class="num">Valor</th><th>Detalhes</th></tr></thead><tbody>${movs.map(m => `<tr><td>${fmtDate(m.date)}</td><td>${chip(m.kind, cor(m.kind))}</td><td class="num">${m.kind === 'Saída' ? '− ' : m.kind === 'Entrada' ? '+ ' : ''}${num(m.qty)}</td><td class="num">${num(m.before)} → <strong>${num(m.after)}</strong></td><td class="num">${Number(m.value) > 0 ? 'R$ ' + num(m.value, 2) : '—'}</td><td><small>${esc([m.lote && 'lote ' + m.lote, m.validade && 'val. ' + fmtDate(m.validade), fieldName(m.fieldId), m.supplier, m.doc, m.notes].filter(Boolean).join(' • '))}</small></td></tr>`).join('')}</tbody></table></div>` : empty('Sem movimentações', '')}</section>`;
}

// Inventário: contagem de todos os itens de uma vez; só itens com diferença geram ajuste
function telaInventario() {
  const itens = db.stock.slice().sort((a, b) => (a.category || '').localeCompare(b.category || '', 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR'));
  return head('Inventário', 'Digite o saldo contado de cada item. Deixe em branco o que não foi contado.', btn('← Estoque', 'nav', 'estoque', 'secondary')) +
    `<section class="card panel"><div class="form" style="grid-template-columns:1fr 1fr;margin-bottom:12px"><div class="field"><label for="invData">Data da contagem</label><input id="invData" type="date" value="${today()}"></div><div class="field"><label for="invResp">Responsável</label><input id="invResp" value="${esc(db.settings.owner || '')}"></div></div>
    <div class="tbl-wrap"><table class="tbl inv"><thead><tr><th>Item</th><th class="num">No app</th><th class="num">Contado</th><th class="num">Diferença</th></tr></thead><tbody>${itens.map(s => `<tr><td><strong>${esc(s.name)}</strong><br><small style="color:var(--muted)">${esc([s.category, s.location].filter(Boolean).join(' • '))}</small></td><td class="num">${num(s.qty)} ${esc(s.unit)}</td><td class="num"><input class="inv-q" data-inv="${esc(s.id)}" inputmode="decimal" aria-label="Contado ${esc(s.name)}"></td><td class="num inv-dif" id="dif-${esc(s.id)}">—</td></tr>`).join('')}</tbody></table></div>
    <div class="actions"><button class="primary" data-act="inv-salvar">Registrar ajustes</button></div></section>`;
}
function lerInventario() {
  return $$('[data-inv]').map(el => { const s = find('stock', el.dataset.inv), v = umNum(el.value); return {s, v, bruto: el.value.trim()}; }).filter(x => x.bruto !== '');
}

VIEWS.estoque.after = () => {
  $$('[data-inv]').forEach(el => el.addEventListener('input', () => { const s = find('stock', el.dataset.inv), v = umNum(el.value), d = $('#dif-' + el.dataset.inv); d.textContent = v === undefined ? (el.value.trim() ? 'inválido' : '—') : `${v - s.qty > 0 ? '+' : ''}${num(v - Number(s.qty || 0))} ${s.unit}`; d.className = 'num inv-dif ' + (v === undefined ? '' : v - s.qty < 0 ? 'neg' : v - s.qty > 0 ? 'pos' : ''); }));
  const q = $('#estQ'); if (!q) return;
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(() => { estBusca = q.value; $('#esGrade').innerHTML = gradeItens(); }, 150); };
};

Object.assign(ACTIONS, {
  'st-in': id => movementForm(id, 'Entrada'),
  'st-out': id => movementForm(id, 'Saída'),
  'est-cat': id => { estCat = id; render(); },
  'inv-salvar': () => {
    const l = lerInventario(), inval = l.find(x => x.v === undefined || x.v < 0);
    if (!l.length) { showToast('Nenhuma contagem digitada'); return; }
    if (inval) { showToast(`Valor inválido para ${inval.s.name}: ${inval.bruto}`); return; }
    const data = $('#invData').value || today(), resp = $('#invResp').value.trim(), dif = l.filter(x => Math.abs(x.v - Number(x.s.qty || 0)) > 1e-9);
    confirmDialog(`${l.length} ${l.length === 1 ? 'item contado' : 'itens contados'}; ${dif.length} com diferença. Registrar os ajustes em ${fmtDate(data)}?`, () => {
      dif.forEach(({s, v}) => { const mov = aplicarMovimento(s, 'Ajuste de inventário', v, 0); db.movements.push({id: uid(), itemId: s.id, kind: 'Ajuste de inventário', qty: v, date: data, notes: `Inventário${resp ? ' — ' + resp : ''}`, ...mov}); });
      db.settings.ultimoInventario = data; save(); showToast(dif.length ? `${dif.length} ajuste(s) registrados` : 'Contagem confere com o app'); go('estoque');
    }, 'Registrar');
  }
});

// Alertas: lotes vencidos ou vencendo
const alertasSemValidade = alerts;
alerts = function () {
  const lista = alertasSemValidade();
  lotesVencendo().forEach(x => lista.push({color: x.dias < 0 ? 'red' : 'orange', icon: '□', title: `${x.dias < 0 ? 'Lote vencido' : 'Lote vencendo'}: ${x.s.name}`, text: `Lote ${x.lote} — ${num(x.saldo)} ${x.s.unit}, validade ${fmtDate(x.validade)}.`, route: 'estoque/' + x.s.id}));
  return lista;
};
