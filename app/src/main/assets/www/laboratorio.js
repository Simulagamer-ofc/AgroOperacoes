// MercaPlant — análise de sementes do lote (boletim) e classificação automática pela categoria
// O laboratório informa pureza, outras sementes (%), germinação e a CONTAGEM de outras sementes na amostra
// (ex.: 3 de azevém em 500 g). O app compara com o padrão de cada categoria e mostra se o lote mantém a categoria,
// se cabe rebaixar (C1 → C2 → S1 → S2) ou se não atende como semente. Nada muda sozinho: quem confirma é a pessoa.
// Amostra menor que a da norma: a contagem é levada à proporção do peso da norma e o resultado fica "provisório".
// Padrões: aveia preta pela IN MAPA 44/2016 (forrageiras de clima temperado; confira alterações da IN 31/2025).

const CAT_ORDEM = ['Básica', 'C1', 'C2', 'S1', 'S2'];
const GRUPOS_OUTRAS = [['cultivada', 'Outra cultivada'], ['silvestre', 'Silvestre'], ['tolerada', 'Nociva tolerada'], ['proibida', 'Nociva proibida'], ['aveia', 'Outra aveia']];
const PADROES_SEMENTES = {
  'aveia preta': {
    nome: 'Aveia preta', norma: 'IN MAPA 44/2016 (Anexos III e IV)', amostraG: 500, validadeMeses: 8,
    // pureza mínima (%), outras sementes máx. (%), germinação mínima (%), e contagem máxima por amostra da norma
    cats: {
      'Básica': {pureza: 98, outrasPct: 0.2, germ: 70, cultivada: 0, silvestre: 0, tolerada: 1, proibida: 0, aveia: 0},
      C1: {pureza: 98, outrasPct: 0.5, germ: 80, cultivada: 1, silvestre: 1, tolerada: 3, proibida: 0, aveia: 2},
      C2: {pureza: 98, outrasPct: 0.5, germ: 80, cultivada: 1, silvestre: 1, tolerada: 3, proibida: 0, aveia: 2},
      S1: {pureza: 97, outrasPct: 1.0, germ: 80, cultivada: 2, silvestre: 2, tolerada: 6, proibida: 0, aveia: 5},
      S2: {pureza: 96, outrasPct: 1.5, germ: 80, cultivada: 10, silvestre: 4, tolerada: 12, proibida: 0, aveia: 10}},
    // Grupo sugerido para as espécies que mais aparecem (o laboratório confirma; dá para mudar na análise)
    grupos: {'azevem': 'tolerada', 'aveia branca': 'aveia', 'aveia amarela': 'aveia', 'nabo': 'cultivada', 'nabica': 'silvestre', 'trigo': 'cultivada', 'centeio': 'cultivada', 'cevada': 'cultivada', 'ervilhaca': 'cultivada'}
  }
};
const labChave = s => semAcentoApp(String(s || '')).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const labPadrao = especie => { const k = labChave(especie); return PADROES_SEMENTES[k] || (k === 'avena strigosa' ? PADROES_SEMENTES['aveia preta'] : null); };
const labVazio = v => v === '' || v == null || !Number.isFinite(Number(v));

/** Classificação de uma análise: para cada categoria, cada critério (atende / não atende / pendente). */
function labClassificar(a, especie) {
  const p = labPadrao(especie); if (!p) return null;
  const amostra = Number(a.amostraG) || 0, fator = amostra > 0 ? p.amostraG / amostra : 1;
  const conta = {}; (a.encontradas || []).forEach(e => { if (e.grupo && Number(e.n) > 0) conta[e.grupo] = (conta[e.grupo] || 0) + Number(e.n); });
  const prop = Object.fromEntries(Object.entries(conta).map(([g, n]) => [g, Math.round(n * fator * 10) / 10]));
  const porCat = CAT_ORDEM.map(cat => {
    const lim = p.cats[cat], itens = [];
    const crit = (rotulo, valor, limite, maior, unid = '') => itens.push({rotulo, valor, limite, unid,
      ok: labVazio(valor) ? null : maior ? Number(valor) >= limite : Number(valor) <= limite});
    crit('Pureza', a.pureza, lim.pureza, true, '%');
    crit('Outras sementes', a.outrasPct, lim.outrasPct, false, '%');
    crit('Germinação', a.germinacao, lim.germ, true, '%');
    GRUPOS_OUTRAS.forEach(([g, rot]) => { if (lim[g] != null && (conta[g] || g === 'proibida' || g === 'tolerada')) crit(rot, amostra ? prop[g] || 0 : null, lim[g], false); });
    const atende = itens.every(i => i.ok !== false), pendente = itens.some(i => i.ok === null);
    return {cat, itens, atende, pendente};
  });
  // Só com a contagem como veio (sem proporção), para mostrar a diferença quando a amostra é menor
  const semProp = fator !== 1 ? CAT_ORDEM.find(cat => Object.entries(conta).every(([g, n]) => p.cats[cat][g] == null || n <= p.cats[cat][g]) &&
    ['pureza', 'germ'].every(k => labVazio(k === 'pureza' ? a.pureza : a.germinacao) || Number(k === 'pureza' ? a.pureza : a.germinacao) >= p.cats[cat][k]) &&
    (labVazio(a.outrasPct) || Number(a.outrasPct) <= p.cats[cat].outrasPct)) : null;
  return {p, amostra, fator, conta, prop, porCat, semProp, abaixo: amostra > 0 && amostra < p.amostraG};
}
/** Veredito para a categoria do lote: mantém, rebaixa para qual, ou não atende como semente. */
function labVeredito(cl, catLote) {
  if (!cl) return null;
  const i0 = Math.max(0, CAT_ORDEM.indexOf(catLote === 'C2' ? 'C2' : catLote)); // Genética/sem categoria: avalia desde a Básica
  const daqui = cl.porCat.slice(catLote && CAT_ORDEM.includes(catLote) ? i0 : 0);
  const primeira = daqui.find(c => c.atende);
  if (!primeira) return {tipo: 'reprovado', cat: null, pendente: daqui.some(c => c.pendente)};
  if (CAT_ORDEM.includes(catLote) && primeira.cat === catLote) return {tipo: 'mantem', cat: catLote, pendente: primeira.pendente};
  return {tipo: CAT_ORDEM.includes(catLote) ? 'rebaixa' : 'atende', cat: primeira.cat, pendente: primeira.pendente};
}
function labTextoVeredito(v, cl, catLote) {
  if (!v) return '';
  const prov = cl.abaixo ? `<small class="lab-prov">⚠ Provisório: amostra de ${num(cl.amostra)} g, a norma pede ${num(cl.p.amostraG)} g. A contagem foi levada à proporção de ${num(cl.p.amostraG)} g${cl.semProp && cl.semProp !== v.cat ? ` (sem a proporção daria ${cl.semProp})` : ''}. Refaça com ${num(cl.p.amostraG)} g para valer.</small>` : '';
  const pend = v.pendente ? '<small class="lab-prov">Faltam resultados (ex.: germinação): a classificação fecha quando chegarem.</small>' : '';
  if (v.tipo === 'mantem') return `<div class="lab-ver ok"><b>✓ Fica ${esc(v.cat)}</b><span>Atende o padrão da categoria do lote.</span>${prov}${pend}</div>`;
  if (v.tipo === 'atende') return `<div class="lab-ver ok"><b>✓ Atende ${esc(v.cat)}</b><span>Maior categoria atendida.</span>${prov}${pend}</div>`;
  if (v.tipo === 'rebaixa') return `<div class="lab-ver alerta"><b>↓ Não atende ${esc(catLote)}: atende ${esc(v.cat)}</b><span>O lote pode ser rebaixado para ${esc(v.cat)} (você confirma ao salvar).</span>${prov}${pend}</div>`;
  return `<div class="lab-ver ruim"><b>✗ Não atende como semente</b><span>Nem o padrão de S2. O lote pode ser reprovado e ir para grão.</span>${prov}${pend}</div>`;
}
// Colunas: da categoria do lote para baixo (não sobe de categoria); C1 e C2 juntas quando o padrão é o mesmo
function labColunas(cl, catLote) {
  const i0 = CAT_ORDEM.includes(catLote) ? CAT_ORDEM.indexOf(catLote) : 0;
  const cs = cl.porCat.slice(i0), out = [];
  cs.forEach(c => { const ant = out[out.length - 1]; if (ant && c.cat === 'C2' && ant.cat === 'C1' && JSON.stringify(cl.p.cats.C1) === JSON.stringify(cl.p.cats.C2)) ant.rot = 'C1/C2'; else out.push({...c, rot: c.cat}); });
  return out;
}
function labTabela(cl, destaque, catLote) {
  const cols = labColunas(cl, catLote), alvo = c => c.cat === destaque || (destaque === 'C2' && c.rot === 'C1/C2');
  const linhas = cl.porCat[0].itens.map((it, k) => `<tr><th>${esc(it.rotulo)}${it.unid ? '' : ' <small>(nº)</small>'}</th><td class="lab-val">${labVazio(it.valor) ? '—' : num(it.valor, it.unid ? 1 : (it.valor % 1 ? 1 : 0)) + it.unid}</td>${cols.map(c => { const x = c.itens[k]; return `<td class="${x.ok === null ? 'pend' : x.ok ? 'ok' : 'nao'}${alvo(c) ? ' alvo' : ''}">${x.ok === null ? '·' : x.ok ? '✓' : '✗'}<small>${x.unid === '%' && x.rotulo !== 'Outras sementes' ? '≥' : '≤'}${num(x.limite, x.limite % 1 ? 1 : 0)}${x.unid}</small></td>`; }).join('')}</tr>`).join('');
  return `<div class="tbl-wrap lab-tab"><table class="tbl"><thead><tr><th>Critério</th><th>Resultado</th>${cols.map(c => `<th class="${alvo(c) ? 'alvo' : ''}">${c.rot}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table></div>`;
}

// ---------- Registrar análise (boletim) ----------
function labForm(lotId, a0) {
  const l = find('lots', lotId); if (!l) return;
  const p = labPadrao(l.species), a = a0 ? JSON.parse(JSON.stringify(a0)) : {data: today(), amostraG: p?.amostraG || '', encontradas: []};
  if (!a.encontradas.length) a.encontradas.push({nome: '', grupo: '', n: ''});
  const campo = (k, rot, extra = '') => `<div class="field"><label for="lab_${k}">${rot}</label><input id="lab_${k}" data-lab="${k}" inputmode="decimal" value="${esc(a[k] ?? '')}" ${extra}></div>`;
  const nomes = p ? Object.keys(p.grupos) : [];
  dialog.innerHTML = `<h3>Análise de sementes — lote ${esc(l.code)}</h3>
    <p class="sub">${esc([l.species, l.cultivar, l.category].filter(Boolean).join(' • '))}${p ? ` • padrão: ${esc(p.norma)}` : ' • sem tabela de padrões para esta espécie: a análise fica registrada, mas o app não classifica'}</p>
    <form class="form-grid lab-form" autocomplete="off">
      <div class="field"><label for="lab_data">Data do resultado</label><input id="lab_data" data-lab="data" type="date" value="${esc(a.data || today())}"></div>
      <div class="field"><label for="lab_laboratorio">Laboratório</label><input id="lab_laboratorio" data-lab="laboratorio" value="${esc(a.laboratorio || '')}" placeholder="Ex.: laboratório próprio"></div>
      <div class="field"><label for="lab_boletim">Nº do boletim</label><input id="lab_boletim" data-lab="boletim" value="${esc(a.boletim || '')}"></div>
      ${campo('amostraG', 'Amostra examinada (g)', `${p ? `placeholder="${p.amostraG}"` : ''}`)}
      ${campo('pureza', 'Pureza — sementes puras (%)')}${campo('outrasPct', 'Outras sementes (%)')}
      ${campo('germinacao', 'Germinação (%)')}${campo('vigor', 'Vigor (%) — opcional')}
      ${campo('pms', 'Peso de mil sementes (g) — opcional')}${campo('umidade', 'Umidade (%) — opcional')}
      <div class="field full"><label>Outras sementes encontradas na amostra (contagem)</label>
        <div id="labOutras" class="lab-outras"></div>
        <button type="button" class="secondary lab-mais">+ Outra espécie</button>
        ${nomes.length ? `<datalist id="labNomes">${nomes.map(n => `<option value="${esc(n === 'azevem' ? 'azevém' : n === 'nabica' ? 'nabiça' : n)}">`).join('')}</datalist>` : ''}</div>
      <div class="field full" id="labResultado" aria-live="polite"></div>
      <div class="field full"><label for="lab_obs">Observações</label><textarea id="lab_obs" data-lab="obs" rows="2">${esc(a.obs || '')}</textarea></div>
      <div class="actions full"><button type="button" class="secondary" data-close>Cancelar</button><button type="submit" class="primary">Salvar análise</button></div>
    </form>`;
  $('[data-close]', dialog).onclick = closeModal;
  const lerNum = v => { const x = typeof numeroBR === 'function' ? numeroBR(v) : Number(String(v).replace(',', '.')); return v === '' || !Number.isFinite(x) ? '' : x; };
  const ler = () => {
    $$('[data-lab]', dialog).forEach(el => { const k = el.dataset.lab; a[k] = ['data', 'laboratorio', 'boletim', 'obs'].includes(k) ? el.value.trim() : lerNum(el.value); });
    a.encontradas = $$('.lab-linha', dialog).map(r => ({nome: $('[data-o=nome]', r).value.trim(), grupo: $('[data-o=grupo]', r).value, n: lerNum($('[data-o=n]', r).value)}));
  };
  const linhas = () => {
    $('#labOutras', dialog).innerHTML = a.encontradas.map((e, i) => `<div class="lab-linha" data-i="${i}">
      <input data-o="nome" list="labNomes" placeholder="Espécie (ex.: azevém)" value="${esc(e.nome || '')}" aria-label="Espécie">
      <select data-o="grupo" aria-label="Grupo"><option value="">Grupo…</option>${GRUPOS_OUTRAS.filter(([g]) => !p || p.cats.C1[g] != null).map(([g, r]) => `<option value="${g}" ${e.grupo === g ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <input data-o="n" inputmode="numeric" placeholder="Nº" value="${esc(e.n ?? '')}" aria-label="Quantidade">
      <button type="button" class="link lab-tira" aria-label="Tirar">✕</button></div>`).join('');
  };
  const resultado = () => {
    ler();
    const el = $('#labResultado', dialog); if (!el) return;
    const cl = labClassificar(a, l.species);
    if (!cl) { el.innerHTML = ''; return; }
    const v = labVeredito(cl, l.category);
    el.innerHTML = `<label>Classificação (automática)</label>${labTextoVeredito(v, cl, l.category)}${labTabela(cl, v?.cat, l.category)}`;
  };
  linhas(); resultado();
  const caixa = $('.lab-form', dialog);
  caixa.addEventListener('input', e => {
    if (e.target.matches('[data-o=nome]') && p) { // sugere o grupo pela espécie
      const r = e.target.closest('.lab-linha'), g = p.grupos[labChave(e.target.value)], s = $('[data-o=grupo]', r);
      if (g && !s.value) s.value = g;
    }
    resultado();
  });
  caixa.addEventListener('change', resultado);
  caixa.addEventListener('click', e => {
    if (e.target.closest('.lab-mais')) { ler(); a.encontradas.push({nome: '', grupo: '', n: ''}); linhas(); resultado(); }
    const t = e.target.closest('.lab-tira'); if (t) { ler(); a.encontradas.splice(Number(t.closest('.lab-linha').dataset.i), 1); if (!a.encontradas.length) a.encontradas.push({nome: '', grupo: '', n: ''}); linhas(); resultado(); }
  });
  caixa.onsubmit = e => {
    e.preventDefault(); ler();
    if (!a.data) { showToast('Informe a data do resultado', true); return; }
    if (['pureza', 'outrasPct', 'germinacao', 'vigor', 'umidade'].some(k => a[k] !== '' && (a[k] < 0 || a[k] > 100))) { showToast('Percentuais vão de 0 a 100', true); return; }
    if (a.encontradas.some(x => Number(x.n) > 0 && !x.grupo)) { showToast('Escolha o grupo de cada espécie encontrada', true); return; }
    a.encontradas = a.encontradas.filter(x => x.nome || Number(x.n) > 0);
    const cl = labClassificar(a, l.species), v = labVeredito(cl, l.category);
    const reg = {...a, id: a.id || uid(), lotId, especie: l.species || '', categoriaLote: l.category || '', resultado: v ? {tipo: v.tipo, cat: v.cat, provisorio: !!cl.abaixo || !!v.pendente} : null,
      validade: p && a.germinacao !== '' ? labValidade(a.data, p.validadeMeses) : ''};
    upsert('analisesSementes', reg);
    if (a.germinacao !== '') l.germination = a.germinacao;
    if (a.vigor !== '') l.vigor = a.vigor;
    const resumo = v ? {mantem: `fica ${v.cat}`, atende: `atende ${v.cat}`, rebaixa: `não atende ${l.category}, atende ${v.cat}`, reprovado: 'não atende como semente'}[v.tipo] + (reg.resultado.provisorio ? ' (provisório)' : '') : 'sem classificação';
    db.lotEvents.push({id: uid(), lotId, date: a.data, title: `Análise de sementes${a.boletim ? ' nº ' + a.boletim : ''}`, text: [resumo, a.germinacao !== '' ? `germinação ${num(a.germinacao)}%` : '', a.pureza !== '' ? `pureza ${num(a.pureza, 1)}%` : '', ...a.encontradas.filter(x => Number(x.n) > 0).map(x => `${x.nome || 'outra'}: ${num(x.n)}`)].filter(Boolean).join(' • ')});
    save(); closeModal();
    // Decisão sobre o lote: sempre perguntando
    if (v && !reg.resultado.provisorio) {
      if (v.tipo === 'mantem' && l.status === 'Aguardando análise') confirmDialog(`Lote ${l.code} atende ${v.cat}. Marcar como Aprovado?`, () => labSituacao(l, 'Aprovado', a.data), 'Aprovar');
      else if (v.tipo === 'rebaixa') confirmDialog(`Lote ${l.code} não atende ${l.category}, mas atende ${v.cat}. Rebaixar para ${v.cat}?`, () => { const de = l.category; l.category = v.cat; db.lotEvents.push({id: uid(), lotId, date: a.data, title: `Categoria: ${v.cat}`, text: `Rebaixado de ${de} pela análise`}); labSituacao(l, 'Aprovado', a.data); }, `Rebaixar para ${v.cat}`);
      else if (v.tipo === 'reprovado') confirmDialog(`Lote ${l.code} não atende o padrão nem de S2. Marcar como Reprovado (vai para grão)?`, () => labSituacao(l, 'Reprovado', a.data), 'Reprovar');
      else render();
    } else { showToast(reg.resultado?.provisorio ? 'Análise salva (classificação provisória)' : 'Análise salva'); render(); }
  };
  modal.classList.add('open');
}
function labSituacao(l, st, data) { if (l.status !== st) { db.lotEvents.push({id: uid(), lotId: l.id, date: data, title: `Situação: ${st}`, text: `Anterior: ${l.status}`}); l.status = st; } save(); }
function labValidade(data, meses) { const d = new Date(data + 'T12:00:00'); d.setMonth(d.getMonth() + meses + 1, 0); return isoLocal(d); } // excluído o mês da conclusão: até o fim do mês

// ---------- Página do lote: última análise e classificação ----------
function labCartaoLote(l) {
  const lista = (db.analisesSementes || []).filter(a => a.lotId === l.id).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const a = lista[0], p = labPadrao(l.species);
  const botao = `<button class="primary" data-act="lab-nova" data-id="${esc(l.id)}">+ Registrar análise</button>`;
  if (!a) return `<div class="section-title"><h3>Análise de sementes</h3>${botao}</div><section class="card panel"><p class="nota">Nenhuma análise registrada.${p ? ` Ao registrar o boletim (pureza, germinação e a contagem de outras sementes em ${num(p.amostraG)} g), o MercaPlant mostra na hora se o lote fica ${esc(l.category || 'na categoria')} ou se precisa rebaixar.` : ''}</p></section>`;
  const cl = labClassificar(a, l.species), v = labVeredito(cl, a.categoriaLote || l.category);
  const venc = a.validade && a.validade < today(), perto = a.validade && !venc && a.validade <= addDias(today(), 30);
  return `<div class="section-title"><h3>Análise de sementes</h3>${botao}</div>
    <section class="card panel lab-lote">
      <div class="lab-cab"><div><strong>Boletim${a.boletim ? ' nº ' + esc(a.boletim) : ''}</strong><small>${fmtDate(a.data)}${a.laboratorio ? ' • ' + esc(a.laboratorio) : ''}${a.amostraG ? ` • amostra ${num(a.amostraG)} g` : ''}</small></div>
        ${a.validade ? `<span class="chip ${venc ? 'red' : perto ? 'orange' : 'green'}">${venc ? 'Teste vencido' : 'Válido até'} ${fmtDate(a.validade)}</span>` : ''}</div>
      ${cl ? labTextoVeredito(v, cl, a.categoriaLote || l.category) + labTabela(cl, v?.cat, a.categoriaLote || l.category) : ''}
      ${(a.encontradas || []).filter(x => Number(x.n) > 0).length ? `<p class="nota">Encontradas: ${a.encontradas.filter(x => Number(x.n) > 0).map(x => `${esc(x.nome || 'outra')} ${num(x.n)} (${esc((GRUPOS_OUTRAS.find(([g]) => g === x.grupo) || ['', ''])[1].toLowerCase())})`).join(' • ')}</p>` : ''}
      <div class="btn-row">${btn('Editar análise', 'lab-editar', a.id, 'secondary')}${lista.length > 1 ? `<small class="nota">${lista.length - 1} ${lista.length === 2 ? 'análise anterior' : 'análises anteriores'} na linha do tempo</small>` : ''}</div>
      ${p ? `<p class="nota">Padrão de ${esc(p.nome.toLowerCase())}: ${esc(p.norma)}. Confira com a norma vigente.</p>` : ''}
    </section>`;
}
if (typeof lotDetail === 'function') {
  const detalheSemLab = lotDetail;
  lotDetail = id => {
    const html = detalheSemLab(id), l = find('lots', id); if (!l) return html;
    const i = html.indexOf('<div class="section-title"><h3>Linha do tempo</h3>');
    return i < 0 ? html + labCartaoLote(l) : html.slice(0, i) + labCartaoLote(l) + html.slice(i);
  };
}
Object.assign(ACTIONS, {
  'lab-nova': id => labForm(id),
  'lab-editar': id => { const a = find('analisesSementes', id); if (a) labForm(a.lotId, a); }
});
