// MercaPlant — análise de sementes do lote (boletim) e classificação automática pela categoria
// A classificação sai da CONTAGEM de outras sementes encontradas na amostra, separada por grupo
// (outra cultivada — e as cultivadas que a norma lista à parte, como aveia no trigo —, silvestre, nociva tolerada,
// nociva proibida). Ex.: 3 de azevém em 500 g de aveia preta. O app compara com o limite de cada categoria e mostra se
// o lote mantém a categoria, se cabe rebaixar (C1 → C2 → S1 → S2) ou se não atende como semente. Nada muda sozinho.
// Cada grupo tem o peso de amostra da norma: nas forrageiras de clima temperado, outras cultivadas e silvestres são
// contadas numa amostra menor (ex.: 50 g na aveia preta) e as nocivas na maior (500 g). Amostra examinada menor que a
// da norma: a contagem vai à proporção e o resultado fica "provisório".
// Pureza, germinação e vigor ficam registrados (a germinação dá a validade do teste), mas não entram na classificação.
// Padrões: os que vêm no app (padroes-sementes.js: IN 45/2013, IN 44/2016 com a IN 31/2025, IN 30/2008 e IN 42/2019) e os da fazenda
// (coleção padroesSementes, editável por ADM/supervisor), que têm prioridade. Espécies em que a norma não pede contagem
// de outras sementes por número (ex.: tomate, pimentão, cucurbitáceas) não classificam: a análise fica registrada e o
// formulário mostra os mínimos de germinação e pureza da norma.

const CAT_ORDEM = ['Básica', 'C1', 'C2', 'S1', 'S2'];
const labChave = s => semAcentoApp(String(s || '')).replace(/[-_()]+/g, ' ').replace(/\s+/g, ' ').trim();
const labVazio = v => v === '' || v == null || !Number.isFinite(Number(v));
const labGestor = () => typeof mcpGestor !== 'function' || mcpGestor();
const labGrupoBase = () => [{id: 'cultivada', rot: 'Outra espécie cultivada', tipo: 'cs', lim: {}}, {id: 'silvestre', rot: 'Silvestre', tipo: 'cs', lim: {}},
  {id: 'tolerada', rot: 'Nociva tolerada', tipo: 'noc', lim: {}}, {id: 'proibida', rot: 'Nociva proibida', tipo: 'noc', lim: {Básica: 0, C1: 0, C2: 0, S1: 0, S2: 0}}];

// Padrão salvo na versão 1.2.5 (lim por grupo, um peso de amostra) → formato atual
function labNormalizar(p) {
  if (!p || Array.isArray(p.grupos)) return p;
  const rot = {cultivada: 'Outra espécie cultivada', silvestre: 'Silvestre', tolerada: 'Nociva tolerada', proibida: 'Nociva proibida', extra: p.extra || 'Outra'};
  const grupos = Object.entries(p.lim || {}).map(([id, lim]) => ({id, rot: rot[id] || id, tipo: ['tolerada', 'proibida'].includes(id) ? 'noc' : 'cs', lim}));
  return {...p, amostraCS: p.amostraCS || p.amostraG, cats: CAT_ORDEM, grupos, sugestoes: p.grupos && !Array.isArray(p.grupos) ? p.grupos : (p.sugestoes || {})};
}
const labDoApp = k => (typeof PADROES_SEMENTES_APP !== 'undefined' ? PADROES_SEMENTES_APP : []).find(p => [p.especie, p.cientifico, ...(p.sinonimos || [])].some(n => labChave(n) === k)) || null;
/** Padrão da espécie: o da fazenda (editado) ou o que vem no app. */
function labPadrao(especie) {
  const k = labChave(especie); if (!k) return null;
  const app = labDoApp(k), nomes = new Set([k, app && labChave(app.especie)].filter(Boolean));
  const daFazenda = (db.padroesSementes || []).find(p => nomes.has(labChave(p.especie)));
  return labNormalizar(daFazenda) || app;
}
const labCats = p => (p.cats || CAT_ORDEM).filter(c => CAT_ORDEM.includes(c));
const labAmostraNorma = (p, tipo) => tipo === 'cs' ? (Number(p.amostraCS) || Number(p.amostraG)) : Number(p.amostraG);
// Sem nenhum limite de contagem (a norma não pede: "-" na IN 42/2019) → não classifica
const labSemContagem = p => !!p && p.grupos.every(g => Object.values(g.lim || {}).every(labVazio));
const labDuasAmostras = p => !!p && Number(p.amostraCS) > 0 && Number(p.amostraCS) !== Number(p.amostraG);

/** Classificação: para cada categoria, cada grupo atende (≤ limite), não atende, ou fica pendente (sem amostra). */
function labClassificar(a, especie) {
  const p = labPadrao(especie); if (!p || labSemContagem(p)) return null;
  const examinada = tipo => Number(tipo === 'cs' && labDuasAmostras(p) ? a.amostraCS || a.amostraG : a.amostraG) || 0;
  const conta = {}; (a.encontradas || []).forEach(e => { if (e.grupo && Number(e.n) > 0) conta[e.grupo] = (conta[e.grupo] || 0) + Number(e.n); });
  const grupos = p.grupos.filter(g => !g.id.startsWith('x') || conta[g.id]); // cultivadas listadas à parte só aparecem se achadas
  const info = grupos.map(g => { const ex = examinada(g.tipo), norma = labAmostraNorma(p, g.tipo), fator = ex > 0 && norma > 0 ? norma / ex : 1;
    return {g, ex, norma, fator, valor: ex ? Math.round((conta[g.id] || 0) * fator * 10) / 10 : null}; });
  const porCat = labCats(p).map(cat => {
    const itens = info.map(({g, valor}) => { const limite = g.lim?.[cat];
      return {g: g.id, rotulo: g.rot, valor, limite, ok: valor === null ? null : labVazio(limite) ? true : valor <= Number(limite)}; });
    return {cat, itens, atende: itens.every(i => i.ok !== false), pendente: itens.some(i => i.ok === null)};
  });
  const abaixo = info.filter(i => i.ex > 0 && i.ex < i.norma);
  // Só com a contagem como veio (sem proporção), para mostrar a diferença quando a amostra é menor
  const semProp = abaixo.length ? labCats(p).find(cat => info.every(({g}) => labVazio(g.lim?.[cat]) || (conta[g.id] || 0) <= Number(g.lim[cat]))) : null;
  return {p, conta, info, porCat, semProp, abaixo, duas: labDuasAmostras(p)};
}
/** Veredito para a categoria do lote: mantém, rebaixa para qual, ou não atende como semente. */
function labVeredito(cl, catLote) {
  if (!cl) return null;
  const cats = labCats(cl.p), i0 = CAT_ORDEM.indexOf(catLote);
  const daqui = cl.porCat.filter(c => i0 < 0 || CAT_ORDEM.indexOf(c.cat) >= i0); // não sobe de categoria
  const primeira = daqui.find(c => c.atende);
  if (!primeira) return {tipo: 'reprovado', cat: null, pendente: daqui.some(c => c.pendente)};
  if (cats.includes(catLote) && primeira.cat === catLote) return {tipo: 'mantem', cat: catLote, pendente: primeira.pendente};
  return {tipo: CAT_ORDEM.includes(catLote) ? 'rebaixa' : 'atende', cat: primeira.cat, pendente: primeira.pendente};
}
function labTextoVeredito(v, cl, catLote) {
  if (!v) return '';
  if (v.pendente) return `<div class="lab-ver"><b>Informe a amostra examinada (g)</b><span>A classificação sai da contagem de outras sementes no peso da amostra (norma: ${labTextoNorma(cl.p)}).</span></div>`;
  const prov = cl.abaixo.length ? `<small class="lab-prov">⚠ Provisório: ${cl.abaixo.map(i => `amostra de ${num(i.ex)} g para ${i.g.tipo === 'cs' ? 'cultivadas e silvestres' : 'nocivas'} (a norma pede ${num(i.norma)} g)`).filter((t, k, l) => l.indexOf(t) === k).join('; ')}. A contagem foi levada à proporção${cl.semProp && cl.semProp !== v.cat ? ` (sem a proporção daria ${cl.semProp})` : ''}. Refaça no peso da norma para valer.</small>` : '';
  if (v.tipo === 'mantem') return `<div class="lab-ver ok"><b>✓ Fica ${esc(v.cat)}</b><span>A contagem de outras sementes está dentro do limite da categoria do lote.</span>${prov}</div>`;
  if (v.tipo === 'atende') return `<div class="lab-ver ok"><b>✓ Atende ${esc(v.cat)}</b><span>Maior categoria atendida pela contagem.</span>${prov}</div>`;
  if (v.tipo === 'rebaixa') return `<div class="lab-ver alerta"><b>↓ Não atende ${esc(catLote)}: atende ${esc(v.cat)}</b><span>O lote pode ser rebaixado para ${esc(v.cat)} (você confirma ao salvar).</span>${prov}</div>`;
  return `<div class="lab-ver ruim"><b>✗ Não atende como semente</b><span>A contagem passa do limite da última categoria. O lote pode ser reprovado e ir para grão.</span>${prov}</div>`;
}
/** Espécie sem contagem por número: o que a norma pede (germinação e pureza mínimas da categoria do lote). */
function labTextoSemContagem(p, cat) {
  const c = labCats(p).includes(cat) ? cat : 'C1', g = p.germ?.[c], pz = p.pureza;
  return `A norma (${esc(p.norma || '')}) não pede contagem de outras sementes por número para ${esc(String(p.especie).toLowerCase())}: a análise fica registrada, sem classificação automática.${!labVazio(g) ? ` Mínimos ${esc(c)}: germinação ${num(g)}%${!labVazio(pz) ? `, pureza ${num(pz)}%` : ''}.` : ''}`;
}
// ---------- Germinação e pureza x mínimo da norma (só aviso: a classificação segue pela contagem) ----------
/** Mínimo da norma para a categoria (germ ou pureza): número único ou por categoria. */
function labMin(p, campo, cat) {
  const v = p?.[campo]; if (v == null || v === '') return null;
  const x = typeof v === 'object' ? v[cat] : v;
  return labVazio(x) ? null : Number(x);
}
/** Confere germinação e pureza do boletim com o mínimo da categoria do lote; se não atinge, diz a categoria que atinge. */
function labConfere(a, p, cat) {
  if (!p || !a) return [];
  const cats = labCats(p), i0 = cats.indexOf(cat); if (i0 < 0) return [];
  return [['germ', 'germinacao', 'Germinação'], ['pureza', 'pureza', 'Pureza']].map(([campo, k, rot]) => {
    if (labVazio(a[k])) return null;
    const valor = Number(a[k]), min = labMin(p, campo, cat); if (min == null) return null;
    const ok = valor >= min, atende = ok ? cat : cats.slice(i0 + 1).find(c => { const m = labMin(p, campo, c); return m != null && valor >= m; }) || null;
    return {campo: k, rot, valor, min, ok, atende};
  }).filter(Boolean);
}
function labTextoConfere(lista, cat) {
  if (!lista.length) return '';
  return `<div class="lab-conf">${lista.map(c => `<p class="${c.ok ? 'ok' : 'nao'}"><b>${c.ok ? '✓' : '⚠'} ${esc(c.rot)} ${num(c.valor, c.valor % 1 ? 1 : 0)}%</b> ${c.ok ? `atinge o mínimo do ${esc(cat)} (${num(c.min)}%)` : `abaixo do mínimo do ${esc(cat)} (${num(c.min)}%)${c.atende ? ` — atinge o do ${esc(c.atende)}` : ' — não atinge nenhuma categoria'}`}</p>`).join('')}<small>Aviso pela norma; a classificação continua pela contagem de outras sementes.</small></div>`;
}
const labTextoNorma = p => labDuasAmostras(p) ? `${num(p.amostraCS)} g para cultivadas e silvestres, ${num(p.amostraG)} g para nocivas` : `${num(p.amostraG)} g`;
// Colunas: da categoria do lote para baixo (não sobe de categoria); C1 e C2 juntas quando o limite é o mesmo em todos os grupos
function labColunas(cl, catLote) {
  const i0 = Math.max(0, CAT_ORDEM.indexOf(catLote));
  const cs = cl.porCat.filter(c => CAT_ORDEM.indexOf(c.cat) >= i0), mesmo = (a, b) => cl.p.grupos.every(g => String(g.lim?.[a] ?? '') === String(g.lim?.[b] ?? ''));
  const out = [];
  cs.forEach(c => { const ant = out[out.length - 1]; if (ant && ant.cat === 'C1' && c.cat === 'C2' && mesmo('C1', 'C2')) ant.rot = 'C1/C2'; else out.push({cat: c.cat, rot: c.cat, c}); });
  return out;
}
function labTabela(cl, destaque, catLote) {
  const cols = labColunas(cl, catLote), alvo = col => col.cat === destaque || (col.rot === 'C1/C2' && destaque === 'C2');
  const linhas = cl.porCat[0].itens.map((it, k) => { const inf = cl.info[k];
    return `<tr><th>${esc(it.rotulo)}${cl.duas ? `<small>em ${num(inf.norma)} g</small>` : ''}</th><td class="lab-val">${it.valor === null ? '—' : num(it.valor, it.valor % 1 ? 1 : 0)}</td>${cols.map(col => { const x = col.c.itens[k];
      return `<td class="${x.ok === null ? 'pend' : x.ok ? 'ok' : 'nao'}${alvo(col) ? ' alvo' : ''}">${x.ok === null ? '·' : x.ok ? '✓' : '✗'}<small>${labVazio(x.limite) ? 'sem limite' : '≤' + num(x.limite)}</small></td>`; }).join('')}</tr>`; }).join('');
  return `<div class="tbl-wrap lab-tab"><table class="tbl"><thead><tr><th>Outras sementes (nº)</th><th>Achado${!cl.duas && cl.info[0]?.fator !== 1 && cl.info[0]?.ex ? `<small>em ${num(cl.info[0].norma)} g</small>` : ''}</th>${cols.map(col => `<th class="${alvo(col) ? 'alvo' : ''}">${col.rot}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table></div>`;
}

// ---------- Registrar análise (boletim) ----------
function labForm(lotId, a0) {
  const l = find('lots', lotId); if (!l) return;
  const p = labPadrao(l.species), duas = labDuasAmostras(p), semConta = labSemContagem(p);
  const a = a0 ? JSON.parse(JSON.stringify(a0)) : {data: today(), amostraG: p?.amostraG || '', amostraCS: duas ? p.amostraCS : '', encontradas: []};
  if (!a.encontradas.length) a.encontradas.push({nome: '', grupo: '', n: ''});
  const campo = (k, rot, extra = '') => `<div class="field"><label for="lab_${k}">${rot}</label><input id="lab_${k}" data-lab="${k}" inputmode="decimal" value="${esc(a[k] ?? '')}" ${extra}></div>`;
  const nomes = p ? Object.keys(p.sugestoes || {}) : [];
  const temOutros = semConta || ['pureza', 'outrasPct', 'germinacao', 'vigor', 'pms', 'umidade'].some(k => !labVazio(a[k]));
  dialog.innerHTML = `<h3>Análise de sementes — lote ${esc(l.code)}</h3>
    <p class="sub">${esc([l.species, l.cultivar, l.category].filter(Boolean).join(' • '))}${p ? ` • padrão: ${esc(p.norma || 'da fazenda')}` : ''}</p>
    ${p ? '' : `<p class="lab-sem">Ainda não há padrão para ${esc(l.species || 'esta espécie')}: a análise fica registrada, mas não classifica.${labGestor() ? ` <button type="button" class="link" data-act="lab-padrao" data-id="${esc(l.species || '')}">Criar o padrão</button>` : ' Peça ao ADM ou supervisor para criar o padrão.'}</p>`}
    ${semConta ? `<p class="lab-sem">${labTextoSemContagem(p, l.category)}</p>` : ''}
    <form class="form-grid lab-form" autocomplete="off">
      <div class="field"><label for="lab_data">Data do resultado</label><input id="lab_data" data-lab="data" type="date" value="${esc(a.data || today())}"></div>
      <div class="field"><label for="lab_boletim">Nº do boletim</label><input id="lab_boletim" data-lab="boletim" value="${esc(a.boletim || '')}"></div>
      ${duas ? campo('amostraCS', `Amostra para outras cultivadas e silvestres (g) — norma: ${num(p.amostraCS)} g`, `placeholder="${p.amostraCS}"`) + campo('amostraG', `Amostra para nocivas (g) — norma: ${num(p.amostraG)} g`, `placeholder="${p.amostraG}"`)
        : campo('amostraG', `Amostra examinada (g)${p?.amostraG ? ` — norma: ${num(p.amostraG)} g` : ''}`, p ? `placeholder="${p.amostraG}"` : '')}
      <div class="field"><label for="lab_laboratorio">Laboratório</label><input id="lab_laboratorio" data-lab="laboratorio" value="${esc(a.laboratorio || '')}" placeholder="Ex.: laboratório próprio"></div>
      <div class="field full" ${semConta ? 'hidden' : ''}><label>Sementes de outras espécies encontradas na amostra</label>
        <div id="labOutras" class="lab-outras"></div>
        <button type="button" class="secondary lab-mais">+ Outra espécie</button>
        ${nomes.length ? `<datalist id="labNomes">${nomes.map(n => `<option value="${esc({azevem: 'azevém', nabica: 'nabiça', 'feijao caupi': 'feijão-caupi'}[n] || n)}">`).join('')}</datalist>` : ''}</div>
      <div class="field full" id="labResultado" aria-live="polite" ${semConta ? 'hidden' : ''}></div>
      <details class="field full lab-outros" ${temOutros ? 'open' : ''}><summary>Outros resultados do boletim (opcional)</summary>
        <div class="form-grid">${campo('germinacao', 'Germinação (%)')}${campo('vigor', 'Vigor (%)')}${campo('pureza', 'Pureza (%)')}${campo('outrasPct', 'Outras sementes (%)')}${campo('pms', 'Peso de mil sementes (g)')}${campo('umidade', 'Umidade (%)')}</div>
        <small class="nota">Ficam no histórico do lote; a germinação dá a validade do teste e é conferida com o mínimo da norma.</small></details>
      <div class="field full" id="labConf" aria-live="polite"></div>
      <div class="field full"><label for="lab_obs">Observações</label><textarea id="lab_obs" data-lab="obs" rows="2">${esc(a.obs || '')}</textarea></div>
      <div class="actions full"><button type="button" class="secondary" data-close>Cancelar</button><button type="submit" class="primary">Salvar análise</button></div>
    </form>`;
  $('[data-close]', dialog).onclick = closeModal;
  const lerNum = v => { const x = typeof numeroBR === 'function' ? numeroBR(v) : Number(String(v).replace(',', '.')); return v === '' || !Number.isFinite(x) ? '' : x; };
  const ler = () => {
    $$('[data-lab]', dialog).forEach(el => { const k = el.dataset.lab; a[k] = ['data', 'laboratorio', 'boletim', 'obs'].includes(k) ? el.value.trim() : lerNum(el.value); });
    a.encontradas = $$('.lab-linha', dialog).map(r => ({nome: $('[data-o=nome]', r).value.trim(), grupo: $('[data-o=grupo]', r).value, n: lerNum($('[data-o=n]', r).value)}));
  };
  const opcoesGrupo = sel => (p ? p.grupos : labGrupoBase()).map(g => `<option value="${g.id}" ${sel === g.id ? 'selected' : ''}>${esc(g.rot)}</option>`).join('');
  const linhas = () => {
    $('#labOutras', dialog).innerHTML = a.encontradas.map((e, i) => `<div class="lab-linha" data-i="${i}">
      <input data-o="nome" list="labNomes" placeholder="Espécie (ex.: azevém)" value="${esc(e.nome || '')}" aria-label="Espécie">
      <select data-o="grupo" aria-label="Grupo"><option value="">Grupo…</option>${opcoesGrupo(e.grupo)}</select>
      <input data-o="n" inputmode="numeric" placeholder="Nº" value="${esc(e.n ?? '')}" aria-label="Quantidade">
      <button type="button" class="link lab-tira" aria-label="Tirar">✕</button></div>`).join('');
  };
  const resultado = () => {
    ler();
    const cf = $('#labConf', dialog); if (cf) cf.innerHTML = labTextoConfere(labConfere(a, p, l.category), l.category);
    const el = $('#labResultado', dialog); if (!el) return;
    const cl = labClassificar(a, l.species);
    if (!cl) { el.innerHTML = ''; return; }
    const v = labVeredito(cl, l.category);
    el.innerHTML = `<label>Classificação (automática)</label>${labTextoVeredito(v, cl, l.category)}${labTabela(cl, v?.cat, l.category)}`;
  };
  linhas(); resultado();
  const caixa = $('.lab-form', dialog);
  caixa.addEventListener('input', e => {
    if (e.target.matches('[data-o=nome]') && p) { // sugere o grupo pela espécie (a norma ou o que a fazenda já usou)
      const r = e.target.closest('.lab-linha'), k = labChave(e.target.value), s = $('[data-o=grupo]', r);
      const g = (p.sugestoes || {})[k] || p.grupos.find(x => x.id.startsWith('x') && labChave(x.rot).startsWith(k) && k.length > 3)?.id;
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
    const reg = {...a, id: a.id || uid(), lotId, especie: l.species || '', categoriaLote: l.category || '', resultado: v ? {tipo: v.tipo, cat: v.cat, provisorio: !!cl.abaixo.length || !!v.pendente} : null,
      validade: p?.validadeMeses && a.germinacao !== '' ? labValidade(a.data, p.validadeMeses) : '', confere: labConfere(a, p, l.category)};
    upsert('analisesSementes', reg);
    labAprenderGrupos(l.species, a.encontradas);
    if (a.germinacao !== '') l.germination = a.germinacao;
    if (a.vigor !== '') l.vigor = a.vigor;
    const resumo = v ? {mantem: `fica ${v.cat}`, atende: `atende ${v.cat}`, rebaixa: `não atende ${l.category}, atende ${v.cat}`, reprovado: 'não atende como semente'}[v.tipo] + (reg.resultado.provisorio ? ' (provisório)' : '') : 'sem classificação';
    db.lotEvents.push({id: uid(), lotId, date: a.data, title: `Análise de sementes${a.boletim ? ' nº ' + a.boletim : ''}`, text: [resumo, ...a.encontradas.filter(x => Number(x.n) > 0).map(x => `${x.nome || 'outra'}: ${num(x.n)}`), a.amostraG ? `amostra ${duas && a.amostraCS ? num(a.amostraCS) + ' g / ' : ''}${num(a.amostraG)} g` : '', a.germinacao !== '' ? `germinação ${num(a.germinacao)}%` : '', ...reg.confere.filter(c => !c.ok).map(c => `${c.rot.toLowerCase()} abaixo do mínimo do ${l.category} (${num(c.min)}%)`)].filter(Boolean).join(' • ')});
    save(); closeModal();
    // Decisão sobre o lote: sempre perguntando
    if (v && !reg.resultado.provisorio) {
      if (v.tipo === 'mantem' && l.status === 'Aguardando análise') confirmDialog(`Lote ${l.code} atende ${v.cat}. Marcar como Aprovado?`, () => labSituacao(l, 'Aprovado', a.data), 'Aprovar');
      else if (v.tipo === 'rebaixa') confirmDialog(`Lote ${l.code} não atende ${l.category}, mas atende ${v.cat}. Rebaixar para ${v.cat}?`, () => { const de = l.category; l.category = v.cat; db.lotEvents.push({id: uid(), lotId, date: a.data, title: `Categoria: ${v.cat}`, text: `Rebaixado de ${de} pela análise`}); labSituacao(l, 'Aprovado', a.data); }, `Rebaixar para ${v.cat}`);
      else if (v.tipo === 'reprovado') confirmDialog(`Lote ${l.code} passa do limite da última categoria. Marcar como Reprovado (vai para grão)?`, () => labSituacao(l, 'Reprovado', a.data), 'Reprovar');
      else render();
    } else { showToast(reg.resultado?.provisorio ? 'Análise salva (classificação provisória)' : 'Análise salva'); render(); }
  };
  modal.classList.add('open');
}
function labSituacao(l, st, data) { if (l.status !== st) { db.lotEvents.push({id: uid(), lotId: l.id, date: data, title: `Situação: ${st}`, text: `Anterior: ${l.status}`}); l.status = st; } save(); }
// ---------- Validade do teste de germinação e reanálise ----------
// Portaria MAPA 538/2022: teste vale até 12 meses e a reanálise 6 (acondicionamento ordinário); a norma da espécie pode
// fixar prazos menores (padrão: validadeMeses e validadeReanaliseMeses). Validade conta até o fim do mês, excluído o mês do teste.
const labMesesReanalise = p => Number(p?.validadeReanaliseMeses) > 0 ? Number(p.validadeReanaliseMeses) : Number(p?.validadeMeses) > 0 ? Math.min(6, Number(p.validadeMeses)) : null;
const labDiasAte = iso => Math.round((new Date(iso + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5);
const labLoteAtivo = l => !['Expedido', 'Reprovado'].includes(l.status);
const labAnalisesLote = lotId => (db.analisesSementes || []).filter(a => a.lotId === lotId).sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.tipo === 'reanalise') - (a.tipo === 'reanalise'));
/** Situação do teste de germinação: pela análise ou reanálise mais recente com validade. */
function labValidadeLote(l) {
  const a = labAnalisesLote(l.id).find(x => x.validade); if (!a) return null;
  const dias = labDiasAte(a.validade);
  return {a, validade: a.validade, dias, estado: dias < 0 ? 'vencido' : dias <= 30 ? 'vence' : 'ok'};
}
const labPodeVender = l => labValidadeLote(l)?.estado !== 'vencido';
function labChipValidade(l) {
  if (!labLoteAtivo(l)) return '';
  const v = labValidadeLote(l); if (!v || v.estado === 'ok') return '';
  return v.estado === 'vencido' ? chip('Teste vencido: não vender', 'red') : chip(`Teste vence em ${v.dias} ${v.dias === 1 ? 'dia' : 'dias'}`, 'orange');
}
/** Reanálise da germinação: renova a validade do teste (nova análise só de germinação/vigor). */
function labReanalise(lotId, r0) {
  const l = find('lots', lotId); if (!l) return;
  const p = labPadrao(l.species), meses = labMesesReanalise(p), min = labMin(p, 'germ', l.category), v0 = labValidadeLote(l);
  openForm({title: `Reanálise da germinação — lote ${l.code}`, submit: 'Salvar reanálise',
    sub: [v0 ? `Teste atual: ${v0.estado === 'vencido' ? 'venceu' : 'vale até'} ${fmtDate(v0.validade)}.` : '', meses ? `A reanálise vale ${meses} meses (até o fim do mês).` : 'Sem prazo de validade no padrão desta espécie.'].filter(Boolean).join(' '),
    values: r0 ? {...r0} : {data: today()},
    fields: [{k: 'data', label: 'Data do resultado', type: 'date', required: true}, {k: 'boletim', label: 'Nº do boletim'}, {k: 'laboratorio', label: 'Laboratório', placeholder: 'Ex.: laboratório próprio'},
      {k: 'germinacao', label: 'Germinação (%)', type: 'number', min: 0, required: true, hint: min != null ? `Mínimo do ${l.category}: ${num(min)}%` : ''}, {k: 'vigor', label: 'Vigor (%)', type: 'number', min: 0},
      {k: 'obs', label: 'Observações', type: 'textarea'}],
    onSubmit: v => {
      if (!(v.germinacao >= 0 && v.germinacao <= 100)) return 'Germinação vai de 0 a 100%';
      if (v.vigor !== '' && v.vigor != null && (v.vigor < 0 || v.vigor > 100)) return 'Vigor vai de 0 a 100%';
      const reg = {...(r0 || {}), ...v, id: r0?.id || uid(), lotId, tipo: 'reanalise', especie: l.species || '', categoriaLote: l.category || '', encontradas: [],
        validade: meses ? labValidade(v.data, meses) : ''};
      reg.confere = labConfere(reg, p, l.category);
      upsert('analisesSementes', reg);
      l.germination = v.germinacao; if (v.vigor !== '' && v.vigor != null) l.vigor = v.vigor;
      if (!r0) db.lotEvents.push({id: uid(), lotId, date: v.data, title: `Reanálise da germinação${v.boletim ? ' nº ' + v.boletim : ''}`, text: [`germinação ${num(v.germinacao)}%`, reg.validade ? `válida até ${fmtDate(reg.validade)}` : '', ...reg.confere.filter(c => !c.ok).map(c => `abaixo do mínimo do ${l.category} (${num(c.min)}%)`)].filter(Boolean).join(' • ')});
      save(); showToast(reg.validade ? `Reanálise salva: teste válido até ${fmtDate(reg.validade)}` : 'Reanálise salva');
    }});
}
function labValidade(data, meses) { const d = new Date(data + 'T12:00:00'); d.setMonth(d.getMonth() + meses + 1, 0); return isoLocal(d); } // excluído o mês da conclusão: até o fim do mês
// O grupo escolhido para cada espécie encontrada vira a sugestão das próximas análises (só ADM/supervisor grava)
function labAprenderGrupos(especie, encontradas) {
  const p = labPadrao(especie); if (!p || !labGestor()) return;
  const novos = encontradas.filter(x => x.nome && x.grupo && (p.sugestoes || {})[labChave(x.nome)] !== x.grupo);
  if (!novos.length) return;
  const reg = p.id ? {...p} : {...JSON.parse(JSON.stringify(p)), id: uid()};
  reg.sugestoes = {...(reg.sugestoes || {})}; novos.forEach(x => { reg.sugestoes[labChave(x.nome)] = x.grupo; });
  upsert('padroesSementes', reg);
}

// ---------- Padrões de sementes (tabela por espécie, editável) ----------
function labTodosPadroes() {
  const fazenda = (db.padroesSementes || []).map(labNormalizar), app = typeof PADROES_SEMENTES_APP !== 'undefined' ? PADROES_SEMENTES_APP : [];
  const chaves = new Set(fazenda.map(p => labChave(p.especie)));
  return [...fazenda, ...app.filter(p => !chaves.has(labChave(p.especie)))].sort((a, b) => a.especie.localeCompare(b.especie, 'pt-BR'));
}
function labListaPadroes(filtro = '') {
  const todos = labTodosPadroes(), k = labChave(filtro);
  const lista = k ? todos.filter(p => [p.especie, p.cientifico, ...(p.sinonimos || [])].some(n => (' ' + labChave(n)).includes(' ' + k))) : todos; // pelo começo das palavras ("pim" não acha "capim")
  const lim = (p, id) => p.grupos.find(g => g.id === id)?.lim?.C1;
  const resumo = p => labSemContagem(p) ? `sem contagem de outras sementes por número • mínimo C1: germinação ${num(p.germ?.C1 ?? '')}%${labVazio(p.pureza) ? '' : `, pureza ${num(p.pureza)}%`}` : `amostra ${labTextoNorma(p)} • C1 aceita: ${[['cultivada', 'cultivada'], ['silvestre', 'silvestre'], ['tolerada', 'nociva tolerada']].map(([id, r]) => labVazio(lim(p, id)) ? '' : `${num(lim(p, id))} ${r}`).filter(Boolean).join(', ')}`;
  dialog.innerHTML = `<h3>Padrões de sementes</h3><p class="sub">${todos.length} espécies. Limite de sementes de outras espécies por categoria, na amostra da norma. Valem para a classificação automática das análises.</p>
    <div class="field"><input id="labBusca" placeholder="Buscar espécie (ex.: trigo, azevém, Lolium)" value="${esc(filtro)}" aria-label="Buscar espécie"></div>
    <div class="lab-padroes">${lista.map(p => `<div class="row"><div><strong>${esc(p.especie)}</strong> <em>${esc(p.cientifico || '')}</em><small>${esc(resumo(p))}</small><small>${esc(p.norma || 'Padrão da fazenda')}${p.id ? ' • ajustado pela fazenda' : ''}</small></div>${labGestor() ? `<button class="secondary" data-act="lab-padrao" data-id="${esc(p.especie)}">${p.id ? 'Editar' : 'Ver'}</button>` : ''}</div>`).join('') || '<p class="nota">Nenhuma espécie com esse nome.</p>'}</div>
    <div class="actions"><button type="button" class="secondary" data-close>Fechar</button>${labGestor() ? '<button type="button" class="primary" data-act="lab-padrao" data-id="">+ Espécie</button>' : ''}</div>`;
  $('[data-close]', dialog).onclick = closeModal;
  const b = $('#labBusca', dialog); b.oninput = () => { const pos = b.value; labListaPadroes(pos); const n = $('#labBusca', dialog); n.focus(); n.setSelectionRange(pos.length, pos.length); };
  modal.classList.add('open');
}
function labEditarPadrao(especie) {
  if (!labGestor()) { showToast('Só o ADM ou o supervisor muda os padrões', true); return; }
  const atual = especie ? labPadrao(especie) : null, doApp = especie ? labDoApp(labChave(especie)) : null;
  const p = atual ? JSON.parse(JSON.stringify(atual)) : {especie: especie || '', norma: '', amostraG: '', amostraCS: '', validadeMeses: '', cats: CAT_ORDEM, grupos: labGrupoBase(), sugestoes: {}};
  const val = v => labVazio(v) ? '' : v;
  const cats = labCats(p);
  const celula = (g, c) => cats.includes(c) ? `<td><input inputmode="numeric" data-lim="${esc(g.id)}" data-col="${c}" value="${esc(val(g.lim?.[c]))}" aria-label="${esc(g.rot)} ${c}"></td>` : '<td class="pend">—</td>';
  dialog.innerHTML = `<h3>${atual ? 'Padrão — ' + esc(p.especie) : 'Novo padrão de sementes'}</h3>
    <p class="sub">Número máximo de sementes de outras espécies na amostra da norma, por categoria. Em branco = sem limite. ${atual?.id ? 'Ajustado pela fazenda.' : atual ? 'Vem no app: ao salvar, vira o padrão da fazenda.' : 'Copie da norma do MAPA da espécie.'}</p>
    <form class="form-grid" autocomplete="off">
      <div class="field"><label for="lp_esp">Espécie do lote</label><input id="lp_esp" value="${esc(p.especie)}" ${atual ? 'readonly' : 'required'} placeholder="Ex.: Trigo"></div>
      <div class="field"><label for="lp_norma">Norma</label><input id="lp_norma" value="${esc(p.norma || '')}" placeholder="Ex.: IN MAPA 45/2013"></div>
      <div class="field"><label for="lp_cs">Amostra para outras cultivadas e silvestres (g)</label><input id="lp_cs" inputmode="decimal" value="${esc(val(p.amostraCS || p.amostraG))}" required></div>
      <div class="field"><label for="lp_am">Amostra para nocivas (g)</label><input id="lp_am" inputmode="decimal" value="${esc(val(p.amostraG))}" required></div>
      <div class="field"><label for="lp_val">Validade do teste de germinação (meses)</label><input id="lp_val" inputmode="numeric" value="${esc(val(p.validadeMeses))}"></div>
      <div class="field"><label for="lp_vre">Validade da reanálise (meses)</label><input id="lp_vre" inputmode="numeric" value="${esc(val(p.validadeReanaliseMeses))}" placeholder="${labMesesReanalise(p) || 6}"></div>
      <div class="field full"><div class="tbl-wrap lab-tab lab-edita"><table class="tbl"><thead><tr><th>Grupo</th>${CAT_ORDEM.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${p.grupos.map(g => `<tr><th>${esc(g.rot)}</th>${CAT_ORDEM.map(c => celula(g, c)).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="actions full">${atual?.id && doApp ? '<button type="button" class="secondary" data-lp-volta>Voltar ao do app</button>' : ''}<button type="button" class="secondary" data-close>Cancelar</button><button type="submit" class="primary">Salvar padrão</button></div>
    </form>`;
  $('[data-close]', dialog).onclick = closeModal;
  $('[data-lp-volta]', dialog)?.addEventListener('click', () => confirmDialog(`Voltar ${p.especie} ao padrão que vem no app (${doApp.norma})?`, () => { remove('padroesSementes', atual.id); showToast('Padrão do app restaurado'); }, 'Voltar ao do app'));
  $('form', dialog).onsubmit = e => {
    e.preventDefault();
    const nome = $('#lp_esp', dialog).value.trim(), am = numeroBR($('#lp_am', dialog).value), cs = numeroBR($('#lp_cs', dialog).value), vm = numeroBR($('#lp_val', dialog).value), vre = numeroBR($('#lp_vre', dialog).value);
    if (!nome) { showToast('Informe a espécie', true); return; }
    if (!(am > 0) || !(cs > 0)) { showToast('Informe o peso das amostras da norma (g)', true); return; }
    if (!atual && labPadrao(nome)) { showToast(`Já existe padrão para ${nome}: edite o existente`, true); return; }
    const grupos = p.grupos.map(g => ({...g, lim: {...g.lim}}));
    $$('[data-lim]', dialog).forEach(i => { const g = grupos.find(x => x.id === i.dataset.lim), x = i.value.trim() === '' ? '' : numeroBR(i.value); if (g) g.lim[i.dataset.col] = Number.isFinite(x) ? x : ''; });
    const reg = {...p, id: p.id || uid(), especie: atual ? p.especie : nome, amostraG: am, amostraCS: cs, validadeMeses: Number.isFinite(vm) && vm > 0 ? vm : '', validadeReanaliseMeses: Number.isFinite(vre) && vre > 0 ? vre : '', norma: $('#lp_norma', dialog).value.trim(), grupos};
    delete reg.lim; delete reg.extra;
    upsert('padroesSementes', reg); closeModal(); showToast(`Padrão de ${reg.especie} salvo`); render();
  };
  modal.classList.add('open');
}

// ---------- Página do lote: última análise e classificação ----------
function labCartaoLote(l) {
  const todas = labAnalisesLote(l.id), lista = todas.filter(x => x.tipo !== 'reanalise');
  const a = lista[0], p = labPadrao(l.species), re = todas.find(x => x.tipo === 'reanalise' && (!a || (x.data || '') >= (a.data || '')));
  const botao = `<button class="primary" data-act="lab-nova" data-id="${esc(l.id)}">+ Registrar análise</button>`;
  const semPadrao = p ? '' : `<p class="lab-sem">Sem padrão para ${esc(l.species || 'esta espécie')}: a análise fica registrada, mas não classifica.${labGestor() ? ` <button type="button" class="link" data-act="lab-padrao" data-id="${esc(l.species || '')}">Criar o padrão</button>` : ''}</p>`;
  const lote = p?.loteMaxKg && Number(l.weight) > p.loteMaxKg ? `<p class="lab-sem">⚠ Lote de ${num(l.weight)} kg: a norma de ${esc(p.especie.toLowerCase())} admite até ${num(p.loteMaxKg)} kg por lote (uma amostra para cada lote).</p>` : '';
  if (!a) return `<div class="section-title"><h3>Análise de sementes</h3>${botao}</div><section class="card panel">${semPadrao}${lote}<p class="nota">Nenhuma análise registrada.${p ? ` Ao lançar a contagem de outras sementes na amostra (norma: ${labTextoNorma(p)}), o MercaPlant mostra na hora se o lote fica ${esc(l.category || 'na categoria')} ou se precisa rebaixar.` : ''}</p></section>`;
  const cl = labClassificar(a, l.species), v = labVeredito(cl, a.categoriaLote || l.category);
  const vl = labValidadeLote(l), venc = vl?.estado === 'vencido', perto = vl?.estado === 'vence', ativo = labLoteAtivo(l);
  const aviso = !vl || !ativo || vl.estado === 'ok' ? '' : `<div class="lab-ver ${venc ? 'ruim' : 'alerta'}"><b>${venc ? `✗ Teste de germinação vencido em ${fmtDate(vl.validade)}: não pode vender` : `⏳ Teste de germinação vence em ${vl.dias} ${vl.dias === 1 ? 'dia' : 'dias'} (${fmtDate(vl.validade)})`}</b><span>${venc ? 'Faça a reanálise da germinação para renovar a validade.' : 'Faça a reanálise antes de vencer para continuar vendendo o lote.'}${labMesesReanalise(p) ? ` A reanálise vale ${labMesesReanalise(p)} meses.` : ''}</span></div>`;
  const conf = labConfere(re ? {...a, germinacao: re.germinacao} : a, p, a.categoriaLote || l.category);
  const info = [a.germinacao !== '' && a.germinacao != null ? `germinação ${num(a.germinacao)}%` : '', a.vigor !== '' && a.vigor != null ? `vigor ${num(a.vigor)}%` : '', a.pureza !== '' && a.pureza != null ? `pureza ${num(a.pureza, 1)}%` : '', a.pms !== '' && a.pms != null ? `PMS ${num(a.pms, 1)} g` : ''].filter(Boolean).join(' • ');
  const grupoNome = g => ((p?.grupos || labGrupoBase()).find(x => x.id === g)?.rot || g).toLowerCase();
  const amostra = a.amostraG ? ` • amostra ${a.amostraCS && labDuasAmostras(p) ? num(a.amostraCS) + ' g / ' : ''}${num(a.amostraG)} g` : '';
  return `<div class="section-title"><h3>Análise de sementes</h3>${botao}</div>
    <section class="card panel lab-lote">${semPadrao}${lote}
      <div class="lab-cab"><div><strong>Boletim${a.boletim ? ' nº ' + esc(a.boletim) : ''}</strong><small>${fmtDate(a.data)}${a.laboratorio ? ' • ' + esc(a.laboratorio) : ''}${amostra}</small></div>
        ${vl ? `<span class="chip ${venc ? 'red' : perto ? 'orange' : 'green'}">${venc ? 'Teste vencido' : 'Válido até'} ${fmtDate(vl.validade)}</span>` : ''}</div>
      ${aviso}
      ${cl ? labTextoVeredito(v, cl, a.categoriaLote || l.category) + labTabela(cl, v?.cat, a.categoriaLote || l.category) : ''}
      ${(a.encontradas || []).filter(x => Number(x.n) > 0).length ? `<p class="nota">Encontradas: ${a.encontradas.filter(x => Number(x.n) > 0).map(x => `${esc(x.nome || 'outra')} ${num(x.n)} (${esc(grupoNome(x.grupo))})`).join(' • ')}</p>` : ''}
      ${info ? `<p class="nota">Boletim: ${esc(info)}</p>` : ''}
      ${re ? `<p class="nota lab-re">Reanálise em ${fmtDate(re.data)}${re.boletim ? ` (boletim ${esc(re.boletim)})` : ''}: germinação ${num(re.germinacao)}%${re.vigor !== '' && re.vigor != null ? ` • vigor ${num(re.vigor)}%` : ''}${re.validade ? ` • válida até ${fmtDate(re.validade)}` : ''} <button type="button" class="link" data-act="lab-reanalise-editar" data-id="${esc(re.id)}">editar</button></p>` : ''}
      ${labTextoConfere(conf, a.categoriaLote || l.category)}
      <div class="btn-row">${venc ? '' : btn(['Básica', 'C1', 'C2'].includes(l.category) ? 'Certificado (PDF)' : 'Termo de conformidade (PDF)', 'lab-termo', l.id) + btn('Enviar', 'lab-termo-enviar', l.id, 'secondary')}${a.germinacao !== '' && a.germinacao != null || re ? btn('+ Reanálise da germinação', 'lab-reanalise', l.id, 'secondary') : ''}${btn('Editar análise', 'lab-editar', a.id, 'secondary')}${btn('Padrões de sementes', 'lab-padroes', '', 'secondary')}</div>${lista.length > 1 ? `<small class="nota">${lista.length - 1} ${lista.length === 2 ? 'análise anterior' : 'análises anteriores'} na linha do tempo</small>` : ''}
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
  'lab-padrao': esp => labEditarPadrao(esp),
  'lab-reanalise': id => labReanalise(id),
  'lab-reanalise-editar': id => { const r = find('analisesSementes', id); if (r) labReanalise(r.lotId, r); },
  'lab-dados-termo': () => labDadosTermo()
});
// Dados do produtor para o termo de conformidade / certificado (Ajustes → Agronomia)
function labDadosTermo(depois) {
  const s = db.settings;
  openForm({title: 'Dados do termo de conformidade', submit: 'Salvar',
    sub: 'Saem no termo de conformidade (S1 e S2) e no certificado (Básica, C1 e C2) dos lotes. Nome, CPF/CNPJ e endereço vêm do cadastro do proprietário.',
    values: {renasemProdutor: s.renasemProdutor || '', respTecnico: s.respTecnico || '', respRegistro: s.respRegistro || '', renasemRT: s.renasemRT || '', certificador: s.certificador || ''},
    fields: [{k: 'renasemProdutor', label: 'RENASEM do produtor', placeholder: 'Ex.: RS-01234/2020', required: true},
      {k: 'respTecnico', label: 'Responsável técnico', required: true}, {k: 'respRegistro', label: 'CREA / CFTA do responsável técnico'},
      {k: 'renasemRT', label: 'RENASEM do responsável técnico', required: true},
      {k: 'certificador', label: 'Certificador (Básica, C1 e C2)', full: true, placeholder: 'Ex.: produção própria — credenciamento RS-00000/2021, ou a entidade certificadora'}],
    onSubmit: v => { Object.assign(db.settings, v); save(); showToast('Dados do termo salvos'); if (depois) setTimeout(depois, 50); }});
}
// Ajustes → Agronomia: atalho para os padrões de sementes
if (typeof tecEmbrulhar === 'function') tecEmbrulhar('cadastros', ajustesSemLab => (...a) => {
  const html = ajustesSemLab(...a), i = html.indexOf('<h3>Agronomia</h3>'); if (i < 0) return html;
  const fim = html.indexOf('</article>', i); if (fim < 0) return html;
  const n = labTodosPadroes().length;
  return html.slice(0, fim) + `<div class="field"><label>Padrões de sementes</label><p class="nota">Limites de outras sementes por categoria (C1, C2, S1, S2) usados na classificação automática das análises de lote: ${n} espécies (grandes culturas, forrageiras e hortaliças).</p><div class="btn-row">${btn('Ver e editar padrões', 'lab-padroes', '', 'secondary')}${btn('Dados do termo de conformidade', 'lab-dados-termo', '', 'secondary')}</div></div>` + html.slice(fim);
});
