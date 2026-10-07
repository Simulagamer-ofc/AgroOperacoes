'use strict';
/* Produção, vendas e margem por talhão e safra.
   Produção: colheita pesada (kg) → sacas de 60 kg. Receita do talhão: produção × preço médio das vendas da cultura na safra.
   Custo do talhão: gastos ligados ao talhão na safra + insumos aplicados (saídas do estoque com custo).
   Custos sem talhão (combustível, manutenção, mão de obra geral…) aparecem à parte e, se o usuário quiser, rateados pela área. */

const KG_SACA_GRAO = 60; // saca comercial de grãos no Brasil
let prodSafra = '', prodRateio = false, avisoCarencia = '';

const safrasConhecidas = () => [...new Set([...db.fields.map(f => f.season), ...db.colheitas.map(c => c.season), ...db.vendas.map(v => v.season)].filter(Boolean))].sort().reverse();
const safraDoTalhao = id => find('fields', id)?.season || '';

function colheitaForm(fieldId) {
  if (!db.fields.length) { showToast('Cadastre o talhão primeiro'); return fieldForm(); }
  const f0 = fieldId ? find('fields', fieldId) : null;
  openForm({
    title: 'Registrar colheita', sub: 'Peso líquido pesado (balança ou romaneio). Pode lançar por carga ou o total do talhão.',
    values: {fieldId, date: today(), season: f0?.season || '', cultura: f0?.crop || ''},
    fields: [
      {k: 'fieldId', label: 'Talhão', type: 'select', options: fieldOptions, required: true, full: true},
      {k: 'cultura', label: 'Cultura', required: true, placeholder: 'Ex.: Soja'},
      {k: 'season', label: 'Safra', required: true, placeholder: 'Ex.: 2025/26'},
      {k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'kg', label: 'Peso colhido (kg)', type: 'number', min: 0, required: true, hint: `Convertido em sacas de ${KG_SACA_GRAO} kg.`},
      {k: 'umidade', label: 'Umidade (%)', type: 'number', min: 0},
      {k: 'destino', label: 'Destino', placeholder: 'Ex.: armazém próprio, cooperativa'},
      {k: 'notes', label: 'Observações', type: 'textarea'}
    ],
    onSubmit: v => {
      if (!(v.kg > 0)) return 'Informe o peso colhido';
      const lib = typeof liberacaoColheita === 'function' ? liberacaoColheita(v.fieldId) : null;
      if (lib && v.date < lib.libera && avisoCarencia !== v.fieldId + v.date) { avisoCarencia = v.fieldId + v.date; return `Atenção: ${lib.a.produto} só libera a colheita a partir de ${fmtDate(lib.libera)}. Toque em salvar de novo para registrar mesmo assim.`; }
      avisoCarencia = ''; db.colheitas.push({id: uid(), ...v}); save(); showToast(`${num(v.kg / KG_SACA_GRAO, 1)} sacas registradas`);
    }
  });
}

function vendaForm() {
  openForm({
    title: 'Registrar venda', sub: 'A venda entra em Financeiro → A receber (à vista já como recebida).',
    values: {date: today(), recebimento: 'À vista', season: prodSafra || safrasConhecidas()[0] || ''},
    fields: [
      {k: 'cultura', label: 'Cultura', required: true, placeholder: 'Ex.: Soja'},
      {k: 'season', label: 'Safra', required: true},
      {k: 'date', label: 'Data da venda', type: 'date', required: true},
      {k: 'sacas', label: `Sacas vendidas (${KG_SACA_GRAO} kg)`, type: 'number', min: 0, required: true},
      {k: 'preco', label: 'Preço por saca (R$)', type: 'number', min: 0, required: true},
      {k: 'comprador', label: 'Comprador'},
      {k: 'recebimento', label: 'Recebimento', type: 'select', options: ['À vista', 'A prazo'], required: true},
      {k: 'vencimento', label: 'Vencimento (se a prazo)', type: 'date'},
      {k: 'doc', label: 'Contrato / nota'},
      {k: 'notes', label: 'Observações', type: 'textarea'}
    ],
    onSubmit: v => {
      if (!(v.sacas > 0 && v.preco > 0)) return 'Informe sacas e preço';
      if (v.recebimento === 'A prazo' && !v.vencimento) return 'Informe o vencimento';
      const valor = Math.round(v.sacas * v.preco * 100) / 100, venda = {id: uid(), ...v, valor};
      const conta = {id: uid(), tipo: 'receber', descricao: `Venda de ${v.cultura.toLowerCase()} — ${num(v.sacas)} sc`, categoria: 'Venda de grãos', parceiro: v.comprador, valor, doc: v.doc, season: v.season, vendaId: venda.id,
        vencimento: v.recebimento === 'A prazo' ? v.vencimento : v.date, ...(v.recebimento === 'À vista' ? {status: 'paga', pagoEm: v.date, valorPago: valor} : {status: 'aberta'})};
      venda.contaId = conta.id; db.vendas.push(venda); db.contas.push(conta); save();
      showToast(`Venda de R$ ${num(valor, 2)} registrada`);
    }
  });
}

// Custos de cada talhão na safra
function custosSafra(season) {
  const porTalhao = {}, add = (id, v, tipo) => { if (!(v > 0)) return; (porTalhao[id] ||= {gastos: 0, insumos: 0})[tipo] += v; };
  db.expenses.filter(g => g.fieldId && (g.season || safraDoTalhao(g.fieldId)) === season).forEach(g => add(g.fieldId, Number(g.value), 'gastos'));
  db.movements.filter(m => m.kind === 'Saída' && m.fieldId && (m.season || safraDoTalhao(m.fieldId)) === season).forEach(m => add(m.fieldId, Number(m.value) || 0, 'insumos'));
  const semTalhao = db.expenses.filter(g => !g.fieldId && g.season === season).reduce((s, g) => s + Number(g.value || 0), 0);
  const insumosSemCusto = db.movements.filter(m => m.kind === 'Saída' && m.fieldId && (m.season || safraDoTalhao(m.fieldId)) === season && !(Number(m.value) > 0)).length;
  return {porTalhao, semTalhao, insumosSemCusto};
}

function analiseSafra(season) {
  const col = db.colheitas.filter(c => c.season === season), vend = db.vendas.filter(v => v.season === season);
  const precoCultura = {};
  vend.forEach(v => { const k = v.cultura.toLowerCase(); (precoCultura[k] ||= {sc: 0, rs: 0}); precoCultura[k].sc += Number(v.sacas); precoCultura[k].rs += Number(v.valor); });
  const preco = c => { const p = precoCultura[(c || '').toLowerCase()]; return p && p.sc ? p.rs / p.sc : null; };
  const cs = custosSafra(season);
  const ids = [...new Set([...col.map(c => c.fieldId), ...Object.keys(cs.porTalhao)])];
  const areaTotal = ids.reduce((s, id) => s + (Number(find('fields', id)?.area) || 0), 0);
  const linhas = ids.map(id => {
    const f = find('fields', id), area = Number(f?.area) || 0, cl = col.filter(c => c.fieldId === id);
    const sacas = cl.reduce((s, c) => s + Number(c.kg) / KG_SACA_GRAO, 0), cultura = cl[0]?.cultura || f?.crop || '';
    const custo = (cs.porTalhao[id]?.gastos || 0) + (cs.porTalhao[id]?.insumos || 0), rateio = prodRateio && areaTotal > 0 ? cs.semTalhao * area / areaTotal : 0;
    const p = preco(cultura), receita = p != null ? sacas * p : null, custoTot = custo + rateio;
    return {id, nome: f?.name || 'Talhão removido', area, cultura, sacas, scha: area ? sacas / area : null, custo: custoTot, custoHa: area ? custoTot / area : null,
      custoSc: sacas ? custoTot / sacas : null, preco: p, receita, margem: receita != null ? receita - custoTot : null, margemHa: receita != null && area ? (receita - custoTot) / area : null,
      equilibrio: p && area ? custoTot / area / p : null};
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const vendidoPorCultura = Object.entries(precoCultura).map(([c, p]) => ({cultura: c, vendido: p.sc, preco: p.rs / p.sc, produzido: col.filter(x => x.cultura.toLowerCase() === c).reduce((s, x) => s + x.kg / KG_SACA_GRAO, 0)}));
  return {linhas, cs, vend, col, areaTotal, vendidoPorCultura, culturasSemVenda: [...new Set(col.map(c => c.cultura.toLowerCase()))].filter(c => !precoCultura[c])};
}

VIEWS.producao = () => {
  const safras = safrasConhecidas();
  if (!prodSafra || !safras.includes(prodSafra)) prodSafra = safras[0] || '';
  const a = prodSafra ? analiseSafra(prodSafra) : null;
  const brl = v => v == null ? '—' : `${v < 0 ? '− ' : ''}R$ ${num(Math.abs(v), 2)}`;
  const tot = a ? a.linhas.reduce((t, l) => ({sacas: t.sacas + l.sacas, area: t.area + (l.sacas ? l.area : 0), custo: t.custo + l.custo, receita: l.receita != null ? t.receita + l.receita : t.receita, margem: l.margem != null ? t.margem + l.margem : t.margem}), {sacas: 0, area: 0, custo: 0, receita: 0, margem: 0}) : null;
  return head('Produção e margem', 'Colheita por talhão, vendas e resultado por safra', btn('+ Venda', 'pd-venda', '', 'secondary') + btn('+ Colheita', 'pd-colheita')) +
    (safras.length ? `<div class="filters">${safras.map(s => `<button class="${s === prodSafra ? 'active' : ''}" data-act="pd-safra" data-id="${esc(s)}">Safra ${esc(s)}</button>`).join('')}</div>` : '') +
    (!a || (!a.linhas.length && !a.vend.length) ? `<section class="card">${empty('Nada registrado nesta safra', 'Registre a colheita dos talhões e as vendas para ver produtividade, custo por saca e margem.', {act: 'pd-colheita', label: '+ Colheita'})}</section>` :
    `<section class="es-kpis">
      <article class="card kpi"><div class="label">Produção</div><div class="value">${num(tot.sacas, 0)} sc</div><div class="hint">${tot.area ? um1(tot.sacas / tot.area) + ' sc/ha em ' + num(tot.area) + ' ha colhidos' : 'sacas de 60 kg'}</div></article>
      <article class="card kpi"><div class="label">Custo por saca</div><div class="value">${tot.sacas ? brl(tot.custo / tot.sacas) : '—'}</div><div class="hint">custo dos talhões ${brl(tot.custo)}</div></article>
      <article class="card kpi"><div class="label">Receita estimada</div><div class="value">${brl(tot.receita)}</div><div class="hint">produção × preço médio de venda</div></article>
      <article class="card kpi ${tot.margem < 0 ? 'alerta' : ''}"><div class="label">Margem</div><div class="value">${brl(tot.margem)}</div><div class="hint">${tot.area ? brl(tot.margem / tot.area) + ' por ha' : ''}</div></article>
    </section>
    <div class="section-title"><h3>Por talhão</h3><label class="pd-rateio"><input type="checkbox" data-act="pd-rateio" ${prodRateio ? 'checked' : ''}> Ratear custos sem talhão pela área (${brl(a.cs.semTalhao)})</label></div>
    <section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Talhão</th><th class="num">Produção</th><th class="num">sc/ha</th><th class="num">Custo/ha</th><th class="num">Custo/sc</th><th class="num">Preço médio</th><th class="num">Margem/ha</th><th class="num">Equilíbrio</th></tr></thead><tbody>
      ${a.linhas.map(l => `<tr><td><strong>${esc(l.nome)}</strong><br><small style="color:var(--muted)">${esc([l.cultura, l.area ? num(l.area) + ' ha' : ''].filter(Boolean).join(' • '))}</small></td><td class="num">${l.sacas ? num(l.sacas, 0) + ' sc' : '—'}</td><td class="num">${l.scha != null && l.sacas ? um1(l.scha) : '—'}</td><td class="num">${l.custoHa != null ? brl(l.custoHa) : '—'}</td><td class="num">${l.custoSc != null ? brl(l.custoSc) : '—'}</td><td class="num">${l.preco != null ? brl(l.preco) : '—'}</td><td class="num">${l.margemHa != null ? `<strong>${brl(l.margemHa)}</strong>` : '—'}</td><td class="num">${l.equilibrio != null ? um1(l.equilibrio) + ' sc/ha' : '—'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="nota">Custo do talhão = gastos ligados a ele na safra + insumos aplicados (saídas do estoque, pelo custo médio). Equilíbrio = sacas por hectare que pagam o custo, ao preço médio de venda.${a.cs.insumosSemCusto ? ` ${a.cs.insumosSemCusto} saída(s) de insumo sem custo registrado não entram no custo.` : ''}${a.culturasSemVenda.length ? ` Sem venda registrada para: ${esc(a.culturasSemVenda.join(', '))} — receita e margem ficam em branco.` : ''}</p></section>
    <section class="grid">
      <article class="card panel"><h3>Vendas da safra</h3>${a.vend.length ? `<table class="tbl"><tbody>${a.vend.slice().sort(byDateDesc).map(v => `<tr><td>${fmtDate(v.date)}<br><small style="color:var(--muted)">${esc([v.cultura, v.comprador].filter(Boolean).join(' • '))}</small></td><td class="num">${num(v.sacas)} sc × ${brl(v.preco)}</td><td class="num"><strong>${brl(v.valor)}</strong></td><td>${mini('Excluir', 'pd-venda-del', v.id, 'del')}</td></tr>`).join('')}</tbody></table>` : 'Nenhuma venda nesta safra.'}</article>
      <article class="card panel"><h3>Saldo para vender</h3>${a.vendidoPorCultura.length || a.culturasSemVenda.length ? `<table class="tbl"><tbody>${[...a.vendidoPorCultura, ...a.culturasSemVenda.map(c => ({cultura: c, vendido: 0, produzido: a.col.filter(x => x.cultura.toLowerCase() === c).reduce((s, x) => s + x.kg / KG_SACA_GRAO, 0)}))].map(x => `<tr><td>${esc(x.cultura)}</td><td class="num">produzido ${num(x.produzido, 0)} sc</td><td class="num">vendido ${num(x.vendido, 0)} sc</td><td class="num"><strong>${num(x.produzido - x.vendido, 0)} sc</strong></td></tr>`).join('')}</tbody></table>` : 'Registre a colheita.'}</article>
    </section>`);
};

TITLES.producao = 'Produção e margem';
Object.assign(ACTIONS, {
  'pd-colheita': id => colheitaForm(id), 'pd-venda': vendaForm,
  'pd-safra': id => { prodSafra = id; render(); },
  'pd-rateio': () => { prodRateio = !prodRateio; render(); },
  'pd-venda-del': id => { const v = find('vendas', id); if (!v) return; confirmDialog('Excluir esta venda? A conta a receber ligada também será excluída.', () => { db.contas = db.contas.filter(c => c.id !== v.contaId); remove('vendas', id); }); }
});
