'use strict';
/* MercaPlant — Indicadores de manutenção (fase 3) e editor dos itens dos checklists.
   Só para quem gerencia (ADM, supervisor ou quem usa o app sem nuvem): o Usuário comum não vê indicadores nem custos.
   Indicadores por máquina e da frota: preventivas × corretivas, custo, tempo parado, horas entre quebras,
   defeitos que se repetem (checklists + consertos, sem contar duas vezes o mesmo defeito do mesmo pedido)
   e o tempo até decidir os pedidos.
   Editor: itens do checklist da máquina (inspeção) e da revisão (preventiva) por tipo de máquina — fica num registro
   da coleção checklistsMaq (sincroniza para os aparelhos de todos). */

const MCI_CFG = 'config-modelos';
const mciModelos = () => find(MCP_COL, MCI_CFG) || {};
const mciRevisao = chave => { const l = mciModelos().revisao?.[chave]; return Array.isArray(l) && l.length ? l : null; };
const mciInspecao = chave => { const l = mciModelos().inspecao?.[chave]; return Array.isArray(l) && l.length ? l : null; };
const MCI_PERIODOS = [[90, '90 dias'], [180, '6 meses'], [365, '12 meses'], [0, 'Tudo']];
let mciPeriodo = 365;
const mciDentro = (d, ini, fim) => !!d && (!ini || d >= ini) && d <= fim;
const mciHorasTxt = h => h >= 48 ? `${num(Math.round(h / 24 * 10) / 10)} dias` : `${num(Math.round(h * 10) / 10)} h`;
const mciBRL = v => v >= 1e6 ? `R$ ${num(v / 1e6, 1)} mi` : v >= 1e4 ? `R$ ${num(v / 1e3, 1)} mil` : `R$ ${num(v, 0)}`;
const MCI_GENERICOS = new Set([...MC_CORRETIVA.map(([i]) => i), MC_TESTE].map(mcNorm));

// ---------- Cálculo ----------
function mciDados(m, dias = mciPeriodo) {
  const fim = today(), ini = dias ? addDias(fim, -dias + 1) : '', iniISO = ini ? new Date(ini + 'T00:00:00').getTime() : 0, agora = Date.now();
  const todas = db.maintenances.filter(x => x.machineId === m.id && x.status !== 'Recusada');
  const concl = todas.filter(x => x.status === 'Concluída' && mciDentro(x.doneDate || x.date, ini, fim));
  const prev = concl.filter(x => x.kind !== 'Corretiva'), corr = concl.filter(x => x.kind === 'Corretiva');
  const custo = l => l.reduce((t, x) => t + mcCustoTotal(x), 0);
  // Tempo parado no período (pedido ou ordem com máquina parada; a que ainda está parada conta até agora)
  let parado = 0, paradas = 0;
  db.maintenances.filter(x => x.machineId === m.id && x.paradaDesde).forEach(x => {
    const a = Math.max(new Date(x.paradaDesde).getTime(), iniISO), b = x.paradaFim ? new Date(x.paradaFim).getTime() : agora;
    if (b > a) { parado += (b - a) / 36e5; paradas++; }
  });
  // Horas trabalhadas: subidas do horímetro no período
  const horas = db.hourLogs.filter(h => h.machineId === m.id && mciDentro(h.date, ini, fim)).reduce((t, h) => t + Math.max(0, Number(h.hours) - Number(h.previous || 0)), 0);
  // Defeitos que se repetem: cada defeito conta uma vez por pedido (o relato do checklist e a troca no conserto são o mesmo)
  const ocorr = new Map();
  const marca = (item, chave, data, fonte) => {
    const k = mcNorm(item); if (!k || MCI_GENERICOS.has(k)) return;
    if (!ocorr.has(k)) ocorr.set(k, {item, vezes: new Map()});
    const g = ocorr.get(k), v = g.vezes.get(chave);
    if (!v) g.vezes.set(chave, {data, fonte}); else if (fonte === 'troca') { v.fonte = 'troca'; if (data > v.data) v.data = data; }
  };
  (db[MCP_COL] || []).filter(r => r.machineId === m.id && r.tipo !== 'config' && mciDentro(r.data, ini, fim))
    .forEach(r => mcpDefeitos(r).forEach(d => marca(d.item, r.pedidoId || r.id, r.data, 'checklist')));
  todas.filter(x => x.kind === 'Corretiva' && mciDentro(x.doneDate || x.date, ini, fim))
    .forEach(x => (x.checklist || []).filter(i => ['trocado', 'problema', 'ajustado'].includes(i.estado)).forEach(i => marca(i.item, x.id, x.doneDate || x.date, i.estado === 'trocado' ? 'troca' : 'conserto')));
  const repetidos = [...ocorr.values()].map(g => ({item: g.item, n: g.vezes.size, ultima: [...g.vezes.values()].map(v => v.data).sort().at(-1), trocas: [...g.vezes.values()].filter(v => v.fonte === 'troca').length}))
    .sort((a, b) => b.n - a.n || String(b.ultima).localeCompare(String(a.ultima)));
  // Pedidos do checklist: quantos, recusados e tempo até a decisão (autorizar ou recusar)
  const pedidos = db.maintenances.filter(x => x.machineId === m.id && x.origem === 'checklist' && mciDentro(x.date, ini, fim));
  const esperas = pedidos.filter(x => x.autorizacao && !x.autorizacao.auto).map(x => {
    const r0 = mcpPedidoInicial(x)[0]; return r0 ? (new Date(x.autorizacao.em) - new Date(r0.em)) / 36e5 : null; }).filter(h => h != null && h >= 0);
  const chks = (db[MCP_COL] || []).filter(r => r.machineId === m.id && r.tipo !== 'config' && r.origem !== 'complemento' && mciDentro(r.data, ini, fim));
  // Por mês (até 12 meses): preventivas, corretivas e custo
  const meses = []; const nM = dias && dias <= 365 ? Math.round(dias / 30.4) : 12;
  for (let k = nM - 1; k >= 0; k--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); meses.push(isoDate(d).slice(0, 7)); }
  const porMes = meses.map(mm => { const l = concl.filter(x => String(x.doneDate || x.date).startsWith(mm)); return {mm, prev: l.filter(x => x.kind !== 'Corretiva').length, corr: l.filter(x => x.kind === 'Corretiva').length, custo: custo(l)}; });
  return {m, ini, fim, concl, prev, corr, custo: custo(concl), custoPrev: custo(prev), custoCorr: custo(corr), parado, paradas, horas, repetidos,
    pedidos: pedidos.length, recusados: db.maintenances.filter(x => x.machineId === m.id && x.origem === 'checklist' && x.status === 'Recusada' && mciDentro(x.date, ini, fim)).length,
    espera: esperas.length ? esperas.reduce((t, h) => t + h, 0) / esperas.length : null, chks: chks.length, chksDef: chks.filter(r => mcpDefeitos(r).length).length,
    abertas: todas.filter(x => !['Concluída', 'Programada'].includes(x.status)).length, porMes};
}
const mciPctCorr = d => d.concl.length ? Math.round(d.corr.length / d.concl.length * 100) : null;

// ---------- Telas ----------
const mciSemAcesso = () => head('Indicadores de manutenção', 'Só para o ADM e o supervisor.', btn('← Máquinas', 'nav', 'maquinas', 'secondary')) + `<section class="card">${empty('Sem acesso aos indicadores', 'Seu nível de acesso é Usuário comum.', {act: 'nav', id: 'maquinas', label: '← Máquinas'})}</section>`;
const mciPeriodoBts = () => `<div class="mci-per" role="group" aria-label="Período">${MCI_PERIODOS.map(([d, t]) => btn(t, 'mci-periodo', String(d), mciPeriodo === d ? 'primary' : 'secondary')).join('')}</div>`;
function mciKpis(d) {
  const pc = mciPctCorr(d), entre = d.corr.length && d.horas ? d.horas / d.corr.length : null;
  return `<section class="kpis mci-kpis">
    <article class="card kpi"><div class="label">Manutenções concluídas</div><div class="value">${d.concl.length}</div><div class="hint">${d.prev.length} preventivas • ${d.corr.length} corretivas</div>
      ${d.concl.length ? `<div class="mci-split" title="Preventivas × corretivas"><span class="prev" style="width:${100 - pc}%"></span><span class="corr" style="width:${pc}%"></span></div>` : ''}</article>
    <article class="card kpi"><div class="label">Corretivas</div><div class="value ${pc >= 50 ? 'txt-red' : ''}">${pc == null ? '—' : pc + '%'}</div><div class="hint">${pc == null ? 'nenhuma concluída no período' : pc >= 50 ? 'mais quebra do que revisão: reforçar a preventiva' : 'das manutenções foram por quebra'}</div></article>
    <article class="card kpi"><div class="label">Custo da manutenção</div><div class="value">${mciBRL(d.custo)}</div><div class="hint">${d.horas && d.custo ? `R$ ${num(d.custo / d.horas, 2)} por hora trabalhada` : `preventiva ${mciBRL(d.custoPrev)} • corretiva ${mciBRL(d.custoCorr)}`}</div></article>
    <article class="card kpi"><div class="label">Tempo parado</div><div class="value ${d.parado > 72 ? 'txt-red' : ''}">${d.parado ? mciHorasTxt(d.parado) : '—'}</div><div class="hint">${d.paradas ? `${d.paradas} ${d.paradas === 1 ? 'parada' : 'paradas'}${entre ? ` • ${num(Math.round(entre))} h entre quebras` : ''}` : 'nenhuma parada registrada'}</div></article>
  </section>`;
}
function mciGrafico(d) {
  const max = Math.max(1, ...d.porMes.map(x => x.prev + x.corr)), nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  if (!d.porMes.some(x => x.prev + x.corr)) return '';
  return `<article class="card panel"><div class="section-title" style="margin:0 0 8px"><h3>Manutenções por mês</h3><span class="mci-leg"><span><i class="prev"></i>Preventiva</span><span><i class="corr"></i>Corretiva</span></span></div>
    <div class="mci-barras" style="grid-template-columns:repeat(${d.porMes.length},1fr)" role="img" aria-label="${d.prev.length} preventivas e ${d.corr.length} corretivas no período">${d.porMes.map(x => `<div class="mci-col" title="${esc(`${nomes[Number(x.mm.slice(5)) - 1]}/${x.mm.slice(2, 4)}: ${x.prev} preventivas, ${x.corr} corretivas${x.custo ? `, R$ ${num(x.custo, 2)}` : ''}`)}">
      <div class="mci-pilha">${x.corr ? `<span class="corr" style="height:${x.corr / max * 100}%"></span>` : ''}${x.prev ? `<span class="prev" style="height:${x.prev / max * 100}%"></span>` : ''}</div><small>${nomes[Number(x.mm.slice(5)) - 1]}</small></div>`).join('')}</div></article>`;
}
function mciRepetidos(d, limite = 8) {
  const rep = d.repetidos.filter(r => r.n >= 2);
  return `<article class="card panel"><div class="section-title" style="margin:0 0 8px"><h3>Defeitos que se repetem</h3><small class="nota">checklists e consertos</small></div>
    ${rep.length ? rep.slice(0, limite).map(r => `<div class="mci-rep"><div><strong>${esc(r.item)}</strong><small>última vez ${fmtDate(r.ultima)}${r.trocas ? ` • trocado ${r.trocas} ${r.trocas === 1 ? 'vez' : 'vezes'}` : ''}</small></div><span class="chip ${r.n >= 3 ? 'red' : 'orange'}">${r.n} vezes</span></div>`).join('')
      + `<p class="nota" style="margin:8px 0 0">Defeito que volta pode ser peça de baixa qualidade, regulagem ou operação errada. Vale olhar a causa antes da próxima troca.</p>`
      : `<p class="nota" style="margin:0">Nenhum defeito repetido no período.${d.repetidos.length ? ` ${d.repetidos.length} ${d.repetidos.length === 1 ? 'defeito apareceu' : 'defeitos diferentes apareceram'} uma vez.` : ''}</p>`}</article>`;
}
function mciPedidos(d) {
  return `<article class="card panel"><div class="section-title" style="margin:0 0 8px"><h3>Checklists e pedidos</h3></div>
    <div class="mci-mini">
      <div><small>Checklists feitos</small><b>${d.chks}</b><small>${d.chks ? `${Math.round(d.chksDef / d.chks * 100)}% com defeito` : '—'}</small></div>
      <div><small>Pedidos do checklist</small><b>${d.pedidos}</b><small>${d.recusados ? `${d.recusados} ${d.recusados === 1 ? 'recusado' : 'recusados'}` : 'nenhum recusado'}</small></div>
      <div><small>Tempo até decidir</small><b>${d.espera == null ? '—' : mciHorasTxt(d.espera)}</b><small>média, do relato até autorizar ou recusar</small></div>
      <div><small>Abertas agora</small><b>${d.abertas}</b><small>pedidos e ordens em andamento</small></div>
    </div></article>`;
}
VIEWS.manutind = arg => {
  if (!mcpGestor()) return mciSemAcesso();
  const m = arg ? find('machines', arg) : null;
  if (m) {
    const d = mciDados(m), ords = d.concl.slice().sort((a, b) => String(b.doneDate || b.date).localeCompare(String(a.doneDate || a.date)));
    return head(`Indicadores — ${m.name}`, `${[m.type, m.model].filter(Boolean).join(' • ')}${d.ini ? ` • ${fmtDate(d.ini)} a ${fmtDate(d.fim)}` : ' • todo o histórico'}`, btn('← Frota', 'nav', 'manutind', 'secondary') + btn('PDF', 'mci-pdf', m.id, 'secondary') + btn('Enviar', 'mci-enviar', m.id, 'secondary')) +
      mciPeriodoBts() + mciKpis(d) + `<div class="mci-duas">${mciGrafico(d) || ''}${mciRepetidos(d)}</div>` + mciPedidos(d) +
      `<div class="section-title"><h3>Manutenções concluídas no período</h3><small class="nota">${ords.length}</small></div><section class="card list">${ords.length ? ords.slice(0, 40).map(x => `<div class="row"><span class="status ${x.kind === 'Corretiva' ? 'orange' : 'green'}"></span><div><strong>${esc(x.description || x.kind)}</strong><small>${esc([x.kind, fmtDate(x.doneDate || x.date), mcCustoTotal(x) ? 'R$ ' + num(mcCustoTotal(x), 2) : '', x.paradaDesde ? 'parada ' + mciHorasTxt(mcHoras(x.paradaDesde, x.paradaFim)) : ''].filter(Boolean).join(' • '))}</small></div><div class="row-actions">${mini('Ver', 'nav', 'ordem/' + x.id)}</div></div>`).join('') : empty('Nenhuma manutenção concluída no período', '')}</section>`;
  }
  const ms = db.machines.filter(x => !isInactive(x)), ds = ms.map(x => mciDados(x));
  const tot = {concl: ds.reduce((t, d) => t + d.concl.length, 0), corr: ds.reduce((t, d) => t + d.corr.length, 0), custo: ds.reduce((t, d) => t + d.custo, 0), parado: ds.reduce((t, d) => t + d.parado, 0)};
  const pc = tot.concl ? Math.round(tot.corr / tot.concl * 100) : null;
  const rep = ds.flatMap(d => d.repetidos.filter(r => r.n >= 2).map(r => ({...r, m: d.m}))).sort((a, b) => b.n - a.n).slice(0, 8);
  const ordem = ds.slice().sort((a, b) => b.custo - a.custo || b.corr.length - a.corr.length || b.parado - a.parado);
  return head('Indicadores de manutenção', 'Frota: preventivas × corretivas, custo, tempo parado e defeitos que se repetem.', btn('← Máquinas', 'nav', 'maquinas', 'secondary') + btn('PDF', 'mci-pdf', '', 'secondary') + btn('Enviar', 'mci-enviar', '', 'secondary')) +
    mciPeriodoBts() +
    `<section class="kpis mci-kpis">
      <article class="card kpi"><div class="label">Manutenções concluídas</div><div class="value">${tot.concl}</div><div class="hint">${tot.concl - tot.corr} preventivas • ${tot.corr} corretivas</div></article>
      <article class="card kpi"><div class="label">Corretivas</div><div class="value ${pc >= 50 ? 'txt-red' : ''}">${pc == null ? '—' : pc + '%'}</div><div class="hint">da frota, no período</div></article>
      <article class="card kpi"><div class="label">Custo da manutenção</div><div class="value">${mciBRL(tot.custo)}</div><div class="hint">${ms.length} máquinas ativas</div></article>
      <article class="card kpi"><div class="label">Tempo parado</div><div class="value">${tot.parado ? mciHorasTxt(tot.parado) : '—'}</div><div class="hint">somando todas as máquinas</div></article></section>` +
    `<div class="section-title"><h3>Por máquina</h3><small class="nota">maior custo primeiro</small></div>
    <section class="card mci-tabela-box"><table class="mci-tabela"><thead><tr><th>Máquina</th><th>Prev.</th><th>Corr.</th><th>% corr.</th><th>Custo</th><th>Parada</th><th>Mais repetido</th><th></th></tr></thead><tbody>
      ${ordem.map(d => { const p = mciPctCorr(d), r = d.repetidos.find(x => x.n >= 2); return `<tr><td><strong>${esc(d.m.name)}</strong><small>${esc(d.m.type || '')}</small></td><td data-l="Preventivas">${d.prev.length}</td><td data-l="Corretivas">${d.corr.length}</td><td data-l="% corretiva" class="${p >= 50 ? 'txt-red' : ''}">${p == null ? '—' : p + '%'}</td><td data-l="Custo">${d.custo ? mciBRL(d.custo) : '—'}</td><td data-l="Parada">${d.parado ? mciHorasTxt(d.parado) : '—'}</td><td data-l="Mais repetido">${r ? `${esc(r.item)} <span class="chip ${r.n >= 3 ? 'red' : 'orange'}">${r.n}×</span>` : '—'}</td><td><div class="row-actions">${mini('Abrir', 'nav', 'manutind/' + d.m.id, 'ok')}</div></td></tr>`; }).join('')}
    </tbody></table></section>` +
    `<article class="card panel" style="margin-top:14px"><div class="section-title" style="margin:0 0 8px"><h3>Defeitos que se repetem na frota</h3></div>${rep.length ? rep.map(r => `<div class="mci-rep"><div><strong>${esc(r.item)}</strong><small>${esc(r.m.name)} • última vez ${fmtDate(r.ultima)}</small></div><span class="chip ${r.n >= 3 ? 'red' : 'orange'}">${r.n} vezes</span></div>`).join('') : '<p class="nota" style="margin:0">Nenhum defeito repetido no período.</p>'}</article>`;
};
TITLES.manutind = 'Indicadores de manutenção';
if (typeof GRUPO_DA_ROTA === 'object') GRUPO_DA_ROTA.manutind = 'maquinas';

// ---------- PDF dos indicadores ----------
function mciPdf(id, enviar) {
  if (!mcpSoGestor()) return;
  if (typeof window.pdfMercaPlant !== 'function') { showToast('Gerador de PDF indisponível', true); return; }
  const m = id ? find('machines', id) : null, ms = m ? [m] : db.machines.filter(x => !isInactive(x)), ds = ms.map(x => mciDados(x));
  const d0 = ds[0] || {ini: '', fim: today()}, periodo = d0.ini ? `${fmtDate(d0.ini)} a ${fmtDate(d0.fim)}` : 'todo o histórico';
  const P = window.pdfMercaPlant({titulo: m ? `Indicadores de manutenção - ${m.name}` : 'Indicadores de manutenção da frota', linha2: periodo, continuacao: `Indicadores · ${periodo}`});
  const C = P.COR, concl = ds.reduce((t, d) => t + d.concl.length, 0), corr = ds.reduce((t, d) => t + d.corr.length, 0), custo = ds.reduce((t, d) => t + d.custo, 0), parado = ds.reduce((t, d) => t + d.parado, 0);
  P.secao('Resumo', periodo);
  P.cartoes([['Manutenções', String(concl), `${concl - corr} preventivas, ${corr} corretivas`, C.verde], ['Corretivas', concl ? `${Math.round(corr / concl * 100)}%` : '-', 'das concluídas', C.laranja],
    ['Custo', `R$ ${num(custo, 2)}`, 'peças, mão de obra e serviços', C.laranja], ['Tempo parado', parado ? mciHorasTxt(parado) : '-', m ? `${ds[0].paradas} paradas` : 'somando a frota', C.azul]]);
  P.secao('Por máquina');
  P.tabela([{t: 'Máquina', w: 2}, {t: 'Prev.', w: .7, dir: true}, {t: 'Corr.', w: .7, dir: true}, {t: '% corr.', w: .8, dir: true}, {t: 'Custo', w: 1.3, dir: true}, {t: 'Parada', w: 1, dir: true}, {t: 'Horas trab.', w: 1, dir: true}],
    ds.slice().sort((a, b) => b.custo - a.custo).map(d => [d.m.name, String(d.prev.length), String(d.corr.length), mciPctCorr(d) == null ? '-' : mciPctCorr(d) + '%', d.custo ? `R$ ${num(d.custo, 2)}` : '-', d.parado ? mciHorasTxt(d.parado) : '-', d.horas ? `${num(Math.round(d.horas))} h` : '-']));
  const rep = ds.flatMap(d => d.repetidos.filter(r => r.n >= 2).map(r => [d.m.name, r.item, String(r.n), fmtDate(r.ultima)]));
  P.secao('Defeitos que se repetem');
  if (rep.length) P.tabela([{t: 'Máquina', w: 1.6}, {t: 'Defeito / peça', w: 2.6}, {t: 'Vezes', w: .7, dir: true}, {t: 'Última', w: 1}], rep); else P.nada('Nenhum defeito repetido no período.');
  if (m) {
    const d = ds[0];
    P.secao('Checklists e pedidos');
    P.ficha([['Checklists feitos', `${d.chks}${d.chks ? ` (${Math.round(d.chksDef / d.chks * 100)}% com defeito)` : ''}`], ['Pedidos do checklist', `${d.pedidos}${d.recusados ? `, ${d.recusados} recusados` : ''}`], ['Tempo médio até decidir (autorizar ou recusar)', d.espera == null ? '-' : mciHorasTxt(d.espera)]]);
    if (d.concl.length) { P.secao('Manutenções concluídas'); P.tabela([{t: 'Data', w: 1}, {t: 'Tipo', w: 1}, {t: 'Serviço', w: 3}, {t: 'Custo', w: 1.2, dir: true}], d.concl.slice().sort((a, b) => String(a.doneDate || a.date).localeCompare(String(b.doneDate || b.date))).map(x => [fmtDate(x.doneDate || x.date), x.kind || '', x.description || '', mcCustoTotal(x) ? `R$ ${num(mcCustoTotal(x), 2)}` : '-'])); }
  }
  P.nota('Custo da manutenção: peças (inclusive do estoque), mão de obra e serviços de cada ordem concluída. Tempo parado: de quando a máquina foi informada como parada até a conclusão.');
  window.entregarPdf(P.finalizar(), `mercaplant-indicadores-manutencao-${m ? mcpSlug(m.name) : 'frota'}-${today()}.pdf`, enviar === true, m ? `Indicadores de manutenção - ${m.name}` : 'Indicadores de manutenção da frota');
}

// ---------- Editor dos itens dos checklists ----------
let mciRasc = null; // {tab, tipo, itens: [{item, obrig}]}
const MCI_TABS = [['inspecao', 'Checklist da máquina (antes de trabalhar)'], ['revisao', 'Revisão (manutenção preventiva)']];
function mciPadrao(tab, tipo) { return tab === 'inspecao' ? (MC_INSPECAO[tipo] || MC_INSPECAO.Outro).map(item => ({item, obrig: false})) : (MC_MODELOS[tipo] || MC_MODELOS.Outro).map(([item, o]) => ({item, obrig: !!o})); }
function mciAtual(tab, tipo) {
  const salvo = tab === 'inspecao' ? mciInspecao(tipo)?.map(item => ({item, obrig: false})) : mciRevisao(tipo)?.map(([item, o]) => ({item, obrig: !!o}));
  return salvo || mciPadrao(tab, tipo);
}
function mciLerRasc() { $$('[data-mci-item]').forEach(el => { const it = mciRasc?.itens[el.dataset.mciItem]; if (it) it.item = el.value.trim(); }); }
VIEWS.modeloschk = arg => {
  if (!mcpGestor()) return mciSemAcesso();
  const [tab0, tipo0] = String(arg || '').split('~'), tab = MCI_TABS.some(([k]) => k === tab0) ? tab0 : 'inspecao', tipo = MC_MODELOS[tipo0] ? tipo0 : 'Trator';
  if (!mciRasc || mciRasc.tab !== tab || mciRasc.tipo !== tipo) mciRasc = {tab, tipo, itens: mciAtual(tab, tipo)};
  const salvo = tab === 'inspecao' ? mciInspecao(tipo) : mciRevisao(tipo), qtd = db.machines.filter(m => !isInactive(m) && mcChaveTipo(m) === tipo).length;
  return head('Itens dos checklists', 'Monte os itens de cada tipo de máquina do jeito da sua fazenda. Vale para todos os aparelhos.', btn('← Checklists', 'nav', 'checklists', 'secondary')) +
    `<div class="mci-per" role="tablist">${MCI_TABS.map(([k, t]) => btn(t, 'nav', `modeloschk/${k}~${tipo}`, k === tab ? 'primary' : 'secondary')).join('')}</div>
    <section class="card panel"><div class="mci-tipo"><label for="mci-tipo">Tipo de máquina</label><select id="mci-tipo">${Object.keys(MC_MODELOS).map(t => `<option value="${esc(t)}" ${t === tipo ? 'selected' : ''}>${esc(t === 'Outro' ? 'Outros tipos' : t)}</option>`).join('')}</select>
      <small class="nota">${qtd ? `${qtd} ${qtd === 1 ? 'máquina ativa usa' : 'máquinas ativas usam'} este modelo` : 'nenhuma máquina ativa deste tipo'} • ${salvo ? 'modelo da fazenda' : 'modelo padrão do MercaPlant'}</small></div>
      <div class="mci-itens">${mciRasc.itens.map((it, i) => `<div class="mci-it"><span class="mci-n">${i + 1}</span><input data-mci-item="${i}" value="${esc(it.item)}" placeholder="Nome do item" aria-label="Item ${i + 1}">
        ${tab === 'revisao' ? `<button type="button" class="mci-ob ${it.obrig ? 'on' : ''}" data-act="mci-obrig" data-id="${i}" aria-pressed="${it.obrig}" title="Obrigatório para concluir">${it.obrig ? '★ Obrigatório' : '☆ Opcional'}</button>` : ''}
        <button type="button" class="mci-ic" data-act="mci-mover" data-id="${i}|-1" aria-label="Subir" ${i ? '' : 'disabled'}>↑</button><button type="button" class="mci-ic" data-act="mci-mover" data-id="${i}|1" aria-label="Descer" ${i < mciRasc.itens.length - 1 ? '' : 'disabled'}>↓</button><button type="button" class="mci-ic del" data-act="mci-tirar" data-id="${i}" aria-label="Tirar">✕</button></div>`).join('')}</div>
      <div class="btn-row" style="margin-top:10px">${btn('+ Item', 'mci-add', '', 'secondary')}${btn('Voltar ao padrão', 'mci-padrao', '', 'secondary')}${btn('Salvar modelo', 'mci-salvar')}</div>
      <p class="nota">${tab === 'inspecao' ? 'Itens que o operador confere antes de trabalhar (OK, Defeito ou N/A). Defeito vira pedido de manutenção.' : 'Itens da revisão preventiva. ★ Obrigatório: precisa ser marcado para concluir a ordem. O teste de funcionamento entra sempre no fim.'} Checklists e ordens já abertos não mudam.</p></section>`;
};
VIEWS.modeloschk.after = () => {
  const sel = $('#mci-tipo'); if (sel) sel.onchange = () => { const [tab] = String(parseRoute().arg || 'inspecao').split('~'); go(`modeloschk/${tab || 'inspecao'}~${sel.value}`); };
};
TITLES.modeloschk = 'Itens dos checklists';
if (typeof GRUPO_DA_ROTA === 'object') GRUPO_DA_ROTA.modeloschk = 'maquinas';
const mciRedesenhar = () => { const y = scrollY; render(); scrollTo(0, y); };
Object.assign(ACTIONS, {
  'mci-periodo': d => { mciPeriodo = Number(d) || 0; mciRedesenhar(); },
  'mci-pdf': id => mciPdf(id, false), 'mci-enviar': id => mciPdf(id, true),
  'mci-obrig': i => { mciLerRasc(); const it = mciRasc.itens[i]; if (it) it.obrig = !it.obrig; mciRedesenhar(); },
  'mci-mover': k => { mciLerRasc(); const [i, d] = String(k).split('|').map(Number), j = i + d, l = mciRasc.itens; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; mciRedesenhar(); },
  'mci-tirar': i => { mciLerRasc(); mciRasc.itens.splice(Number(i), 1); mciRedesenhar(); },
  'mci-add': () => { mciLerRasc(); mciRasc.itens.push({item: '', obrig: false}); mciRedesenhar(); setTimeout(() => $$('[data-mci-item]').at(-1)?.focus(), 30); },
  'mci-padrao': () => { mciRasc.itens = mciPadrao(mciRasc.tab, mciRasc.tipo); mciRedesenhar(); showToast('Itens padrão carregados: toque em Salvar modelo para usar'); },
  'mci-salvar': () => {
    if (!mcpSoGestor()) return;
    mciLerRasc();
    const itens = mciRasc.itens.filter(it => it.item), nomes = itens.map(it => mcNorm(it.item));
    if (!itens.length) { showToast('Deixe pelo menos um item', true); return; }
    const dup = nomes.find((n, i) => nomes.indexOf(n) !== i); if (dup) { showToast(`Item repetido: “${itens[nomes.indexOf(dup)].item}”`, true); return; }
    if (nomes.includes(mcNorm(MC_TESTE))) { showToast('O teste de funcionamento já entra sozinho no fim da revisão', true); return; }
    const atual = find(MCP_COL, MCI_CFG) || {id: MCI_CFG, tipo: 'config'}, padrao = JSON.stringify(mciPadrao(mciRasc.tab, mciRasc.tipo)) === JSON.stringify(itens);
    const parte = {...(atual[mciRasc.tab] || {})};
    if (padrao) delete parte[mciRasc.tipo]; else parte[mciRasc.tipo] = mciRasc.tab === 'inspecao' ? itens.map(it => it.item) : itens.map(it => [it.item, it.obrig ? 1 : 0]);
    upsert(MCP_COL, {...atual, [mciRasc.tab]: parte, tipo: 'config', por: quemUsa(), em: new Date().toISOString()});
    mciRasc = null; showToast(padrao ? 'Modelo padrão em uso' : 'Modelo salvo para a fazenda toda'); mciRedesenhar();
  }
});
