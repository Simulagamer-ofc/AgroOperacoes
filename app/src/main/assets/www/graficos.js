'use strict';
/* Painel de indicadores da Visão Geral — gráficos em HTML/CSS (sem bibliotecas, funcionam offline).
   Paleta categórica validada (claro e escuro) com o validador de daltonismo; ordem fixa por entidade. */

const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']];
let periodoGraf = Number(safeStorage.get('agro-periodo-graf')) || 30;
// Situação da operação → slot fixo da paleta (a cor segue a situação, nunca a posição)
const COR_SITUACAO = {'Programada': 1, 'Em andamento': 2, 'Concluída': 3, 'Cancelada': 4};

const fmtDia = iso => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
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
  const sub = `${ops.length} operações com data no período`;
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
    const escala = Math.max(Number(s.qty), Number(s.min) * 2), baixo = stockLow(s);
    return `<div class="viz-medidor" ${tip(s.name, `${num(s.qty)} ${s.unit} • mínimo ${num(s.min)} ${s.unit}`)}>
      <div class="viz-med-topo"><span>${esc(s.name)}</span><span class="viz-valor">${baixo ? '<b class="viz-alerta">! abaixo do mínimo</b> ' : ''}${num(s.qty)} / ${num(s.min)} ${esc(s.unit)}</span></div>
      <div class="viz-trilho med"><span class="viz-barra h ${baixo ? 'crit' : 's1'}" style="width:${Math.min(100, Number(s.qty) / escala * 100)}%"></span><i class="viz-min" style="left:${Number(s.min) / escala * 100}%" title="mínimo"></i></div></div>`;
  }).join('')}</div><p class="viz-unid">Traço vertical = estoque mínimo</p>`;
  return cartao('Estoque × mínimo', sub, corpo + tabela(['Item', 'Saldo', 'Mínimo'], itens.map(({s}) => [s.name, `${num(s.qty)} ${s.unit}`, `${num(s.min)} ${s.unit}`])));
}

// ---------- Painel principal (modelo Nexus): situação, últimos 7 dias, estoque e gastos ----------
const DIAS_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function roscaSituacao() {
  const ops = db.operations, total = ops.length;
  const cont = OP_STATUS.map(s => [s, ops.filter(o => o.status === s).length]);
  if (!total) return cartaoNx('Situação das operações', semDados('Nenhuma operação registrada.'));
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
    tabela(['Situação', 'Operações'], cont.map(([st, n]) => [st, n])));
}
function semanaOperacoes() {
  const fim = today(), dias = Array.from({length: 7}, (_, i) => addDias(fim, i - 6));
  const cont = dias.map(d => [d, db.operations.filter(o => o.date === d && o.status !== 'Cancelada').length]);
  const max = Math.max(1, ...cont.map(c => c[1]));
  const dia = d => DIAS_SEM[new Date(d + 'T12:00:00').getDay()];
  return cartaoNx('Últimos sete dias', `<div class="nx-semana" role="img" aria-label="Operações por dia nos últimos sete dias">${cont.map(([d, n]) =>
    `<div class="nx-dia" ${tip(`${dia(d)} ${fmtDia(d)}`, `${n} ${n === 1 ? 'operação' : 'operações'}`)}><div class="nx-trilho">${n ? `<span class="nx-barra" style="height:${n / max * 100}%"></span><b style="bottom:${n / max * 100}%">${n}</b>` : ''}</div><small>${dia(d)}</small></div>`).join('')}</div>` +
    tabela(['Dia', 'Operações'], cont.map(([d, n]) => [`${dia(d)} ${fmtDia(d)}`, n])));
}
function estoqueInsumos() {
  const comMin = db.stock.filter(s => Number(s.min) > 0), baixo = comMin.filter(stockLow);
  return cartaoNx('Estoque de insumos', `<div class="nx-tiles"><div class="nx-tile ok"><strong>${comMin.length - baixo.length}</strong><span>Sem alerta</span></div><div class="nx-tile baixo"><strong>${baixo.length}</strong><span>${baixo.length ? '! ' : ''}Estoque baixo</span></div></div>
    <p class="nx-nota">${baixo.length ? `Abaixo do mínimo: ${esc(baixo.map(s => s.name).join(', '))}.` : 'Saldo comparado ao mínimo cadastrado.'}${db.stock.length > comMin.length ? ` ${db.stock.length - comMin.length} sem mínimo definido.` : ''}</p>`);
}
const cartaoNx = (titulo, corpo) => `<article class="card nx-card"><h3>${esc(titulo)}</h3>${corpo}</article>`;
function painelNexus() {
  const custo = db.maintenances.reduce((s, m) => s + (Number(m.cost) || 0), 0);
  return `<section class="viz-root nx-grid3">${roscaSituacao()}${semanaOperacoes()}${estoqueInsumos()}</section>
    <section class="card nx-gastos"><div><h3>Controle de gastos</h3><p>Custos de manutenção lançados neste aparelho: <strong>R$ ${num(custo, 2)}</strong></p></div><button data-act="nav" data-id="relatorios">Ver relatórios</button></section>`;
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
