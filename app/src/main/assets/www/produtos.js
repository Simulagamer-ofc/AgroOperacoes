'use strict';
/* MercaPlant — Produtos na operação (aplicação, adubação, plantio e tratamento de sementes).
   A operação passa a ter os produtos com a dose (calda de vários produtos). O app calcula o total pela área
   (ou pelos kg de semente, no tratamento) e, na aplicação, quantos tanques e quanto de cada produto por tanque.
   Ao concluir: baixa no estoque pela área feita e, na aplicação, já gera o registro de carência (Aplicações e carência)
   — o operador lança uma vez só. O clima da hora (previsão guardada no aparelho) fica gravado no início e na conclusão,
   com aviso quando está fora do recomendado para pulverizar. */

const OP_COM_PRODUTO = ['Aplicação', 'Adubação', 'Plantio', 'Tratamento de sementes'];
const PROD_CATS = {
  'Aplicação': ['Defensivo', 'Adjuvante', 'Fertilizante'],
  'Adubação': ['Fertilizante', 'Corretivo (calcário/gesso)'],
  'Plantio': ['Semente', 'Fertilizante', 'Inoculante', 'Tratamento de sementes'],
  'Tratamento de sementes': ['Tratamento de sementes', 'Inoculante', 'Defensivo']
};
const DOSES_HA = ['L/ha', 'mL/ha', 'kg/ha', 'g/ha', 't/ha', 'sc/ha'];
const DOSES_SEM = ['mL/100 kg', 'L/100 kg', 'g/100 kg', 'kg/100 kg'];
const prodPorSemente = t => t === 'Tratamento de sementes';
// Converte uma quantidade entre unidades de volume ou massa; null se não dá (ex.: L → kg)
const PROD_BASE = {L: ['v', 1], mL: ['v', 1e-3], 'm³': ['v', 1e3], kg: ['m', 1], g: ['m', 1e-3], t: ['m', 1e3]};
function prodConverter(q, de, para) {
  if (de === para) return q;
  const a = PROD_BASE[de], b = PROD_BASE[para]; if (!a || !b || a[0] !== b[0]) return null;
  return q * a[1] / b[1];
}
const prodUnidDose = dose => String(dose || '').split('/')[0];
function prodDosePadrao(s, tipo) {
  const u = s?.unit || 'L';
  if (prodPorSemente(tipo)) return ['g', 'kg', 't'].includes(u) ? 'g/100 kg' : 'mL/100 kg';
  return {L: 'L/ha', mL: 'mL/ha', kg: 'kg/ha', g: 'g/ha', t: 't/ha', sc: 'sc/ha'}[u] || 'L/ha';
}
// Total de um produto: dose × área (ou × kg de semente ÷ 100), na unidade da dose e na do estoque
function prodTotal(p, base, tipo) {
  const d = Number(p.dose); if (!(d > 0) || !(base > 0)) return null;
  const q = prodPorSemente(tipo) ? d * base / 100 : d * base, u = prodUnidDose(p.unDose), s = p.itemId ? find('stock', p.itemId) : null;
  const est = s ? prodConverter(q, u, s.unit) : null;
  return {q, u, est, unEst: s?.unit || ''};
}
const prodNome = p => (p.itemId ? find('stock', p.itemId)?.name : '') || p.nome || 'produto';
const prodFmt = (q, u) => `${num(Math.round(q * 1000) / 1000)} ${u}`;
// Capacidade do tanque do pulverizador (máquina: campo próprio; implemento: “3.000 L” no cadastro)
function prodTanque(o) {
  for (const id of [o.implementoId, o.machineId]) {
    const m = id ? find('machines', id) : null; if (!m) continue;
    if (Number(m.tanqueL) > 0) return Number(m.tanqueL);
    const t = String(m.capacidade || ''); if (/l\b|litro/i.test(t)) { const n = numeroBR(t.replace(/[^\d.,]/g, '')); if (n > 0) return n; }
  }
  return null;
}
const prodArea = o => Number(o.area) || Number(find('fields', o.fieldId)?.area) || 0;
// Plano da calda: tanques e quanto de cada produto vai por tanque
function prodPlanoCalda(o, area = prodArea(o)) {
  const calda = Number(o.calda), tanque = prodTanque(o);
  if (o.type !== 'Aplicação' || !(calda > 0) || !(area > 0)) return null;
  const volume = calda * area, haTanque = tanque ? tanque / calda : null;
  return {calda, area, volume, tanque, tanques: tanque ? Math.ceil(volume / tanque - 1e-9) : null, haTanque};
}
// Preparadores de calda cadastrados (equipamento que prepara a calda antes de abastecer)
const prodPreparadores = () => db.machines.filter(m => m.type === 'Preparador de calda' && !isInactive(m));
const prodResumo = o => (o.produtos || []).map(p => `${prodNome(p)}${Number(p.dose) > 0 ? ` ${num(p.dose)} ${p.unDose}` : ''}`).join(' + ');

// ---------- Clima na hora (da previsão guardada) ----------
function prodClimaAgora() {
  const c = typeof lerClima === 'function' ? lerClima() : null, h = c?.dados?.hourly; if (!h?.time || typeof avaliarHora !== 'function') return null;
  const agora = new Date(), chave = `${today()}T${String(agora.getHours()).padStart(2, '0')}:00`, i = h.time.indexOf(chave); if (i < 0) return null;
  const a = avaliarHora(h, i);
  return {em: new Date().toISOString(), t: Math.round(a.t * 10) / 10, ur: Math.round(a.ur), v: Math.round(a.v * 10) / 10, dt: Math.round(a.dt * 10) / 10, ok: a.ok, motivos: a.motivos, fonte: 'previsão'};
}
const prodClimaTxt = c => !c ? '' : `${num(c.t, 1)} °C • umidade ${num(c.ur)}% • vento ${num(c.v, 1)} km/h • Delta T ${num(c.dt, 1)}`;

// ---------- Componente: lista de produtos no formulário ----------
// prodRasc: {tipo, modo: 'plano' | 'conclusao', concluir (lançada já feita), itens: [{itemId, dose, unDose, carencia, usado, usadoManual, novo}],
//            calda, velocidade, pressao, ponta, receituario, respTecnico}
let prodRasc = null;
const prodComUsado = () => prodRasc && (prodRasc.modo === 'conclusao' || prodRasc.concluir);
const prodNum = v => v === '' || v == null ? '' : (n => n === undefined ? '' : n)(numeroBR(String(v).trim()));
const prodTxtNum = v => v === '' || v == null ? '' : String(v).replace('.', ',');
function prodOpcoes(tipo, p) {
  const cats = PROD_CATS[tipo] || [], lista = db.stock.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  const ind = lista.filter(s => cats.includes(s.category)), outros = lista.filter(s => !cats.includes(s.category) && s.category !== 'Combustível' && s.category !== 'Peças');
  const op = s => `<option value="${esc(s.id)}" ${s.id === p.itemId ? 'selected' : ''}>${esc(s.name)} — ${num(s.qty)} ${esc(s.unit)}</option>`;
  const gestor = typeof mcpGestor !== 'function' || mcpGestor();
  return `<option value="">Escolha o produto do estoque…</option>${!p.itemId && p.nome ? `<option value="__legado" selected>${esc(p.nome)} (fora do estoque)</option>` : ''}${ind.length ? `<optgroup label="${esc(cats.join(', '))}">${ind.map(op).join('')}</optgroup>` : ''}${outros.length ? `<optgroup label="Outros itens do estoque">${outros.map(op).join('')}</optgroup>` : ''}${gestor ? `<option value="__novo" ${p.novo ? 'selected' : ''}>+ Cadastrar produto no estoque…</option>` : ''}`;
}
// Quantidade calculada (na unidade do estoque) para a base (área ou kg de semente)
const prodCalc = (p, base, tipo) => { const t = prodTotal(p, base, tipo); return t?.est != null ? Math.round(t.est * 1000) / 1000 : null; };
function prodLinha(p, i, base) {
  const r = prodRasc, s = p.itemId ? find('stock', p.itemId) : null, tot = prodTotal(p, base, r.tipo), doses = prodPorSemente(r.tipo) ? DOSES_SEM : DOSES_HA;
  const precisaCar = r.tipo === 'Aplicação' && prodComUsado() && s?.category === 'Defensivo' && (s.carencia === '' || s.carencia == null);
  const calc = s ? prodCalc(p, base, r.tipo) : null;
  if (s && prodComUsado() && !p.usadoManual) p.usado = calc ?? '';
  const usado = Number(p.usado), real = s && usado > 0 && base > 0 ? usado / base : null;
  return `<div class="prod-it" data-prod="${i}">
    <div class="prod-l1"><select data-prod-item="${i}" aria-label="Produto ${i + 1}">${prodOpcoes(r.tipo, p)}</select><button type="button" class="prod-x" data-prod-x="${i}" aria-label="Tirar produto">✕</button></div>
    ${p.novo ? `<div class="prod-novo"><input data-prod-novo-nome="${i}" value="${esc(p.novo.nome || '')}" placeholder="Nome do produto (ex.: Glifosato 480)"><select data-prod-novo-un="${i}">${['L', 'kg', 'mL', 'g', 'sc', 't', 'un'].map(u => `<option ${u === p.novo.un ? 'selected' : ''}>${u}</option>`).join('')}</select><button type="button" class="secondary" data-prod-criar="${i}">Cadastrar</button><small class="nota">Entra no estoque com saldo zero; lance a entrada da nota depois.</small></div>` : ''}
    <div class="prod-l2"><span class="prod-rot">Dose</span><input data-prod-dose="${i}" inputmode="decimal" value="${esc(prodTxtNum(p.dose))}" placeholder="${prodPorSemente(r.tipo) ? 'por 100 kg' : 'por ha'}" aria-label="Dose"><select data-prod-un="${i}" aria-label="Unidade da dose">${doses.map(u => `<option ${u === p.unDose ? 'selected' : ''}>${u}</option>`).join('')}</select>
      ${!prodComUsado() ? `<span class="prod-tot">${tot ? `= ${prodFmt(tot.q, tot.u)}${tot.est != null && tot.unEst !== tot.u ? ` (${prodFmt(tot.est, tot.unEst)})` : ''}${s && tot.est != null && tot.est > Number(s.qty || 0) ? ' <b class="txt-red">saldo insuficiente</b>' : ''}` : ''}</span>` : ''}</div>
    ${prodComUsado() && s ? `<div class="prod-l2 prod-usado"><span class="prod-rot">Quantidade usada</span><input data-prod-usado="${i}" inputmode="decimal" value="${esc(prodTxtNum(p.usado))}" placeholder="0" aria-label="Quantidade usada de ${esc(s.name)}"><b>${esc(s.unit)}</b>
      <small class="nota">${calc != null ? `calculado pela dose: ${prodFmt(calc, s.unit)}` : 'informe o que saiu'}${real != null ? ` • dose real ${num(Math.round(real * 1000) / 1000)} ${esc(s.unit)}/${prodPorSemente(r.tipo) ? 'kg' : 'ha'}` : ''}${usado > Number(s.qty || 0) ? ` • <b class="txt-red">saldo ${prodFmt(Number(s.qty) || 0, s.unit)}: o estoque fica negativo</b>` : ''}</small></div>` : ''}
    ${precisaCar ? `<div class="prod-l2"><span class="prod-rot">Carência (dias, da bula)</span><input data-prod-car="${i}" inputmode="numeric" value="${esc(p.carencia ?? '')}" placeholder="dias" aria-label="Carência em dias"><small class="nota">o produto não tem carência no cadastro</small></div>` : ''}
  </div>`;
}
// Avisos da regulagem pela configuração da máquina (faixa de velocidade e de pressão)
function prodAvisosReg(o, r) {
  const out = [], m = [o.implementoId, o.machineId].map(id => id && find('machines', id)).find(x => x?.config) || null;
  if (!m || typeof cfgValor !== 'function') return out;
  const fv = cfgValor(m, 'faixaVelocidadeKmH'), fp = cfgValor(m, 'faixaPressaoBar'), v = Number(r.velocidade), pr = Number(r.pressao);
  const fora = (x, f) => x > 0 && f && ((f.min != null && x < f.min) || (f.max != null && x > f.max));
  if (fora(v, fv)) out.push(`Velocidade fora da faixa de trabalho de ${m.name} (${num(fv.min, 1)} a ${num(fv.max, 1)} km/h)`);
  if (fora(pr, fp)) out.push(`Pressão fora da faixa do comando de ${m.name} (${num(fp.min, 1)} a ${num(fp.max, 1)} bar)`);
  return out;
}
function prodBlocoHtml(o, base) {
  const r = prodRasc, plano = r.tipo === 'Aplicação' ? prodPlanoCalda({...o, calda: r.calda}, base) : null;
  const tanque = plano?.tanque, porTanque = plano?.haTanque ? r.itens.filter(p => Number(p.dose) > 0).map(p => { const t = prodTotal(p, plano.haTanque, r.tipo); return t ? `${prodNome(p)}: ${prodFmt(t.q, t.u)}` : ''; }).filter(Boolean) : [];
  const comVel = ['Aplicação', 'Adubação', 'Plantio'].includes(r.tipo), avisos = prodAvisosReg(o, r);
  return `<div class="prod-topo"><b>Produtos${r.tipo === 'Aplicação' ? ' da calda' : ''}</b><small>${prodPorSemente(r.tipo) ? (base ? `para ${num(base)} kg de semente` : 'informe os kg de semente para calcular') : base ? `para ${num(base)} ha` : 'escolha o talhão ou informe a área para calcular'}</small></div>
    ${prodComUsado() ? `<p class="nota" style="margin:0">Informe a quantidade que realmente saiu de cada produto: é ela que dá baixa no estoque.</p>` : ''}
    ${r.itens.map((p, i) => prodLinha(p, i, base)).join('')}
    <button type="button" class="link" data-prod-add>+ Produto</button>
    ${comVel || r.tipo === 'Aplicação' ? `<div class="prod-reg">${comVel ? `<label>Velocidade (km/h)<input data-prod-vel inputmode="decimal" value="${esc(prodTxtNum(r.velocidade))}" placeholder="Ex.: 12"></label>` : ''}
      ${r.tipo === 'Aplicação' && prodPreparadores().length ? `<label>Preparador de calda<select data-prod-prep><option value="">— não usado —</option>${prodPreparadores().map(m => `<option value="${esc(m.id)}" ${m.id === r.preparadorId ? 'selected' : ''}>${esc(m.name)}${Number(m.tanqueL) > 0 ? ` (${num(m.tanqueL)} L)` : ''}</option>`).join('')}</select></label>` : ''}
      ${r.tipo === 'Aplicação' ? `<label>Volume de calda (L/ha)<input data-prod-calda inputmode="decimal" value="${esc(prodTxtNum(r.calda))}" placeholder="Ex.: 100"></label><label>Pressão (bar)<input data-prod-pres inputmode="decimal" value="${esc(prodTxtNum(r.pressao))}" placeholder="Ex.: 3"></label><label>Ponta / bico<input data-prod-ponta value="${esc(r.ponta || '')}" placeholder="Ex.: leque 110015"></label>` : ''}</div>` : ''}
    ${avisos.length ? `<p class="prod-aviso">⚠ ${esc(avisos.join(' • '))}</p>` : ''}
    ${plano ? `<p class="prod-plano">${plano.tanques ? `<b>${plano.tanques} ${plano.tanques === 1 ? 'tanque' : 'tanques'}</b> de ${num(tanque)} L (${num(Math.round(plano.haTanque * 10) / 10)} ha por tanque) • ` : ''}${num(Math.round(plano.volume))} L de calda${porTanque.length ? `<br>Por tanque cheio: ${esc(porTanque.join(' • '))}` : ''}${!tanque ? '<br><small>Cadastre a capacidade do tanque do pulverizador para ver os tanques.</small>' : ''}</p>` : ''}
    ${r.tipo === 'Aplicação' ? `<div class="prod-rec"><label>Nº do receituário<input data-prod-rec value="${esc(r.receituario || '')}"></label><label>Responsável técnico<input data-prod-resp value="${esc(r.respTecnico || '')}"></label></div>` : ''}`;
}
function prodLer() {
  if (!prodRasc) return;
  const cada = (sel, fn) => $$(`[${sel}]`, dialog).forEach(el => { const p = prodRasc.itens[el.getAttribute(sel)]; if (p) fn(p, el.value.trim()); });
  cada('data-prod-dose', (p, v) => { const n = prodNum(v); p.dose = n === '' && v ? v : n; });
  cada('data-prod-un', (p, v) => { p.unDose = v; });
  cada('data-prod-car', (p, v) => { p.carencia = v === '' ? '' : Number(prodNum(v)); });
  cada('data-prod-usado', (p, v) => { p.usado = prodNum(v); });
  cada('data-prod-novo-nome', (p, v) => { if (p.novo) p.novo.nome = v; });
  cada('data-prod-novo-un', (p, v) => { if (p.novo) p.novo.un = v; });
  const val = s => $(s, dialog)?.value.trim();
  if ($('[data-prod-calda]', dialog)) prodRasc.calda = prodNum(val('[data-prod-calda]'));
  if ($('[data-prod-vel]', dialog)) prodRasc.velocidade = prodNum(val('[data-prod-vel]'));
  if ($('[data-prod-pres]', dialog)) prodRasc.pressao = prodNum(val('[data-prod-pres]'));
  if ($('[data-prod-ponta]', dialog)) prodRasc.ponta = val('[data-prod-ponta]');
  if ($('[data-prod-prep]', dialog)) prodRasc.preparadorId = $('[data-prod-prep]', dialog).value;
  if ($('[data-prod-rec]', dialog)) prodRasc.receituario = val('[data-prod-rec]');
  if ($('[data-prod-resp]', dialog)) prodRasc.respTecnico = val('[data-prod-resp]');
}
let prodContexto = null; // {o, base: () => número} — operação e de onde vem a área / kg
function prodRedesenhar() {
  const box = $('[data-prod-bloco]', dialog); if (!box || !prodRasc || !prodContexto) return;
  const foco = document.activeElement, sel = foco && box.contains(foco) ? [...foco.attributes].find(a => a.name.startsWith('data-prod'))?.name : null, val = sel ? foco.getAttribute(sel) : null, pos = foco?.selectionStart;
  box.innerHTML = prodBlocoHtml(prodContexto.o(), prodContexto.base());
  if (sel) { const el = box.querySelector(`[${sel}${val ? `="${val}"` : ''}]`); if (el) { el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch { /* select */ } } }
}
const prodLinhaNova = () => ({itemId: '', dose: '', unDose: prodPorSemente(prodRasc.tipo) ? 'mL/100 kg' : 'L/ha'});
document.addEventListener('click', e => {
  if (!prodRasc || !dialog.contains(e.target)) return;
  if (e.target.closest('[data-prod-add]')) { e.preventDefault(); prodLer(); prodRasc.itens.push(prodLinhaNova()); prodRedesenhar(); return; }
  const x = e.target.closest('[data-prod-x]'); if (x) { e.preventDefault(); prodLer(); prodRasc.itens.splice(Number(x.dataset.prodX), 1); prodRedesenhar(); return; }
  // Cadastro rápido no estoque (ADM / supervisor): entra com saldo zero e já fica escolhido
  const c = e.target.closest('[data-prod-criar]'); if (c) { e.preventDefault(); prodLer(); const p = prodRasc.itens[c.dataset.prodCriar]; if (!p?.novo) return;
    const nome = (p.novo.nome || '').trim(); if (!nome) { showToast('Escreva o nome do produto', true); return; }
    if (db.stock.some(s => mcNorm(s.name) === mcNorm(nome))) { showToast(`“${nome}” já está no estoque: escolha na lista`, true); return; }
    const s = {id: uid(), name: nome, category: (PROD_CATS[prodRasc.tipo] || ['Outro'])[0], unit: p.novo.un || 'L', qty: 0, min: 0};
    db.stock.push(s); save(); p.itemId = s.id; delete p.novo; p.unDose = prodDosePadrao(s, prodRasc.tipo); prodRedesenhar(); showToast(`${nome} cadastrado no estoque`); }
});
document.addEventListener('change', e => {
  if (!prodRasc || !dialog.contains(e.target)) return;
  const it = e.target.closest('[data-prod-item]');
  if (it) { prodLer(); const p = prodRasc.itens[it.dataset.prodItem]; if (!p) return;
    if (it.value === '__legado') return;
    if (it.value === '__novo') { p.itemId = ''; delete p.nome; p.novo = {nome: '', un: prodPorSemente(prodRasc.tipo) ? 'L' : 'L'}; }
    else { const s = find('stock', it.value); p.itemId = it.value; delete p.nome; delete p.novo; p.usadoManual = false; if (s) p.unDose = prodDosePadrao(s, prodRasc.tipo); }
    prodRedesenhar(); $(`[data-prod-${it.value === '__novo' ? 'novo-nome' : 'dose'}="${it.dataset.prodItem}"]`, dialog)?.focus(); return; }
  if (e.target.matches('[data-prod-un]')) { prodLer(); prodRedesenhar(); }
});
document.addEventListener('input', e => {
  if (!prodRasc || !dialog.contains(e.target) || !e.target.matches('[data-prod-dose], [data-prod-calda], [data-prod-usado], [data-prod-vel], [data-prod-pres]')) return;
  if (e.target.matches('[data-prod-usado]')) { const p = prodRasc.itens[e.target.dataset.prodUsado]; if (p) p.usadoManual = true; }
  if (e.target.matches('[data-prod-dose]')) { const p = prodRasc.itens[e.target.dataset.prodDose]; if (p) p.usadoManual = false; }
  // Ao redesenhar, lê de novo tudo o que foi digitado até ali (ex.: receituário digitado depois da dose)
  prodLer(); clearTimeout(prodLer.t); prodLer.t = setTimeout(() => { prodLer(); prodRedesenhar(); }, 450);
});
function prodValidarItens(exigir) {
  prodLer();
  const r = prodRasc, cheios = r.itens.filter(p => p.itemId || p.nome);
  // Quantidade usada que o operador não mexeu: a calculada pela dose (mesmo que a tela ainda não tenha redesenhado)
  if (prodComUsado() && prodContexto) { const base = prodContexto.base(); cheios.forEach(p => { if (p.itemId && !p.usadoManual) p.usado = prodCalc(p, base, r.tipo) ?? ''; }); }
  if (r.itens.some(p => p.novo)) return 'Toque em Cadastrar para criar o produto no estoque (ou tire a linha)';
  if (r.itens.some(p => !p.itemId && !p.nome && p.dose !== '' && p.dose != null)) return 'Escolha o produto da dose informada (ou tire a linha)';
  if (cheios.some(p => p.dose !== '' && !(Number(p.dose) > 0))) return `Dose inválida em ${prodNome(cheios.find(p => p.dose !== '' && !(Number(p.dose) > 0)))}`;
  if (exigir) {
    const leg = cheios.find(p => !p.itemId); if (leg) return `Escolha no estoque o produto “${leg.nome}” (para dar baixa)`;
    // Aplicação sempre com produto (carência para a colheita); adubação, plantio e tratamento: produto opcional
    if (!cheios.length && r.tipo === 'Aplicação') return 'Informe os produtos aplicados (eles dão baixa no estoque e geram a carência)';
    const sem = cheios.find(p => !(Number(p.usado) > 0)); if (sem) return `Informe a quantidade usada de ${prodNome(sem)}`;
  }
  return '';
}
const prodGuardar = o => {
  const r = prodRasc;
  o.produtos = r.itens.filter(p => p.itemId || p.nome).map(p => ({itemId: p.itemId || '', ...(p.itemId ? {} : {nome: p.nome}), dose: p.dose, unDose: p.unDose, ...(p.carencia !== undefined && p.carencia !== '' ? {carencia: p.carencia} : {})}));
  if (['Aplicação', 'Adubação', 'Plantio'].includes(r.tipo)) o.velocidade = r.velocidade ?? '';
  if (r.tipo === 'Aplicação') Object.assign(o, {calda: r.calda, pressao: r.pressao ?? '', ponta: r.ponta || '', preparadorId: r.preparadorId || '', receituario: r.receituario || '', respTecnico: r.respTecnico || ''});
};
// Baixa no estoque pela quantidade usada informada; aplicação gera a carência. O saldo pode ficar negativo (o ADM é avisado).
function prodBaixar(o, base) {
  const data = o.date && o.status === 'Concluída' && !o.finishedAt ? o.date : today(), safra = typeof safraDoLancamento === 'function' ? safraDoLancamento({fieldId: o.fieldId, date: data}) : find('fields', o.fieldId)?.season || '';
  const usados = prodRasc.itens.filter(p => p.itemId || p.nome).map(p => p.usado);
  prodGuardar(o);
  o.produtos.forEach((p, k) => {
    const s = p.itemId ? find('stock', p.itemId) : null, q = Math.round((Number(usados[k]) || 0) * 1000) / 1000;
    if (s && q > 0) {
      const mov = aplicarMovimento(s, 'Saída', q, 0), id = uid();
      db.movements.push({id, itemId: s.id, kind: 'Saída', qty: q, date: data, fieldId: o.fieldId || '', season: safra, machineId: o.machineId || '', opId: o.id, notes: `${o.type} — ${opPlace(o)}`, ...mov});
      Object.assign(p, {movId: id, qtdEstoque: q, unEstoque: s.unit}); if (base > 0) p.doseReal = Math.round(q / base * 1000) / 1000;
      if (Number(s.qty) < 0) p.saldoNegativo = true;
    }
    const car = p.carencia !== undefined && p.carencia !== '' ? Number(p.carencia) : s && s.carencia !== '' && s.carencia != null ? Number(s.carencia) : null;
    if (o.type === 'Aplicação' && o.fieldId && (car != null || s?.category === 'Defensivo')) {
      const ap = {id: uid(), fieldId: o.fieldId, date: data, itemId: s?.id || '', produto: s ? s.name : p.nome, dose: Number(p.dose) > 0 ? `${num(p.dose)} ${p.unDose}` : p.doseReal ? `${num(p.doseReal)} ${s?.unit || ''}/ha` : '', qtd: p.qtdEstoque ?? '', baixar: p.movId ? 'Sim' : 'Não',
        carencia: car ?? 0, reentrada: s?.reentrada ?? '', machineId: o.machineId || '', receituario: o.receituario || '', responsavel: o.respTecnico || '', opId: o.id, opMovId: p.movId || '', notes: `Lançada pela operação ${o.type}`};
      db.aplicacoes.push(ap); p.aplicacaoId = ap.id;
    }
  });
  o.produtosBaixados = true; o.produtosEm = new Date().toISOString();
  if (o.type === 'Aplicação') { const c = prodClimaAgora(); if (c) o.climaFim ||= c; }
  const neg = o.produtos.filter(p => p.saldoNegativo);
  if (neg.length) setTimeout(() => showToast(`Estoque negativo: ${neg.map(p => prodNome(p)).join(', ')}. O ADM é avisado para lançar a entrada.`, true), 3200);
  prodRasc = null;
}
const prodValidarCarencia = () => { if (prodRasc.tipo !== 'Aplicação') return ''; const sem = prodRasc.itens.find(p => { const s = p.itemId && find('stock', p.itemId); return s?.category === 'Defensivo' && (s.carencia === '' || s.carencia == null) && (p.carencia === '' || p.carencia == null); }); return sem ? `Informe a carência (dias, da bula) de ${prodNome(sem)}` : ''; };

// ---------- Formulário da operação (programar, ou lançar já feita) ----------
function prodAoAbrirOp(op) {
  prodRasc = null; prodContexto = null;
  const form = $('form', dialog); if (!form) return;
  const tipoSel = form.elements.type, travado = op.produtosBaixados;
  const montar = () => {
    $('[data-prod-bloco]', dialog)?.remove();
    const t = tipoSel.value; if (!OP_COM_PRODUTO.includes(t)) { prodRasc = null; return; }
    if (travado) { form.querySelector('.form').insertAdjacentHTML('beforeend', `<div class="field full prod-bloco" data-prod-bloco><b>Produtos</b><p class="nota" style="margin:4px 0 0">${esc(prodResumo(op) || '—')}. Já baixados do estoque: para corrigir, ajuste no Estoque.</p></div>`); prodRasc = null; return; }
    if (!prodRasc || prodRasc.tipo !== t) prodRasc = {tipo: t, modo: 'plano', itens: (op.type === t ? op.produtos || [] : []).map(p => ({...p})), calda: op.calda ?? '', velocidade: op.velocidade ?? '', pressao: op.pressao ?? '', ponta: op.ponta || '', preparadorId: op.preparadorId || '', receituario: op.receituario || '', respTecnico: op.respTecnico || ''};
    prodRasc.concluir = form.elements.status?.value === 'Concluída' && op.status !== 'Concluída';
    if (!prodRasc.itens.length) prodRasc.itens.push(prodLinhaNova());
    prodContexto = {o: () => ({...op, type: t, fieldId: form.elements.fieldId?.value, machineId: form.elements.machineId?.value, implementoId: form.elements.implementoId?.value, area: numeroBR(form.elements.area?.value || '') || ''}),
      base: () => prodPorSemente(t) ? numeroBR(form.elements.kg?.value || '') || 0 : numeroBR(form.elements.area?.value || '') || Number(find('fields', form.elements.fieldId?.value)?.area) || 0};
    const alvo = form.elements.operator?.closest('.field');
    const html = `<div class="field full prod-bloco" data-prod-bloco>${prodBlocoHtml(prodContexto.o(), prodContexto.base())}</div>`;
    if (alvo) alvo.insertAdjacentHTML('beforebegin', html); else form.querySelector('.form').insertAdjacentHTML('beforeend', html);
  };
  tipoSel.addEventListener('change', montar);
  form.elements.status?.addEventListener('change', () => { if (!prodRasc) return; prodLer(); prodRasc.concluir = form.elements.status.value === 'Concluída' && op.status !== 'Concluída'; prodRedesenhar(); });
  ['fieldId', 'area', 'kg', 'machineId', 'implementoId'].forEach(k => form.elements[k]?.addEventListener('change', () => { prodLer(); prodRedesenhar(); }));
  montar();
}
function prodAoSalvarOp(item, op) {
  if (op.produtosBaixados) return '';
  if (!OP_COM_PRODUTO.includes(item.type)) { delete item.produtos; delete item.calda; return ''; }
  if (!prodRasc) return '';
  // Lançada já feita: pede a quantidade usada e dá baixa agora
  if (prodRasc.concluir && item.status === 'Concluída') {
    const e = prodValidarItens(true) || prodValidarCarencia(); if (e) return e;
    prodBaixar(item, prodContexto.base());
    return '';
  }
  const e = prodValidarItens(false); if (e) return e;
  prodGuardar(item); prodRasc = null;
  return '';
}

// ---------- Iniciar: plano da calda e clima ----------
function prodAoAbrirInicio(o) {
  const form = $('form', dialog); if (!form || !OP_COM_PRODUTO.includes(o.type)) return;
  const plano = prodPlanoCalda(o), c = o.type === 'Aplicação' ? prodClimaAgora() : null, base = prodPorSemente(o.type) ? Number(o.kg) || 0 : prodArea(o);
  const linhas = (o.produtos || []).map(p => { const t = prodTotal(p, base, o.type), tq = plano?.haTanque ? prodTotal(p, plano.haTanque, o.type) : null;
    return `<li><b>${esc(prodNome(p))}</b>${Number(p.dose) > 0 ? ` — ${num(p.dose)} ${esc(p.unDose)}` : ''}${tq ? ` • por tanque: ${prodFmt(tq.q, tq.u)}` : ''}${t ? ` • total: ${prodFmt(t.q, t.u)}` : ''}</li>`; }).join('');
  if (!linhas && !c) return;
  form.querySelector('.form').insertAdjacentHTML('afterbegin', `<div class="field full prod-bloco prod-info">
    ${linhas ? `<b>${o.type === 'Aplicação' ? 'Calda' : 'Produtos'}</b><ul>${linhas}</ul>${plano?.tanques ? `<p class="prod-plano"><b>${plano.tanques} ${plano.tanques === 1 ? 'tanque' : 'tanques'}</b> de ${num(plano.tanque)} L • ${num(plano.calda)} L/ha • ${num(Math.round(plano.haTanque * 10) / 10)} ha por tanque</p>` : ''}${o.preparadorId && find('machines', o.preparadorId) ? `<p class="nota" style="margin:4px 0">Calda preparada no ${esc(find('machines', o.preparadorId).name)}</p>` : ''}${[Number(o.velocidade) > 0 ? `velocidade ${num(o.velocidade, 1)} km/h` : '', Number(o.pressao) > 0 ? `pressão ${num(o.pressao, 1)} bar` : '', o.ponta ? `ponta ${o.ponta}` : ''].filter(Boolean).length ? `<p class="nota" style="margin:4px 0">Regulagem: ${esc([Number(o.velocidade) > 0 ? `velocidade ${num(o.velocidade, 1)} km/h` : '', Number(o.pressao) > 0 ? `pressão ${num(o.pressao, 1)} bar` : '', o.ponta ? `ponta ${o.ponta}` : ''].filter(Boolean).join(' • '))}</p>` : ''}${o.receituario ? `<small class="nota">Receituário nº ${esc(o.receituario)}${o.respTecnico ? ` — ${esc(o.respTecnico)}` : ''}</small>` : ''}` : ''}
    ${c ? `<p class="prod-clima ${c.ok ? 'ok' : 'ruim'}">${c.ok ? '✓ Bom para pulverizar agora' : `⚠ Atenção: ${esc(c.motivos.join(', '))}`}<small>${esc(prodClimaTxt(c))} (previsão)</small></p>` : ''}</div>`);
}
function prodAoIniciar(o) { if (o.type === 'Aplicação') { const c = prodClimaAgora(); if (c) o.climaIni = c; } }

// ---------- Concluir: área feita e quantidade usada (é ela que dá baixa), carência ----------
function prodAoAbrirConclusao(o) {
  prodRasc = null; prodContexto = null;
  const form = $('form', dialog); if (!form || !OP_COM_PRODUTO.includes(o.type) || o.produtosBaixados) return;
  prodRasc = {tipo: o.type, modo: 'conclusao', itens: (o.produtos || []).map(p => ({...p})), calda: o.calda ?? '', velocidade: o.velocidade ?? '', pressao: o.pressao ?? '', ponta: o.ponta || '', preparadorId: o.preparadorId || '', receituario: o.receituario || '', respTecnico: o.respTecnico || ''};
  if (!prodRasc.itens.length) prodRasc.itens.push(prodLinhaNova());
  prodContexto = {o: () => ({...o, area: numeroBR(form.elements.area?.value || '') || o.area}), base: () => prodPorSemente(o.type) ? numeroBR(form.elements.kg?.value || '') || Number(o.kg) || 0 : numeroBR(form.elements.area?.value || '') || prodArea(o)};
  const alvo = form.elements.notes?.closest('.field'), c = o.type === 'Aplicação' ? prodClimaAgora() : null;
  const html = `<div class="field full prod-bloco" data-prod-bloco>${prodBlocoHtml(prodContexto.o(), prodContexto.base())}</div>
    ${c ? `<div class="field full"><p class="prod-clima ${c.ok ? 'ok' : 'ruim'}">${c.ok ? '✓ Condição boa para pulverizar' : `⚠ ${esc(c.motivos.join(', '))}`}<small>${esc(prodClimaTxt(c))} (previsão, fica gravado)</small></p></div>` : ''}`;
  if (alvo) alvo.insertAdjacentHTML('beforebegin', html); else form.querySelector('.form').insertAdjacentHTML('beforeend', html);
  ['area', 'kg'].forEach(k => form.elements[k]?.addEventListener('input', () => { clearTimeout(prodAoAbrirConclusao.t); prodAoAbrirConclusao.t = setTimeout(() => { prodLer(); prodRedesenhar(); }, 400); }));
}
function prodValidarConclusao(o) {
  if (!prodRasc || prodRasc.modo !== 'conclusao' || o.produtosBaixados) return '';
  if (!(prodContexto.base() > 0)) return prodPorSemente(o.type) ? 'Informe os kg de semente tratados' : 'Informe a área feita (ha)';
  return prodValidarItens(true) || prodValidarCarencia();
}
function prodAoConcluir(o) {
  if (!prodRasc || prodRasc.modo !== 'conclusao' || o.produtosBaixados) return;
  prodBaixar(o, prodContexto.base());
}
// Excluir a operação: devolve ao estoque o que ela tirou e apaga as carências que ela gerou
const opDelSemProdutos = ACTIONS['op-del'];
ACTIONS['op-del'] = id => {
  const o = find('operations', id);
  if (!o?.produtos?.some(p => p.movId || p.aplicacaoId)) return opDelSemProdutos(id);
  confirmDialog('Excluir esta operação? Os produtos que ela tirou do estoque voltam ao saldo e as carências geradas por ela saem de Aplicações.', () => {
    o.produtos.forEach(p => {
      const m = p.movId && find('movements', p.movId); if (m) { const s = find('stock', m.itemId); if (s) s.qty = Number(s.qty || 0) + Number(m.qty); db.movements = db.movements.filter(x => x.id !== m.id); }
      if (p.aplicacaoId) db.aplicacoes = db.aplicacoes.filter(a => a.id !== p.aplicacaoId);
    });
    remove('operations', id); showToast('Operação excluída');
  });
};

// Estoque negativo (saída de operação maior que o saldo): aviso para quem lança as entradas
const alertasSemProdutos = alerts;
alerts = function () {
  const l = alertasSemProdutos();
  if (typeof mcpGestor !== 'function' || mcpGestor()) db.stock.filter(s => Number(s.qty) < 0).forEach(s => l.unshift({color: 'red', icon: '!', title: `Estoque negativo: ${s.name}`, text: `Saldo ${num(s.qty)} ${s.unit}: saiu mais do que havia lançado. Lance a entrada da nota.`, route: 'estoque'}));
  return l;
};
