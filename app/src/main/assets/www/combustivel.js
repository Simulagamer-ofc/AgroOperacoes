'use strict';
/* Combustível por máquina: abastecimentos com horímetro, consumo pelo método do tanque cheio
   (litros entre dois enchimentos ÷ horas trabalhadas entre eles) e custo. Só usa dados lançados. */

const LIMITE_AVISO_CONSUMO = 0.2; // aviso operacional: consumo 20% acima da média da própria máquina (não é referência técnica)
let combPeriodo = 'mes';

// Intervalos entre abastecimentos de tanque cheio da máquina: L/h e L/ha
function intervalosConsumo(machineId) {
  const ab = db.fuel.filter(f => f.machineId === machineId && Number(f.hours) > 0).sort((a, b) => Number(a.hours) - Number(b.hours) || a.date.localeCompare(b.date));
  const out = [];
  let ultimoCheio = null, litros = 0;
  for (const f of ab) {
    if (ultimoCheio) litros += Number(f.liters) || 0;
    if (f.cheio === 'Sim') {
      if (ultimoCheio) {
        const horas = Number(f.hours) - Number(ultimoCheio.hours);
        const area = db.operations.filter(o => o.machineId === machineId && o.status === 'Concluída' && o.date > ultimoCheio.date && o.date <= f.date).reduce((s, o) => s + (Number(o.area) || 0), 0);
        if (horas > 0) out.push({de: ultimoCheio, ate: f, litros, horas, lh: litros / horas, area, lha: area > 0 ? litros / area : null});
      }
      ultimoCheio = f; litros = 0;
    }
  }
  return out;
}
function resumoConsumo(machineId) {
  const ints = intervalosConsumo(machineId);
  if (!ints.length) return null;
  const ult = ints.at(-1), ant = ints.slice(0, -1);
  const media = ant.length ? ant.reduce((s, i) => s + i.litros, 0) / ant.reduce((s, i) => s + i.horas, 0) : null;
  const tl = ints.reduce((s, i) => s + i.litros, 0), th = ints.reduce((s, i) => s + i.horas, 0);
  const comArea = ints.filter(i => i.area > 0), lha = comArea.length ? comArea.reduce((s, i) => s + i.litros, 0) / comArea.reduce((s, i) => s + i.area, 0) : null;
  return {ultimo: ult, mediaGeral: tl / th, mediaAnterior: media, lha, intervalos: ints.length,
    acima: media != null && ult.lh > media * (1 + LIMITE_AVISO_CONSUMO)};
}

function abastecimentoForm(machineId) {
  const ativas = db.machines.filter(m => !isInactive(m));
  if (!ativas.length) { showToast('Cadastre uma máquina ativa primeiro'); return; }
  const diesel = db.stock.filter(s => s.category === 'Combustível');
  const m0 = machineId ? find('machines', machineId) : null;
  openForm({
    title: `Abastecimento${m0 ? ' — ' + m0.name : ''}`,
    sub: 'Para medir o consumo, abasteça até completar o tanque e marque “Tanque cheio”. O consumo é calculado entre dois tanques cheios.',
    values: {machineId, date: today(), cheio: 'Sim', origem: diesel.length ? 'estoque' : 'posto', gasto: 'Sim', itemId: diesel.length === 1 ? diesel[0].id : ''},
    fields: [
      {k: 'machineId', label: 'Máquina', type: 'select', options: machineOptions, labelAusente: maquinaAusente, required: true, full: true},
      {k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'liters', label: 'Litros abastecidos', type: 'number', min: 0, required: true},
      {k: 'hours', label: 'Horímetro no abastecimento (h)', type: 'number', min: 0, required: true, hint: m0 ? `Último horímetro: ${num(m0.hours)} h` : ''},
      {k: 'cheio', label: 'Tanque cheio?', type: 'select', options: ['Sim', 'Não'], required: true},
      {k: 'origem', label: 'Origem do combustível', type: 'select', options: [{value: 'estoque', label: 'Tanque da fazenda (sai do estoque)'}, {value: 'posto', label: 'Posto / compra direta'}], required: true},
      {k: 'itemId', label: 'Item do estoque (tanque da fazenda)', type: 'select', options: () => diesel.map(s => ({value: s.id, label: `${s.name} — ${num(s.qty)} ${s.unit}`})), full: true},
      {k: 'value', label: 'Valor pago (R$) — compra no posto', type: 'number', min: 0},
      {k: 'gasto', label: 'Lançar compra no posto em Controle de gastos', type: 'select', options: ['Sim', 'Não'], required: true},
      {k: 'operator', label: 'Operador'},
      {k: 'notes', label: 'Observações', type: 'textarea'}
    ],
    onSubmit: v => {
      const m = find('machines', v.machineId); if (!m) return 'Selecione a máquina';
      if (!(v.liters > 0)) return 'Informe os litros abastecidos';
      const anterior = db.fuel.filter(f => f.machineId === m.id && Number(f.hours) > 0).sort((a, b) => Number(b.hours) - Number(a.hours))[0];
      if (anterior && Number(v.hours) < Number(anterior.hours)) return `Horímetro menor que o do último abastecimento (${num(anterior.hours)} h)`;
      const reg = {id: uid(), machineId: m.id, date: v.date, liters: v.liters, hours: v.hours, cheio: v.cheio, origem: v.origem, operator: v.operator, notes: v.notes};
      if (v.origem === 'estoque') {
        const s = find('stock', v.itemId);
        if (!s) return 'Escolha o item de combustível do estoque (ou mude a origem para posto)';
        if (v.liters > Number(s.qty || 0)) return `Saldo insuficiente de ${s.name} (${num(s.qty)} ${s.unit})`;
        const mov = aplicarMovimento(s, 'Saída', v.liters, 0);
        db.movements.push({id: uid(), itemId: s.id, kind: 'Saída', qty: v.liters, date: v.date, notes: `Abastecimento — ${m.name}`, fuelId: reg.id, machineId: m.id, ...mov});
        Object.assign(reg, {itemId: s.id, value: mov.value ?? '', unitCost: mov.unitCost ?? ''});
      } else {
        reg.value = v.value > 0 ? v.value : '';
        if (v.value > 0 && v.gasto === 'Sim') db.expenses.push({id: uid(), date: v.date, category: 'Combustível', description: `Abastecimento ${m.name} — ${num(v.liters)} L`, value: v.value, machineId: m.id, fuelId: reg.id});
      }
      // Horímetro do abastecimento atualiza a máquina (como no registro de horímetro)
      if (Number(v.hours) > Number(m.hours || 0)) { db.hourLogs.push({id: uid(), machineId: m.id, date: v.date, hours: v.hours, previous: Number(m.hours || 0), notes: 'Abastecimento'}); m.hours = v.hours; }
      db.fuel.push(reg); save();
      const r = resumoConsumo(m.id);
      showToast(r && r.ultimo.ate.id === reg.id ? `${m.name}: ${um1(r.ultimo.lh)} L/h desde o último tanque cheio` : `Abastecimento de ${m.name} salvo`);
    }
  });
}

const PERIODOS_COMB = [['mes', 'Este mês'], ['30', '30 dias'], ['90', '90 dias'], ['365', '12 meses'], ['tudo', 'Tudo']];
const inicioComb = () => combPeriodo === 'tudo' ? '' : combPeriodo === 'mes' ? today().slice(0, 8) + '01' : daysAgo(Number(combPeriodo) - 1);

VIEWS.combustivel = () => {
  const desde = inicioComb(), lista = db.fuel.filter(f => f.date >= desde && f.date <= today()).sort(byDateDesc);
  const litros = lista.reduce((s, f) => s + Number(f.liters || 0), 0), valor = lista.reduce((s, f) => s + (Number(f.value) || 0), 0), semValor = lista.filter(f => !(Number(f.value) > 0)).length;
  const maquinas = db.machines.map(m => ({m, r: resumoConsumo(m.id), l: lista.filter(f => f.machineId === m.id).reduce((s, f) => s + Number(f.liters || 0), 0)})).filter(x => x.r || x.l);
  const avisos = maquinas.filter(x => x.r?.acima);
  const linha = f => `<tr><td>${fmtDate(f.date)}</td><td><strong>${esc(machineName(f.machineId) || 'Máquina removida')}</strong>${f.operator ? `<br><small style="color:var(--muted)">${esc(f.operator)}</small>` : ''}</td><td class="num">${num(f.liters)} L</td><td class="num">${num(f.hours)} h</td><td>${f.cheio === 'Sim' ? chip('Tanque cheio', 'blue') : chip('Parcial', 'gray')}</td><td>${f.origem === 'estoque' ? 'Estoque' : 'Posto'}</td><td class="num">${Number(f.value) > 0 ? 'R$ ' + num(f.value, 2) : '—'}</td><td>${mini('Excluir', 'cb-del', f.id, 'del')}</td></tr>`;
  return head('Combustível', 'Abastecimentos por máquina e consumo pelo método do tanque cheio', btn('+ Abastecimento', 'cb-new')) +
    `<div class="filters">${PERIODOS_COMB.map(([k, r]) => `<button class="${k === combPeriodo ? 'active' : ''}" data-act="cb-periodo" data-id="${k}">${r}</button>`).join('')}</div>
    <section class="es-kpis">
      <article class="card kpi"><div class="label">Litros abastecidos</div><div class="value">${num(litros)} L</div><div class="hint">${lista.length} abastecimento(s)</div></article>
      <article class="card kpi"><div class="label">Custo do combustível</div><div class="value">R$ ${num(valor, 2)}</div><div class="hint">${semValor ? `${semValor} sem valor (item sem custo médio)` : 'pelo custo médio ou valor pago'}</div></article>
      <article class="card kpi ${avisos.length ? 'aviso' : ''}"><div class="label">Consumo acima do normal</div><div class="value">${avisos.length}</div><div class="hint">${esc(avisos.map(x => x.m.name).join(', ') || 'mais de 20% acima da média da própria máquina')}</div></article>
      <article class="card kpi"><div class="label">Máquinas com consumo medido</div><div class="value">${maquinas.filter(x => x.r).length}</div><div class="hint">precisam de 2 tanques cheios</div></article>
    </section>
    <div class="section-title"><h3>Consumo por máquina</h3></div>
    <section class="card panel">${maquinas.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Máquina</th><th class="num">Último intervalo</th><th class="num">Média da máquina</th><th class="num">L/ha</th><th class="num">Litros no período</th><th></th></tr></thead><tbody>${maquinas.map(({m, r, l}) => `<tr><td><strong>${esc(m.name)}</strong></td><td class="num">${r ? `${um1(r.ultimo.lh)} L/h<br><small>${num(r.ultimo.litros)} L em ${um1(r.ultimo.horas)} h</small>` : '—'}</td><td class="num">${r ? um1(r.mediaGeral) + ' L/h' : '—'}</td><td class="num">${r?.lha != null ? um1(r.lha) : '—'}</td><td class="num">${num(l)} L</td><td>${r?.acima ? chip('acima do normal', 'orange') : r ? chip('normal', 'green') : chip('medindo', 'gray')}</td></tr>`).join('')}</tbody></table></div>
      <p class="nota">Consumo = litros colocados desde o último tanque cheio ÷ horas do horímetro entre os dois. L/ha usa a área das operações concluídas da máquina no intervalo. “Acima do normal” compara o último intervalo com a média anterior da própria máquina (aviso operacional, mais de 20%).</p>` : empty('Nenhum abastecimento', 'Registre os abastecimentos com o horímetro e marque quando completar o tanque.', {act: 'cb-new', label: '+ Abastecimento'})}</section>
    ${lista.length ? `<div class="section-title"><h3>Abastecimentos</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Máquina</th><th class="num">Litros</th><th class="num">Horímetro</th><th>Tanque</th><th>Origem</th><th class="num">Valor</th><th></th></tr></thead><tbody>${lista.map(linha).join('')}</tbody></table></div></section>` : ''}`;
};

TITLES.combustivel = 'Combustível';
Object.assign(ACTIONS, {
  'cb-new': id => abastecimentoForm(id),
  'cb-periodo': id => { combPeriodo = id; render(); },
  'cb-del': id => confirmDialog('Excluir este abastecimento? Se saiu do estoque, o combustível volta para o saldo.', () => {
    db.movements.filter(m => m.fuelId === id && m.kind === 'Saída').forEach(m => { const s = find('stock', m.itemId); if (s) s.qty = Number(s.qty || 0) + Number(m.qty); });
    db.movements = db.movements.filter(m => m.fuelId !== id); db.expenses = db.expenses.filter(g => g.fuelId !== id);
    remove('fuel', id);
  })
});

// Alerta na Visão geral quando o último consumo medido ficar acima do normal da própria máquina
const alertasSemCombustivel = alerts;
alerts = function () {
  const lista = alertasSemCombustivel();
  db.machines.filter(m => !isInactive(m)).forEach(m => { const r = resumoConsumo(m.id); if (r?.acima) lista.push({color: 'orange', icon: '⛽', title: `Consumo acima do normal: ${m.name}`, text: `${um1(r.ultimo.lh)} L/h no último intervalo; média anterior ${um1(r.mediaAnterior)} L/h.`, route: 'combustivel'}); });
  return lista;
};
