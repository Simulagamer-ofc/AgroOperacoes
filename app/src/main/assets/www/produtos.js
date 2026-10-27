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
let prodRasc = null; // {tipo, itens: [{itemId, nome, dose, unDose, carencia}], calda, receituario, respTecnico, modo: 'plano' | 'conclusao'}
function prodOpcoes(tipo) {
  const cats = PROD_CATS[tipo] || [], lista = db.stock.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  const ind = lista.filter(s => cats.includes(s.category)), outros = lista.filter(s => !cats.includes(s.category) && s.category !== 'Combustível' && s.category !== 'Peças');
  const op = s => `<option value="${esc(s.id)}">${esc(s.name)} — ${num(s.qty)} ${esc(s.unit)}</option>`;
  return `<option value="">Escolha o produto…</option>${ind.length ? `<optgroup label="${esc(cats.join(', '))}">${ind.map(op).join('')}</optgroup>` : ''}${outros.length ? `<optgroup label="Outros itens do estoque">${outros.map(op).join('')}</optgroup>` : ''}<option value="__outro">Outro (não está no estoque)…</option>`;
}
function prodLinha(p, i, base) {
  const r = prodRasc, s = p.itemId ? find('stock', p.itemId) : null, tot = prodTotal(p, base, r.tipo), doses = prodPorSemente(r.tipo) ? DOSES_SEM : DOSES_HA;
  const precisaCar = r.tipo === 'Aplicação' && r.modo === 'conclusao' && (s ? s.category === 'Defensivo' : !!p.nome) && !(s && s.carencia !== '' && s.carencia != null);
  const sel = prodOpcoes(r.tipo).replace(`value="${esc(p.itemId || (p.nome ? '__outro' : ''))}"`, `value="${esc(p.itemId || (p.nome ? '__outro' : ''))}" selected`);
  return `<div class="prod-it" data-prod="${i}">
    <div class="prod-l1"><select data-prod-item="${i}" aria-label="Produto ${i + 1}">${sel}</select><button type="button" class="prod-x" data-prod-x="${i}" aria-label="Tirar produto">✕</button></div>
    ${!p.itemId && p.nome != null ? `<input class="prod-nome" data-prod-nome="${i}" value="${esc(p.nome || '')}" placeholder="Nome do produto">` : ''}
    <div class="prod-l2"><input data-prod-dose="${i}" inputmode="decimal" value="${esc(p.dose === '' || p.dose == null ? '' : String(p.dose).replace('.', ','))}" placeholder="Dose" aria-label="Dose"><select data-prod-un="${i}" aria-label="Unidade da dose">${doses.map(u => `<option ${u === p.unDose ? 'selected' : ''}>${u}</option>`).join('')}</select>
      <span class="prod-tot">${tot ? `= ${prodFmt(tot.q, tot.u)}${tot.est != null && tot.unEst !== tot.u ? ` (${prodFmt(tot.est, tot.unEst)})` : ''}${s && tot.est != null && tot.est > Number(s.qty || 0) ? ' <b class="txt-red">saldo insuficiente</b>' : ''}` : ''}</span></div>
    ${precisaCar ? `<div class="prod-l2"><input data-prod-car="${i}" inputmode="numeric" value="${esc(p.carencia ?? '')}" placeholder="Carência (dias, da bula)" aria-label="Carência em dias"><small class="nota">sem carência no cadastro do produto</small></div>` : ''}
  </div>`;
}
function prodBlocoHtml(o, base) {
  const r = prodRasc, plano = r.tipo === 'Aplicação' ? prodPlanoCalda({...o, calda: r.calda}, base) : null;
  const tanque = plano?.tanque, porTanque = plano?.haTanque ? r.itens.filter(p => Number(p.dose) > 0).map(p => { const t = prodTotal(p, plano.haTanque, r.tipo); return t ? `${prodNome(p)}: ${prodFmt(t.q, t.u)}` : ''; }).filter(Boolean) : [];
  return `<div class="prod-topo"><b>Produtos${r.tipo === 'Aplicação' ? ' da calda' : ''}</b><small>${prodPorSemente(r.tipo) ? (base ? `para ${num(base)} kg de semente` : 'informe os kg de semente para calcular') : base ? `para ${num(base)} ha` : 'escolha o talhão ou informe a área para calcular'}</small></div>
    ${r.itens.map((p, i) => prodLinha(p, i, base)).join('')}
    <button type="button" class="link" data-prod-add>+ Produto</button>
    ${r.tipo === 'Aplicação' ? `<div class="prod-calda"><label>Volume de calda (L/ha)<input data-prod-calda inputmode="decimal" value="${esc(r.calda === '' || r.calda == null ? '' : String(r.calda).replace('.', ','))}" placeholder="Ex.: 100"></label>
      ${plano ? `<p class="prod-plano">${plano.tanques ? `<b>${plano.tanques} ${plano.tanques === 1 ? 'tanque' : 'tanques'}</b> de ${num(tanque)} L (${num(Math.round(plano.haTanque * 10) / 10)} ha por tanque) • ` : ''}${num(Math.round(plano.volume))} L de calda${porTanque.length ? `<br>Por tanque cheio: ${esc(porTanque.join(' • '))}` : ''}${!tanque ? '<br><small>Cadastre a capacidade do tanque do pulverizador para ver os tanques.</small>' : ''}</p>` : ''}</div>
      <div class="prod-rec"><label>Nº do receituário<input data-prod-rec value="${esc(r.receituario || '')}"></label><label>Responsável técnico<input data-prod-resp value="${esc(r.respTecnico || '')}"></label></div>` : ''}`;
}
function prodLer() {
  if (!prodRasc) return;
  $$('[data-prod-dose]', dialog).forEach(el => { const p = prodRasc.itens[el.dataset.prodDose]; if (p) { const n = el.value.trim() === '' ? '' : numeroBR(el.value.trim()); p.dose = n === undefined ? el.value.trim() : n; } });
  $$('[data-prod-un]', dialog).forEach(el => { const p = prodRasc.itens[el.dataset.prodUn]; if (p) p.unDose = el.value; });
  $$('[data-prod-nome]', dialog).forEach(el => { const p = prodRasc.itens[el.dataset.prodNome]; if (p) p.nome = el.value.trim(); });
  $$('[data-prod-car]', dialog).forEach(el => { const p = prodRasc.itens[el.dataset.prodCar]; if (p) p.carencia = el.value.trim() === '' ? '' : Number(numeroBR(el.value.trim())); });
  const c = $('[data-prod-calda]', dialog); if (c) { const n = c.value.trim() === '' ? '' : numeroBR(c.value.trim()); prodRasc.calda = n === undefined ? '' : n; }
  const rc = $('[data-prod-rec]', dialog); if (rc) prodRasc.receituario = rc.value.trim();
  const rp = $('[data-prod-resp]', dialog); if (rp) prodRasc.respTecnico = rp.value.trim();
}
let prodContexto = null; // {o, base: () => número} — operação e de onde vem a área / kg
function prodRedesenhar() {
  const box = $('[data-prod-bloco]', dialog); if (!box || !prodRasc || !prodContexto) return;
  prodLer(); // o que foi digitado e ainda não lido (ex.: receituário) não se perde ao redesenhar
  const foco = document.activeElement, sel = foco && box.contains(foco) ? [...foco.attributes].find(a => a.name.startsWith('data-prod'))?.name : null, val = sel ? foco.getAttribute(sel) : null, pos = foco?.selectionStart;
  box.innerHTML = prodBlocoHtml(prodContexto.o(), prodContexto.base());
  if (sel) { const el = box.querySelector(`[${sel}${val ? `="${val}"` : ''}]`); if (el) { el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch { /* select */ } } }
}
document.addEventListener('click', e => {
  if (!prodRasc || !dialog.contains(e.target)) return;
  if (e.target.closest('[data-prod-add]')) { e.preventDefault(); prodLer(); prodRasc.itens.push({itemId: '', dose: '', unDose: prodPorSemente(prodRasc.tipo) ? 'mL/100 kg' : 'L/ha'}); prodRedesenhar(); return; }
  const x = e.target.closest('[data-prod-x]'); if (x) { e.preventDefault(); prodLer(); prodRasc.itens.splice(Number(x.dataset.prodX), 1); prodRedesenhar(); }
});
document.addEventListener('change', e => {
  if (!prodRasc || !dialog.contains(e.target)) return;
  const it = e.target.closest('[data-prod-item]');
  if (it) { prodLer(); const p = prodRasc.itens[it.dataset.prodItem]; if (!p) return;
    if (it.value === '__outro') { p.itemId = ''; p.nome = p.nome || ''; } else { const s = find('stock', it.value); p.itemId = it.value; delete p.nome; if (s) p.unDose = prodDosePadrao(s, prodRasc.tipo); }
    prodRedesenhar(); if (it.value === '__outro') $(`[data-prod-nome="${it.dataset.prodItem}"]`, dialog)?.focus(); else $(`[data-prod-dose="${it.dataset.prodItem}"]`, dialog)?.focus(); return; }
  if (e.target.matches('[data-prod-un]')) { prodLer(); prodRedesenhar(); }
});
document.addEventListener('input', e => {
  if (!prodRasc || !dialog.contains(e.target) || !e.target.matches('[data-prod-dose], [data-prod-calda]')) return;
  prodLer(); clearTimeout(prodLer.t); prodLer.t = setTimeout(prodRedesenhar, 450);
});
function prodValidarItens(exigir) {
  prodLer();
  const r = prodRasc, cheios = r.itens.filter(p => p.itemId || p.nome);
  if (r.itens.some(p => !p.itemId && p.nome === '')) return 'Escreva o nome do produto (ou tire a linha)';
  // Linha vazia (sem produto e sem dose) é ignorada; com dose e sem produto, pede o produto
  if (r.itens.some(p => !p.itemId && p.nome == null && p.dose !== '' && p.dose != null)) return 'Escolha o produto da dose informada (ou tire a linha)';
  if (cheios.some(p => p.dose !== '' && !(Number(p.dose) > 0))) return `Dose inválida em ${prodNome(cheios.find(p => p.dose !== '' && !(Number(p.dose) > 0)))}`;
  if (exigir && !cheios.length) return r.tipo === 'Aplicação' ? 'Informe os produtos aplicados (eles geram a carência para a colheita)' : 'Informe os produtos usados';
  if (exigir) { const sem = cheios.find(p => !(Number(p.dose) > 0)); if (sem) return `Informe a dose de ${prodNome(sem)}`; }
  return '';
}
const prodGuardar = o => {
  const r = prodRasc; o.produtos = r.itens.filter(p => p.itemId || p.nome).map(p => ({itemId: p.itemId || '', ...(p.itemId ? {} : {nome: p.nome}), dose: p.dose, unDose: p.unDose, ...(p.carencia !== undefined && p.carencia !== '' ? {carencia: p.carencia} : {})}));
  if (r.tipo === 'Aplicação') { o.calda = r.calda; o.receituario = r.receituario || ''; o.respTecnico = r.respTecnico || ''; }
};

// ---------- Formulário da operação (programar / editar) ----------
function prodAoAbrirOp(op) {
  prodRasc = null; prodContexto = null;
  const form = $('form', dialog); if (!form) return;
  const tipoSel = form.elements.type, travado = op.produtosBaixados;
  const montar = () => {
    $('[data-prod-bloco]', dialog)?.remove();
    const t = tipoSel.value; if (!OP_COM_PRODUTO.includes(t)) { prodRasc = null; return; }
    if (travado) { form.querySelector('.form').insertAdjacentHTML('beforeend', `<div class="field full prod-bloco"><b>Produtos</b><p class="nota" style="margin:4px 0 0">${esc(prodResumo(op) || '—')}. Já baixados do estoque na conclusão: para corrigir, ajuste no Estoque.</p></div>`); return; }
    if (!prodRasc || prodRasc.tipo !== t) prodRasc = {tipo: t, modo: 'plano', itens: (op.type === t ? op.produtos || [] : []).map(p => ({...p})), calda: op.calda ?? '', receituario: op.receituario || '', respTecnico: op.respTecnico || ''};
    if (!prodRasc.itens.length) prodRasc.itens.push({itemId: '', dose: '', unDose: prodPorSemente(t) ? 'mL/100 kg' : 'L/ha'});
    prodContexto = {o: () => ({...op, type: t, fieldId: form.elements.fieldId?.value, machineId: form.elements.machineId?.value, implementoId: form.elements.implementoId?.value, area: numeroBR(form.elements.area?.value || '') || ''}),
      base: () => prodPorSemente(t) ? numeroBR(form.elements.kg?.value || '') || 0 : numeroBR(form.elements.area?.value || '') || Number(find('fields', form.elements.fieldId?.value)?.area) || 0};
    const alvo = form.elements.operator?.closest('.field');
    const html = `<div class="field full prod-bloco" data-prod-bloco>${prodBlocoHtml(prodContexto.o(), prodContexto.base())}</div>`;
    if (alvo) alvo.insertAdjacentHTML('beforebegin', html); else form.querySelector('.form').insertAdjacentHTML('beforeend', html);
  };
  tipoSel.addEventListener('change', montar);
  ['fieldId', 'area', 'kg', 'machineId', 'implementoId'].forEach(k => form.elements[k]?.addEventListener('change', () => { prodLer(); prodRedesenhar(); }));
  montar();
}
function prodAoSalvarOp(item, op) {
  if (op.produtosBaixados) return '';
  if (!prodRasc || !OP_COM_PRODUTO.includes(item.type)) { if (!OP_COM_PRODUTO.includes(item.type)) { delete item.produtos; delete item.calda; } return ''; }
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
    ${linhas ? `<b>${o.type === 'Aplicação' ? 'Calda' : 'Produtos'}</b><ul>${linhas}</ul>${plano?.tanques ? `<p class="prod-plano"><b>${plano.tanques} ${plano.tanques === 1 ? 'tanque' : 'tanques'}</b> de ${num(plano.tanque)} L • ${num(plano.calda)} L/ha • ${num(Math.round(plano.haTanque * 10) / 10)} ha por tanque</p>` : ''}${o.receituario ? `<small class="nota">Receituário nº ${esc(o.receituario)}${o.respTecnico ? ` — ${esc(o.respTecnico)}` : ''}</small>` : ''}` : ''}
    ${c ? `<p class="prod-clima ${c.ok ? 'ok' : 'ruim'}">${c.ok ? '✓ Bom para pulverizar agora' : `⚠ Atenção: ${esc(c.motivos.join(', '))}`}<small>${esc(prodClimaTxt(c))} (previsão)</small></p>` : ''}</div>`);
}
function prodAoIniciar(o) { if (o.type === 'Aplicação') { const c = prodClimaAgora(); if (c) o.climaIni = c; } }

// ---------- Concluir: quantidade usada, baixa no estoque e carência ----------
function prodAoAbrirConclusao(o) {
  prodRasc = null; prodContexto = null;
  const form = $('form', dialog); if (!form || !OP_COM_PRODUTO.includes(o.type) || o.produtosBaixados) return;
  prodRasc = {tipo: o.type, modo: 'conclusao', itens: (o.produtos || []).map(p => ({...p})), calda: o.calda ?? '', receituario: o.receituario || '', respTecnico: o.respTecnico || ''};
  if (!prodRasc.itens.length) prodRasc.itens.push({itemId: '', dose: '', unDose: prodPorSemente(o.type) ? 'mL/100 kg' : 'L/ha'});
  prodContexto = {o: () => ({...o, area: numeroBR(form.elements.area?.value || '') || o.area}), base: () => prodPorSemente(o.type) ? numeroBR(form.elements.kg?.value || '') || Number(o.kg) || 0 : numeroBR(form.elements.area?.value || '') || prodArea(o)};
  const alvo = form.elements.notes?.closest('.field'), c = o.type === 'Aplicação' ? prodClimaAgora() : null;
  const html = `<div class="field full prod-bloco" data-prod-bloco>${prodBlocoHtml(prodContexto.o(), prodContexto.base())}</div>
    <div class="field full prod-baixa"><label class="prod-check"><input type="checkbox" data-prod-baixar ${db.stock.length ? 'checked' : ''}> Tirar do estoque o total usado (pela área trabalhada)</label>${c ? `<p class="prod-clima ${c.ok ? 'ok' : 'ruim'}">${c.ok ? '✓ Condição boa para pulverizar' : `⚠ ${esc(c.motivos.join(', '))}`}<small>${esc(prodClimaTxt(c))} (previsão, fica gravado)</small></p>` : ''}</div>`;
  if (alvo) alvo.insertAdjacentHTML('beforebegin', html); else form.querySelector('.form').insertAdjacentHTML('beforeend', html);
  ['area', 'kg'].forEach(k => form.elements[k]?.addEventListener('input', () => { clearTimeout(prodAoAbrirConclusao.t); prodAoAbrirConclusao.t = setTimeout(() => { prodLer(); prodRedesenhar(); }, 400); }));
}
function prodValidarConclusao(o) {
  if (!prodRasc || prodRasc.modo !== 'conclusao' || o.produtosBaixados) return '';
  const e = prodValidarItens(true); if (e) return e;
  const base = prodContexto.base(), baixar = $('[data-prod-baixar]', dialog)?.checked;
  if (!(base > 0)) return prodPorSemente(o.type) ? 'Informe os kg de semente tratados para calcular os produtos' : 'Informe a área trabalhada para calcular os produtos';
  if (o.type === 'Aplicação') { const sem = prodRasc.itens.find(p => (p.itemId ? find('stock', p.itemId)?.category === 'Defensivo' && (find('stock', p.itemId).carencia === '' || find('stock', p.itemId).carencia == null) : p.nome) && (p.carencia === '' || p.carencia == null)); if (sem) return `Informe a carência (dias, da bula) de ${prodNome(sem)}`; }
  if (baixar) for (const p of prodRasc.itens.filter(x => x.itemId)) {
    const s = find('stock', p.itemId), t = prodTotal(p, base, o.type);
    if (t && t.est == null) return `A dose de ${s.name} está em ${t.u} e o estoque em ${s.unit}: ajuste a unidade da dose ou desmarque a baixa no estoque`;
    if (t && t.est > Number(s.qty || 0)) return `Saldo insuficiente de ${s.name}: precisa de ${prodFmt(t.est, s.unit)}, há ${prodFmt(Number(s.qty) || 0, s.unit)}`;
  }
  return '';
}
function prodAoConcluir(o) {
  if (!prodRasc || prodRasc.modo !== 'conclusao' || o.produtosBaixados) return;
  const base = prodContexto.base(), baixar = $('[data-prod-baixar]', dialog)?.checked, data = today(), safra = typeof safraDoLancamento === 'function' ? safraDoLancamento({fieldId: o.fieldId, date: data}) : find('fields', o.fieldId)?.season || '';
  prodGuardar(o);
  o.produtos.forEach(p => {
    const s = p.itemId ? find('stock', p.itemId) : null, t = prodTotal(p, base, o.type);
    if (t) { p.total = Math.round(t.q * 1000) / 1000; p.unTotal = t.u; }
    if (baixar && s && t?.est > 0) {
      const mov = aplicarMovimento(s, 'Saída', t.est, 0), id = uid();
      db.movements.push({id, itemId: s.id, kind: 'Saída', qty: Math.round(t.est * 1000) / 1000, date: data, fieldId: o.fieldId || '', season: safra, machineId: o.machineId || '', opId: o.id, notes: `${o.type} — ${opPlace(o)}`, ...mov});
      p.movId = id; p.qtdEstoque = Math.round(t.est * 1000) / 1000;
    }
    // Aplicação: carência para a colheita (produto defensivo ou com carência informada)
    const car = p.carencia !== undefined && p.carencia !== '' ? Number(p.carencia) : s && s.carencia !== '' && s.carencia != null ? Number(s.carencia) : null;
    if (o.type === 'Aplicação' && o.fieldId && (car != null || s?.category === 'Defensivo')) {
      const ap = {id: uid(), fieldId: o.fieldId, date: data, itemId: s?.id || '', produto: s ? s.name : p.nome, dose: Number(p.dose) > 0 ? `${num(p.dose)} ${p.unDose}` : '', qtd: p.qtdEstoque ?? '', baixar: p.movId ? 'Sim' : 'Não',
        carencia: car ?? 0, reentrada: s?.reentrada ?? '', machineId: o.machineId || '', receituario: o.receituario || '', responsavel: o.respTecnico || '', opId: o.id, opMovId: p.movId || '', notes: `Lançada pela operação ${o.type}`};
      db.aplicacoes.push(ap); p.aplicacaoId = ap.id;
    }
  });
  o.produtosBaixados = !!baixar; o.produtosEm = new Date().toISOString();
  if (o.type === 'Aplicação') { const c = prodClimaAgora(); if (c) o.climaFim = c; }
  prodRasc = null;
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
