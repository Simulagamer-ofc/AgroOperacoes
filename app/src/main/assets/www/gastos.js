'use strict';
/* Controle de gastos: lançamentos de despesas por categoria, máquina, talhão e safra.
   Os custos de manutenção continuam lançados na própria ordem de manutenção e entram aqui somente para leitura
   (sem duplicar valores). Tudo fica no aparelho (db.expenses). */

const CAT_GASTO = ['Combustível', 'Peças', 'Mão de obra', 'Insumos', 'Serviços de terceiros', 'Frete', 'Energia', 'Arrendamento', 'Outros'];
const CAT_MANUT = 'Manutenção';
let gastoPeriodo = 'mes', gastoCat = '';

// Todos os custos com valor: despesas lançadas + manutenções com custo (data de conclusão, ou de abertura)
function lancamentosCusto(desde = '', ate = '9999') {
  const out = db.expenses.filter(g => Number(g.value) > 0).map(g => ({id: g.id, origem: 'gasto', date: g.date, value: Number(g.value), category: g.category || 'Outros', machineId: g.machineId || '', fieldId: g.fieldId || '', season: g.season || '', desc: g.description || ''}));
  db.maintenances.filter(m => Number(m.cost) > 0).forEach(m => out.push({id: m.id, origem: 'manutencao', date: m.doneDate || m.date || '', value: Number(m.cost), category: CAT_MANUT, machineId: m.machineId || '', fieldId: '', season: '', desc: m.description || 'Manutenção'}));
  return out.filter(x => x.date >= desde && x.date <= ate).sort((a, b) => b.date.localeCompare(a.date));
}
const somaValor = l => l.reduce((s, x) => s + x.value, 0);
const agrupar = (l, chave) => { const g = {}; l.forEach(x => { const k = chave(x); g[k] = (g[k] || 0) + x.value; }); return Object.entries(g).sort((a, b) => b[1] - a[1]); };

function gastoForm(g = {}) {
  openForm({
    title: g.id ? 'Editar gasto' : 'Lançar gasto',
    sub: 'Informe o valor do documento (nota, recibo ou boleto). Vincule à máquina e ao talhão quando houver.',
    values: {date: today(), ...g},
    fields: [
      {k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'category', label: 'Categoria', type: 'select', options: CAT_GASTO, required: true},
      {k: 'description', label: 'Descrição', placeholder: 'Ex.: Diesel S10 — 800 L', full: true, required: true},
      {k: 'value', label: 'Valor (R$)', type: 'number', min: 0, required: true},
      {k: 'supplier', label: 'Fornecedor'},
      {k: 'machineId', label: 'Máquina', type: 'select', options: () => db.machines.map(m => ({value: m.id, label: m.name}))},
      {k: 'fieldId', label: 'Talhão', type: 'select', options: fieldOptions},
      {k: 'season', label: 'Safra', placeholder: 'Ex.: 2026/27'},
      {k: 'doc', label: 'Documento', placeholder: 'Nº da nota ou recibo'},
      {k: 'notes', label: 'Observações', type: 'textarea'}
    ],
    onSubmit: v => {
      if (!(Number(v.value) > 0)) return 'Informe um valor maior que zero';
      // Safra do talhão quando não informada
      if (!v.season && v.fieldId) v.season = find('fields', v.fieldId)?.season || '';
      upsert('expenses', {...g, ...v, id: g.id || uid()});
      showToast('Gasto salvo');
    }
  });
}

const PERIODOS_GASTO = [['mes', 'Este mês'], ['30', '30 dias'], ['90', '90 dias'], ['365', '12 meses'], ['tudo', 'Tudo']];
function inicioPeriodoGasto() {
  if (gastoPeriodo === 'tudo') return '';
  if (gastoPeriodo === 'mes') return today().slice(0, 8) + '01';
  return daysAgo(Number(gastoPeriodo) - 1);
}

VIEWS.gastos = () => {
  const desde = inicioPeriodoGasto(), todos = lancamentosCusto(desde, today());
  const lista = gastoCat ? todos.filter(x => x.category === gastoCat) : todos;
  const total = somaValor(lista);
  const porCat = agrupar(todos, x => x.category), maxCat = Math.max(1, ...porCat.map(c => c[1]));
  const porMaq = agrupar(lista.filter(x => x.machineId), x => machineName(x.machineId) || 'Máquina removida');
  const porTalhao = agrupar(lista.filter(x => x.fieldId), x => x.fieldId);
  const semVinculo = somaValor(lista.filter(x => !x.machineId && !x.fieldId));
  const linha = x => {
    const vinc = [machineName(x.machineId), fieldName(x.fieldId), x.season].filter(Boolean).join(' • ');
    const acoes = x.origem === 'gasto' ? `<div class="row-actions">${mini('Editar', 'gs-edit', x.id)}${mini('Excluir', 'gs-del', x.id, 'del')}</div>` : `<div class="row-actions">${mini('Abrir manutenção', 'mt-edit', x.id)}</div>`;
    return `<tr><td>${fmtDate(x.date)}</td><td><strong>${esc(x.desc)}</strong>${vinc ? `<br><small style="color:var(--muted)">${esc(vinc)}</small>` : ''}</td><td>${chip(x.category, x.origem === 'manutencao' ? 'orange' : 'blue')}</td><td class="num">R$ ${num(x.value, 2)}</td><td>${acoes}</td></tr>`;
  };
  const rotPeriodo = desde ? `desde ${fmtDate(desde)}` : 'todos os lançamentos';
  return head('Controle de gastos', `${lista.length} lançamento(s) • ${rotPeriodo}`, btn('Exportar (CSV)', 'gs-csv', '', 'secondary') + btn('+ Lançar gasto', 'gs-new')) +
    `<div class="filters">${PERIODOS_GASTO.map(([k, r]) => `<button class="${k === gastoPeriodo ? 'active' : ''}" data-act="gs-periodo" data-id="${k}">${r}</button>`).join('')}</div>
    <section class="kpis">
      <article class="card kpi"><div class="label">${gastoCat ? esc(gastoCat) : 'Total de gastos'}</div><div class="value">R$ ${num(total, 2)}</div><div class="hint">${esc(rotPeriodo)}</div></article>
      <article class="card kpi"><div class="label">Manutenção</div><div class="value">R$ ${num(somaValor(todos.filter(x => x.origem === 'manutencao')), 2)}</div><div class="hint">lançado nas ordens de manutenção</div></article>
      <article class="card kpi"><div class="label">Outras despesas</div><div class="value">R$ ${num(somaValor(todos.filter(x => x.origem === 'gasto')), 2)}</div><div class="hint">lançadas nesta tela</div></article>
    </section>
    <section class="grid">
      <article class="card panel"><h3>Por categoria</h3>${porCat.length ? `<table class="tbl"><tbody>${porCat.map(([c, v]) => `<tr class="clickable" data-act="gs-cat" data-id="${esc(c === gastoCat ? '' : c)}" style="cursor:pointer"><td>${c === gastoCat ? '<strong>' + esc(c) + '</strong>' : esc(c)}</td><td style="width:40%"><div class="bar"><span style="width:${v / maxCat * 100}%"></span></div></td><td class="num">R$ ${num(v, 2)}</td></tr>`).join('')}</tbody></table><p class="nota">${gastoCat ? 'Toque na categoria de novo para ver todas.' : 'Toque numa categoria para filtrar a lista.'}</p>` : 'Nenhum gasto no período.'}</article>
      <article class="card panel"><h3>Por máquina e talhão</h3>${porMaq.length || porTalhao.length ? `<table class="tbl"><tbody>${porMaq.map(([n, v]) => `<tr><td>⚙ ${esc(n)}</td><td class="num">R$ ${num(v, 2)}</td><td></td></tr>`).join('')}${porTalhao.map(([id, v]) => { const f = find('fields', id); return `<tr><td>▤ ${esc(f?.name || 'Talhão removido')}</td><td class="num">R$ ${num(v, 2)}</td><td class="num">${Number(f?.area) > 0 ? `R$ ${num(v / f.area, 2)}/ha` : ''}</td></tr>`; }).join('')}</tbody></table>${semVinculo ? `<p class="nota">R$ ${num(semVinculo, 2)} sem máquina nem talhão vinculados.</p>` : ''}` : 'Nenhum gasto vinculado a máquina ou talhão no período.'}</article>
    </section>
    <div class="section-title"><h3>Lançamentos${gastoCat ? ' — ' + esc(gastoCat) : ''}</h3></div>
    <section class="card panel">${lista.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th></th></tr></thead><tbody>${lista.map(linha).join('')}</tbody></table></div>` : empty('Nenhum gasto no período', 'Lance combustível, peças, mão de obra, insumos e serviços para acompanhar o custo da operação.', {act: 'gs-new', label: '+ Lançar gasto'})}</section>`;
};

function exportarGastosCsv() {
  const cols = [['Data', x => fmtDate(x.date)], ['Categoria', x => x.category], ['Descrição', x => x.desc], ['Valor (R$)', x => x.value], ['Máquina', x => machineName(x.machineId)], ['Talhão', x => fieldName(x.fieldId)], ['Safra', x => x.season], ['Fornecedor', x => x.origem === 'gasto' ? find('expenses', x.id)?.supplier : ''], ['Documento', x => x.origem === 'gasto' ? find('expenses', x.id)?.doc : ''], ['Origem', x => x.origem === 'gasto' ? 'Gasto lançado' : 'Ordem de manutenção']];
  const cell = v => { const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const linhas = lancamentosCusto(inicioPeriodoGasto(), today()).filter(x => !gastoCat || x.category === gastoCat);
  downloadFile(`agro-gastos-${today()}.csv`, 'text/csv', '﻿' + [cols.map(c => c[0]).join(';'), ...linhas.map(r => cols.map(c => cell(c[1](r))).join(';'))].join('\r\n'));
}

TITLES.gastos = 'Controle de gastos';
Object.assign(ACTIONS, {
  'gs-new': () => gastoForm(),
  'gs-talhao': id => gastoForm({fieldId: id}),
  'gs-edit': id => gastoForm(find('expenses', id)),
  'gs-del': id => confirmDialog('Excluir este gasto?', () => remove('expenses', id)),
  'gs-periodo': id => { gastoPeriodo = id; gastoCat = ''; render(); },
  'gs-cat': id => { gastoCat = id; render(); },
  'gs-csv': exportarGastosCsv
});
