'use strict';
/* Beneficiamento (UBS): ordem por lote com etapas configuráveis, descarte pesado em cada etapa,
   quebra de umidade calculada na secagem (F-QUEBRA-UMIDADE), saída em sacas e rendimento.
   Só usa pesos informados pelo usuário; nada é estimado sem medição. */

const ETAPAS_UBS = [
  {id: 'recebimento', nome: 'Recebimento', tipo: 'entrada', fixa: true},
  {id: 'pre_limpeza', nome: 'Pré-limpeza', tipo: 'descarte'},
  {id: 'secagem', nome: 'Secagem', tipo: 'secagem'},
  {id: 'ar_peneiras', nome: 'Máquina de ar e peneiras', tipo: 'descarte'},
  {id: 'espiral', nome: 'Espiral', tipo: 'descarte'},
  {id: 'mesa', nome: 'Mesa de gravidade', tipo: 'descarte'},
  {id: 'selecionadora', nome: 'Selecionadora eletrônica (cor)', tipo: 'descarte', padraoDesligada: true},
  {id: 'tratamento', nome: 'Tratamento', tipo: 'tratamento'},
  {id: 'ensaque', nome: 'Ensaque', tipo: 'ensaque', fixa: true}
];
const etapaUbs = id => ETAPAS_UBS.find(e => e.id === id) || {id, nome: id, tipo: 'descarte'};
const etapasConfiguradas = () => Array.isArray(db.settings.ubsEtapas) && db.settings.ubsEtapas.length
  ? ETAPAS_UBS.filter(e => e.fixa || db.settings.ubsEtapas.includes(e.id)).map(e => e.id)
  : ETAPAS_UBS.filter(e => !e.padraoDesligada).map(e => e.id);
let ubsFiltro = 'todas';

// Pesos ao longo das etapas registradas. Rendimento final = peso ensacado ÷ peso recebido.
function calcOrdem(o) {
  const reg = o.registros || {}, entrada = Number(reg.recebimento?.pesoKg) || 0;
  let restante = entrada;
  const passos = [];
  for (const id of o.etapas) {
    const r = reg[id], e = etapaUbs(id);
    if (!r || id === 'recebimento') continue;
    if (e.tipo === 'descarte') { restante -= Number(r.descarteKg) || 0; passos.push({id, nome: e.nome, perdaKg: Number(r.descarteKg) || 0, aposKg: restante}); }
    if (e.tipo === 'secagem') { restante -= Number(r.quebraKg) || 0; passos.push({id, nome: e.nome, perdaKg: Number(r.quebraKg) || 0, aposKg: restante, secagem: true}); }
  }
  const ens = reg.ensaque, pesoFinal = ens ? ens.sacas * ens.kgPorSaca : null;
  return {entrada, restante, passos, pesoFinal, sacas: ens?.sacas ?? null, diferencaKg: ens ? restante - pesoFinal : null,
    rendimento: entrada > 0 ? (pesoFinal ?? restante) / entrada * 100 : null, concluida: !!ens};
}
const proximaEtapa = o => o.etapas.find(id => !(o.registros || {})[id] && !(o.pulos || []).includes(id));
const loteDaOrdem = o => find('lots', o.lotId) || o.lote || {};
const kgFmt = v => `${num(v, v % 1 ? 1 : 0)} kg`;
const pctDe = (v, base) => base > 0 ? um1(v / base * 100) + '%' : '—';
const maquinasDe = tipos => () => db.machines.filter(m => !tipos || tipos.includes(m.type)).map(m => ({value: m.id, label: m.name}));

function novaOrdemUbs() {
  const abertos = new Set(db.ubs.filter(o => o.status !== 'Concluída').map(o => o.lotId));
  const lotes = db.lots.filter(l => !abertos.has(l.id));
  if (!db.lots.length) { showToast('Cadastre o lote de sementes primeiro'); return lotForm({status: 'Colhido'}); }
  if (!lotes.length) { showToast('Todos os lotes já têm ordem de beneficiamento aberta'); return; }
  openForm({
    title: 'Nova ordem de beneficiamento',
    sub: `Etapas desta UBS: ${etapasConfiguradas().map(id => etapaUbs(id).nome).join(' → ')}. Altere em “Etapas da UBS”.`,
    values: {inicio: today()},
    fields: [
      {k: 'lotId', label: 'Lote', type: 'select', required: true, full: true, options: () => lotes.map(l => ({value: l.id, label: `${l.code} — ${[l.species, l.cultivar, l.category].filter(Boolean).join(' • ')}`}))},
      {k: 'inicio', label: 'Início', type: 'date', required: true}
    ],
    onSubmit: v => {
      const l = find('lots', v.lotId); if (!l) return 'Selecione o lote';
      const o = {id: uid(), lotId: l.id, lote: {code: l.code, species: l.species, cultivar: l.cultivar, category: l.category, season: l.season},
        inicio: v.inicio, status: 'Em andamento', etapas: etapasConfiguradas(), registros: {}, pulos: [], criadoEm: new Date().toISOString()};
      db.ubs.push(o);
      if (l.status !== 'Em beneficiamento') { db.lotEvents.push({id: uid(), lotId: l.id, date: v.inicio, title: 'Situação: Em beneficiamento', text: `Anterior: ${l.status}`}); l.status = 'Em beneficiamento'; }
      save(); showToast(`Ordem aberta para o lote ${l.code}`); go('ubs/' + o.id);
    }
  });
}

function registrarEtapaUbs(ordemId) {
  const o = find('ubs', ordemId); if (!o) return;
  const id = proximaEtapa(o); if (!id) { showToast('Todas as etapas já foram registradas'); return; }
  const e = etapaUbs(id), c = calcOrdem(o), l = loteDaOrdem(o);
  const comuns = [{k: 'data', label: 'Data', type: 'date', required: true}];
  const notas = {k: 'notas', label: 'Observações', type: 'textarea'};
  let fields, sub = `Lote ${l.code}`, onSubmit;
  const gravar = (r, evento) => {
    o.registros[id] = {...r, registradoEm: new Date().toISOString()};
    db.lotEvents.push({id: uid(), lotId: o.lotId, date: r.data, title: `UBS: ${e.nome}`, text: evento});
    save(); showToast(`Etapa registrada: ${e.nome}`);
  };
  if (e.tipo === 'entrada') {
    sub += ' — peso de entrada na UBS (balança).';
    fields = [...comuns, {k: 'machineId', label: 'Moega / balança', type: 'select', options: maquinasDe(['Moega', 'Beneficiamento', 'Silo/Armazém'])},
      {k: 'pesoKg', label: 'Peso recebido (kg)', type: 'number', min: 0, required: true}, {k: 'umidade', label: 'Umidade na recepção (%)', type: 'number', min: 0}, notas];
    onSubmit = v => { if (!(v.pesoKg > 0)) return 'Informe o peso recebido'; gravar(v, `Entrada ${kgFmt(v.pesoKg)}${v.umidade !== '' ? ` • umidade ${num(v.umidade, 1)}%` : ''}`); };
  } else if (e.tipo === 'descarte') {
    sub += ` — entram nesta etapa ${kgFmt(c.restante)}. Informe o descarte pesado.`;
    fields = [...comuns, {k: 'machineId', label: 'Máquina', type: 'select', options: maquinasDe(['Beneficiamento', 'Implemento', 'Outro'])},
      {k: 'descarteKg', label: 'Descarte pesado (kg)', type: 'number', min: 0, required: true, hint: ' '},
      {k: 'regulagem', label: 'Regulagem usada', placeholder: id === 'ar_peneiras' ? 'Ex.: peneiras 6,5 / 5,0 mm' : id === 'mesa' ? 'Ex.: inclinação, ar' : ''}, notas];
    onSubmit = v => {
      if (v.descarteKg > c.restante) return `Descarte maior que o peso que entrou na etapa (${kgFmt(c.restante)})`;
      gravar(v, `Descarte ${kgFmt(v.descarteKg)} (${pctDe(v.descarteKg, c.restante)} da etapa)${v.regulagem ? ' • ' + v.regulagem : ''}`);
    };
  } else if (e.tipo === 'secagem') {
    const ur = o.registros.recebimento?.umidade;
    sub += ` — entram ${kgFmt(c.restante)}. A quebra de peso é calculada pelas umidades (matéria seca constante).`;
    fields = [...comuns, {k: 'machineId', label: 'Secador', type: 'select', options: maquinasDe(['Secador'])},
      {k: 'umidadeInicial', label: 'Umidade antes (%)', type: 'number', min: 0, required: true, hint: ur !== undefined && ur !== '' ? `Na recepção: ${num(ur, 1)}%` : ''},
      {k: 'umidadeFinal', label: 'Umidade depois (%)', type: 'number', min: 0, required: true}, notas];
    onSubmit = v => {
      if (!(v.umidadeInicial < 100 && v.umidadeFinal < 100)) return 'Umidades devem ser menores que 100%';
      if (v.umidadeFinal > v.umidadeInicial) return 'Umidade depois maior que a de antes: confira as leituras';
      const fim = AV().calculos.massaAposSecagem(c.restante, v.umidadeInicial, v.umidadeFinal);
      const quebraKg = Math.round((c.restante - fim) * 10) / 10;
      gravar({...v, quebraKg}, `Umidade ${num(v.umidadeInicial, 1)}% → ${num(v.umidadeFinal, 1)}% • quebra ${kgFmt(quebraKg)}`);
    };
  } else if (e.tipo === 'tratamento') {
    sub += ' — o produto usado sai do estoque (opcional).';
    fields = [...comuns, {k: 'machineId', label: 'Tratadora', type: 'select', options: maquinasDe(['Beneficiamento', 'Implemento', 'Outro'])},
      {k: 'itemId', label: 'Produto do estoque', type: 'select', options: () => db.stock.map(s => ({value: s.id, label: `${s.name} — ${num(s.qty)} ${s.unit}`})), full: true},
      {k: 'qtd', label: 'Quantidade usada', type: 'number', min: 0}, {k: 'dose', label: 'Dose da bula / recomendação', placeholder: 'Ex.: 200 mL/100 kg'}, notas];
    onSubmit = v => {
      const s = v.itemId ? find('stock', v.itemId) : null;
      if (s && !(v.qtd > 0)) return 'Informe a quantidade usada do produto';
      if (s && v.qtd > Number(s.qty || 0)) return `Saldo insuficiente de ${s.name} (${num(s.qty)} ${s.unit})`;
      if (s) { const mov = aplicarMovimento(s, 'Saída', v.qtd, 0); db.movements.push({id: uid(), itemId: s.id, kind: 'Saída', qty: v.qtd, date: v.data, notes: `Tratamento de sementes — lote ${l.code}`, ubsId: o.id, ...mov}); }
      gravar(v, s ? `${s.name}: ${num(v.qtd)} ${s.unit}${v.dose ? ' • dose ' + v.dose : ''}` : (v.dose ? 'Dose ' + v.dose : 'Tratamento registrado'));
    };
  } else {
    sub += ` — restam ${kgFmt(c.restante)} pelas etapas registradas. A semente ensacada entra no estoque.`;
    fields = [...comuns, {k: 'sacas', label: 'Sacas ensacadas', type: 'number', min: 0, required: true},
      {k: 'kgPorSaca', label: 'Peso por saca (kg)', type: 'number', min: 0, required: true, hint: 'Peso líquido de cada saca, como na embalagem.'},
      {k: 'embalagemId', label: 'Embalagens do estoque (sai 1 por saca)', type: 'select', full: true, options: () => db.stock.map(s => ({value: s.id, label: `${s.name} — ${num(s.qty)} ${s.unit}`}))}, notas];
    onSubmit = v => {
      if (!(v.sacas > 0) || !Number.isInteger(v.sacas)) return 'Informe o número de sacas (inteiro)';
      if (!(v.kgPorSaca > 0)) return 'Informe o peso por saca';
      const peso = v.sacas * v.kgPorSaca;
      if (peso > c.entrada) return `Peso ensacado (${kgFmt(peso)}) maior que o peso recebido (${kgFmt(c.entrada)}): confira`;
      const emb = v.embalagemId ? find('stock', v.embalagemId) : null;
      if (emb && v.sacas > Number(emb.qty || 0)) return `Saldo insuficiente de ${emb.name} (${num(emb.qty)} ${emb.unit})`;
      if (emb) { const mov = aplicarMovimento(emb, 'Saída', v.sacas, 0); db.movements.push({id: uid(), itemId: emb.id, kind: 'Saída', qty: v.sacas, date: v.data, notes: `Ensaque — lote ${l.code}`, ubsId: o.id, ...mov}); }
      // Semente beneficiada entra no estoque, em sacas (sem custo: o app não supõe preço)
      let item = db.stock.find(s => s.lotId === o.lotId);
      if (!item) { item = {id: uid(), name: `Semente ${[l.species, l.cultivar].filter(Boolean).join(' ')} — lote ${l.code}`, category: 'Semente', unit: 'sc', qty: 0, min: '', location: '', lotId: o.lotId}; db.stock.push(item); }
      const mov = aplicarMovimento(item, 'Entrada', v.sacas, 0);
      db.movements.push({id: uid(), itemId: item.id, kind: 'Entrada', qty: v.sacas, date: v.data, notes: `Ensaque UBS — ${num(v.kgPorSaca)} kg por saca`, ubsId: o.id, ...mov});
      db.settings.kgPorSaca = v.kgPorSaca;
      o.status = 'Concluída'; o.fim = v.data;
      const lt = find('lots', o.lotId);
      if (lt && lt.status === 'Em beneficiamento') { lt.status = 'Aguardando análise'; db.lotEvents.push({id: uid(), lotId: lt.id, date: v.data, title: 'Situação: Aguardando análise', text: 'Beneficiamento concluído'}); }
      const rend = c.entrada > 0 ? peso / c.entrada * 100 : null;
      gravar(v, `${num(v.sacas)} sacas de ${num(v.kgPorSaca)} kg = ${kgFmt(peso)}${rend != null ? ` • rendimento ${um1(rend)}%` : ''}`);
    };
  }
  openForm({title: `${e.nome} — lote ${l.code}`, sub, values: {data: today(), ...(e.tipo === 'ensaque' && db.settings.kgPorSaca ? {kgPorSaca: db.settings.kgPorSaca} : {})}, fields, onSubmit});
  // Percentual do descarte enquanto digita
  const d = $('#f_descarteKg', dialog), h = d?.parentElement.querySelector('.hint');
  if (d && h) d.addEventListener('input', () => { const x = Number(d.value.replace(',', '.')); h.textContent = x > 0 ? `${pctDe(x, c.restante)} do que entrou na etapa (${kgFmt(c.restante)})` : ''; });
  const sa = $('#f_sacas', dialog), kp = $('#f_kgPorSaca', dialog), hk = kp?.parentElement.querySelector('.hint');
  if (sa && kp && hk) { const base = hk.textContent; const at = () => { const n = Number(sa.value), k = Number(kp.value.replace(',', '.')); hk.textContent = n > 0 && k > 0 ? `${kgFmt(n * k)} ensacados • rendimento ${pctDe(n * k, c.entrada)}` : base; }; sa.oninput = at; kp.oninput = at; }
}

function configurarEtapasUbs() {
  const ativas = etapasConfiguradas();
  dialog.innerHTML = `<h3>Etapas da UBS</h3><p class="sub">Marque as etapas que a sua unidade usa. Valem para as novas ordens; recebimento e ensaque são obrigatórios.</p>
    <div class="ubs-cfg">${ETAPAS_UBS.map(e => `<label class="es-ck"><input type="checkbox" value="${e.id}" ${ativas.includes(e.id) ? 'checked' : ''} ${e.fixa ? 'disabled' : ''}> <span>${esc(e.nome)}</span></label>`).join('')}</div>
    <div class="actions"><button type="button" class="secondary" data-close>Cancelar</button><button class="primary" id="ubsCfgOk">Salvar</button></div>`;
  $('[data-close]', dialog).onclick = closeModal;
  $('#ubsCfgOk').onclick = () => { db.settings.ubsEtapas = $$('.ubs-cfg input:checked', dialog).map(i => i.value); save(); closeModal(); showToast('Etapas da UBS salvas'); render(); };
  modal.classList.add('open');
}

function cartaoOrdem(o) {
  const c = calcOrdem(o), l = loteDaOrdem(o), feitas = o.etapas.filter(id => o.registros[id] || (o.pulos || []).includes(id)).length, prox = proximaEtapa(o);
  return `<article class="card ubs-ordem clickable" data-act="nav" data-id="ubs/${esc(o.id)}">
    <div class="ubs-topo"><div><strong>Lote ${esc(l.code)}</strong><small>${esc([l.species, l.cultivar, l.category].filter(Boolean).join(' • '))}</small></div>${chip(o.status, c.concluida ? 'green' : 'orange')}</div>
    <div class="ubs-passos" role="img" aria-label="${feitas} de ${o.etapas.length} etapas">${o.etapas.map(id => `<i class="${o.registros[id] ? 'feito' : (o.pulos || []).includes(id) ? 'pulado' : id === prox ? 'atual' : ''}" title="${esc(etapaUbs(id).nome)}"></i>`).join('')}</div>
    <div class="ubs-num"><div><span>Entrada</span><b>${c.entrada ? kgFmt(c.entrada) : '—'}</b></div><div><span>Sacas</span><b>${c.sacas != null ? num(c.sacas) : '—'}</b></div><div><span>Rendimento</span><b>${c.concluida ? um1(c.rendimento) + '%' : '—'}</b></div></div>
    ${!c.concluida && prox ? `<small class="ubs-prox">Próxima etapa: ${esc(etapaUbs(prox).nome)}</small>` : ''}</article>`;
}

VIEWS.ubs = arg => arg ? detalheOrdemUbs(arg) : listaUbs();

function listaUbs() {
  const ini = today().slice(0, 8) + '01';
  const abertas = db.ubs.filter(o => o.status !== 'Concluída'), conclMes = db.ubs.filter(o => o.status === 'Concluída' && (o.fim || '') >= ini);
  const cs = conclMes.map(calcOrdem), entMes = cs.reduce((t, c) => t + c.entrada, 0), saiMes = cs.reduce((t, c) => t + (c.pesoFinal || 0), 0), sacasMes = cs.reduce((t, c) => t + (c.sacas || 0), 0);
  const aguard = db.lots.filter(l => l.status === 'Aguardando análise');
  const filtros = {todas: ['Todas', () => true], andamento: ['Em andamento', o => o.status !== 'Concluída'], concluidas: ['Concluídas', o => o.status === 'Concluída']};
  const lista = db.ubs.filter(filtros[ubsFiltro][1]).sort((a, b) => (a.status === 'Concluída') - (b.status === 'Concluída') || (b.inicio || '').localeCompare(a.inicio || ''));
  return head('Beneficiamento (UBS)', 'Ordens de beneficiamento por lote: etapas, descarte e rendimento', btn('⚙ Etapas da UBS', 'ubs-cfg', '', 'secondary') + btn('+ Nova ordem', 'ubs-nova')) +
    `<section class="es-kpis">
      <article class="card kpi"><div class="label">Em beneficiamento</div><div class="value">${abertas.length}</div><div class="hint">${esc(abertas.map(o => loteDaOrdem(o).code).join(', ') || 'nenhum lote')}</div></article>
      <article class="card kpi"><div class="label">Ensacado no mês</div><div class="value">${num(sacasMes)} sc</div><div class="hint">${saiMes ? kgFmt(saiMes) + ' • ' : ''}${conclMes.length} ${conclMes.length === 1 ? 'ordem concluída' : 'ordens concluídas'}</div></article>
      <article class="card kpi"><div class="label">Rendimento do mês</div><div class="value">${entMes ? um1(saiMes / entMes * 100) + '%' : '—'}</div><div class="hint">ensacado ÷ recebido, ordens concluídas</div></article>
      <article class="card kpi"><div class="label">Aguardando laboratório</div><div class="value">${aguard.length}</div><div class="hint">${esc(aguard.map(l => l.code).join(', ') || 'nenhum lote')}</div></article>
    </section>
    <div class="filters">${Object.entries(filtros).map(([k, [r, f]]) => `<button class="${k === ubsFiltro ? 'active' : ''}" data-act="ubs-filtro" data-id="${k}">${r} (${db.ubs.filter(f).length})</button>`).join('')}</div>
    ${lista.length ? `<section class="ubs-lista">${lista.map(cartaoOrdem).join('')}</section>` : `<section class="card">${empty('Nenhuma ordem de beneficiamento', 'Abra uma ordem quando um lote de sementes entrar na UBS.', {act: 'ubs-nova', label: '+ Nova ordem'})}</section>`}`;
}

function detalheOrdemUbs(id) {
  const o = find('ubs', id); if (!o) return empty('Ordem não encontrada', '');
  const c = calcOrdem(o), l = loteDaOrdem(o), prox = proximaEtapa(o), reg = o.registros;
  const linhaEtapa = (eid, i) => {
    const e = etapaUbs(eid), r = reg[eid], pulada = (o.pulos || []).includes(eid), st = r ? 'feito' : pulada ? 'pulado' : eid === prox ? 'atual' : '';
    const maq = r?.machineId ? machineName(r.machineId) || '' : '';
    const det = r ? [maq, e.tipo === 'secagem' ? `${num(r.umidadeInicial, 1)}% → ${num(r.umidadeFinal, 1)}%` : '', r.regulagem, e.tipo === 'tratamento' && r.itemId ? `${find('stock', r.itemId)?.name || 'produto'} ${num(r.qtd)}` : '', r.dose ? 'dose ' + r.dose : '', fmtDate(r.data)].filter(Boolean).join(' • ') : pulada ? 'não usada neste lote' : st === 'atual' ? 'próxima etapa' : 'pendente';
    const p = c.passos.find(x => x.id === eid);
    const kgTxt = eid === 'recebimento' && r ? `<b>${kgFmt(r.pesoKg)}</b><small>entrada${r.umidade !== '' && r.umidade != null ? ` • ${num(r.umidade, 1)}%` : ''}</small>`
      : p ? `<b>− ${kgFmt(p.perdaKg)}</b><small>${p.secagem ? 'quebra de umidade' : pctDe(p.perdaKg, c.entrada) + ' da entrada'}</small>`
      : eid === 'ensaque' && r ? `<b>${num(r.sacas)} sc</b><small>${num(r.kgPorSaca)} kg/sc = ${kgFmt(r.sacas * r.kgPorSaca)}</small>` : '';
    return `<li class="${st}"><span class="bola">${r ? '✓' : pulada ? '–' : i + 1}</span><div><strong>${esc(e.nome)}</strong><small>${esc(det)}</small>${r?.notas ? `<small>${esc(r.notas)}</small>` : ''}</div><div class="kg">${kgTxt}</div></li>`;
  };
  const fluxo = c.entrada ? [['Entrada', c.entrada], ...c.passos.map(p => ['Após ' + p.nome.toLowerCase(), p.aposKg]), ...(c.concluida ? [['Ensacado', c.pesoFinal]] : [])] : [];
  const maior = c.passos.filter(p => !p.secagem).sort((a, b) => b.perdaKg - a.perdaKg)[0];
  const ultimo = [...o.etapas].reverse().find(eid => reg[eid] || (o.pulos || []).includes(eid));
  const acoes = c.concluida ? '' : [prox ? btn(`+ Registrar ${etapaUbs(prox).nome.toLowerCase()}`, 'ubs-etapa', o.id) : '',
    prox && !etapaUbs(prox).fixa ? btn('Pular etapa', 'ubs-pular', o.id, 'secondary') : '',
    ultimo ? btn('Desfazer última', 'ubs-desfazer', o.id, 'secondary') : '',
    `<button class="danger" data-act="ubs-excluir" data-id="${esc(o.id)}">Excluir ordem</button>`].join('');
  return head(`Lote ${l.code} — beneficiamento`, [l.species, l.cultivar, l.category && 'categoria ' + l.category, l.season && 'safra ' + l.season, 'início ' + fmtDate(o.inicio)].filter(Boolean).join(' • '), btn('← Ordens', 'nav', 'ubs', 'secondary') + btn('Ver lote', 'nav', 'lotes/' + o.lotId, 'secondary')) +
    (acoes ? `<div class="btn-row ubs-acoes">${acoes}</div>` : '') +
    `<section class="ubs-det">
      <article class="card panel"><h3>Etapas</h3><ol class="ubs-etapas">${o.etapas.map(linhaEtapa).join('')}</ol></article>
      <article class="card panel viz-root"><h3>Rendimento do beneficiamento</h3>
        ${c.entrada ? `<div class="ubs-rend"><b>${c.concluida ? um1(c.rendimento) + '%' : '—'}</b><span>${c.concluida ? `${kgFmt(c.pesoFinal)} ensacados (${num(c.sacas)} sacas) de ${kgFmt(c.entrada)} recebidos` : `parcial: restam ${kgFmt(c.restante)} (${pctDe(c.restante, c.entrada)}) pelas etapas registradas`}</span></div>
        <div class="ubs-fluxo">${fluxo.map(([n, v], i) => `<div class="ln ${i === fluxo.length - 1 && c.concluida ? 'final' : ''}" ${tip(n, kgFmt(v))}><span>${esc(n)}</span><div class="tr"><span style="width:${Math.max(0, v / c.entrada * 100)}%"></span></div><b>${kgFmt(v)}</b></div>`).join('')}</div>
        ${maior && maior.perdaKg > 0 ? `<p class="ubs-maior">Maior descarte: <strong>${esc(maior.nome)}</strong> — ${kgFmt(maior.perdaKg)} (${pctDe(maior.perdaKg, c.entrada)} da entrada).</p>` : ''}
        ${c.concluida && Math.abs(c.diferencaKg) >= 0.5 ? `<p class="nota">Diferença entre o peso esperado pelas etapas (${kgFmt(c.restante)}) e o ensacado: ${c.diferencaKg > 0 ? '' : '+'}${kgFmt(Math.abs(c.diferencaKg))} ${c.diferencaKg > 0 ? 'não registrados como descarte (perdas de manuseio, sobras ou diferença de balança)' : 'a mais que o esperado — confira as pesagens'}.</p>` : ''}
        ${tabela(['Etapa', 'Descarte (kg)', 'Após (kg)'], [['Entrada', '—', num(c.entrada)], ...c.passos.map(p => [p.nome, num(p.perdaKg, 1), num(p.aposKg, 1)]), ...(c.concluida ? [['Ensacado', '—', num(c.pesoFinal, 1)]] : [])])}`
        : semDados('Registre o recebimento (peso de entrada) para calcular o rendimento.')}
        <p class="nota">Rendimento = peso ensacado ÷ peso recebido. Na secagem, a quebra vem das umidades informadas (F-QUEBRA-UMIDADE). Ao concluir o ensaque, as sacas entram no estoque.</p></article>
    </section>`;
}

Object.assign(ACTIONS, {
  'ubs-nova': novaOrdemUbs,
  'ubs-cfg': configurarEtapasUbs,
  'ubs-filtro': id => { ubsFiltro = id; render(); },
  'ubs-etapa': id => registrarEtapaUbs(id),
  'ubs-pular': id => { const o = find('ubs', id), p = proximaEtapa(o); if (!p || etapaUbs(p).fixa) return; confirmDialog(`Pular a etapa “${etapaUbs(p).nome}” neste lote?`, () => { (o.pulos ||= []).push(p); save(); }, 'Pular'); },
  'ubs-desfazer': id => {
    const o = find('ubs', id), ult = [...o.etapas].reverse().find(eid => o.registros[eid] || (o.pulos || []).includes(eid));
    if (!ult || o.status === 'Concluída') return;
    const r = o.registros[ult];
    confirmDialog(`Desfazer “${etapaUbs(ult).nome}”?${r?.itemId ? ' O produto usado volta para o estoque.' : ''}`, () => {
      if (o.registros[ult]) {
        // Tratamento: devolve ao estoque o que saiu por esta ordem
        db.movements.filter(m => m.ubsId === o.id && m.kind === 'Saída' && ult === 'tratamento').forEach(m => { const s = find('stock', m.itemId); if (s) s.qty = Number(s.qty || 0) + Number(m.qty); });
        if (ult === 'tratamento') db.movements = db.movements.filter(m => !(m.ubsId === o.id && m.kind === 'Saída'));
        delete o.registros[ult];
      } else o.pulos = o.pulos.filter(x => x !== ult);
      save();
    }, 'Desfazer');
  },
  'ubs-excluir': id => confirmDialog('Excluir esta ordem de beneficiamento? Produtos de tratamento que saíram por ela voltam ao estoque.', () => {
    const o = find('ubs', id); if (!o || o.status === 'Concluída') return;
    db.movements.filter(m => m.ubsId === id && m.kind === 'Saída').forEach(m => { const s = find('stock', m.itemId); if (s) s.qty = Number(s.qty || 0) + Number(m.qty); });
    db.movements = db.movements.filter(m => m.ubsId !== id);
    remove('ubs', id); go('ubs');
  })
});
TITLES.ubs = 'Beneficiamento (UBS)';
