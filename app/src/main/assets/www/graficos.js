'use strict';
/* Painel de indicadores da Visão Geral — gráficos em HTML/CSS (sem bibliotecas, funcionam offline).
   Paleta categórica validada (claro e escuro) com o validador de daltonismo; ordem fixa por entidade. */

const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']];
let periodoGraf = Number(safeStorage.get('agro-periodo-graf')) || 30;
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
  const sub = `Operações concluídas • total ${num(total)} ha`;
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
  const teto = tetoEixo(linhas[0][1]);
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

// ---------- Painel principal (modelo Nexus): situação, últimos 7 dias, estoque e gastos ----------
const DIAS_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function roscaSituacao() {
  const ops = db.operations, total = ops.length;
  const cont = OP_STATUS.map(s => [s, ops.filter(o => o.status === s).length]);
  if (!total) return cartaoNx('Situação das operações', semDados('Nenhuma operação registrada.') + semanaOperacoes());
  // Anel: cada situação é um arco; 2px de folga entre arcos
  const r = 58, C = 2 * Math.PI * r, folga = cont.filter(([, n]) => n).length > 1 ? 2 : 0;
  let acum = 0;
  const arcos = cont.filter(([, n]) => n).map(([st, n]) => {
    const comp = n / total * C, arco = `<circle class="nx-seg" r="${r}" cx="75" cy="75" fill="none" stroke="var(--s${COR_SITUACAO[st]})" stroke-width="22" stroke-dasharray="${Math.max(0, comp - folga)} ${C}" stroke-dashoffset="${-acum}" transform="rotate(-90 75 75)" ${tip(st, `${n} de ${total} (${num(n / total * 100, 0)}%)`)}></circle>`;
    acum += comp; return arco;
  }).join('');
  return cartaoNx('Situação das operações', `<div class="nx-donut"><svg viewBox="0 0 150 150" role="img" aria-label="Situação das operações: ${cont.map(([s, n]) => `${s} ${n}`).join(', ')}">${arcos}
      <text x="75" y="80" text-anchor="middle" class="centro-n">${total}</text><text x="75" y="100" text-anchor="middle" class="centro-t">operações</text></svg>
    <ul class="nx-leg">${cont.map(([st, n]) => `<li><i class="s${COR_SITUACAO[st]}"></i><span>${esc(st === 'Programada' ? 'Planejada' : st)}</span><b>${n}</b></li>`).join('')}</ul></div>` +
    tabela(['Situação', 'Operações'], cont.map(([st, n]) => [st, n])) + semanaOperacoes());
}
function semanaOperacoes() {
  const fim = today(), dias = Array.from({length: 7}, (_, i) => addDias(fim, i - 6));
  const cont = dias.map(d => [d, db.operations.filter(o => o.date === d && o.status !== 'Cancelada').length]);
  const max = Math.max(1, ...cont.map(c => c[1]));
  const dia = d => DIAS_SEM[new Date(d + 'T12:00:00').getDay()];
  return `<h4 class="nx-sub">Últimos sete dias</h4><div class="nx-semana compacta" role="img" aria-label="Operações por dia nos últimos sete dias">${cont.map(([d, n]) =>
    `<div class="nx-dia" ${tip(`${dia(d)} ${fmtDia(d)}`, `${n} ${n === 1 ? 'operação' : 'operações'}`)}><div class="nx-trilho">${n ? `<span class="nx-barra" style="height:${n / max * 100}%"></span><b style="bottom:${n / max * 100}%">${n}</b>` : ''}</div><small>${dia(d)}</small></div>`).join('')}</div>` +
    tabela(['Dia', 'Operações'], cont.map(([d, n]) => [`${dia(d)} ${fmtDia(d)}`, n]));
}
// Custos dos últimos 6 meses em pizza, por categoria (3 maiores + “Outras”).
// Soma os gastos lançados e o custo das manutenções concluídas (data de conclusão) — ver gastos.js.
// Pizza com até 3 categorias + “Demais” (só há 3 cores categóricas validadas). Cor segue a categoria
// (ordem alfabética entre as mostradas), nunca a posição no ranking; “Demais” em cinza.
function pizza(entrada, total, fmt) {
  const DEMAIS = 'Demais';
  const fatias = entrada.length > 3 ? [...entrada.slice(0, 3), [DEMAIS, entrada.slice(3).reduce((s, f) => s + f[1], 0)]] : entrada;
  const nomes = fatias.map(f => f[0]).filter(n => n !== DEMAIS).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const cor = n => n === DEMAIS ? 'var(--c0)' : `var(--c${nomes.indexOf(n) + 1})`;
  const pct = v => Math.round(v / total * 100);
  // Fatias como caminhos SVG; contorno na cor do cartão = folga de 2px entre fatias
  const R = 70, cx = 75, cy = 75; let ang = -Math.PI / 2;
  const ponto = a => `${(cx + R * Math.cos(a)).toFixed(2)} ${(cy + R * Math.sin(a)).toFixed(2)}`;
  const fatiaSvg = ([n, v]) => {
    const a = v / total * 2 * Math.PI, d = fatias.length === 1 ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} Z`
      : `M ${cx} ${cy} L ${ponto(ang)} A ${R} ${R} 0 ${a > Math.PI ? 1 : 0} 1 ${ponto(ang + a)} Z`;
    ang += a;
    return `<path class="nx-seg" d="${d}" fill="${cor(n)}" stroke="var(--panel)" stroke-width="2" stroke-linejoin="round" ${tip(n, `${fmt(v)} (${pct(v)}%)`)}></path>`;
  };
  return {fatias, html: rotulo => `<div class="nx-donut pizza"><svg viewBox="0 0 150 150" role="img" aria-label="${esc(rotulo)}: ${esc(fatias.map(([n, v]) => `${n} ${pct(v)}%`).join(', '))}">${fatias.map(fatiaSvg).join('')}</svg>
    <ul class="nx-leg custos">${fatias.map(([n, v]) => `<li><i style="background:${cor(n)}"></i><span>${esc(n)}<small>${esc(fmt(v))}</small></span><b>${pct(v)}%</b></li>`).join('')}</ul></div>`};
}
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function custosMes() {
  const hoje = new Date(today() + 'T12:00:00'), ini = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);
  const desde = `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}-01`;
  const lanc = lancamentosCusto(desde, today());
  const total = somaValor(lanc);
  if (!total) return cartaoNx('Custos', semDados('Nenhum custo lançado nos últimos 6 meses. Use “Controle de gastos” ou informe o custo ao concluir uma manutenção.'));
  let fatias = agrupar(lanc, x => x.category);
  const porMaq = agrupar(lanc.filter(x => x.machineId), x => machineName(x.machineId) || 'Máquina removida');
  const pz = pizza(fatias, total, v => `R$ ${num(v, 2)}`);
  const pct = v => v / total * 100;
  const meses = Array.from({length: 6}, (_, k) => new Date(ini.getFullYear(), ini.getMonth() + k, 1));
  const porMes = meses.map(d => [`${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, somaValor(lanc.filter(x => x.date.startsWith(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)))]);
  return cartaoNx('Custos', `<p class="nx-total"><strong>R$ ${num(total, 2)}</strong> nos últimos 6 meses</p>
    ${pz.html('Custos por categoria')}
    <p class="nx-nota">Gastos lançados e manutenções concluídas desde ${fmtDate(desde)}, por categoria.${custoManutPrevisto() ? ` Fora do total: R$ ${num(custoManutPrevisto(), 2)} em manutenções abertas (previsão).` : ''}</p>` +
    tabela(['Categoria', 'Custo (R$)', '%'], pz.fatias.map(([n, v]) => [n, num(v, 2), Math.round(pct(v)) + '%'])) +
    (porMaq.length ? tabela(['Máquina', 'Custo (R$)'], porMaq.map(([n, v]) => [n, num(v, 2)])).replace('Ver tabela', 'Ver por máquina') : '') +
    tabela(['Mês', 'Custo (R$)'], porMes.map(([m, v]) => [m, num(v, 2)])).replace('Ver tabela', 'Ver por mês'));
}
// Valor em estoque por categoria (custo médio × saldo). Sem nenhum custo registrado, mostra itens por categoria.
function estoqueInsumos() {
  if (!db.stock.length) return cartaoNx('Estoque de insumos', semDados('Nenhum item de estoque cadastrado.'));
  const comValor = db.stock.filter(s => valorItem(s) > 0), total = comValor.reduce((t, s) => t + valorItem(s), 0);
  const porValor = total > 0, semCusto = db.stock.length - comValor.length;
  const base = porValor ? agrupar(comValor.map(s => ({category: s.category || 'Outro', value: valorItem(s)})), x => x.category)
    : agrupar(db.stock.map(s => ({category: s.category || 'Outro', value: 1})), x => x.category);
  const tot = porValor ? total : db.stock.length;
  const pz = pizza(base, tot, porValor ? (v => `R$ ${num(v, 2)}`) : (v => `${v} ${v === 1 ? 'item' : 'itens'}`));
  const baixo = db.stock.filter(stockLow), perto = db.stock.filter(estoquePerto);
  return cartaoNx('Estoque de insumos', `<p class="nx-total">${porValor ? `<strong>R$ ${num(total, 2)}</strong> em estoque` : `<strong>${db.stock.length}</strong> ${db.stock.length === 1 ? 'item' : 'itens'} por categoria`}</p>
    ${pz.html(porValor ? 'Valor em estoque por categoria' : 'Itens por categoria')}
    <ul class="es-sinais"><li class="es-baixo"><b>${baixo.length ? '! ' : ''}${baixo.length}</b>abaixo do mínimo${baixo.length ? ': ' + esc(baixo.map(s => s.name).join(', ')) : ''}</li><li class="es-perto"><b>${perto.length}</b>perto do mínimo</li>${semCusto ? `<li><b>${semCusto}</b>sem custo registrado${porValor ? ' (fora do valor)' : ''}</li>` : ''}</ul>` +
    tabela(['Categoria', porValor ? 'Valor (R$)' : 'Itens', '%'], pz.fatias.map(([n, v]) => [n, porValor ? num(v, 2) : v, Math.round(v / tot * 100) + '%'])));
}
const cartaoNx = (titulo, corpo) => `<article class="card nx-card"><h3>${esc(titulo)}</h3>${corpo}</article>`;
function painelNexus() {
  const mes = somaValor(lancamentosCusto(today().slice(0, 8) + '01', today()));
  return `<section class="viz-root nx-grid3">${roscaSituacao()}${custosMes()}${estoqueInsumos()}</section>
    <section class="card nx-gastos"><div><h3>Controle de gastos</h3><p>Gastos deste mês, desde ${fmtDate(today().slice(0, 8) + '01')} (despesas e manutenções concluídas): <strong>R$ ${num(mes, 2)}</strong></p></div><div class="nx-gastos-btns"><button data-act="gs-new">+ Lançar gasto</button><button data-act="nav" data-id="gastos">Ver gastos</button></div></section>`;
}

function painelGraficos() {
  const fim = today(), ini = addDias(fim, -(periodoGraf - 1));
  return `<div class="section-title viz-cab"><h3>Indicadores do período</h3><div class="filters viz-filtro" role="group" aria-label="Período dos indicadores">${PERIODOS.map(([d, r]) =>
    `<button class="${d === periodoGraf ? 'active' : ''}" data-act="graf-periodo" data-id="${d}" aria-pressed="${d === periodoGraf}">${r}</button>`).join('')}</div></div>
    <section class="viz-root viz-grid">${graficoArea(ini, fim)}${graficoHoras(ini, fim)}${graficoEstoque()}</section>`;
}

ACTIONS['graf-periodo'] = id => { periodoGraf = Number(id); safeStorage.set('agro-periodo-graf', String(periodoGraf)); render(); };

// Dica flutuante única (mouse e teclado); textos inseridos com textContent
(() => {
  const el = document.createElement('div');
  el.className = 'viz-tip'; el.setAttribute('role', 'tooltip');
  const v = document.createElement('strong'), t = document.createElement('span');
  el.append(v, t); document.body.appendChild(el);
  const mostrar = (alvo, x, y) => {
    v.textContent = alvo.dataset.tipValor; t.textContent = alvo.dataset.tip;
    el.classList.add('on');
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px';
    el.style.top = Math.max(8, y - r.height - 12) + 'px';
  };
  const esconder = () => el.classList.remove('on');
  document.addEventListener('pointermove', e => { const a = e.target.closest?.('[data-tip]'); if (a) mostrar(a, e.clientX, e.clientY); else esconder(); });
  document.addEventListener('focusin', e => { const a = e.target.closest?.('[data-tip]'); if (a) { const r = a.getBoundingClientRect(); mostrar(a, r.left + r.width / 2, r.top); } });
  document.addEventListener('focusout', esconder);
  addEventListener('scroll', esconder, {passive: true});
})();
