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
// Consumo para mostrar: máquina em L/h; veículo (odômetro) em km/L. lh = litros por unidade do medidor.
const consumoTxt = (m, lh) => !(lh > 0) ? '—' : porKm(m) ? `${um1(1 / lh)} km/L` : `${um1(lh)} L/h`;
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
  const ativas = db.machines.filter(m => !isInactive(m) && usaCombustivel(m));
  if (!ativas.length) { showToast('Cadastre uma máquina ativa primeiro'); return; }
  const diesel = db.stock.filter(s => s.category === 'Combustível');
  const m0 = machineId ? find('machines', machineId) : null;
  openForm({
    title: `Abastecimento${m0 ? ' — ' + m0.name : ''}`,
    sub: 'Para medir o consumo, abasteça até completar o tanque e marque “Tanque cheio”. O consumo é calculado entre dois tanques cheios.',
    values: {machineId, date: today(), cheio: 'Sim', origem: diesel.length ? 'estoque' : 'posto', gasto: 'Sim', itemId: diesel.length === 1 ? diesel[0].id : ''},
    fields: [
      {k: 'machineId', label: 'Máquina', type: 'select', options: () => machineOptions().filter(o => usaCombustivel(find('machines', o.value)) || o.value === machineId), labelAusente: maquinaAusente, required: true, full: true},
      {k: 'date', label: 'Data', type: 'date', required: true},
      {k: 'liters', label: 'Litros abastecidos', type: 'number', min: 0, required: true},
      {k: 'hours', label: m0 && porKm(m0) ? 'Odômetro no abastecimento (km)' : 'Horímetro no abastecimento (h)', type: 'number', min: 0, required: true, hint: m0 ? `Último registro: ${num(m0.hours)} ${unidMed(m0)}` : ''},
      {k: 'cheio', label: 'Tanque cheio?', type: 'select', options: ['Sim', 'Não'], required: true},
      {k: 'origem', label: 'Origem do combustível', type: 'select', options: [{value: 'estoque', label: 'Tanque da fazenda (sai do estoque)'}, {value: 'posto', label: 'Posto / compra direta'}], required: true},
      {k: 'itemId', label: 'Item do estoque (tanque da fazenda)', mostrarSe: ['origem', 'estoque'], type: 'select', options: () => diesel.map(s => ({value: s.id, label: `${s.name} — ${num(s.qty)} ${s.unit}`})), full: true},
      {k: 'value', label: 'Valor pago no posto (R$)', type: 'number', min: 0, mostrarSe: ['origem', 'posto']},
      {k: 'gasto', label: 'Lançar em Controle de gastos', type: 'select', options: ['Sim', 'Não'], required: true, mostrarSe: ['origem', 'posto']},
      {k: 'operator', label: 'Operador', mais: true},
      {k: 'notes', label: 'Observações', type: 'textarea', mais: true}
    ],
    onSubmit: v => {
      const m = find('machines', v.machineId); if (!m) return 'Selecione a máquina';
      if (!(v.liters > 0)) return 'Informe os litros abastecidos';
      const anterior = db.fuel.filter(f => f.machineId === m.id && Number(f.hours) > 0).sort((a, b) => Number(b.hours) - Number(a.hours))[0];
      if (anterior && Number(v.hours) < Number(anterior.hours)) return `${NomeMed(m)} menor que o do último abastecimento (${num(anterior.hours)} ${unidMed(m)})`;
      const salto = typeof conferirSalto === 'function' ? conferirSalto(m, v.hours, v.date) : ''; if (salto) return salto;
      const dup = typeof conferirRepetido === 'function' ? conferirRepetido('fuel', f => f.machineId === m.id && f.date === v.date && Number(f.liters) === Number(v.liters), `já existe um abastecimento de ${num(v.liters)} L de ${m.name} em ${fmtDate(v.date)}`) : ''; if (dup) return dup;
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
      // Guarda o id do registro de horímetro para desfazer ao excluir o abastecimento
      if (Number(v.hours) > Number(m.hours || 0)) { const hl = {id: uid(), machineId: m.id, date: v.date, hours: v.hours, previous: Number(m.hours || 0), notes: 'Abastecimento', fuelId: reg.id}; db.hourLogs.push(hl); m.hours = v.hours; reg.hourLogId = hl.id; }
      db.fuel.push(reg); save();
      const r = resumoConsumo(m.id);
      showToast(r && r.ultimo.ate.id === reg.id ? `${m.name}: ${consumoTxt(m, r.ultimo.lh)} desde o último tanque cheio` : `Abastecimento de ${m.name} salvo`);
    }
  });
  // Rótulo da leitura conforme a máquina escolhida (horímetro ou odômetro)
  const sel = $('#f_machineId', dialog), rotular = () => { const m = find('machines', sel?.value), f = $('#f_hours', dialog)?.closest('.field'); if (!f || !m) return;
    f.querySelector('label').textContent = `${porKm(m) ? 'Odômetro no abastecimento (km)' : 'Horímetro no abastecimento (h)'} *`; const h = f.querySelector('.hint'); if (h) h.textContent = `Último registro: ${num(m.hours)} ${unidMed(m)}`; };
  sel?.addEventListener('change', rotular); rotular();
}

// Custo do abastecimento: valor pago (posto) ou custo médio do item na saída do estoque.
// Registro antigo do tanque da fazenda sem custo: usa o custo da movimentação ou, se não houver, o custo médio atual do item (estimado).
function custoAbast(f) {
  if (Number(f.value) > 0) return {v: Number(f.value)};
  if (f.origem !== 'estoque') return {v: 0, falta: 'posto'};
  const mov = db.movements.find(m => m.fuelId === f.id && m.kind === 'Saída');
  if (Number(mov?.value) > 0) return {v: Number(mov.value)};
  const cm = custoMedio(find('stock', f.itemId || mov?.itemId));
  return cm != null ? {v: cm * Number(f.liters || 0), est: true} : {v: 0, falta: 'estoque'};
}

const PERIODOS_COMB = [['mes', 'Este mês'], ['30', '30 dias'], ['90', '90 dias'], ['365', '12 meses'], ['tudo', 'Tudo']];
const inicioComb = () => combPeriodo === 'tudo' ? '' : combPeriodo === 'mes' ? today().slice(0, 8) + '01' : daysAgo(Number(combPeriodo) - 1);

VIEWS.combustivel = () => {
  const desde = inicioComb(), lista = db.fuel.filter(f => f.date >= desde && f.date <= today()).sort(byDateDesc);
  const custos = new Map(lista.map(f => [f.id, custoAbast(f)]));
  const litros = lista.reduce((s, f) => s + Number(f.liters || 0), 0), valor = lista.reduce((s, f) => s + custos.get(f.id).v, 0);
  const semPosto = lista.filter(f => custos.get(f.id).falta === 'posto').length, semCusto = lista.filter(f => custos.get(f.id).falta === 'estoque').length, estimados = lista.filter(f => custos.get(f.id).est).length;
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const dicaCusto = [semPosto && plural(semPosto, 'compra no posto sem valor informado', 'compras no posto sem valor informado'), semCusto && plural(semCusto, 'saída do tanque com item sem custo médio', 'saídas do tanque com item sem custo médio'), estimados && plural(estimados, 'estimado pelo custo médio atual', 'estimados pelo custo médio atual')].filter(Boolean).join(' • ');
  const maquinas = db.machines.map(m => ({m, r: resumoConsumo(m.id), l: lista.filter(f => f.machineId === m.id).reduce((s, f) => s + Number(f.liters || 0), 0)})).filter(x => x.r || x.l);
  const avisos = maquinas.filter(x => x.r?.acima);
  const linha = f => `<tr><td>${fmtDate(f.date)}</td><td><strong>${esc(machineName(f.machineId) || 'Máquina removida')}</strong>${f.operator ? `<br><small style="color:var(--muted)">${esc(f.operator)}</small>` : ''}</td><td class="num">${num(f.liters)} L</td><td class="num">${num(f.hours)} ${unidMed(find('machines', f.machineId))}</td><td>${f.cheio === 'Sim' ? chip('Tanque cheio', 'blue') : chip('Parcial', 'gray')}</td><td>${f.origem === 'estoque' ? 'Estoque' : 'Posto'}</td><td class="num">${(c => c.v > 0 ? `R$ ${num(c.v, 2)}${c.est ? '<br><small>estimado</small>' : ''}` : '—')(custos.get(f.id))}</td><td>${mini('Excluir', 'cb-del', f.id, 'del')}</td></tr>`;
  return head('Combustível', 'Abastecimentos por máquina e consumo pelo método do tanque cheio', btn('+ Abastecimento', 'cb-new')) +
    `<div class="filters">${PERIODOS_COMB.map(([k, r]) => `<button class="${k === combPeriodo ? 'active' : ''}" data-act="cb-periodo" data-id="${k}">${r}</button>`).join('')}</div>
    <section class="es-kpis">
      <article class="card kpi"><div class="label">Litros abastecidos</div><div class="value">${num(litros)} L</div><div class="hint">${plural(lista.length, 'abastecimento', 'abastecimentos')}</div></article>
      <article class="card kpi"><div class="label">Custo do combustível</div><div class="value">R$ ${num(valor, 2)}</div><div class="hint">${dicaCusto || 'pelo custo médio ou valor pago'}</div></article>
      <article class="card kpi ${avisos.length ? 'aviso' : ''}"><div class="label">Consumo acima do normal</div><div class="value">${avisos.length}</div><div class="hint">${esc(avisos.map(x => x.m.name).join(', ') || 'mais de 20% acima da média da própria máquina')}</div></article>
      <article class="card kpi"><div class="label">Máquinas com consumo medido</div><div class="value">${maquinas.filter(x => x.r).length}</div><div class="hint">precisam de 2 tanques cheios</div></article>
    </section>
    <div class="section-title"><h3>Consumo por máquina</h3></div>
    <section class="card panel">${maquinas.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Máquina</th><th class="num">Último intervalo</th><th class="num">Média da máquina</th><th class="num">L/ha</th><th class="num">Litros no período</th><th></th></tr></thead><tbody>${maquinas.map(({m, r, l}) => `<tr><td><strong>${esc(m.name)}</strong></td><td class="num">${r ? `${consumoTxt(m, r.ultimo.lh)}<br><small>${num(r.ultimo.litros)} L em ${um1(r.ultimo.horas)} ${unidMed(m)}</small>` : '—'}</td><td class="num">${r ? consumoTxt(m, r.mediaGeral) : '—'}</td><td class="num">${r?.lha != null ? um1(r.lha) : '—'}</td><td class="num">${num(l)} L</td><td>${r?.acima ? chip('acima do normal', 'orange') : r ? chip('normal', 'green') : chip('medindo', 'gray')}</td></tr>`).join('')}</tbody></table></div>
      <p class="nota">Consumo = litros colocados desde o último tanque cheio ÷ horas do horímetro entre os dois (máquina, L/h); veículo: km do odômetro ÷ litros (km/L). L/ha usa a área das operações concluídas da máquina no intervalo. “Acima do normal” compara o último intervalo com a média anterior da própria máquina (aviso operacional, mais de 20%).</p>` : empty('Nenhum abastecimento', 'Registre os abastecimentos com o horímetro e marque quando completar o tanque.', {act: 'cb-new', label: '+ Abastecimento'})}</section>
    ${lista.length ? `<div class="section-title"><h3>Abastecimentos</h3></div><section class="card panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Máquina</th><th class="num">Litros</th><th class="num">Horímetro</th><th>Tanque</th><th>Origem</th><th class="num">Valor</th><th></th></tr></thead><tbody>${lista.map(linha).join('')}</tbody></table></div></section>` : ''}`;
};

TITLES.combustivel = 'Combustível';
Object.assign(ACTIONS, {
  'cb-new': id => abastecimentoForm(id),
  'cb-periodo': id => { combPeriodo = id; render(); },
  'cb-del': id => confirmDialog('Excluir este abastecimento? Se saiu do estoque, o combustível volta para o saldo.', () => {
    const f = find('fuel', id), m = f && find('machines', f.machineId);
    db.movements.filter(m => m.fuelId === id && m.kind === 'Saída').forEach(m => { const s = find('stock', m.itemId); if (s) s.qty = Number(s.qty || 0) + Number(m.qty); });
    db.movements = db.movements.filter(m => m.fuelId !== id); db.expenses = db.expenses.filter(g => g.fuelId !== id);
    // Desfaz o horímetro lançado pelo abastecimento (registros antigos: procura pelo mesmo dia e leitura)
    const hl = f && (db.hourLogs.find(h => h.id === f.hourLogId) || db.hourLogs.find(h => h.fuelId === id) || (!f.hourLogId ? db.hourLogs.find(h => h.notes === 'Abastecimento' && h.machineId === f.machineId && h.date === f.date && Number(h.hours) === Number(f.hours)) : null));
    if (hl) {
      db.hourLogs = db.hourLogs.filter(h => h.id !== hl.id);
      // Só volta o horímetro se esta leitura ainda for a última da máquina
      if (m && Number(m.hours) === Number(hl.hours)) m.hours = Math.max(Number(hl.previous) || 0, ...db.hourLogs.filter(h => h.machineId === m.id).map(h => Number(h.hours) || 0));
    }
    remove('fuel', id); showToast('Excluído');
  })
});

// Alerta na Visão geral quando o último consumo medido ficar acima do normal da própria máquina
const alertasSemCombustivel = alerts;
alerts = function () {
  const lista = alertasSemCombustivel();
  db.machines.filter(m => !isInactive(m)).forEach(m => { const r = resumoConsumo(m.id); if (r?.acima) lista.push({color: 'orange', icon: '⛽', title: `Consumo acima do normal: ${m.name}`, text: `${consumoTxt(m, r.ultimo.lh)} no último intervalo; média anterior ${consumoTxt(m, r.mediaAnterior)}.`, route: 'combustivel'}); });
  return lista;
};
