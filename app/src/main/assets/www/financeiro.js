'use strict';
/* Financeiro: contas a pagar e a receber (com parcelas), baixa, vencimentos e fluxo de caixa.
   Regime de caixa: o que conta é a data em que o dinheiro saiu ou entrou.
   Saídas realizadas = contas a pagar pagas + gastos e manutenções à vista (sem conta a pagar ligada).
   Entradas realizadas = contas a receber recebidas. Previsto = contas em aberto pelo vencimento. */

const CAT_RECEITA = ['Venda de grãos', 'Venda de sementes', 'Serviços prestados', 'Arrendamento recebido', 'Outras receitas'];
const CAT_PAGAR = [...CAT_GASTO, 'Financiamento / parcela', 'Impostos e taxas'];
let finAba = 'pagar', finFiltro = 'abertas';

const contaVencida = c => c.status !== 'paga' && c.vencimento < today();
const valorAberto = c => c.status === 'paga' ? 0 : Number(c.valor) || 0;
const brl2 = v => 'R$ ' + num(v, 2);
const addMeses = (iso, n) => { const [a, m, d] = iso.split('-').map(Number), dt = new Date(a, m - 1 + n, 1); const ult = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate(); return isoDate(new Date(dt.getFullYear(), dt.getMonth(), Math.min(d, ult))); };

// Divide um valor em parcelas mensais; a última absorve os centavos
function gerarParcelas(base, total, n, primeiro) {
  const cada = Math.floor(total / n * 100) / 100;
  return Array.from({length: n}, (_, i) => ({...base, id: uid(), valor: i === n - 1 ? Math.round((total - cada * (n - 1)) * 100) / 100 : cada,
    vencimento: addMeses(primeiro, i), parcela: n > 1 ? `${i + 1}/${n}` : '', status: 'aberta'}));
}

function contaForm(tipo, c = {}) {
  const pagar = tipo === 'pagar', nova = !c.id;
  openForm({
    title: nova ? (pagar ? 'Nova conta a pagar' : 'Nova conta a receber') : (pagar ? 'Editar conta a pagar' : 'Editar conta a receber'),
    sub: nova ? 'Com mais de uma parcela, o valor é dividido em vencimentos mensais.' : (c.parcela ? `Parcela ${c.parcela}` : ''),
    values: {vencimento: today(), parcelas: 1, lancarGasto: 'Sim', ...c},
    fields: [
      {k: 'descricao', label: 'Descrição', required: true, full: true, placeholder: pagar ? 'Ex.: Fertilizante — revenda' : 'Ex.: Venda de soja — trading'},
      {k: 'categoria', label: 'Categoria', type: 'select', options: pagar ? CAT_PAGAR : CAT_RECEITA, required: true},
      {k: 'parceiro', label: pagar ? 'Fornecedor / credor' : 'Cliente'},
      {k: 'valor', label: nova ? 'Valor total (R$)' : 'Valor (R$)', type: 'number', min: 0, required: true},
      ...(nova ? [{k: 'parcelas', label: 'Parcelas', type: 'number', min: 1, required: true}] : []),
      {k: 'vencimento', label: nova ? 'Vencimento (1ª parcela)' : 'Vencimento', type: 'date', required: true},
      {k: 'doc', label: 'Documento', placeholder: 'Nota, boleto, contrato'},
      ...(pagar ? [{k: 'machineId', label: 'Máquina', type: 'select', options: () => db.machines.map(m => ({value: m.id, label: m.name})), labelAusente: maquinaAusente},
        {k: 'fieldId', label: 'Talhão', type: 'select', options: fieldOptions}, {k: 'season', label: 'Safra', placeholder: 'Ex.: 2026/27'},
        ...(c.expenseId ? [] : [{k: 'lancarGasto', label: 'Lançar como gasto ao pagar', type: 'select', options: ['Sim', 'Não'], required: true, hint: 'Use “Não” se o gasto já foi lançado (ex.: compra no estoque).'}])] : [{k: 'season', label: 'Safra', placeholder: 'Ex.: 2026/27'}]),
      {k: 'notas', label: 'Observações', type: 'textarea'}
    ],
    onSubmit: v => {
      if (!(v.valor > 0)) return 'Informe um valor maior que zero';
      if (nova) {
        const n = Math.round(Number(v.parcelas) || 1); if (n < 1 || n > 120) return 'Parcelas entre 1 e 120';
        const {parcelas, valor, vencimento, ...base} = v;
        gerarParcelas({...base, tipo, grupo: uid()}, valor, n, vencimento).forEach(p => db.contas.push(p));
        save(); showToast(n > 1 ? `${n} parcelas lançadas` : 'Conta lançada');
      } else { upsert('contas', {...c, ...v}); showToast('Conta salva'); }
    }
  });
}

function baixarConta(id) {
  const c = find('contas', id); if (!c) return;
  const pagar = c.tipo === 'pagar';
  openForm({
    title: pagar ? `Pagar — ${c.descricao}` : `Receber — ${c.descricao}`,
    sub: `${c.parcela ? 'Parcela ' + c.parcela + ' • ' : ''}vencimento ${fmtDate(c.vencimento)} • ${brl2(c.valor)}`,
    values: {pagoEm: today(), valorPago: c.valor, parcial: 'saldo'},
    fields: [{k: 'pagoEm', label: pagar ? 'Data do pagamento' : 'Data do recebimento', type: 'date', required: true},
      {k: 'valorPago', label: 'Valor efetivo (R$)', type: 'number', min: 0, required: true, hint: 'Com juros, multa ou desconto, informe o valor que de fato saiu ou entrou.'},
      {k: 'conta', label: 'Forma / conta', placeholder: 'Ex.: Pix, boleto, banco'},
      {k: 'parcial', label: 'Se o valor for menor que o da conta', type: 'select', options: [{value: 'saldo', label: 'Pagamento parcial: manter o restante em aberto'}, {value: 'quitar', label: 'Quitar a conta (desconto)'}], required: true}],
    onSubmit: v => {
      if (!(v.valorPago > 0)) return 'Informe o valor';
      // Pagamento parcial: esta conta fica paga pelo valor efetivo e o restante vira uma conta em aberto no mesmo vencimento
      const resto = Math.round((Number(c.valor) - v.valorPago) * 100) / 100, parcial = v.parcial === 'saldo' && resto > 0;
      if (parcial) {
        const {gastoGeradoId, pagoEm, valorPago, formaPagamento, saldoContaId, ...base} = c;
        const saldo = {...base, id: uid(), valor: resto, status: 'aberta', saldoDe: c.id};
        db.contas.push(saldo); Object.assign(c, {valor: v.valorPago, valorOriginal: c.valorOriginal ?? c.valor, saldoContaId: saldo.id});
      }
      Object.assign(c, {status: 'paga', pagoEm: v.pagoEm, valorPago: v.valorPago, formaPagamento: v.conta});
      // Conta a pagar sem gasto ligado: vira gasto na data do pagamento (custo pelo valor efetivo)
      if (pagar && !c.expenseId && c.lancarGasto === 'Sim' && CAT_GASTO.includes(c.categoria)) {
        const g = {id: uid(), date: v.pagoEm, category: c.categoria, description: c.descricao + (c.parcela ? ` (${c.parcela})` : ''), value: v.valorPago, supplier: c.parceiro, doc: c.doc, machineId: c.machineId || '', fieldId: c.fieldId || '', season: c.season || '', contaId: c.id};
        db.expenses.push(g); c.gastoGeradoId = g.id;
      }
      save(); showToast(parcial ? `${pagar ? 'Pagamento' : 'Recebimento'} parcial registrado • restante em aberto` : pagar ? 'Pagamento registrado' : 'Recebimento registrado');
    }
  });
}
function estornarConta(id) {
  const c = find('contas', id); if (!c) return;
  confirmDialog(`Desfazer a baixa de “${c.descricao}”? A conta volta para em aberto.`, () => {
    if (c.gastoGeradoId) db.expenses = db.expenses.filter(g => g.id !== c.gastoGeradoId);
    // Pagamento parcial: o restante ainda em aberto volta para esta conta
    const saldo = c.saldoContaId && find('contas', c.saldoContaId);
    if (saldo && saldo.status !== 'paga') { c.valor = Math.round((Number(c.valor) + Number(saldo.valor)) * 100) / 100; db.contas = db.contas.filter(x => x.id !== saldo.id); delete c.saldoContaId; delete c.valorOriginal; }
    delete c.gastoGeradoId; c.status = 'aberta'; delete c.pagoEm; delete c.valorPago; save();
  }, 'Desfazer');
}

// ----- Fluxo de caixa (mês a mês) -----
function movimentosCaixa() {
  const out = [];
  const comConta = new Set(db.contas.filter(c => c.expenseId).map(c => c.expenseId));
  db.contas.forEach(c => {
    if (c.status === 'paga') out.push({data: c.pagoEm, valor: Number(c.valorPago) || 0, tipo: c.tipo === 'pagar' ? 'saida' : 'entrada', realizado: true, desc: c.descricao});
    else out.push({data: c.vencimento, valor: Number(c.valor) || 0, tipo: c.tipo === 'pagar' ? 'saida' : 'entrada', realizado: false, desc: c.descricao});
  });
  // Gastos e manutenções à vista (sem conta a pagar ligada) já saíram do caixa na data
  db.expenses.filter(g => Number(g.value) > 0 && !g.contaId && !comConta.has(g.id)).forEach(g => out.push({data: g.date, valor: Number(g.value), tipo: 'saida', realizado: true, desc: g.description}));
  db.maintenances.filter(m => Number(m.cost) > 0 && m.status === 'Concluída').forEach(m => out.push({data: m.doneDate || m.date, valor: Number(m.cost), tipo: 'saida', realizado: true, desc: m.description}));
  return out.filter(x => x.data);
}
function fluxoMensal(meses = 6) {
  const hoje = new Date(today() + 'T12:00:00'), ini = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
  const movs = movimentosCaixa(), chave = d => d.slice(0, 7);
  const lista = Array.from({length: meses}, (_, k) => { const d = new Date(ini.getFullYear(), ini.getMonth() + k, 1); return {k: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, rot: `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, ent: 0, sai: 0, entPrev: 0, saiPrev: 0}; });
  const porK = Object.fromEntries(lista.map(x => [x.k, x]));
  let antesEnt = 0, antesSai = 0;
  movs.forEach(m => {
    const x = porK[chave(m.data)];
    if (!x) { if (m.data < lista[0].k && m.realizado) { if (m.tipo === 'entrada') antesEnt += m.valor; else antesSai += m.valor; } return; }
    if (m.tipo === 'entrada') m.realizado ? x.ent += m.valor : x.entPrev += m.valor; else m.realizado ? x.sai += m.valor : x.saiPrev += m.valor;
  });
  const saldoInicial = Number(db.settings.saldoInicial);
  let saldo = Number.isFinite(saldoInicial) && db.settings.saldoInicial !== '' && db.settings.saldoInicial != null ? saldoInicial + antesEnt - antesSai : null;
  lista.forEach(x => { if (saldo != null) { saldo += x.ent + x.entPrev - x.sai - x.saiPrev; x.saldo = saldo; } });
  const atrasadas = movs.filter(m => !m.realizado && m.data < lista[0].k);
  return {lista, temSaldo: saldo != null, atrasadas};
}
function graficoFluxo(lista) {
  const max = Math.max(1, ...lista.flatMap(x => [x.ent + x.entPrev, x.sai + x.saiPrev]));
  const barra = (real, prev, cls, n) => `<div class="fx-barra" ${tip(n, `${brl2(real + prev)}${prev ? ` (previsto ${brl2(prev)})` : ''}`)}><span class="${cls}" style="height:${real / max * 100}%"></span><span class="${cls} prev" style="height:${prev / max * 100}%"></span></div>`;
  return `<div class="fx-graf" role="img" aria-label="Entradas e saídas por mês">${lista.map(x => `<div class="fx-mes"><div class="fx-par">${barra(x.ent, x.entPrev, 'ent', `Entradas ${x.rot}`)}${barra(x.sai, x.saiPrev, 'sai', `Saídas ${x.rot}`)}</div><small>${x.rot}</small></div>`).join('')}</div>
    <ul class="fx-leg"><li><i class="ent"></i>Entradas</li><li><i class="sai"></i>Saídas</li><li><i class="prev-amostra"></i>Tom apagado = previsto (em aberto)</li></ul>`;
}

VIEWS.financeiro = () => {
  const t = today(), em7 = addDias(t, 7), em30 = addDias(t, 30);
  const pagarAbertas = db.contas.filter(c => c.tipo === 'pagar' && c.status !== 'paga'), receberAbertas = db.contas.filter(c => c.tipo === 'receber' && c.status !== 'paga');
  const venc = db.contas.filter(contaVencida);
  const soma = l => l.reduce((s, c) => s + valorAberto(c), 0);
  const fx = fluxoMensal(), mesAtual = fx.lista[2];
  const abas = [['pagar', `A pagar (${pagarAbertas.length})`], ['receber', `A receber (${receberAbertas.length})`], ['fluxo', 'Fluxo de caixa']];
  let corpo;
  if (finAba === 'fluxo') {
    corpo = `<section class="card panel viz-root"><div class="section-title" style="margin:0 0 8px"><h3>Entradas e saídas por mês</h3>${btn(db.settings.saldoInicial != null && db.settings.saldoInicial !== '' ? 'Saldo inicial: ' + brl2(db.settings.saldoInicial) : 'Informar saldo inicial', 'fin-saldo', '', 'secondary')}</div>
      ${graficoFluxo(fx.lista)}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mês</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Resultado</th>${fx.temSaldo ? '<th class="num">Saldo</th>' : ''}</tr></thead><tbody>${fx.lista.map(x => { const r = x.ent + x.entPrev - x.sai - x.saiPrev; return `<tr><td>${x.rot}</td><td class="num">${brl2(x.ent + x.entPrev)}${x.entPrev ? `<br><small>previsto ${brl2(x.entPrev)}</small>` : ''}</td><td class="num">${brl2(x.sai + x.saiPrev)}${x.saiPrev ? `<br><small>previsto ${brl2(x.saiPrev)}</small>` : ''}</td><td class="num"><strong>${r < 0 ? '− ' : ''}${brl2(Math.abs(r))}</strong></td>${fx.temSaldo ? `<td class="num">${x.saldo < 0 ? '− ' : ''}${brl2(Math.abs(x.saldo))}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>
      ${fx.atrasadas.length ? `<p class="nota">${fx.atrasadas.length === 1 ? '1 conta vencida' : fx.atrasadas.length + ' contas vencidas'} antes de ${fx.lista[0].rot} ainda em aberto ${fx.atrasadas.length === 1 ? 'não entra' : 'não entram'} nos meses acima — veja em “A pagar” / “A receber”.</p>` : ''}
      <p class="nota">Regime de caixa: pagas e recebidas pela data do pagamento; em aberto pelo vencimento. Gastos e manutenções sem conta a pagar ligada contam como pagos à vista na data do lançamento.${fx.temSaldo ? '' : ' Informe o saldo inicial para ver o saldo acumulado.'}</p></section>`;
  } else {
    const tipo = finAba, filtros = {abertas: ['Em aberto', c => c.status !== 'paga'], vencidas: ['Vencidas', contaVencida], pagas: [tipo === 'pagar' ? 'Pagas' : 'Recebidas', c => c.status === 'paga'], todas: ['Todas', () => true]};
    const lista = db.contas.filter(c => c.tipo === tipo && filtros[finFiltro][1](c)).sort((a, b) => (a.status === 'paga') - (b.status === 'paga') || (a.status === 'paga' ? (b.pagoEm || '').localeCompare(a.pagoEm || '') : a.vencimento.localeCompare(b.vencimento)));
    const linha = c => {
      const v = contaVencida(c), dias = Math.round((new Date(c.vencimento + 'T12:00:00') - new Date(t + 'T12:00:00')) / 864e5);
      const sit = c.status === 'paga' ? chip(`${tipo === 'pagar' ? 'Paga' : 'Recebida'} ${fmtDate(c.pagoEm)}`, 'green') : v ? chip(`Vencida há ${-dias} d`, 'red') : dias <= 7 ? chip(dias === 0 ? 'Vence hoje' : `Vence em ${dias} d`, 'orange') : chip('Em aberto', 'gray');
      return `<tr><td>${fmtDate(c.vencimento)}</td><td><strong>${esc(c.descricao)}</strong>${c.parcela ? ` <small>(${esc(c.parcela)})</small>` : ''}${c.saldoDe ? ' <small>(restante de pagamento parcial)</small>' : ''}<br><small style="color:var(--muted)">${esc([c.categoria, c.parceiro, c.doc].filter(Boolean).join(' • '))}</small></td><td class="num">${brl2(c.status === 'paga' ? c.valorPago : c.valor)}</td><td>${sit}</td><td><div class="row-actions">${c.status === 'paga' ? mini('Desfazer baixa', 'fin-estornar', c.id) : mini(tipo === 'pagar' ? 'Pagar' : 'Receber', 'fin-baixar', c.id)}${mini('Editar', 'fin-edit', c.id)}${mini('Excluir', 'fin-del', c.id, 'del')}</div></td></tr>`;
    };
    corpo = `<div class="filters">${Object.entries(filtros).map(([k, [r, f]]) => `<button class="${k === finFiltro ? 'active' : ''}" data-act="fin-filtro" data-id="${k}">${r} (${db.contas.filter(c => c.tipo === tipo && f(c)).length})</button>`).join('')}</div>
      <section class="card panel">${lista.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vencimento</th><th>Descrição</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>${lista.map(linha).join('')}</tbody></table></div>` : empty('Nenhuma conta aqui', tipo === 'pagar' ? 'Lance boletos, parcelas e compras a prazo.' : 'Lance vendas a prazo e outros valores a receber.', {act: tipo === 'pagar' ? 'fin-pagar' : 'fin-receber', label: tipo === 'pagar' ? '+ Conta a pagar' : '+ Conta a receber'})}</section>`;
  }
  return head('Financeiro', 'Contas a pagar e a receber, vencimentos e fluxo de caixa', btn('+ A receber', 'fin-receber', '', 'secondary') + btn('+ A pagar', 'fin-pagar')) +
    `<section class="es-kpis">
      <article class="card kpi ${venc.length ? 'alerta' : ''}"><div class="label">Vencidas</div><div class="value">${venc.length ? '! ' : ''}${venc.length}</div><div class="hint">${brl2(soma(venc))} em aberto</div></article>
      <article class="card kpi"><div class="label">A pagar em 7 dias</div><div class="value">${brl2(soma(pagarAbertas.filter(c => c.vencimento >= t && c.vencimento <= em7)))}</div><div class="hint">total em aberto ${brl2(soma(pagarAbertas))}</div></article>
      <article class="card kpi"><div class="label">A receber em 30 dias</div><div class="value">${brl2(soma(receberAbertas.filter(c => c.vencimento >= t && c.vencimento <= em30)))}</div><div class="hint">total em aberto ${brl2(soma(receberAbertas))}</div></article>
      <article class="card kpi"><div class="label">Resultado do mês</div><div class="value">${(() => { const r = mesAtual.ent + mesAtual.entPrev - mesAtual.sai - mesAtual.saiPrev; return (r < 0 ? '− ' : '') + brl2(Math.abs(r)); })()}</div><div class="hint">entradas − saídas, realizado + previsto</div></article>
    </section>
    <div class="filters fin-abas" role="tablist">${abas.map(([k, r]) => `<button class="${k === finAba ? 'active' : ''}" data-act="fin-aba" data-id="${k}" role="tab" aria-selected="${k === finAba}">${r}</button>`).join('')}</div>${corpo}`;
};

TITLES.financeiro = 'Financeiro';
Object.assign(ACTIONS, {
  'fin-pagar': () => contaForm('pagar'), 'fin-receber': () => contaForm('receber'),
  'fin-edit': id => { const c = find('contas', id); if (c) contaForm(c.tipo, c); },
  'fin-baixar': baixarConta, 'fin-estornar': estornarConta,
  'fin-del': id => { const c = find('contas', id); if (!c) return; confirmDialog(`Excluir “${c.descricao}${c.parcela ? ' ' + c.parcela : ''}”?${c.gastoGeradoId ? ' O gasto gerado no pagamento também será excluído.' : ''}`, () => { if (c.gastoGeradoId) db.expenses = db.expenses.filter(g => g.id !== c.gastoGeradoId); remove('contas', id); showToast('Excluído'); }); },
  'fin-aba': id => { finAba = id; finFiltro = 'abertas'; render(); },
  'fin-filtro': id => { finFiltro = id; render(); },
  'fin-saldo': () => openForm({title: 'Saldo inicial do caixa', sub: 'Saldo das contas da fazenda antes do primeiro mês do fluxo. Deixe em branco para não mostrar saldo.', values: {saldo: db.settings.saldoInicial ?? ''}, fields: [{k: 'saldo', label: 'Saldo (R$)', type: 'number'}],
    onSubmit: v => { db.settings.saldoInicial = v.saldo; save(); }})
});

// Alertas: contas vencidas ou vencendo em até 3 dias
const alertasSemFinanceiro = alerts;
alerts = function () {
  const lista = alertasSemFinanceiro(), t = today(), em3 = addDias(t, 3);
  const venc = db.contas.filter(contaVencida), prox = db.contas.filter(c => c.status !== 'paga' && c.vencimento >= t && c.vencimento <= em3);
  if (venc.length) lista.unshift({color: 'red', icon: '$', title: `${venc.length} ${venc.length === 1 ? 'conta vencida' : 'contas vencidas'}`, text: venc.slice(0, 3).map(c => `${c.descricao} (${fmtDate(c.vencimento)})`).join('; '), route: 'financeiro'});
  if (prox.length) lista.push({color: 'orange', icon: '$', title: `${prox.length} ${prox.length === 1 ? 'conta vence' : 'contas vencem'} em até 3 dias`, text: prox.slice(0, 3).map(c => `${c.descricao} — ${brl2(c.valor)} (${fmtDate(c.vencimento)})`).join('; '), route: 'financeiro'});
  return lista;
};
