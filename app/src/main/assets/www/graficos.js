'use strict';
/* Painel de indicadores da Visão Geral — gráficos em HTML/CSS (sem bibliotecas, funcionam offline).
   Paleta categórica validada (claro e escuro) com o validador de daltonismo; ordem fixa por entidade. */

const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']];
const periodoSalvo = Number(safeStorage.get('agro-periodo-graf'));
let periodoGraf = PERIODOS.some(([d]) => d === periodoSalvo) ? periodoSalvo : 30;
// Situação da operação → slot fixo da paleta (a cor segue a situação, nunca a posição)
const COR_SITUACAO = {'Programada': 1, 'Em andamento': 2, 'Concluída': 3, 'Cancelada': 4};

const fmtDia = iso => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDate(d); }; // data local (toISOString seria UTC)
// Teto "redondo" para o eixo: 1, 2, 2,5, 5 × 10ⁿ
function tetoEixo(max) {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map(f => f * p).find(v => v >= max);
}
const tip = (titulo, valor) => `data-tip="${esc(titulo)}" data-tip-valor="${esc(valor)}" tabindex="0"`;
const tabela = (cab, linhas) => `<details class="viz-tab"><summary>Ver tabela</summary><div class="tbl-wrap"><table class="tbl"><thead><tr>${cab.map((c, i) => `<th${i ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
const cartao = (titulo, sub, corpo) => `<article class="card panel viz-card"><h3>${esc(titulo)}</h3><p class="viz-sub">${esc(sub)}</p>${corpo}</article>`;
const semDados = txt => `<p class="viz-vazio">${esc(txt)}</p>`;

// 1) Área trabalhada: colunas por dia (7 dias) ou por semana (30/90 dias)
function graficoArea(ini, fim) {
  const ops = db.operations.filter(o => o.status === 'Concluída' && Number(o.area) > 0 && o.date >= ini && o.date <= fim);
  const passo = periodoGraf <= 7 ? 1 : 7;
  const grupos = [];
  for (let d = ini; d <= fim; d = addDias(d, passo)) grupos.push({de: d, ate: addDias(d, passo - 1) > fim ? fim : addDias(d, passo - 1), ha: 0});
  ops.forEach(o => { const g = grupos.find(x => o.date >= x.de && o.date <= x.ate); if (g) g.ha += Number(o.area); });
  const total = grupos.reduce((s, g) => s + g.ha, 0);
  const sub = `Operações concluídas • total ${num(total)} ha de operações (inclui passagens no mesmo talhão)`;
  if (!total) return cartao('Área trabalhada', sub, semDados('Nenhuma operação concluída com área informada no período.'));
  const teto = tetoEixo(Math.max(...grupos.map(g => g.ha)));
  const maior = grupos.reduce((a, g) => g.ha > a.ha ? g : a);
  const rot = g => passo === 1 ? fmtDia(g.de) : `${fmtDia(g.de)}–${fmtDia(g.ate)}`;
  const marcaX = i => grupos.length <= 8 || i % Math.ceil(grupos.length / 6) === 0 || i === grupos.length - 1;
  const corpo = `<div class="viz-col" role="img" aria-label="Área trabalhada por ${passo === 1 ? 'dia' : 'semana'}: total ${num(total)} hectares">
      <div class="viz-eixo-y"><span>${num(teto)}</span><span>${num(teto / 2)}</span><span>0</span></div>
      <div class="viz-plot"><div class="viz-grade"><i></i><i></i><i></i></div>
        ${grupos.map((g, i) => `<div class="viz-slot" ${tip(rot(g), num(g.ha) + ' ha')}>${g === maior ? `<b class="viz-rot" style="bottom:${g.ha / teto * 100}%">${num(g.ha)}</b>` : ''}<span class="viz-barra s1" style="height:${g.ha / teto * 100}%"></span><em>${marcaX(i) ? esc(passo === 1 ? fmtDia(g.de) : fmtDia(g.de)) : ''}</em></div>`).join('')}
      </div></div><p class="viz-unid">ha por ${passo === 1 ? 'dia' : 'semana (início)'}</p>`;
  return cartao('Área trabalhada', sub, corpo + tabela([passo === 1 ? 'Dia' : 'Semana', 'Área (ha)'], grupos.map(g => [rot(g), num(g.ha)])));
}

// 2) Horas trabalhadas por máquina (lançamentos de horímetro do período)
function graficoHoras(ini, fim) {
  const porMaq = {};
  db.hourLogs.filter(h => h.date >= ini && h.date <= fim).forEach(h => {
    const d = Number(h.hours) - Number(h.previous || 0);
    if (d > 0) porMaq[h.machineId] = (porMaq[h.machineId] || 0) + d;
  });
  let linhas = Object.entries(porMaq).map(([id, h]) => [machineName(id) || 'Máquina removida', h]).sort((a, b) => b[1] - a[1]);
  if (linhas.length > 7) linhas = [...linhas.slice(0, 6), ['Outras', linhas.slice(6).reduce((s, l) => s + l[1], 0)]];
  const total = linhas.reduce((s, l) => s + l[1], 0);
  const sub = `Pelo horímetro • total ${num(total)} h`;
  if (!linhas.length) return cartao('Horas por máquina', sub, semDados('Nenhum registro de horímetro no período. Use “Registrar horímetro”.'));
  const teto = tetoEixo(Math.max(...linhas.map(([, h]) => h))); // Inclui o grupo Outras na escala.
  const corpo = `<div class="viz-barras" role="img" aria-label="Horas trabalhadas por máquina">${linhas.map(([n, h]) =>
    `<div class="viz-linha" ${tip(n, num(h) + ' h')}><span class="viz-nome">${esc(n)}</span><span class="viz-trilho"><span class="viz-barra h s1" style="width:${h / teto * 100}%"></span></span><span class="viz-valor">${num(h)} h</span></div>`).join('')}</div>`;
  return cartao('Horas por máquina', sub, corpo + tabela(['Máquina', 'Horas'], linhas.map(([n, h]) => [n, num(h)])));
}

// 3) Operações do período por situação (parte do todo: barra empilhada 100%)
function graficoSituacao(ini, fim) {
  const ops = db.operations.filter(o => o.date >= ini && o.date <= fim);
  const cont = OP_STATUS.map(s => [s, ops.filter(o => o.status === s).length]);
  const sub = `${ops.length} ${ops.length === 1 ? 'operação' : 'operações'} com data no período`;
  if (!ops.length) return cartao('Operações por situação', sub, semDados('Nenhuma operação com data no período.'));
  const pct = n => n / ops.length * 100;
  const corpo = `<div class="viz-pilha" role="img" aria-label="Operações por situação">${cont.filter(([, n]) => n).map(([s, n]) =>
    `<span class="viz-seg s${COR_SITUACAO[s]}" style="flex:${n}" ${tip(s, `${n} (${num(pct(n), 0)}%)`)}>${pct(n) >= 14 ? `<b>${n}</b>` : ''}</span>`).join('')}</div>
    <ul class="viz-legenda">${cont.map(([s, n]) => `<li><i class="s${COR_SITUACAO[s]}"></i><strong>${n}</strong> ${esc(s)}</li>`).join('')}</ul>`;
  return cartao('Operações por situação', sub, corpo + tabela(['Situação', 'Operações', '%'], cont.map(([s, n]) => [s, n, num(pct(n), 0) + '%'])));
}

// 4) Estoque × mínimo (medidores: trilho do mesmo tom, marca no mínimo; abaixo do mínimo = alerta com ícone e texto)
function graficoEstoque() {
  const itens = db.stock.filter(s => Number(s.min) > 0).map(s => ({s, r: Number(s.qty) / Number(s.min)})).sort((a, b) => a.r - b.r).slice(0, 6);
  const sub = 'Itens com estoque mínimo definido, do mais crítico ao mais folgado';
  if (!itens.length) return cartao('Estoque × mínimo', sub, semDados('Defina o estoque mínimo dos itens em Estoque e Insumos.'));
  const corpo = `<div class="viz-medidores">${itens.map(({s, r}) => {
    const escala = Math.max(Number(s.qty), Number(s.min) * 2), baixo = stockLow(s), perto = estoquePerto(s);
    return `<div class="viz-medidor" ${tip(s.name, `${num(s.qty)} ${s.unit} • mínimo ${num(s.min)} ${s.unit}`)}>
      <div class="viz-med-topo"><span>${esc(s.name)}</span><span class="viz-valor">${baixo ? '<b class="viz-alerta">! abaixo do mínimo</b> ' : perto ? '<b class="viz-aviso">perto do mínimo</b> ' : ''}${num(s.qty)} / ${num(s.min)} ${esc(s.unit)}</span></div>
      <div class="viz-trilho med"><span class="viz-barra h ${baixo ? 'crit' : perto ? 's2' : 's1'}" style="width:${Math.min(100, Number(s.qty) / escala * 100)}%"></span><i class="viz-min" style="left:${Number(s.min) / escala * 100}%" title="mínimo"></i></div></div>`;
  }).join('')}</div><p class="viz-unid">Traço vertical = estoque mínimo</p>`;
  return cartao('Estoque × mínimo', sub, corpo + tabela(['Item', 'Saldo', 'Mínimo'], itens.map(({s}) => [s.name, `${num(s.qty)} ${s.unit}`, `${num(s.min)} ${s.unit}`])));
}

// ---------- Painel aprovado: custos, evolução mensal, situação e insumos em atenção ----------
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const periodoPainel = () => { const fim = today(); return {ini: addDias(fim, -(periodoGraf - 1)), fim}; };
const operacoesPainel = (ini, fim) => db.operations.filter(o => o.date >= ini && o.date <= fim);
const insumosAtencao = () => db.stock.filter(s => stockLow(s) || estoquePerto(s))
  .sort((a, b) => Number(a.qty) / Number(a.min) - Number(b.qty) / Number(b.min) || String(a.name).localeCompare(String(b.name), 'pt-BR'));
const cartaoPainel = (titulo, sub, corpo) => `<article class="nx-panel"><h3>${esc(titulo)}</h3><p class="nx-caption">${esc(sub)}</p>${corpo}</article>`;
const dinheiroPainel = v => 'R$ ' + num(v, Number.isInteger(v) ? 0 : 2);

function custosCategorias(ini, fim) {
  const lanc = lancamentosCusto(ini, fim), todas = agrupar(lanc, x => x.category);
  const linhas = todas.length > 4 ? [...todas.slice(0, 3), ['Outras despesas', somaValor(lanc.filter(x => !todas.slice(0, 3).some(([n]) => n === x.category)))]] : todas;
  const max = Math.max(1, ...linhas.map(([, v]) => v));
  const barras = linhas.length ? `<div class="nx-cost-rows" role="img" aria-label="Custos por categoria em reais">${linhas.map(([n, v]) => `<div>
      <div class="nx-row-head"><span>${esc(n)}</span><b>${dinheiroPainel(v)}</b></div>
      <div class="nx-track"><div class="nx-fill" style="width:${v / max * 100}%"></div></div></div>`).join('')}</div>` : semDados('Nenhum custo registrado no período.');
  const previsto = custoManutPrevisto();
  return cartaoPainel('Custos por categoria', `Despesas e manutenções concluídas · ${periodoGraf} dias`, barras +
    (previsto ? `<p class="nx-detail">Fora do total: ${dinheiroPainel(previsto)} em manutenções abertas (previsão).</p>` : '') +
    (todas.length > 4 ? tabela(['Categoria', 'Custo (R$)'], todas.map(([n, v]) => [n, num(v, 2)])) : ''));
}

function custosMes() {
  const fim = today(), hoje = new Date(fim + 'T12:00:00');
  const meses = Array.from({length: 6}, (_, i) => new Date(hoje.getFullYear(), hoje.getMonth() - 5 + i, 1));
  const lanc = lancamentosCusto(isoDate(meses[0]), fim);
  const valores = meses.map(d => { const prefixo = isoDate(d).slice(0, 7); return {nome: MESES[d.getMonth()], ano: d.getFullYear(), valor: somaValor(lanc.filter(x => x.date.startsWith(prefixo)))}; });
  const max = Math.max(0, ...valores.map(m => m.valor));
  const divisor = max >= 1e6 ? 1e6 : max >= 1000 ? 1000 : 1;
  const unidade = divisor === 1e6 ? 'R$ milhões' : divisor === 1000 ? 'R$ mil' : 'R$';
  const barras = max > 0 ? `<div class="nx-months" role="group" aria-label="Custos dos últimos seis meses, ${unidade}">${valores.map((m, i) =>
    `<button type="button" class="nx-month" aria-label="${esc(`${m.nome}/${m.ano}: ${dinheiroPainel(m.valor)}${i === 5 ? ', mês em andamento' : ''}`)}" ${tip(`${m.nome}/${m.ano}${i === 5 ? ' · até ' + fmtDate(fim) : ''}`, dinheiroPainel(m.valor))}>
      <b>${num(m.valor / divisor)}</b><span class="nx-column" style="height:${m.valor / max * 140}px"></span><small>${m.nome}${i === 5 ? '*' : ''}</small></button>`).join('')}</div>` : semDados('Nenhum custo registrado nos últimos seis meses.');
  return cartaoPainel('Evolução mensal dos custos', `Últimos 6 meses · valores em ${unidade}`, barras +
    `<p class="nx-detail">* ${esc(MESES[hoje.getMonth()])}/${hoje.getFullYear()} até ${fmtDate(fim)} · mês em andamento</p>`);
}

function roscaSituacao(ini, fim) {
  const ops = operacoesPainel(ini, fim), total = ops.length;
  const cont = OP_STATUS.map(s => [s, ops.filter(o => o.status === s).length]);
  const cores = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
  let acumulado = 0;
  const gradiente = cont.map(([, n], i) => { const de = acumulado; acumulado += total ? n / total * 100 : 0; return `${cores[i]} ${de}% ${acumulado}%`; }).join(',');
  const corpo = total ? `<div class="nx-status-area"><div class="nx-status-ring" role="img" aria-label="${esc(cont.map(([s, n]) => `${s}: ${n}`).join(', '))}" style="background:conic-gradient(${gradiente})"><div class="nx-status-hole"><b>${total}</b><span class="nx-caption">operações</span></div></div>
      <div class="nx-status-legend">${cont.map(([s, n]) => `<div><span>${esc(s === 'Programada' ? 'Planejadas' : s === 'Concluída' ? 'Concluídas' : s === 'Cancelada' ? 'Canceladas' : s)}</span><b>${n}</b></div>`).join('')}</div></div>` : semDados('Nenhuma operação com data no período.');
  return cartaoPainel('Situação das operações', `Operações com data nos últimos ${periodoGraf} dias`, corpo);
}

function estoqueInsumos() {
  const itens = insumosAtencao(), exibidos = itens.slice(0, 2);
  const corpo = exibidos.length ? exibidos.map(s => {
    const qtd = Number(s.qty), min = Number(s.min), unidade = esc(s.unit);
    const situacao = qtd < min ? `Abaixo do mínimo de ${num(min)} ${unidade} · faltam ${num(min - qtd)} ${unidade}` : qtd === min ? `No mínimo de ${num(min)} ${unidade}` : `Perto do mínimo de ${num(min)} ${unidade}`;
    return `<div class="nx-stock-row"><div class="nx-row-head"><span>${esc(s.name)}</span><b>${num(qtd)} ${unidade}</b></div>
      <div class="nx-track"><div class="nx-fill nx-stock-fill" style="width:${Math.max(0, Math.min(100, qtd / (min * 2) * 100))}%"></div></div><p class="nx-warning">${situacao}</p></div>`;
  }).join('') : semDados(db.stock.length ? 'Nenhum insumo abaixo ou perto do mínimo.' : 'Nenhum insumo cadastrado.');
  return cartaoPainel('Insumos que precisam de atenção', 'Saldo atual · comparação com estoque mínimo', corpo +
    `<button type="button" class="nx-stock-link" data-act="nav" data-id="estoque">Ver todos os insumos${itens.length > 2 ? ` (${itens.length} em atenção)` : ''} →</button>`);
}

function painelNexus() {
  const {ini, fim} = periodoPainel(), custo = somaValor(lancamentosCusto(ini, fim));
  const concluidas = operacoesPainel(ini, fim).filter(o => o.status === 'Concluída').length, atencao = insumosAtencao().length;
  return `<section class="nx-dashboard viz-root"><header class="nx-dashboard-head"><div><h2>Centro de operações</h2><p class="nx-caption">${esc(db.settings.farm || 'Minha fazenda')}</p></div>
      <div class="nx-periods" role="group" aria-label="Período do painel">${PERIODOS.map(([d, label]) => `<button type="button" class="${d === periodoGraf ? 'active' : ''}" data-act="graf-periodo" data-id="${d}" aria-pressed="${d === periodoGraf}">${label}</button>`).join('')}</div></header>
    <section class="nx-dashboard-kpis" aria-label="Resumo do painel">
      <article class="nx-panel nx-stat"><p class="nx-caption">Custos no período</p><div class="nx-metric">${dinheiroPainel(custo)}</div><p class="nx-caption">Últimos ${periodoGraf} dias</p></article>
      <article class="nx-panel nx-stat"><p class="nx-caption">Operações concluídas</p><div class="nx-metric">${concluidas}</div><p class="nx-caption">No período selecionado</p></article>
      <article class="nx-panel nx-stat"><p class="nx-caption">Estoque em atenção</p><div class="nx-metric">${atencao} ${atencao === 1 ? 'item' : 'itens'}</div><p class="nx-caption">Saldo atual</p></article>
    </section><section class="nx-dashboard-grid">${custosCategorias(ini, fim)}${custosMes()}${roscaSituacao(ini, fim)}${estoqueInsumos()}</section></section>`;
}

function painelGraficos() {
  const {ini, fim} = periodoPainel();
  return `<div class="section-title"><h3>Indicadores adicionais · últimos ${periodoGraf} dias</h3></div>
    <section class="viz-root viz-grid">${graficoArea(ini, fim)}${graficoHoras(ini, fim)}${graficoEstoque()}</section>`;
}

ACTIONS['graf-periodo'] = id => {
  const novo = Number(id);
  if (!PERIODOS.some(([d]) => d === novo)) return;
  periodoGraf = novo; safeStorage.set('agro-periodo-graf', String(periodoGraf)); render();
};

// Dica flutuante única (mouse e teclado); textos inseridos com textContent
(() => {
  const el = document.createElement('div');
  el.className = 'viz-tip'; el.id = 'grafico-dica'; el.setAttribute('role', 'tooltip');
  let fixado = null;
  const v = document.createElement('strong'), t = document.createElement('span');
  el.append(v, t); document.body.appendChild(el);
  const mostrar = (alvo, x, y) => {
    v.textContent = alvo.dataset.tipValor; t.textContent = alvo.dataset.tip;
    el.classList.add('on');
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px';
    el.style.top = Math.max(8, y - r.height - 12) + 'px';
  };
  const esconder = () => { fixado?.removeAttribute('aria-describedby'); fixado = null; el.classList.remove('on'); };
  document.addEventListener('click', e => {
    const a = e.target.closest?.('[data-tip]');
    if (!a || a === fixado) { esconder(); return; }
    esconder(); fixado = a; a.setAttribute('aria-describedby', el.id);
    const r = a.getBoundingClientRect(); mostrar(a, r.left + r.width / 2, r.top);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') esconder(); });
  document.addEventListener('pointermove', e => { if (fixado || e.pointerType === 'touch') return; const a = e.target.closest?.('[data-tip]'); if (a) mostrar(a, e.clientX, e.clientY); else esconder(); });
  document.addEventListener('focusin', e => { const a = e.target.closest?.('[data-tip]'); if (a) { const r = a.getBoundingClientRect(); mostrar(a, r.left + r.width / 2, r.top); } });
  document.addEventListener('focusout', esconder);
  addEventListener('scroll', esconder, {passive: true});
  addEventListener('resize', esconder);
  addEventListener('hashchange', esconder);
})();
