'use strict';
/* MercaPlant — Lançamentos mais rápidos, sem perder a precisão (0.85).
   • Talhão pelo GPS: operação, monitoramento, chuva e aplicação sugerem o talhão onde o celular está (contornos do mapa).
     Só procura sozinho quando a localização já está liberada; senão, mostra o botão “Achar o talhão pelo GPS”.
   • Pessoas da lista: operador e responsável sugerem a Equipe, os usuários da fazenda e os nomes já usados; o que bate
     (sem acento ou maiúscula) é gravado igual ao da lista — “joao” vira “João Silva”. O usuário comum já vem como operador.
   • Fornecedor da lista: gasto e entrada de estoque sugerem os fornecedores cadastrados e os já usados, com o mesmo ajuste.
   • Lembrar o último: implemento que costuma ir com a máquina, pluviômetro, origem e tanque do diesel, fornecedor do item;
     “↺ Igual ao último” no abastecimento e na chuva. Litros, mm e horímetro nunca são copiados: sempre digitados.
   • Último horímetro/odômetro de qualquer máquina escolhida (abastecimento e registro de horímetro).
   • Monitoramento: nome da praga, unidade e nível de ação já usados pela fazenda.
   • Chuva de vários pluviômetros numa tela só.
   • QR code na máquina: etiqueta para imprimir; “📷 Ler QR” fotografa a etiqueta e abre a máquina com as ações do dia. */

const agComum = () => typeof nvComum === 'function' && nvComum();
const agEuNome = () => { const u = typeof nv !== 'undefined' && nv?.sessao?.usuario; return (u && nv.nomes?.[u]) || (typeof quemUsa === 'function' ? quemUsa() : '') || ''; };
// Sem repetir (ignora acento e maiúscula), mantendo a primeira grafia
const agUnicos = l => { const m = new Map(); l.forEach(x => { const t = String(x || '').trim(); if (t && !m.has(normSug(t))) m.set(normSug(t), t); }); return [...m.values()]; };
const agRecentes = l => (l || []).slice().sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || '')));
const agPessoas = () => agUnicos([...(db.equipe || []).filter(p => !p.inativo && p.ativo !== false).map(p => p.nome),
  ...Object.values((typeof nv !== 'undefined' && nv?.nomes) || {}), ...agRecentes([...db.operations, ...db.fuel]).slice(0, 300).map(x => x.operator)]);
const agFornecedores = () => agUnicos([...(db.fornecedores || []).map(f => f.nome), ...agRecentes([...db.movements, ...db.expenses]).slice(0, 500).map(x => x.supplier)]);
const AG_GPS = ['op', 'mip', 'chuva', 'aplicacao'];

// Última leitura do medidor de uma máquina e de quando é
function agUltimaLeitura(m) {
  const regs = [...db.hourLogs.filter(h => h.machineId === m.id && Number(h.hours) > 0).map(h => ({d: h.date, h: Number(h.hours)})),
    ...db.fuel.filter(f => f.machineId === m.id && Number(f.hours) > 0).map(f => ({d: f.date, h: Number(f.hours)}))];
  const u = regs.filter(r => r.h === Number(m.hours)).sort((a, b) => String(b.d).localeCompare(String(a.d)))[0];
  return {h: Number(m.hours) || 0, d: u?.d || ''};
}
function agDica(form, k, html, cls = 'ag-dica') {
  const fld = form.elements[k]?.closest('.field'); if (!fld) return null;
  let h = fld.querySelector('.' + cls); if (!h) { h = Object.assign(document.createElement('span'), {className: 'hint ' + cls}); fld.append(h); }
  h.innerHTML = html; return h;
}
const agSet = (form, k, v) => { const el = form.elements[k]; if (!el || v == null || v === '') return false; if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === String(v))) return false; el.value = String(v); el.dispatchEvent(new Event('change', {bubbles: true})); return true; };

// ---------------- Antes de abrir: listas e valores lembrados ----------------
FORM_PRE.push(cfg => {
  const F = cfg.form; if (!F) return;
  const v = cfg.values, novo = !cfg.editando && !v.id;
  for (const f of cfg.fields || []) {
    if (f.k === 'operator' || (f.k === 'responsavel' && F === 'mip')) { f.sugestoes = agPessoas; f.canon = true; }
    if (f.k === 'responsavel' && F === 'aplicacao') { f.sugestoes = () => agUnicos(agRecentes(db.aplicacoes).map(a => a.responsavel)); f.canon = true; }
    if (f.k === 'supplier' && (F === 'mov' || F === 'gasto')) { f.sugestoes = agFornecedores; f.canon = true; }
    if (F === 'mip' && f.k === 'alvo') { f.sugestoes = () => agUnicos(agRecentes(db.monitoramentos).map(m => m.alvo)); f.canon = true; }
    if (F === 'mip' && f.k === 'unidade') { f.sugestoes = () => agUnicos(agRecentes(db.monitoramentos).map(m => m.unidade)); f.canon = true; }
  }
  if (!novo) return;
  // Quem está lançando no campo (usuário comum) já vem como operador / responsável
  if ((F === 'op' || F === 'abastecimento') && !v.operator && agComum()) v.operator = agEuNome();
  if (F === 'mip' && !v.responsavel && agComum()) v.responsavel = agEuNome();
  // Lembrar o último
  if (F === 'chuva' && v.fieldId === undefined) { const u = agRecentes(db.chuvas)[0]; if (u?.fieldId && find('fields', u.fieldId)) { v.fieldId = u.fieldId; cfg._lembrado = {fieldId: u.fieldId}; } }
  if (F === 'abastecimento') { const u = agRecentes(db.fuel)[0];
    if (u?.origem === 'posto') v.origem = 'posto'; else if (u?.itemId && find('stock', u.itemId)) { v.origem = 'estoque'; v.itemId = u.itemId; } }
  if (F === 'mov' && cfg.kind === 'Entrada' && v.itemId && !v.supplier) v.supplier = agRecentes(db.movements.filter(m => m.itemId === v.itemId && m.kind === 'Entrada' && m.supplier))[0]?.supplier || '';
});

// ---------------- Formulário aberto ----------------
FORM_POS.push((cfg, form) => {
  const F = cfg.form; if (!F) return;
  const novo = !cfg.editando && !cfg.values.id;
  if (novo && AG_GPS.includes(F)) agGpsTalhao(cfg, form);
  // Último horímetro/odômetro da máquina escolhida
  if ((F === 'abastecimento' || F === 'horimetro') && form.elements.machineId) {
    const atual = () => { const m = find('machines', form.elements.machineId.value), k = 'hours'; if (!m || !temMedidor(m)) { agDica(form, k, ''); return; }
      const l = agUltimaLeitura(m), lab = form.elements[k]?.closest('.field')?.querySelector('label');
      if (lab) lab.textContent = F === 'abastecimento' ? `${porKm(m) ? 'Odômetro' : 'Horímetro'} no abastecimento (${unidMed(m)}) *` : `Leitura do ${porKm(m) ? 'odômetro (km)' : 'horímetro (h)'} *`;
      agDica(form, k, `Último registro: <b>${esc(num(l.h))} ${unidMed(m)}</b>${l.d ? ` em ${esc(fmtDate(l.d))}` : ''}. Confira o painel.`);
      $$('.field > .hint:not(.ag-dica)', form.elements[k].closest('.field')).forEach(h => { if (/^Último registro/.test(h.textContent)) h.hidden = true; }); };
    form.elements.machineId.addEventListener('change', atual); atual();
  }
  // ↺ Igual ao último (o número da leitura nunca é copiado)
  if (novo && F === 'abastecimento') { const u = agRecentes(db.fuel)[0], m = u && find('machines', u.machineId);
    if (m && !isInactive(m)) agBotaoUltimo(form, `↺ Igual ao último: ${m.name}${u.origem === 'posto' ? ', posto' : ''}`, () => {
      agSet(form, 'machineId', u.machineId); agSet(form, 'origem', u.origem); agSet(form, 'itemId', u.itemId); agSet(form, 'cheio', u.cheio); if (u.operator && !form.elements.operator.value) form.elements.operator.value = u.operator; form.elements.liters?.focus(); }); }
  if (novo && F === 'chuva') { const u = agRecentes(db.chuvas)[0];
    if (u) agBotaoUltimo(form, `↺ Igual à última: ${u.fieldId ? fieldName(u.fieldId) || 'talhão' : 'sede'}${u.hora ? ', ' + u.hora : ''}`, () => { agSet(form, 'fieldId', u.fieldId || ''); if (!u.fieldId && form.elements.fieldId) { form.elements.fieldId.value = ''; form.elements.fieldId.dispatchEvent(new Event('change', {bubbles: true})); } if (u.hora) { form.elements.hora.value = u.hora; form.elements.hora.dispatchEvent(new Event('change', {bubbles: true})); } form.elements.mm?.focus(); }); }
  // Operação: o implemento que costuma ir com esta máquina
  if (F === 'op' && form.elements.machineId && form.elements.implementoId) form.elements.machineId.addEventListener('change', () => setTimeout(() => {
    const im = form.elements.implementoId, mid = form.elements.machineId.value; if (!mid || im.value || im.closest('.field')?.hidden) return;
    const u = agRecentes(db.operations.filter(o => o.machineId === mid && o.implementoId && o.id !== cfg.values.id))[0];
    if (u && agSet(form, 'implementoId', u.implementoId)) agDica(form, 'implementoId', `Último usado com ${esc(machineName(mid))} (${esc(fmtDate(u.date))}). Troque se for outro.`);
  }, 0));
  // Entrada de estoque: fornecedor da última entrada do item
  if (F === 'mov' && form.elements.itemId && form.elements.supplier) form.elements.itemId.addEventListener('change', () => {
    if (form.elements.supplier.value) return; const s = agRecentes(db.movements.filter(m => m.itemId === form.elements.itemId.value && m.kind === 'Entrada' && m.supplier))[0]?.supplier;
    if (s) form.elements.supplier.value = s; });
  // Monitoramento: unidade e nível de ação usados da última vez para a mesma praga
  if (F === 'mip' && form.elements.alvo) { const preencher = () => {
    const a = normSug(form.elements.alvo.value); if (!a) return; const u = agRecentes(db.monitoramentos.filter(m => normSug(m.alvo) === a && m.id !== cfg.values.id))[0]; if (!u) return;
    const feitos = [];
    if (!form.elements.unidade.value && u.unidade) { form.elements.unidade.value = u.unidade; feitos.push('unidade'); }
    if (form.elements.nivelAcao && !form.elements.nivelAcao.value && u.nivelAcao !== '' && u.nivelAcao != null) { form.elements.nivelAcao.value = String(u.nivelAcao).replace('.', ','); feitos.push('nível de ação'); }
    if (form.elements.tipo && u.tipo && form.elements.tipo.value !== u.tipo) agSet(form, 'tipo', u.tipo);
    if (feitos.length) agDica(form, 'alvo', `${feitos.join(' e ')} iguais ao último monitoramento de ${esc(u.alvo)} (${esc(fmtDate(u.date))}). Confira.`); };
    form.elements.alvo.addEventListener('change', preencher); }
});
function agBotaoUltimo(form, rotulo, fazer) {
  const b = Object.assign(document.createElement('button'), {type: 'button', className: 'ag-ultimo', textContent: rotulo});
  b.onclick = () => { fazer(); b.remove(); };
  form.prepend(b);
}

// ---------------- Talhão pelo GPS ----------------
function agGpsTalhao(cfg, form) {
  const sel = form.elements.fieldId; if (!sel || typeof confPosicao !== 'function') return;
  const comCont = db.fields.filter(f => f.contorno?.pontos?.length > 2); if (!comCont.length) return;
  const dica = html => agDica(form, 'fieldId', html, 'ag-gps');
  // Lista obrigatória já abre no primeiro talhão: o GPS pode trocar enquanto a pessoa não escolher outro
  const inicial = sel.value; let mexeu = false; sel.addEventListener('input', () => { mexeu = true; });
  const botao = () => { const h = dica('<button type="button" class="link" data-ag-gps>📍 Achar o talhão pelo GPS</button>'); h.querySelector('[data-ag-gps]').onclick = () => buscar(true); };
  const buscar = async manual => {
    dica('📍 Procurando o talhão pelo GPS…');
    const g = await confPosicao(manual ? 15000 : 8000);
    if (!form.isConnected) return;
    if (g.erro) { if (manual) dica(`📍 ${esc(g.erro)}.`); else botao(); return; }
    const f = comCont.find(t => confDentro(g.lat, g.lon, t.contorno.pontos));
    if (!f) { dica(`📍 Pelo GPS você não está dentro de nenhum talhão com contorno${g.prec ? ` (precisão ±${g.prec} m)` : ''}.`); return; }
    const pode = manual || (!mexeu && (sel.value === '' || sel.value === cfg._lembrado?.fieldId || sel.value === inicial));
    if (sel.value === f.id) dica(`📍 Confere com o GPS: você está no <b>${esc(f.name)}</b>.`);
    else if (pode && agSet(form, 'fieldId', f.id)) dica(`📍 Pelo GPS: você está no <b>${esc(f.name)}</b>. Troque se for outro.`);
    else { const h = dica(`📍 Pelo GPS você está no <b>${esc(f.name)}</b>. <button type="button" class="link">Usar este</button>`); h.querySelector('button').onclick = () => { agSet(form, 'fieldId', f.id); dica(`📍 Pelo GPS: <b>${esc(f.name)}</b>.`); }; }
  };
  // Só procura sozinho quando a localização já está liberada (não abre pedido de permissão ao abrir o formulário)
  const q = navigator.permissions?.query?.({name: 'geolocation'});
  if (q) q.then(p => p.state === 'granted' ? buscar(false) : botao(), botao); else botao();
}

// ---------------- Chuva de vários pluviômetros ----------------
function chuvaVarios() {
  const usados = new Set(db.chuvas.map(c => c.fieldId || ''));
  const ordem = l => l.sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR', {numeric: true}));
  const talhoes = db.fields.map(f => [f.id, f.name]);
  const principais = usados.size ? [...(usados.has('') ? [['', 'Sede (sem talhão)']] : []), ...ordem(talhoes.filter(([id]) => usados.has(id)))] : [['', 'Sede (sem talhão)'], ...ordem(talhoes)];
  const outros = usados.size ? [...(usados.has('') ? [] : [['', 'Sede (sem talhão)']]), ...ordem(talhoes.filter(([id]) => !usados.has(id)))] : [];
  const chave = id => 'mm_' + (id || 'sede');
  openForm({form: 'chuva-varios', title: 'Chuva de vários pluviômetros', sub: 'Mesma data e hora para todos. Preencha só os que tiveram leitura; em branco não é lançado.', submit: 'Registrar as leituras', maisRotulo: `Outros locais (${outros.length})`,
    values: {date: today(), hora: nowTime()},
    fields: [{k: 'date', label: 'Data da leitura', type: 'date', required: true}, {k: 'hora', label: 'Hora da leitura', type: 'time'},
      ...principais.map(([id, n]) => ({k: chave(id), label: `${n} (mm)`, type: 'number', min: 0})), ...outros.map(([id, n]) => ({k: chave(id), label: `${n} (mm)`, type: 'number', min: 0, mais: true}))],
    onSubmit: v => {
      const lanc = [...principais, ...outros].map(([id, n]) => ({id, n, mm: v[chave(id)]})).filter(x => x.mm !== '' && x.mm != null);
      if (!lanc.length) return 'Preencha a chuva de pelo menos um pluviômetro';
      const alto = lanc.find(x => x.mm > 400); if (alto) return `${alto.n}: mais de 400 mm numa leitura, confira o valor`;
      if (v.date > today() || (v.date === today() && v.hora && v.hora > nowTime())) return 'A leitura não pode ser no futuro: confira a data e a hora';
      const dups = lanc.filter(x => db.chuvas.some(c => c.date === v.date && (c.fieldId || '') === x.id && (c.hora || '') === (v.hora || '')));
      if (dups.length) { const e = pedirConfirmacao(`chv|${v.date}|${v.hora}|${dups.map(d => d.id).join(',')}`, `Já existe chuva em ${fmtDate(v.date)}${v.hora ? ' às ' + v.hora : ''} para ${dups.map(d => d.n).join(', ')}`); if (e) return e; }
      lanc.forEach(x => db.chuvas.push({id: uid(), date: v.date, hora: v.hora, mm: x.mm, fieldId: x.id, notes: '', fonte: 'pluviômetro'}));
      save(); showToast(`${lanc.length} ${lanc.length === 1 ? 'leitura registrada' : 'leituras registradas'}: ${lanc.map(x => `${x.n.replace(' (sem talhão)', '')} ${um1(x.mm)} mm`).join(', ')}`);
    }});
}

// ---------------- QR code na máquina ----------------
const AG_URL_APP = 'https://simulagamer-ofc.github.io/AgroOperacoes/';
const agUrlMaquina = id => `${AG_URL_APP}#/m/${id}`;
VIEWS.etiquetasmaq = id => {
  const l = (id ? [find('machines', id)] : db.machines.filter(m => !isInactive(m))).filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', {numeric: true}));
  const volta = btn('← Máquinas', 'nav', 'maquinas', 'secondary');
  if (!l.length) return head('Etiquetas QR das máquinas', '', volta) + `<section class="card">${empty('Nenhuma máquina', 'Cadastre as máquinas primeiro.')}</section>`;
  return `<div class="no-print">${head(id ? `Etiqueta QR — ${l[0].name}` : 'Etiquetas QR das máquinas', 'Imprima, plastifique e cole perto do painel. No MercaPlant, “📷 Ler QR” fotografa a etiqueta e abre a máquina; a câmera do celular abre a versão web.',
    volta + (id ? btn('Todas as máquinas', 'nav', 'etiquetasmaq', 'secondary') : '') + btn('Imprimir', 'af-imprimir'))}</div>
    <section class="etiquetas ag-etq">${l.map(m => `<article class="etiqueta"><div class="et-qr" role="img" aria-label="QR code da máquina ${esc(m.name)}">${typeof qrSvg === 'function' ? qrSvg(agUrlMaquina(m.id)) : ''}</div>
      <div class="et-txt"><strong>${esc(m.name)}</strong><span>${esc([m.type === 'Implemento' ? m.tipoImpl || 'Implemento' : m.type, m.model, m.placa].filter(Boolean).join(' • '))}</span><span>${esc(db.settings.farm || 'MercaPlant')}</span><small>Aponte o 📷 Ler QR do MercaPlant</small></div></article>`).join('')}</section>`;
};
TITLES.etiquetasmaq = 'Etiquetas QR';
// Painel da máquina (aberto pelo QR): as ações do dia num toque
VIEWS.m = id => {
  const m = find('machines', id), volta = btn('← Máquinas', 'nav', 'maquinas', 'secondary');
  if (!m) return head('Máquina', '', volta) + `<section class="card">${empty('Máquina não encontrada nesta fazenda', 'A etiqueta pode ser de outra fazenda, ou a máquina foi removida.')}</section>`;
  const ops = db.operations.filter(o => (o.machineId === m.id || o.implementoId === m.id) && ['Programada', 'Em andamento'].includes(o.status)).sort((a, b) => (a.status === 'Em andamento' ? -1 : 0) - (b.status === 'Em andamento' ? -1 : 0) || String(a.date).localeCompare(String(b.date)));
  const acao = (rot, act, idv, cls = 'secondary') => `<button class="${cls} ag-acao" data-act="${act}" data-id="${esc(idv)}">${rot}</button>`;
  const l = temMedidor(m) ? agUltimaLeitura(m) : null;
  return head(m.name, [m.type === 'Implemento' ? m.tipoImpl || 'Implemento' : m.type, m.model, l ? `${num(l.h)} ${unidMed(m)}${l.d ? ' em ' + fmtDate(l.d) : ''}` : ''].filter(Boolean).join(' • '), volta) +
    (isInactive(m) ? `<section class="card panel"><p class="pc-aviso">Máquina inativa.</p></section>` : '') +
    (ops.length ? `<div class="section-title"><h3>Operações desta máquina</h3></div><section class="card list">${ops.map(o => `<div class="list-row"><div><strong>${esc(o.type)} — ${esc(opPlace(o))}</strong><small>${esc([o.status, fmtDate(o.date), o.operator].filter(Boolean).join(' • '))}</small></div>${o.status === 'Em andamento' ? acao('Concluir', 'op-done', o.id, 'primary') : acao('Iniciar', 'op-start', o.id, 'primary')}</div>`).join('')}</section>` : '') +
    `<section class="ag-acoes">${m.type === 'Implemento' ? '' : acao('▶ Nova operação', 'ag-op-maq', m.id, ops.length ? 'secondary' : 'primary')}${!isInactive(m) && typeof usaCombustivel === 'function' && usaCombustivel(m) ? acao('⛽ Abastecer', 'cb-new', m.id) : ''}${temMedidor(m) ? acao(porKm(m) ? '◷ Odômetro' : '◷ Horímetro', 'hour-new', m.id) : ''}${m.type === 'Implemento' ? '' : acao('☑ Checklist', 'mcp-novo', m.id)}${acao('⚙ Manutenção', 'mt-new', m.id)}${acao('📘 Peças', 'nav', 'pecas/' + m.id)}</section>`;
};
TITLES.m = 'Máquina';
// Ler o QR: foto da etiqueta (câmera do celular, sem pedir outra permissão) e leitura no próprio aparelho
let agJsqr = null;
const agCarregarJsqr = () => agJsqr || (agJsqr = new Promise((ok, falha) => { if (typeof jsQR === 'function') return ok(); const s = document.createElement('script'); s.src = 'lib/jsqr/jsqr.min.js'; s.onload = ok; s.onerror = () => { agJsqr = null; falha(new Error('Leitor de QR indisponível')); }; document.head.append(s); }));
async function agLerQrDaImagem(arquivo) {
  const bmp = await createImageBitmap(arquivo);
  if ('BarcodeDetector' in window) { try { const r = await new BarcodeDetector({formats: ['qr_code']}).detect(bmp); if (r[0]?.rawValue) return r[0].rawValue; } catch { /* segue para o leitor do app */ } }
  await agCarregarJsqr();
  for (const lado of [1400, 900, 600, 2000]) {
    const k = Math.min(1, lado / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const cv = Object.assign(document.createElement('canvas'), {width: w, height: h}), cx = cv.getContext('2d', {willReadFrequently: true}); cx.drawImage(bmp, 0, 0, w, h);
    const r = jsQR(cx.getImageData(0, 0, w, h).data, w, h, {inversionAttempts: 'attemptBoth'}); if (r?.data) return r.data;
  }
  return '';
}
function agLerQr() {
  const inp = Object.assign(document.createElement('input'), {type: 'file', accept: 'image/*'}); inp.setAttribute('capture', 'environment');
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    showToast('Lendo o QR…');
    try {
      const txt = await agLerQrDaImagem(f), id = (String(txt).match(/#\/m\/([A-Za-z0-9_-]+)/) || [])[1];
      if (!txt) return showToast('Não achei o QR na foto. Chegue mais perto, com a etiqueta inteira e sem reflexo.', true);
      if (!id) return showToast('Este QR não é de uma máquina do MercaPlant.', true);
      if (!find('machines', id)) return showToast('Máquina não encontrada nesta fazenda.', true);
      go('m/' + id);
    } catch (e) { showToast(e.message || 'Não foi possível ler o QR', true); }
  };
  inp.click();
}

Object.assign(ACTIONS, {
  'ch-varios': () => chuvaVarios(),
  'ag-ler-qr': () => agLerQr(),
  'ag-op-maq': id => operationForm({machineId: id})
});
