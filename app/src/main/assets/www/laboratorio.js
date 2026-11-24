// MercaPlant — análise de sementes do lote (boletim) e classificação automática pela categoria
// A classificação sai da CONTAGEM de outras sementes encontradas na amostra, separada por grupo
// (outra cultivada, silvestre, nociva tolerada, nociva proibida): ex.: 3 de azevém em 500 g de aveia preta.
// O app compara com o limite de cada categoria e mostra se o lote mantém a categoria, se cabe rebaixar
// (C1 → C2 → S1 → S2) ou se não atende como semente. Nada muda sozinho: quem confirma é a pessoa.
// Pureza, germinação e vigor ficam registrados (germinação dá a validade do teste), mas não entram na classificação.
// Amostra menor que a da norma: a contagem vai à proporção do peso da norma e o resultado fica "provisório".
// Padrões por espécie: tabela editável e sincronizada (coleção padroesSementes); aveia preta já vem pela IN MAPA 44/2016.

const CAT_ORDEM = ['Básica', 'C1', 'C2', 'S1', 'S2'];
const CAT_COLUNAS = [['Básica', ['Básica']], ['C1/C2', ['C1', 'C2']], ['S1', ['S1']], ['S2', ['S2']]];
const GRUPOS_BASE = [['cultivada', 'Outra cultivada'], ['silvestre', 'Silvestre'], ['tolerada', 'Nociva tolerada'], ['proibida', 'Nociva proibida']];
const labLim = (b, c, s1, s2) => ({'Básica': b, C1: c, C2: c, S1: s1, S2: s2});
// Padrões que já vêm no app (conferir com a norma vigente). Contagem máxima por amostra da norma (amostraG).
const PADROES_BASE = {
  'aveia preta': {especie: 'Aveia preta', norma: 'IN MAPA 44/2016 (Anexos III e IV)', amostraG: 500, validadeMeses: 8,
    lim: {cultivada: labLim(0, 1, 2, 10), silvestre: labLim(0, 1, 2, 4), tolerada: labLim(1, 3, 6, 12), proibida: labLim(0, 0, 0, 0), extra: labLim(0, 2, 5, 10)},
    extra: 'Outra espécie de aveia',
    grupos: {'azevem': 'tolerada', 'aveia branca': 'extra', 'aveia amarela': 'extra', 'nabo': 'cultivada', 'nabica': 'silvestre', 'trigo': 'cultivada', 'centeio': 'cultivada', 'cevada': 'cultivada', 'ervilhaca': 'cultivada'}}
};
const labChave = s => semAcentoApp(String(s || '')).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const LAB_SINONIMOS = {'avena strigosa': 'aveia preta', 'aveia': 'aveia preta'};
const labBase = k => PADROES_BASE[LAB_SINONIMOS[k] || k] || null;
/** Padrão da espécie: o da fazenda (editado) ou o que vem no app. */
function labPadrao(especie) {
  const k = labChave(especie); if (!k) return null;
  const k2 = LAB_SINONIMOS[k] || k;
  return (db.padroesSementes || []).find(p => labChave(p.especie) === k2 || labChave(p.especie) === k) || labBase(k);
}
const labGrupos = p => [...GRUPOS_BASE, ...(p?.extra ? [['extra', p.extra]] : [])];
const labVazio = v => v === '' || v == null || !Number.isFinite(Number(v));
const labGestor = () => typeof mcpGestor !== 'function' || mcpGestor();

/** Classificação: para cada categoria, o grupo atende (≤ limite), não atende, ou fica pendente (sem amostra). */
function labClassificar(a, especie) {
  const p = labPadrao(especie); if (!p) return null;
  const amostra = Number(a.amostraG) || 0, fator = amostra > 0 && p.amostraG > 0 ? p.amostraG / amostra : 1;
  const conta = {}; (a.encontradas || []).forEach(e => { if (e.grupo && Number(e.n) > 0) conta[e.grupo] = (conta[e.grupo] || 0) + Number(e.n); });
  const prop = Object.fromEntries(Object.entries(conta).map(([g, n]) => [g, Math.round(n * fator * 10) / 10]));
  const grupos = labGrupos(p).filter(([g]) => p.lim[g] && (g !== 'extra' || conta.extra));
  const porCat = CAT_ORDEM.map(cat => {
    const itens = grupos.map(([g, rot]) => { const limite = p.lim[g][cat], valor = amostra ? prop[g] || 0 : null;
      return {g, rotulo: rot, valor, limite, ok: valor === null ? null : labVazio(limite) ? true : valor <= Number(limite)}; });
    return {cat, itens, atende: itens.every(i => i.ok !== false), pendente: itens.some(i => i.ok === null)};
  });
  // Só com a contagem como veio (sem proporção), para mostrar a diferença quando a amostra é menor
  const semProp = fator !== 1 ? CAT_ORDEM.find(cat => Object.entries(conta).every(([g, n]) => !p.lim[g] || labVazio(p.lim[g][cat]) || n <= Number(p.lim[g][cat]))) : null;
  return {p, amostra, fator, conta, prop, porCat, semProp, abaixo: amostra > 0 && amostra < p.amostraG};
}
/** Veredito para a categoria do lote: mantém, rebaixa para qual, ou não atende como semente. */
function labVeredito(cl, catLote) {
  if (!cl) return null;
  const temCat = CAT_ORDEM.includes(catLote), daqui = cl.porCat.slice(temCat ? CAT_ORDEM.indexOf(catLote) : 0);
  const primeira = daqui.find(c => c.atende);
  if (!primeira) return {tipo: 'reprovado', cat: null, pendente: daqui.some(c => c.pendente)};
  if (temCat && primeira.cat === catLote) return {tipo: 'mantem', cat: catLote, pendente: primeira.pendente};
  return {tipo: temCat ? 'rebaixa' : 'atende', cat: primeira.cat, pendente: primeira.pendente};
}
function labTextoVeredito(v, cl, catLote) {
  if (!v) return '';
  if (v.pendente) return `<div class="lab-ver"><b>Informe a amostra examinada (g)</b><span>A classificação sai da contagem de outras sementes no peso da amostra${cl.p.amostraG ? ` (norma: ${num(cl.p.amostraG)} g)` : ''}.</span></div>`;
  const prov = cl.abaixo ? `<small class="lab-prov">⚠ Provisório: amostra de ${num(cl.amostra)} g, a norma pede ${num(cl.p.amostraG)} g. A contagem foi levada à proporção de ${num(cl.p.amostraG)} g${cl.semProp && cl.semProp !== v.cat ? ` (sem a proporção daria ${cl.semProp})` : ''}. Refaça com ${num(cl.p.amostraG)} g para valer.</small>` : '';
  if (v.tipo === 'mantem') return `<div class="lab-ver ok"><b>✓ Fica ${esc(v.cat)}</b><span>A contagem de outras sementes está dentro do limite da categoria do lote.</span>${prov}</div>`;
  if (v.tipo === 'atende') return `<div class="lab-ver ok"><b>✓ Atende ${esc(v.cat)}</b><span>Maior categoria atendida pela contagem.</span>${prov}</div>`;
  if (v.tipo === 'rebaixa') return `<div class="lab-ver alerta"><b>↓ Não atende ${esc(catLote)}: atende ${esc(v.cat)}</b><span>O lote pode ser rebaixado para ${esc(v.cat)} (você confirma ao salvar).</span>${prov}</div>`;
  return `<div class="lab-ver ruim"><b>✗ Não atende como semente</b><span>A contagem passa até do limite de S2. O lote pode ser reprovado e ir para grão.</span>${prov}</div>`;
}
// Colunas: da categoria do lote para baixo (não sobe de categoria); C1 e C2 juntas (mesmo limite)
function labTabela(cl, destaque, catLote) {
  const i0 = CAT_ORDEM.includes(catLote) ? CAT_ORDEM.indexOf(catLote) : 0;
  const cols = CAT_COLUNAS.filter(([, cs]) => cs.some(c => CAT_ORDEM.indexOf(c) >= i0)).map(([rot, cs]) => ({rot, c: cl.porCat.find(x => x.cat === cs.find(c => CAT_ORDEM.indexOf(c) >= i0))}));
  const alvo = col => col.c.cat === destaque || (col.rot === 'C1/C2' && ['C1', 'C2'].includes(destaque));
  const linhas = cl.porCat[0].itens.map((it, k) => `<tr><th>${esc(it.rotulo)}</th><td class="lab-val">${it.valor === null ? '—' : num(it.valor, it.valor % 1 ? 1 : 0)}</td>${cols.map(col => { const x = col.c.itens[k]; return `<td class="${x.ok === null ? 'pend' : x.ok ? 'ok' : 'nao'}${alvo(col) ? ' alvo' : ''}">${x.ok === null ? '·' : x.ok ? '✓' : '✗'}<small>${labVazio(x.limite) ? 'sem limite' : '≤' + num(x.limite)}</small></td>`; }).join('')}</tr>`).join('');
  return `<div class="tbl-wrap lab-tab"><table class="tbl"><thead><tr><th>Outras sementes (nº)</th><th>Achado${cl.fator !== 1 && cl.amostra ? `<small>em ${num(cl.p.amostraG)} g</small>` : ''}</th>${cols.map(col => `<th class="${alvo(col) ? 'alvo' : ''}">${col.rot}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table></div>`;
}

// ---------- Registrar análise (boletim) ----------
function labForm(lotId, a0) {
  const l = find('lots', lotId); if (!l) return;
  const p = labPadrao(l.species), a = a0 ? JSON.parse(JSON.stringify(a0)) : {data: today(), amostraG: p?.amostraG || '', encontradas: []};
  if (!a.encontradas.length) a.encontradas.push({nome: '', grupo: '', n: ''});
  const campo = (k, rot, extra = '') => `<div class="field"><label for="lab_${k}">${rot}</label><input id="lab_${k}" data-lab="${k}" inputmode="decimal" value="${esc(a[k] ?? '')}" ${extra}></div>`;
  const nomes = p ? Object.keys(p.grupos || {}) : [];
  const temOutros = ['pureza', 'outrasPct', 'germinacao', 'vigor', 'pms', 'umidade'].some(k => !labVazio(a[k]));
  dialog.innerHTML = `<h3>Análise de sementes — lote ${esc(l.code)}</h3>
    <p class="sub">${esc([l.species, l.cultivar, l.category].filter(Boolean).join(' • '))}${p ? ` • padrão: ${esc(p.norma || 'da fazenda')}` : ''}</p>
    ${p ? '' : `<p class="lab-sem">Ainda não há padrão para ${esc(l.species || 'esta espécie')}: a análise fica registrada, mas não classifica.${labGestor() ? ` <button type="button" class="link" data-act="lab-padrao" data-id="${esc(l.species || '')}">Criar o padrão</button>` : ' Peça ao ADM ou supervisor para criar o padrão.'}</p>`}
    <form class="form-grid lab-form" autocomplete="off">
      <div class="field"><label for="lab_data">Data do resultado</label><input id="lab_data" data-lab="data" type="date" value="${esc(a.data || today())}"></div>
      <div class="field"><label for="lab_boletim">Nº do boletim</label><input id="lab_boletim" data-lab="boletim" value="${esc(a.boletim || '')}"></div>
      ${campo('amostraG', `Amostra examinada (g)${p?.amostraG ? ` — norma: ${num(p.amostraG)} g` : ''}`, p ? `placeholder="${p.amostraG}"` : '')}
      <div class="field"><label for="lab_laboratorio">Laboratório</label><input id="lab_laboratorio" data-lab="laboratorio" value="${esc(a.laboratorio || '')}" placeholder="Ex.: laboratório próprio"></div>
      <div class="field full"><label>Sementes de outras espécies encontradas na amostra</label>
        <div id="labOutras" class="lab-outras"></div>
        <button type="button" class="secondary lab-mais">+ Outra espécie</button>
        ${nomes.length ? `<datalist id="labNomes">${nomes.map(n => `<option value="${esc({azevem: 'azevém', nabica: 'nabiça'}[n] || n)}">`).join('')}</datalist>` : ''}</div>
      <div class="field full" id="labResultado" aria-live="polite"></div>
      <details class="field full lab-outros" ${temOutros ? 'open' : ''}><summary>Outros resultados do boletim (opcional)</summary>
        <div class="form-grid">${campo('germinacao', 'Germinação (%)')}${campo('vigor', 'Vigor (%)')}${campo('pureza', 'Pureza (%)')}${campo('outrasPct', 'Outras sementes (%)')}${campo('pms', 'Peso de mil sementes (g)')}${campo('umidade', 'Umidade (%)')}</div>
        <small class="nota">Ficam no histórico do lote; a germinação dá a validade do teste. Não entram na classificação.</small></details>
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
      <select data-o="grupo" aria-label="Grupo"><option value="">Grupo…</option>${labGrupos(p).filter(([g]) => !p || p.lim[g]).map(([g, r]) => `<option value="${g}" ${e.grupo === g ? 'selected' : ''}>${r}</option>`).join('')}</select>
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
    if (e.target.matches('[data-o=nome]') && p) { // sugere o grupo pela espécie (o que a fazenda já usou)
      const r = e.target.closest('.lab-linha'), g = (p.grupos || {})[labChave(e.target.value)], s = $('[data-o=grupo]', r);
      if (g && !s.value && [...s.options].some(o => o.value === g)) s.value = g;
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
    if (a.encontradas.some(x => x.n !== '' && (x.n < 0 || !Number.isInteger(x.n)))) { showToast('A quantidade de sementes é um número inteiro', true); return; }
    a.encontradas = a.encontradas.filter(x => x.nome || Number(x.n) > 0);
    const cl = labClassificar(a, l.species), v = labVeredito(cl, l.category);
    const reg = {...a, id: a.id || uid(), lotId, especie: l.species || '', categoriaLote: l.category || '', resultado: v ? {tipo: v.tipo, cat: v.cat, provisorio: !!cl.abaixo || !!v.pendente} : null,
      validade: p?.validadeMeses && a.germinacao !== '' ? labValidade(a.data, p.validadeMeses) : ''};
    upsert('analisesSementes', reg);
    labAprenderGrupos(l.species, a.encontradas);
    if (a.germinacao !== '') l.germination = a.germinacao;
    if (a.vigor !== '') l.vigor = a.vigor;
    const resumo = v ? {mantem: `fica ${v.cat}`, atende: `atende ${v.cat}`, rebaixa: `não atende ${l.category}, atende ${v.cat}`, reprovado: 'não atende como semente'}[v.tipo] + (reg.resultado.provisorio ? ' (provisório)' : '') : 'sem classificação';
    db.lotEvents.push({id: uid(), lotId, date: a.data, title: `Análise de sementes${a.boletim ? ' nº ' + a.boletim : ''}`, text: [resumo, ...a.encontradas.filter(x => Number(x.n) > 0).map(x => `${x.nome || 'outra'}: ${num(x.n)}`), a.amostraG ? `amostra ${num(a.amostraG)} g` : '', a.germinacao !== '' ? `germinação ${num(a.germinacao)}%` : ''].filter(Boolean).join(' • ')});
    save(); closeModal();
    // Decisão sobre o lote: sempre perguntando
    if (v && !reg.resultado.provisorio) {
      if (v.tipo === 'mantem' && l.status === 'Aguardando análise') confirmDialog(`Lote ${l.code} atende ${v.cat}. Marcar como Aprovado?`, () => labSituacao(l, 'Aprovado', a.data), 'Aprovar');
      else if (v.tipo === 'rebaixa') confirmDialog(`Lote ${l.code} não atende ${l.category}, mas atende ${v.cat}. Rebaixar para ${v.cat}?`, () => { const de = l.category; l.category = v.cat; db.lotEvents.push({id: uid(), lotId, date: a.data, title: `Categoria: ${v.cat}`, text: `Rebaixado de ${de} pela análise`}); labSituacao(l, 'Aprovado', a.data); }, `Rebaixar para ${v.cat}`);
      else if (v.tipo === 'reprovado') confirmDialog(`Lote ${l.code} passa do limite até de S2. Marcar como Reprovado (vai para grão)?`, () => labSituacao(l, 'Reprovado', a.data), 'Reprovar');
      else render();
    } else { showToast(reg.resultado?.provisorio ? 'Análise salva (classificação provisória)' : 'Análise salva'); render(); }
  };
  modal.classList.add('open');
}
function labSituacao(l, st, data) { if (l.status !== st) { db.lotEvents.push({id: uid(), lotId: l.id, date: data, title: `Situação: ${st}`, text: `Anterior: ${l.status}`}); l.status = st; } save(); }
function labValidade(data, meses) { const d = new Date(data + 'T12:00:00'); d.setMonth(d.getMonth() + meses + 1, 0); return isoLocal(d); } // excluído o mês da conclusão: até o fim do mês
// O grupo escolhido para cada espécie encontrada vira a sugestão das próximas análises (só ADM/supervisor grava)
function labAprenderGrupos(especie, encontradas) {
  const p = labPadrao(especie); if (!p || !labGestor()) return;
  const novos = encontradas.filter(x => x.nome && x.grupo && (p.grupos || {})[labChave(x.nome)] !== x.grupo);
  if (!novos.length) return;
  const reg = p.id ? p : {...JSON.parse(JSON.stringify(p)), id: uid()};
  reg.grupos = {...(reg.grupos || {})}; novos.forEach(x => { reg.grupos[labChave(x.nome)] = x.grupo; });
  upsert('padroesSementes', reg);
}

// ---------- Padrões de sementes (tabela por espécie, editável) ----------
function labListaPadroes() {
  const fazenda = db.padroesSementes || [], chaves = new Set(fazenda.map(p => labChave(p.especie)));
  const todos = [...fazenda, ...Object.values(PADROES_BASE).filter(p => !chaves.has(labChave(p.especie)))].sort((a, b) => a.especie.localeCompare(b.especie, 'pt-BR'));
  const resumo = p => `amostra ${num(p.amostraG)} g • C1/C2 aceita: ${GRUPOS_BASE.map(([g, r]) => labVazio(p.lim[g]?.C1) ? '' : `${num(p.lim[g].C1)} ${r.toLowerCase()}`).filter(Boolean).join(', ')}`;
  dialog.innerHTML = `<h3>Padrões de sementes</h3><p class="sub">Limite de sementes de outras espécies por categoria, na amostra da norma. Valem para a classificação automática das análises.</p>
    <div class="lab-padroes">${todos.map(p => `<div class="row"><div><strong>${esc(p.especie)}</strong><small>${esc(resumo(p))}</small><small>${esc(p.norma || 'Padrão da fazenda')}${p.id ? ' • ajustado pela fazenda' : ' • vem no app'}</small></div>${labGestor() ? `<button class="secondary" data-act="lab-padrao" data-id="${esc(p.especie)}">Editar</button>` : ''}</div>`).join('') || '<p class="nota">Nenhum padrão ainda.</p>'}</div>
    <div class="actions"><button type="button" class="secondary" data-close>Fechar</button>${labGestor() ? '<button type="button" class="primary" data-act="lab-padrao" data-id="">+ Espécie</button>' : ''}</div>`;
  $('[data-close]', dialog).onclick = closeModal;
  modal.classList.add('open');
}
function labEditarPadrao(especie) {
  if (!labGestor()) { showToast('Só o ADM ou o supervisor muda os padrões', true); return; }
  const atual = especie ? labPadrao(especie) : null, base = especie ? labBase(labChave(especie)) : null;
  const p = atual ? JSON.parse(JSON.stringify(atual)) : {especie: especie || '', norma: '', amostraG: '', validadeMeses: '', lim: Object.fromEntries(GRUPOS_BASE.map(([g]) => [g, labLim('', '', '', '')])), grupos: {}};
  const val = v => labVazio(v) ? '' : v;
  const celula = (g, col) => `<td><input inputmode="numeric" data-lim="${g}" data-col="${col}" value="${esc(val(p.lim[g]?.[col === 'C1/C2' ? 'C1' : col]))}" aria-label="${esc(g)} ${col}"></td>`;
  dialog.innerHTML = `<h3>${atual ? 'Padrão — ' + esc(p.especie) : 'Novo padrão de sementes'}</h3>
    <p class="sub">Número máximo de sementes de outras espécies na amostra da norma, por categoria. Em branco = sem limite. Copie da norma do MAPA da espécie.</p>
    <form class="form-grid" autocomplete="off">
      <div class="field"><label for="lp_esp">Espécie do lote</label><input id="lp_esp" value="${esc(p.especie)}" ${atual ? 'readonly' : 'required'} placeholder="Ex.: Trigo"></div>
      <div class="field"><label for="lp_am">Amostra da norma (g)</label><input id="lp_am" inputmode="numeric" value="${esc(val(p.amostraG))}" required></div>
      <div class="field"><label for="lp_val">Validade do teste de germinação (meses)</label><input id="lp_val" inputmode="numeric" value="${esc(val(p.validadeMeses))}"></div>
      <div class="field"><label for="lp_norma">Norma</label><input id="lp_norma" value="${esc(p.norma || '')}" placeholder="Ex.: IN MAPA 45/2013"></div>
      <div class="field full"><div class="tbl-wrap lab-tab lab-edita"><table class="tbl"><thead><tr><th>Grupo</th>${CAT_COLUNAS.map(([r]) => `<th>${r}</th>`).join('')}</tr></thead>
        <tbody>${labGrupos(p).map(([g, rot]) => `<tr><th>${esc(rot)}</th>${CAT_COLUNAS.map(([r]) => celula(g, r)).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="actions full">${atual?.id && base ? '<button type="button" class="secondary" data-lp-volta>Voltar ao do app</button>' : ''}<button type="button" class="secondary" data-close>Cancelar</button><button type="submit" class="primary">Salvar padrão</button></div>
    </form>`;
  $('[data-close]', dialog).onclick = closeModal;
  $('[data-lp-volta]', dialog)?.addEventListener('click', () => confirmDialog(`Voltar ${p.especie} ao padrão que vem no app (${base.norma})?`, () => { remove('padroesSementes', atual.id); showToast('Padrão do app restaurado'); }, 'Voltar ao do app'));
  $('form', dialog).onsubmit = e => {
    e.preventDefault();
    const nome = $('#lp_esp', dialog).value.trim(), am = numeroBR($('#lp_am', dialog).value), vm = numeroBR($('#lp_val', dialog).value);
    if (!nome) { showToast('Informe a espécie', true); return; }
    if (!(am > 0)) { showToast('Informe o peso da amostra da norma (g)', true); return; }
    if (!atual && labPadrao(nome)) { showToast(`Já existe padrão para ${nome}: edite o existente`, true); return; }
    const lim = {};
    $$('[data-lim]', dialog).forEach(i => {
      const g = i.dataset.lim, col = i.dataset.col, x = i.value.trim() === '' ? '' : numeroBR(i.value);
      lim[g] ||= {}; (col === 'C1/C2' ? ['C1', 'C2'] : [col]).forEach(c => { lim[g][c] = Number.isFinite(x) ? x : ''; });
    });
    const reg = {...p, id: p.id || uid(), especie: atual ? p.especie : nome, amostraG: am, validadeMeses: Number.isFinite(vm) && vm > 0 ? vm : '', norma: $('#lp_norma', dialog).value.trim(), lim};
    upsert('padroesSementes', reg); closeModal(); showToast(`Padrão de ${reg.especie} salvo`); render();
  };
  modal.classList.add('open');
}

// ---------- Página do lote: última análise e classificação ----------
function labCartaoLote(l) {
  const lista = (db.analisesSementes || []).filter(a => a.lotId === l.id).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const a = lista[0], p = labPadrao(l.species);
  const botao = `<button class="primary" data-act="lab-nova" data-id="${esc(l.id)}">+ Registrar análise</button>`;
  const semPadrao = p ? '' : `<p class="lab-sem">Sem padrão para ${esc(l.species || 'esta espécie')}: a análise fica registrada, mas não classifica.${labGestor() ? ` <button type="button" class="link" data-act="lab-padrao" data-id="${esc(l.species || '')}">Criar o padrão</button>` : ''}</p>`;
  if (!a) return `<div class="section-title"><h3>Análise de sementes</h3>${botao}</div><section class="card panel">${semPadrao}<p class="nota">Nenhuma análise registrada.${p ? ` Ao lançar a contagem de outras sementes na amostra (norma: ${num(p.amostraG)} g), o MercaPlant mostra na hora se o lote fica ${esc(l.category || 'na categoria')} ou se precisa rebaixar.` : ''}</p></section>`;
  const cl = labClassificar(a, l.species), v = labVeredito(cl, a.categoriaLote || l.category);
  const venc = a.validade && a.validade < today(), perto = a.validade && !venc && a.validade <= addDias(today(), 30);
  const info = [a.germinacao !== '' && a.germinacao != null ? `germinação ${num(a.germinacao)}%` : '', a.vigor !== '' && a.vigor != null ? `vigor ${num(a.vigor)}%` : '', a.pureza !== '' && a.pureza != null ? `pureza ${num(a.pureza, 1)}%` : '', a.pms !== '' && a.pms != null ? `PMS ${num(a.pms, 1)} g` : ''].filter(Boolean).join(' • ');
  const grupoNome = g => ((p ? labGrupos(p) : GRUPOS_BASE).find(([x]) => x === g) || ['', g])[1].toLowerCase();
  return `<div class="section-title"><h3>Análise de sementes</h3>${botao}</div>
    <section class="card panel lab-lote">${semPadrao}
      <div class="lab-cab"><div><strong>Boletim${a.boletim ? ' nº ' + esc(a.boletim) : ''}</strong><small>${fmtDate(a.data)}${a.laboratorio ? ' • ' + esc(a.laboratorio) : ''}${a.amostraG ? ` • amostra ${num(a.amostraG)} g` : ''}</small></div>
        ${a.validade ? `<span class="chip ${venc ? 'red' : perto ? 'orange' : 'green'}">${venc ? 'Teste vencido' : 'Válido até'} ${fmtDate(a.validade)}</span>` : ''}</div>
      ${cl ? labTextoVeredito(v, cl, a.categoriaLote || l.category) + labTabela(cl, v?.cat, a.categoriaLote || l.category) : ''}
      ${(a.encontradas || []).filter(x => Number(x.n) > 0).length ? `<p class="nota">Encontradas: ${a.encontradas.filter(x => Number(x.n) > 0).map(x => `${esc(x.nome || 'outra')} ${num(x.n)} (${esc(grupoNome(x.grupo))})`).join(' • ')}</p>` : ''}
      ${info ? `<p class="nota">Boletim: ${esc(info)}</p>` : ''}
      <div class="btn-row">${btn('Editar análise', 'lab-editar', a.id, 'secondary')}${btn('Padrões de sementes', 'lab-padroes', '', 'secondary')}${lista.length > 1 ? `<small class="nota">${lista.length - 1} ${lista.length === 2 ? 'análise anterior' : 'análises anteriores'} na linha do tempo</small>` : ''}</div>
      ${p ? `<p class="nota">Padrão de ${esc(p.especie.toLowerCase())}: ${esc(p.norma || 'da fazenda')}. Confira com a norma vigente.</p>` : ''}
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
  'lab-editar': id => { const a = find('analisesSementes', id); if (a) labForm(a.lotId, a); },
  'lab-padroes': () => labListaPadroes(),
  'lab-padrao': esp => labEditarPadrao(esp)
});
// Ajustes → Agronomia: atalho para os padrões de sementes
if (typeof tecEmbrulhar === 'function') tecEmbrulhar('cadastros', ajustesSemLab => (...a) => {
  const html = ajustesSemLab(...a), i = html.indexOf('<h3>Agronomia</h3>'); if (i < 0) return html;
  const fim = html.indexOf('</article>', i); if (fim < 0) return html;
  const n = (db.padroesSementes || []).length + Object.keys(PADROES_BASE).filter(k => !(db.padroesSementes || []).some(p => labChave(p.especie) === k)).length;
  return html.slice(0, fim) + `<div class="field"><label>Padrões de sementes</label><p class="nota">Limites de outras sementes por categoria (C1, C2, S1, S2) usados na classificação automática das análises de lote. ${n} ${n === 1 ? 'espécie' : 'espécies'}.</p><div class="btn-row">${btn('Ver e editar padrões', 'lab-padroes', '', 'secondary')}</div></div>` + html.slice(fim);
});
