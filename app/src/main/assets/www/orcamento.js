'use strict';
/* MercaPlant — Planejado x realizado da safra.
   Orçamento por talhão em R$/ha por categoria, comparado com o custo já lançado no talhão na safra
   (gastos ligados ao talhão + insumos aplicados pelo custo médio — os mesmos números de Produção e margem).
   Só para quem vê o financeiro. Os orçamentos ficam na coleção "orcamentos" e vão para a nuvem como os demais registros. */
const ORC_CATS = ['Sementes', 'Fertilizantes', 'Defensivos', 'Combustível', 'Mão de obra', 'Manutenção e peças', 'Serviços e frete', 'Arrendamento', 'Outros'];
// De onde vem o realizado de cada categoria
const ORC_DE_ESTOQUE = {'Semente': 'Sementes', 'Tratamento de sementes': 'Sementes', 'Fertilizante': 'Fertilizantes', 'Defensivo': 'Defensivos', 'Combustível': 'Combustível', 'Peças': 'Manutenção e peças'};
const ORC_DE_GASTO = {'Combustível': 'Combustível', 'Peças': 'Manutenção e peças', 'Manutenção': 'Manutenção e peças', 'Mão de obra': 'Mão de obra', 'Serviços de terceiros': 'Serviços e frete', 'Frete': 'Serviços e frete', 'Arrendamento': 'Arrendamento'};
const orcVeFin = () => typeof nvVeFinanceiro !== 'function' || nvVeFinanceiro();
const orcamentoDe = (season, fieldId) => db.orcamentos.find(o => o.season === season && o.fieldId === fieldId);
const planejadoHa = o => o ? ORC_CATS.reduce((s, c) => s + (Number(o.valores?.[c]) || 0), 0) : 0;
const brlOrc = v => `${v < 0 ? '− ' : ''}R$ ${num(Math.abs(v), 2)}`;

function realizadoPorCategoria(season, fieldId) {
  const out = Object.fromEntries(ORC_CATS.map(c => [c, 0]));
  db.expenses.filter(g => g.fieldId === fieldId && (g.season || safraDoTalhao(g.fieldId)) === season && Number(g.value) > 0)
    .forEach(g => { out[ORC_DE_GASTO[g.category] || 'Outros'] += Number(g.value); });
  db.movements.filter(m => m.kind === 'Saída' && m.fieldId === fieldId && (m.season || safraDoTalhao(m.fieldId)) === season && Number(m.value) > 0)
    .forEach(m => { out[ORC_DE_ESTOQUE[find('stock', m.itemId)?.category] || 'Outros'] += Number(m.value); });
  return out;
}

// Linhas da safra: talhões da safra + os que têm orçamento ou custo nela
function planejamentoSafra(season) {
  const ids = new Set([...db.fields.filter(f => f.season === season).map(f => f.id), ...db.orcamentos.filter(o => o.season === season).map(o => o.fieldId),
    ...Object.keys(typeof custosSafra === 'function' ? custosSafra(season).porTalhao : {})]);
  const linhas = [...ids].map(id => {
    const f = find('fields', id), area = Number(f?.area) || 0, o = orcamentoDe(season, id), porCat = realizadoPorCategoria(season, id);
    const planHa = planejadoHa(o), plan = planHa * area, real = Object.values(porCat).reduce((s, v) => s + v, 0);
    return {id, nome: f?.name || 'Talhão removido', area, cultura: f?.crop || '', o, planHa, plan, real, porCat, pct: plan > 0 ? real / plan * 100 : null};
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const plan = linhas.reduce((s, l) => s + l.plan, 0), real = linhas.reduce((s, l) => s + l.real, 0);
  return {linhas, plan, real, pct: plan > 0 ? real / plan * 100 : null, semPlano: linhas.filter(l => !l.plan).length};
}
const corPct = p => p == null ? '' : p > 100 ? 'acima' : p >= 90 ? 'perto' : 'ok';
const barraOrc = p => p == null ? '<small class="nota">sem planejamento</small>'
  : `<div class="orc-barra ${corPct(p)}" title="${num(Math.round(p))}% do planejado"><span style="width:${Math.min(100, p)}%"></span></div><small class="orc-pct ${corPct(p)}">${num(Math.round(p))}%</small>`;

// Seção dentro de Produção e margem
function secaoOrcamento(season) {
  if (!season || !orcVeFin()) return '';
  const p = planejamentoSafra(season);
  if (!p.linhas.length) return '';
  const acima = p.linhas.filter(l => l.pct > 100);
  return `<div class="section-title"><h3>Planejado x realizado</h3>${btn('Planejar safra', 'orc-editar', p.linhas[0].id, 'secondary')}</div>
    <section class="card panel orc">
      <div class="orc-topo"><div><small>Planejado</small><strong>${p.plan ? brlOrc(p.plan) : '—'}</strong></div><div><small>Realizado</small><strong>${brlOrc(p.real)}</strong></div>
        <div><small>Saldo</small><strong class="${p.plan && p.real > p.plan ? 'neg' : ''}">${p.plan ? brlOrc(p.plan - p.real) : '—'}</strong></div><div class="orc-topo-barra">${barraOrc(p.pct)}</div></div>
      ${acima.length ? `<p class="orc-aviso">⚠ ${acima.length === 1 ? `<b>${esc(acima[0].nome)}</b> passou` : `<b>${acima.length} talhões</b> passaram`} do planejado.</p>` : ''}
      ${p.semPlano ? `<p class="nota">${p.semPlano} ${p.semPlano === 1 ? 'talhão está' : 'talhões estão'} sem planejamento: toque em "Planejar" para definir o orçamento em R$/ha.</p>` : ''}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Talhão</th><th class="num">Planejado</th><th class="num">Realizado</th><th>Uso do orçamento</th><th></th></tr></thead><tbody>
      ${p.linhas.map(l => `<tr class="clickable" data-act="nav" data-id="orcamento/${esc(l.id)}"><td><strong>${esc(l.nome)}</strong><br><small style="color:var(--muted)">${esc([l.cultura, l.area ? num(l.area) + ' ha' : ''].filter(Boolean).join(' • '))}</small></td>
        <td class="num">${l.plan ? `${brlOrc(l.plan)}<br><small style="color:var(--muted)">${brlOrc(l.planHa)}/ha</small>` : '—'}</td>
        <td class="num">${brlOrc(l.real)}${l.area ? `<br><small style="color:var(--muted)">${brlOrc(l.real / l.area)}/ha</small>` : ''}</td>
        <td class="orc-uso">${barraOrc(l.pct)}</td><td>${mini(l.plan ? 'Detalhar' : 'Planejar', l.plan ? 'nav' : 'orc-editar', l.plan ? `orcamento/${l.id}` : l.id)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="nota">Realizado = gastos lançados com o talhão e a safra + insumos aplicados no talhão (pelo custo médio do estoque). Toque no talhão para ver por categoria.</p>
    </section>`;
}

// Detalhe de um talhão: por categoria
VIEWS.orcamento = fieldId => {
  const season = prodSafra || safraDoTalhao(fieldId), f = find('fields', fieldId);
  if (!orcVeFin()) return head('Planejado x realizado', '') + `<section class="card">${empty('Sem acesso', 'Seu nível de acesso não mostra valores financeiros.')}</section>`;
  if (!season) return head('Planejado x realizado', '', btn('← Produção', 'nav', 'producao', 'secondary')) + `<section class="card">${empty('Defina a safra do talhão', 'Edite o talhão e informe a safra (ex.: 2026/27).')}</section>`;
  const l = planejamentoSafra(season).linhas.find(x => x.id === fieldId) || {nome: f?.name || 'Talhão', area: Number(f?.area) || 0, planHa: 0, plan: 0, real: 0, porCat: realizadoPorCategoria(season, fieldId), pct: null, o: null};
  const linhasCat = ORC_CATS.map(c => {
    const planHa = Number(l.o?.valores?.[c]) || 0, plan = planHa * l.area, real = l.porCat[c] || 0;
    return {c, planHa, plan, real, pct: plan > 0 ? real / plan * 100 : (real > 0 ? null : undefined)};
  }).filter(x => x.plan > 0 || x.real > 0);
  return head(`${l.nome} — safra ${season}`, `Planejado x realizado${l.area ? ` • ${num(l.area)} ha` : ''}`, btn('← Produção', 'nav', 'producao', 'secondary') + btn(l.plan ? 'Editar planejamento' : 'Planejar', 'orc-editar', fieldId)) +
    `<section class="es-kpis">
      <article class="card kpi"><div class="label">Planejado</div><div class="value">${l.plan ? brlOrc(l.plan) : '—'}</div><div class="hint">${l.plan ? brlOrc(l.planHa) + ' por ha' : 'sem planejamento'}</div></article>
      <article class="card kpi"><div class="label">Realizado</div><div class="value">${brlOrc(l.real)}</div><div class="hint">${l.area ? brlOrc(l.real / l.area) + ' por ha' : ''}</div></article>
      <article class="card kpi ${l.plan && l.real > l.plan ? 'alerta' : ''}"><div class="label">Saldo</div><div class="value">${l.plan ? brlOrc(l.plan - l.real) : '—'}</div><div class="hint">${l.pct != null ? num(Math.round(l.pct)) + '% do orçamento usado' : ''}</div></article>
    </section>
    <section class="card panel">${linhasCat.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Categoria</th><th class="num">Planejado</th><th class="num">Realizado</th><th>Uso</th><th class="num">Saldo</th></tr></thead><tbody>
      ${linhasCat.map(x => `<tr><td><strong>${esc(x.c)}</strong>${x.planHa ? `<br><small style="color:var(--muted)">${brlOrc(x.planHa)}/ha</small>` : ''}</td><td class="num">${x.plan ? brlOrc(x.plan) : '—'}</td><td class="num">${brlOrc(x.real)}</td>
        <td class="orc-uso">${x.plan ? barraOrc(x.pct) : '<small class="orc-pct acima">não planejado</small>'}</td><td class="num ${x.plan && x.real > x.plan ? 'neg' : ''}">${x.plan ? brlOrc(x.plan - x.real) : '—'}</td></tr>`).join('')}
      </tbody></table></div>` : empty('Nada planejado nem lançado', 'Planeje o orçamento por hectare e lance os gastos e as saídas de insumos com este talhão.', {act: 'orc-editar', id: fieldId, label: 'Planejar'})}</section>`;
};
TITLES.orcamento = 'Planejado x realizado';

function orcamentoForm(fieldId) {
  const season = prodSafra || safraDoTalhao(fieldId);
  if (!season) return showToast('Defina a safra do talhão primeiro (Talhões → editar).', true);
  const f = find('fields', fieldId), o = orcamentoDe(season, fieldId);
  const outros = db.fields.filter(x => x.season === season && x.id !== fieldId);
  openForm({
    title: `Planejar ${f?.name || 'talhão'} — safra ${season}`,
    sub: `Quanto você prevê gastar por hectare em cada item${f?.area ? ` (${num(f.area)} ha)` : ''}. Deixe em branco o que não se aplica.`,
    values: {...Object.fromEntries(ORC_CATS.map((c, i) => [`c${i}`, o?.valores?.[c] ?? ''])), aplicar: 'este'},
    fields: [...ORC_CATS.map((c, i) => ({k: `c${i}`, label: `${c} (R$/ha)`, type: 'number', min: 0, placeholder: '0,00'})),
      ...(outros.length ? [{k: 'aplicar', label: 'Usar este planejamento em', type: 'select', required: true, full: true, options: [
        {value: 'este', label: 'Só neste talhão'}, {value: 'vazios', label: `Este e os talhões da safra sem planejamento (${outros.filter(x => !orcamentoDe(season, x.id)).length})`},
        {value: 'todos', label: `Todos os ${outros.length + 1} talhões da safra (substitui os planejamentos)`}]}] : [])],
    onSubmit: v => {
      const valores = Object.fromEntries(ORC_CATS.map((c, i) => [c, v[`c${i}`] === '' ? 0 : Number(v[`c${i}`]) || 0]).filter(([, x]) => x > 0));
      const alvo = [fieldId, ...(v.aplicar === 'todos' ? outros.map(x => x.id) : v.aplicar === 'vazios' ? outros.filter(x => !orcamentoDe(season, x.id)).map(x => x.id) : [])];
      alvo.forEach(id => {
        const atual = orcamentoDe(season, id);
        if (atual) Object.assign(atual, {valores, atualizado: today()});
        else db.orcamentos.push({id: uid(), season, fieldId: id, valores, atualizado: today()});
      });
      save();
      showToast(alvo.length > 1 ? `Planejamento salvo em ${alvo.length} talhões` : `Planejamento salvo: ${brlOrc(Object.values(valores).reduce((s, x) => s + x, 0))}/ha`);
    }
  });
}
Object.assign(ACTIONS, {'orc-editar': id => orcamentoForm(id)});
