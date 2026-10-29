'use strict';
/* MercaPlant — Catálogo de peças do fabricante (PDF), por máquina e implemento, em cada fazenda.
   A fazenda importa o PDF oficial do catálogo de peças da máquina dela; o app lê as peças (código, quantidade,
   descrição, conjunto, número no desenho e página) e liga ao modelo. Depois é só buscar: “rolamento”, “filtro de ar”,
   “correia motor” → código, onde fica e em que página está o desenho.
   O PDF não é guardado (pode ter centenas de MB): só a lista de peças, em partes de até ~45 KB (limite do registro),
   e a imagem de cada desenho explodido (WebP ~100 KB), no mesmo lugar das fotos (aparelho + nuvem privada da fazenda).
   “Ver desenho” abre o desenho do conjunto com o número da peça em destaque e a lista das peças daquele desenho.
   Formatos lidos: Kuhn (Catálogo de peças / Spare parts list, colunas Rep • Nr • Qt • Designação). Outros: a pedido. */

const CTP_COL = 'catalogosPecas';
const ctpGestor = () => typeof mcpGestor !== 'function' || mcpGestor();
const ctpN = s => semAcentoApp(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------- Leitura do PDF ----------------
function ctpCarregarPdfjs() {
  if (window.pdfjsLib?.getDocument) return Promise.resolve(window.pdfjsLib);
  return new Promise((ok, erro) => {
    const s = Object.assign(document.createElement('script'), {src: 'lib/pdfjs/pdf.min.js'});
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdfjs/pdf.worker.min.js'; ok(window.pdfjsLib); };
    s.onerror = () => erro(new Error('pdfjs')); document.head.append(s);
  });
}
// Itens de texto da página → linhas (mesma altura), cada uma com os pedaços em ordem da esquerda para a direita
function ctpLinhas(itens) {
  const ls = [];
  itens.filter(i => i.s && i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x).forEach(i => {
    let l = ls.find(x => Math.abs(x.y - i.y) <= 2.5); if (!l) ls.push(l = {y: i.y, it: []}); l.it.push(i);
  });
  ls.forEach(l => l.it.sort((a, b) => a.x - b.x));
  return ls.sort((a, b) => b.y - a.y);
}
// Formato Kuhn: cabeçalho “Rep Nr Qt Designação Designación Description Désignation Observação…”; título do conjunto logo acima
function ctpKuhnPagina(ls, pag) {
  const h = ls.findIndex(l => l.it.some(i => i.s.trim() === 'Rep') && l.it.some(i => i.s.trim() === 'Nr') && l.it.some(i => /^Qt/.test(i.s.trim())));
  if (h < 0) return null;
  const xDe = re => ls[h].it.find(i => re.test(i.s.trim()))?.x;
  const c = {nr: xDe(/^Nr$/), qt: xDe(/^Qt/), pt: xDe(/^Designa[cç][aã]o/), es: xDe(/^Designaci[oó]n/), obs: xDe(/^Observa/)};
  if ([c.nr, c.qt, c.pt].some(v => v == null)) return null;
  c.es = c.es ?? c.pt + 150;
  let t = h - 1; while (t >= 0 && !ls[t].it.length) t--;
  const grupo = t >= 0 ? ls[t].it[0].s.trim() : '', grupoEs = t >= 0 ? ls[t].it[1]?.s.trim() || '' : '';
  const cab = ls.slice(0, h).find(l => l.it.some(i => /^-{2,}[A-Z0-9]/.test(i.s.trim())));
  const titulo = cab ? cab.it.filter(i => i.x < cab.it.find(j => /^-{2,}/.test(j.s.trim())).x).map(i => i.s.trim()).join(' ').trim() : '';
  const serie = cab ? cab.it.filter(i => /^-{2,}[A-Z0-9]/.test(i.s.trim())).map(i => i.s.trim().replace(/^-+/, '')).join(' a ') : '';
  const linhas = [];
  // Linha de peça: Rep (3 dígitos), Nr (código), Qt (3 dígitos) e a descrição em português (até a coluna em espanhol)
  ls.slice(h + 1).forEach(l => {
    const it = l.it.filter(i => i.s.trim()), v = i => it[i]?.s.trim() || '';
    const pt = it.filter(i => i.x >= c.pt - 6 && i.x < c.es - 6).map(i => i.s.trim()).join(' ');
    const obs = c.obs != null ? it.filter(i => i.x >= c.obs - 6).map(i => i.s.trim()).join(' ') : '';
    if (/^\d{3}$/.test(v(0)) && /^[A-Z0-9][A-Z0-9.\-]{4,15}$/.test(v(1)) && /^\d{1,3}$/.test(v(2)) && it[2].x < c.pt - 6) linhas.push({rep: v(0), cod: v(1), qt: Number(v(2)) || '', desc: pt || (it.slice(3).find(i => i.x < (c.obs ?? 9999) - 6)?.s.trim() ?? ''), obs, grupo, pag});
    else if (linhas.length && it.length && it[0].x >= c.pt - 6 && l.y > 30) { const u = linhas.at(-1); if (pt) u.desc = `${u.desc} ${pt}`.trim(); if (obs) u.obs = `${u.obs} ${obs}`.trim(); }
  });
  return {grupo, grupoEs, titulo, serie, linhas};
}
// Página do PDF → imagem (WebP, ~1600 px de largura, fundo branco)
async function ctpDesenhoImagem(pg) {
  const v1 = pg.getViewport({scale: 1}), esc_ = Math.min(3, 1600 / Math.max(v1.width, v1.height)), v = pg.getViewport({scale: esc_});
  const c = document.createElement('canvas'); c.width = Math.round(v.width); c.height = Math.round(v.height);
  const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
  await pg.render({canvasContext: cx, viewport: v}).promise;
  const r = typeof codificarFoto === 'function' ? await codificarFoto(c, [0.8, 0.72, 0.64], 220 * 1024) : {blob: await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.8)), tipo: 'image/jpeg', ext: 'jpg'};
  c.width = c.height = 0; return r;
}
async function ctpLerPdf(arquivo, progresso, comDesenhos = true) {
  const pdfjs = await ctpCarregarPdfjs();
  const doc = await pdfjs.getDocument({data: new Uint8Array(await arquivo.arrayBuffer()), disableFontFace: true, isEvalSupported: false, useSystemFonts: false}).promise;
  const meta = (await doc.getMetadata().catch(() => null))?.info || {};
  const r = {fabricante: /kuhn/i.test(`${meta.Title} ${meta.Author}`) ? 'Kuhn' : '', titulo: '', serie: '', docId: '', paginas: doc.numPages, grupos: [], itens: []};
  let ultimoDesenho = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n), tc = await pg.getTextContent();
    const itens = tc.items.map(i => ({s: i.str, x: i.transform[4], y: i.transform[5]}));
    const ls = ctpLinhas(itens), k = ctpKuhnPagina(ls, n);
    if (n <= 2 && !r.docId) r.docId = (itens.map(i => i.s).join(' ').match(/\b([A-Z]{2}\d{3}[A-Z]{2,4}_\d{2})\b/) || [])[1] || '';
    if (!r.fabricante && /KUHN/.test(itens.map(i => i.s).join(' '))) r.fabricante = 'Kuhn';
    if (!k) { if (itens.filter(i => i.s.trim()).length <= 60) ultimoDesenho = n; }
    else {
      r.titulo = r.titulo || k.titulo; r.serie = r.serie || k.serie;
      let gi = r.grupos.findIndex(g => g[0] === k.grupo && g[1] === (ultimoDesenho || n));
      if (gi < 0 && k.linhas.length) { r.grupos.push([k.grupo, ultimoDesenho || n, 0, n, k.grupoEs]); gi = r.grupos.length - 1; }
      k.linhas.forEach(x => { r.itens.push([x.cod, x.qt, x.desc, gi, x.rep, x.pag, x.obs || '']); r.grupos[gi][2]++; });
    }
    pg.cleanup?.();
    if (progresso && (n % 5 === 0 || n === doc.numPages)) { progresso('pecas', n, doc.numPages, r.itens.length); await new Promise(res => setTimeout(res, 0)); }
  }
  // Desenhos: só as páginas de desenho que têm lista de peças (a que vem antes da lista)
  r.desenhos = [];
  if (comDesenhos && r.itens.length) {
    const pags = [...new Set(r.grupos.filter(g => g[1] && g[1] !== g[3]).map(g => g[1]))];
    for (let k = 0; k < pags.length; k++) {
      try { const pg = await doc.getPage(pags[k]), img = await ctpDesenhoImagem(pg); pg.cleanup?.(); r.desenhos.push({pag: pags[k], ...img}); } catch (e) { console.warn('desenho', pags[k], e); }
      if (progresso) { progresso('desenhos', k + 1, pags.length, r.itens.length); await new Promise(res => setTimeout(res, 0)); }
    }
  }
  await doc.destroy();
  return r;
}

// ---------------- Dados ----------------
// Nome do conjunto em espanhol só quando explica algo que o português não diz (ex.: “Abridor de linha” = protección de rueda)
function ctpAlt(pt, es) {
  if (!es) return '';
  const a = ctpN(pt).split(' ').filter(w => w.length >= 4), b = ctpN(es).split(' ').filter(w => w.length >= 4);
  return b.some(w => a.some(x => x.slice(0, 4) === w.slice(0, 4))) ? '' : es.toLowerCase();
}
const ctpNomeGrupo = g => g ? `${g[0]}${g[3] ? ` (${g[3]})` : ''}` : '';
const ctpCabs = () => db[CTP_COL].filter(r => r.tipo === 'cab');
const ctpServe = (c, m) => !!m && ((c.aplica?.maquinas || []).includes(m.id) || (!!m.model && (c.aplica?.modelos || []).includes(pcNorm(m.model))));
const ctpDaMaquina = m => ctpCabs().filter(c => ctpServe(c, m));
const ctpCache = new Map();
function ctpItens(c) {
  const partes = db[CTP_COL].filter(r => r.tipo === 'parte' && r.cab === c.id).sort((a, b) => a.k - b.k), chave = partes.map(p => p.id + (p._mod || '')).join();
  const ja = ctpCache.get(c.id); if (ja && ja.chave === chave) return ja.itens;
  const itens = partes.flatMap(p => p.itens || []).map((x, i) => ({i, cod: x[0], qt: x[1], desc: x[2], grupo: ctpNomeGrupo(c.grupos?.[x[3]]), gi: x[3], rep: x[4], pag: x[5], obs: x[6] || '', desenho: c.grupos?.[x[3]]?.[1] || ''}));
  itens.forEach(x => { x.txt = ctpN(`${x.cod} ${x.desc} ${x.grupo} ${x.obs}`); x.codN = pcNorm(x.cod); });
  ctpCache.set(c.id, {chave, itens}); return itens;
}
function ctpGravar(r, aplica, arquivo) {
  const id = uid(), partes = []; let atual = [], tam = 0;
  r.itens.forEach(x => { const t = JSON.stringify(x).length + 1; if (tam + t > 45000 && atual.length) { partes.push(atual); atual = []; tam = 0; } atual.push(x); tam += t; });
  if (atual.length) partes.push(atual);
  const cab = {id, tipo: 'cab', fabricante: r.fabricante, titulo: r.titulo || arquivo.replace(/\.pdf$/i, ''), serie: r.serie, docId: r.docId, arquivo, paginas: r.paginas,
    grupos: r.grupos.map(g => [g[0], g[1], g[2], ctpAlt(g[0], g[4])]), total: r.itens.length, codigos: new Set(r.itens.map(x => x[0])).size, partes: partes.length, aplica, importadoEm: new Date().toISOString()};
  // Desenhos: guardados como fotos do registro do catálogo (aparelho + nuvem da fazenda, enviados em segundo plano)
  cab.fotos = (r.desenhos || []).map(d => ({id: `${id}d${d.pag}`, ext: d.ext, pag: d.pag}));
  if (typeof guardarFotoLocal === 'function') (r.desenhos || []).forEach(d => guardarFotoLocal({id: `${id}d${d.pag}`, colecao: CTP_COL, recordId: id, ext: d.ext, tipo: d.tipo, blob: d.blob, fazendaId: typeof nv === 'object' ? nv?.fazenda?.id : undefined, criadaEm: Date.now(), usadaEm: Date.now()}).catch(() => {}));
  db[CTP_COL].push(cab, ...partes.map((itens, k) => ({id: `${id}-${k}`, tipo: 'parte', cab: id, k, itens})));
  save(); if (typeof enviarFotosPendentes === 'function') setTimeout(enviarFotosPendentes, 1500);
  return cab;
}

// ---------------- Na tela de peças da máquina ----------------
const ctpEstado = {}; // por máquina: {busca, grupo}
// Peças do catálogo que têm todas as palavras (ou o código); código exato primeiro
function ctpAchar(cabs, busca) {
  const termos = ctpN(busca || '').split(' ').filter(Boolean); if (!termos.length) return [];
  const exato = pcNorm(busca || ''), achou = cabs.flatMap(c => ctpItens(c).filter(x => termos.every(t => x.txt.includes(t) || (t.length >= 4 && x.codN.includes(t)))).map(x => ({...x, c})));
  return achou.sort((a, b) => (b.codN === exato) - (a.codN === exato));
}
const ctpMaquinasDo = c => db.machines.filter(m => ctpServe(c, m));
function ctpLinha(x, comMaquina) {
  return `<div class="ctp-it"><span class="ctp-rep" title="Número no desenho">${esc(x.rep || '')}</span><div><strong><span class="pc-cod">${esc(x.cod)}</span> ${esc(x.desc)}</strong><small>${esc([comMaquina ? ctpMaquinasDo(x.c).map(m => m.name).join(', ') || x.c.titulo : '', comMaquina ? x.grupo : '', x.qt ? `qtd ${x.qt}` : '', x.obs].filter(Boolean).join(' • '))}</small></div>
    <div class="row-actions">${x.desenho ? mini('📐 Desenho', 'ctp-desenho', `${x.c.id}|${x.i}`) : ''}${mini('Copiar', 'ctp-copiar', x.cod)}${ctpGestor() ? mini('🛒 Pedir', 'ctp-pedir', `${x.c.id}|${x.i}`) : ''}</div></div>`;
}
// Miniatura do desenho do conjunto (carrega depois de mostrar a tela)
const ctpTemDesenho = (c, pag) => (c.fotos || []).some(f => f.pag === pag);
const ctpMiniDesenho = (c, pag, i) => ctpTemDesenho(c, pag) ? `<button class="ctp-thumb" data-act="ctp-desenho" data-id="${esc(c.id)}|${i}" aria-label="Ver o desenho"><img data-ctp-img="${esc(c.id)}|${pag}" alt=""></button>` : '';
function ctpCarregarImgs(raiz = document) {
  if (typeof urlDaFoto !== 'function') return;
  $$('img[data-ctp-img]:not([src])', raiz).forEach(img => { const [cid, pag] = img.dataset.ctpImg.split('|');
    urlDaFoto(CTP_COL, cid, `${cid}d${pag}`, true).then(u => { if (u) img.src = u; else img.closest('.ctp-thumb')?.classList.add('sem'); }); });
}
function ctpListaAchados(achou, mais, chave, comMaquina) {
  const lim = mais ? 400 : 60, vis = achou.slice(0, lim), blocos = new Map();
  vis.forEach(x => { const k = x.c.id + '|' + x.gi; if (!blocos.has(k)) blocos.set(k, []); blocos.get(k).push(x); });
  const bloco = ls => { const x = ls[0], maq = comMaquina ? ctpMaquinasDo(x.c).map(m => m.name).join(', ') || x.c.titulo : '';
    return `<div class="ctp-bloco"><div class="ctp-bloco-cab">${ctpMiniDesenho(x.c, x.desenho, x.i)}<div><strong>${esc(x.grupo)}</strong><small>${esc([maq, x.desenho ? `desenho na pág. ${x.desenho}` : ''].filter(Boolean).join(' • '))}</small></div></div>${ls.map(y => ctpLinha(y, false)).join('')}</div>`; };
  return `<p class="nota ctp-cont">${achou.length} ${achou.length === 1 ? 'peça encontrada' : 'peças encontradas'} em ${blocos.size} ${blocos.size === 1 ? 'conjunto' : 'conjuntos'}${achou.length > lim ? ` — mostrando ${lim}` : ''}</p>${[...blocos.values()].map(bloco).join('') || '<p class="viz-vazio">Nada com essas palavras. Tente só uma (ex.: “rolamento”) ou o código.</p>'}${achou.length > lim ? `<button class="secondary" data-act="ctp-mais" data-id="${esc(chave)}">Mostrar mais</button>` : ''}`;
}
function ctpResultados(m) {
  const st = ctpEstado[m.id] || {}, cabs = ctpDaMaquina(m); if (!cabs.length) return '';
  const linha = x => ctpLinha(x, false);
  if (ctpN(st.busca || '')) return ctpListaAchados(ctpAchar(cabs, st.busca), st.mais, m.id, false);
  if (st.grupo != null) {
    const [ci, gi] = String(st.grupo).split(':').map(Number), c = cabs[ci], g = c?.grupos?.[gi];
    const doG = c && g ? ctpItens(c).filter(x => x.gi === gi) : [];
    if (c && g) return `<div class="ctp-voltar"><button class="link" data-act="ctp-grupo" data-id="${esc(m.id)}|">← Conjuntos</button><strong>${esc(ctpNomeGrupo(g))}</strong><small>desenho na pág. ${g[1]} do PDF</small></div>${ctpTemDesenho(c, g[1]) && doG[0] ? `<button class="ctp-desenho-in" data-act="ctp-desenho" data-id="${esc(c.id)}|${doG[0].i}"><img data-ctp-img="${esc(c.id)}|${g[1]}" alt="Desenho do conjunto ${esc(g[0])}"><span>Toque para ampliar</span></button>` : ''}${doG.map(x => linha({...x, c})).join('')}`;
  }
  return `<div class="ctp-grupos">${cabs.map((c, ci) => (c.grupos || []).map((g, gi) => `<button class="ctp-g" data-act="ctp-grupo" data-id="${esc(m.id)}|${ci}:${gi}"><span>${esc(ctpNomeGrupo(g))}</span><small>${g[2]} ${g[2] === 1 ? 'peça' : 'peças'} • pág. ${g[1]}</small></button>`).join('')).join('')}</div>`;
}
function ctpSecao(m) {
  const cabs = ctpDaMaquina(m), g = ctpGestor();
  if (!cabs.length) return `<section class="card panel ctp-vazio"><div><strong>📘 Catálogo de peças do fabricante</strong><small>Importe o PDF oficial do catálogo de peças desta ${m.type === 'Implemento' ? 'implemento' : 'máquina'} para achar qualquer peça pelo nome e ver o código, onde fica e a página do desenho.</small></div>${g ? btn('Importar catálogo (PDF)', 'nav', 'importarcatalogo/' + m.id) : ''}</section>`;
  const st = ctpEstado[m.id] || {};
  return `<section class="card panel ctp" data-ctp="${esc(m.id)}"><header class="ctp-cab"><div><h3>📘 ${cabs.map(c => esc([c.fabricante, c.titulo].filter(Boolean).join(' '))).join(' + ')}</h3><small>${cabs.map(c => `${num(c.total)} peças • ${(c.grupos || []).length} conjuntos${c.serie ? ` • série ${esc(c.serie)}` : ''} • ${esc(c.arquivo)}`).join(' | ')}</small></div>
      ${g ? `<details class="menu-mais"><summary aria-label="Mais ações" title="Mais ações">⋯</summary><div class="menu-lista">${mini('Importar outro catálogo', 'nav', 'importarcatalogo/' + m.id)}${cabs.map(c => mini(`Tirar ${c.titulo}`, 'ctp-del', c.id, 'del')).join('')}</div></details>` : ''}</header>
    <div class="catm-busca"><input type="search" data-ctp-busca="${esc(m.id)}" value="${esc(st.busca || '')}" placeholder="Buscar peça: rolamento, filtro de ar, correia… ou o código" aria-label="Buscar no catálogo do fabricante" autocomplete="off" enterkeyhint="search"></div>
    <div class="ctp-res" id="ctpRes">${ctpResultados(m)}</div></section>`;
}
document.addEventListener('input', e => {
  const mid = e.target?.dataset?.ctpBusca; if (!mid) return;
  ctpEstado[mid] = {...(ctpEstado[mid] || {}), busca: e.target.value, mais: false};
  clearTimeout(ctpEstado[mid].t); ctpEstado[mid].t = setTimeout(ctpAtualizar.bind(null, mid), 150);
});
function ctpAtualizar(mid) {
  if (mid === '*') { const el = $('#ctpResG'); if (el) { el.innerHTML = ctpResultadosGeral(); ctpCarregarImgs(el); } return; }
  const m = find('machines', mid), el = $('#ctpRes'); if (m && el) { el.innerHTML = ctpResultados(m); ctpCarregarImgs(el); }
}
// Busca em todos os catálogos da fazenda (aba Peças e pesquisa geral)
function ctpResultadosGeral() {
  const st = ctpEstado['*'] || {}; if (!ctpN(st.busca || '')) return '';
  return ctpListaAchados(ctpAchar(ctpCabs(), st.busca), st.mais, '*', true);
}
// Peça do catálogo → peça da fazenda (para pedir, ligar ao estoque e ao fornecedor)
function ctpParaPeca(c, x) {
  const ja = db.pecas.find(p => pcNorm(p.codigo) === pcNorm(x.cod) && pcNorm(p.nome) === pcNorm(x.desc));
  if (ja) return ja;
  const p = {id: uid(), codigo: x.cod, nome: x.desc, marca: c.fabricante || '', sistema: pcSistemaPeloNome(`${x.desc} ${x.grupo}`), equivalentes: [], aplica: JSON.parse(JSON.stringify(c.aplica || {modelos: [], maquinas: []})),
    qtd: Number(x.qt) || '', trocaCada: '', trocaUnid: 'h', itemId: '', fornecedores: [], obs: x.obs || '', origem: {cab: c.id, titulo: [c.fabricante, c.titulo].filter(Boolean).join(' '), grupo: x.grupo, rep: x.rep, pag: x.desenho || x.pag}, criadoEm: new Date().toISOString()};
  if (db.pecas.some(q => pcNorm(q.codigo) === pcNorm(x.cod))) p.codigoRepetido = true;
  upsert('pecas', p); return p;
}
Object.assign(ACTIONS, {
  'ctp-grupo': id => { const [mid, g] = String(id).split('|'); ctpEstado[mid] = {...(ctpEstado[mid] || {}), grupo: g === '' ? null : g, busca: ''}; render(); },
  'ctp-mais': mid => { ctpEstado[mid] = {...(ctpEstado[mid] || {}), mais: true}; ctpAtualizar(mid); },
  'ctp-abrir': id => { const [mid, ...q] = String(id).split('|'); ctpEstado[mid] = {busca: q.join('|')}; go('pecas/' + mid); },
  'ctp-copiar': cod => { (navigator.clipboard?.writeText(cod) || Promise.reject()).then(() => showToast(`Código ${cod} copiado`), () => showToast(`Código: ${cod}`)); },
  'ctp-pedir': id => {
    if (!ctpGestor()) return;
    const [cid, i] = String(id).split('|'), c = db[CTP_COL].find(r => r.id === cid), x = c && ctpItens(c)[Number(i)]; if (!x) return;
    const p = ctpParaPeca(c, x); pcPedir(p.id, Number(x.qt) > 0 ? Number(x.qt) : 1);
    const n = pcPedido().length; showToast(`${x.cod} no pedido (${n} ${n === 1 ? 'peça' : 'peças'}) — veja em 🛒 Pedido`);
  },
  'ctp-del': id => {
    const c = db[CTP_COL].find(r => r.id === id); if (!c || !ctpGestor()) return;
    confirmDialog(`Tirar o catálogo ${c.titulo} (${num(c.total)} peças)? As peças que você já salvou na fazenda continuam.`, () => { db[CTP_COL].filter(r => r.id === id || r.cab === id).forEach(r => remove(CTP_COL, r.id)); ctpCache.delete(id); showToast('Catálogo retirado'); }, 'Tirar');
  }
});

// ---------------- Importar ----------------
let ctpi = null; // {maqId, arquivo, r, lendo}
VIEWS.importarcatalogo = mid => {
  const m = find('machines', mid);
  if (!m) return empty('Máquina não encontrada', '');
  const volta = btn('← Peças', 'nav', 'pecas/' + m.id, 'secondary');
  if (!ctpGestor()) return head('Importar catálogo', 'Só para o ADM e o supervisor.', volta) + `<section class="card">${empty('Sem acesso', 'Seu nível de acesso é Usuário comum.')}</section>`;
  const topo = head(`Importar catálogo de peças — ${m.name}`, [m.type === 'Implemento' ? m.tipoImpl : m.type, m.model].filter(Boolean).join(' • '), volta);
  if (!ctpi || ctpi.maqId !== m.id) ctpi = {maqId: m.id};
  if (ctpi.lendo) return topo + `<section class="card panel ctp-lendo"><strong>Lendo ${esc(ctpi.arquivo)}…</strong><div class="progress"><span id="ctpBarra" style="width:${ctpi.pct || 0}%"></span></div><small id="ctpProg">${esc(ctpi.txt || 'Abrindo o arquivo')}</small><p class="nota">Catálogo grande demora um pouco (um de 400 páginas leva cerca de 1 minuto). Não feche esta tela.</p></section>`;
  if (!ctpi.r) return topo + `<section class="card panel tmi-escolher"><label class="tmi-arquivo"><input type="file" data-ctp-arquivo accept="application/pdf,.pdf"><span class="primary">Escolher o PDF do catálogo</span></label>
      <p class="nota">Use o catálogo oficial de peças do fabricante (o PDF que a concessionária ou o site da marca fornece). O app guarda a lista de peças e a imagem dos desenhos — o PDF continua com você.</p>
      <label class="tmi-area"><input type="checkbox" data-ctp-com-desenhos ${ctpi.semDesenhos ? '' : 'checked'}> Guardar os desenhos (recomendado: mostra onde fica cada peça; ocupa cerca de 20 MB na nuvem da fazenda e leva 1 a 2 minutos a mais)</label>
      <p class="nota">Formatos que o app já lê: <b>Kuhn</b>. Se o seu catálogo for de outra marca e o app não reconhecer, mande o PDF para incluirmos.</p>${pcBotaoFabricante(m) ? `<div class="btn-row">${pcBotaoFabricante(m)}</div>` : ''}</section>`;
  const r = ctpi.r, sel = ctpi.marcados || ['maq:' + m.id];
  // Vale para a máquina escolhida; outras máquinas iguais (mesmo modelo) podem ser marcadas junto
  const ativas = db.machines.filter(x => !isInactive(x) && x.id !== m.id).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR', {numeric: true}));
  const iguais = ativas.filter(x => m.model && pcNorm(x.model) === pcNorm(m.model)), outras = ativas.filter(x => !iguais.includes(x));
  const caixa = (x, extra) => `<label class="pce-mod"><input type="checkbox" data-ctp-mod value="maq:${esc(x.id)}" ${sel.includes('maq:' + x.id) ? 'checked' : ''}><span><b>${esc(x.name)}</b><small>${esc([x.type === 'Implemento' ? x.tipoImpl : x.type, x.model, extra].filter(Boolean).join(' • '))}</small></span></label>`;
  const casa = ctpN(r.titulo).split(' ').filter(t => t.length > 2).some(t => ctpN(`${m.model} ${m.name}`).includes(t));
  return topo + `<section class="card panel"><h3 class="pce-tit">📘 ${esc([r.fabricante, r.titulo].filter(Boolean).join(' ') || ctpi.arquivo)}</h3>
      <div class="ctn-num"><div><span>Peças</span><b>${num(r.itens.length)}</b></div><div><span>Códigos</span><b>${num(new Set(r.itens.map(x => x[0])).size)}</b></div><div><span>Conjuntos</span><b>${r.grupos.length}</b></div><div><span>Páginas</span><b>${r.paginas}</b></div></div>
      ${r.serie ? `<p class="nota">Números de série: ${esc(r.serie)}${r.docId ? ` • catálogo ${esc(r.docId)}` : ''}</p>` : ''}
      ${!casa && r.titulo ? `<p class="pc-aviso">⚠ O catálogo é do <b>${esc(r.titulo)}</b> e esta máquina está cadastrada como <b>${esc(m.model || m.name)}</b>. Confira se é o catálogo certo.</p>` : ''}
      <p class="nota">Primeiros conjuntos: ${esc(r.grupos.slice(0, 8).map(g => g[0]).join(', '))}${r.grupos.length > 8 ? '…' : ''}</p>
      <p class="nota">${r.desenhos?.length ? `🖼 ${r.desenhos.length} desenhos guardados (${num(r.desenhos.reduce((t, d) => t + d.blob.size, 0) / 1048576, 1)} MB)` : 'Sem desenhos (só a lista de peças)'}</p></section>
    <section class="card panel"><h3 class="pce-tit">Vinculado a</h3><p class="nota">O catálogo fica nesta máquina. Se a fazenda tiver outra igual, marque também.</p>
      <div class="pce-mods">${caixa(m, 'esta máquina')}${iguais.map(x => caixa(x, 'mesmo modelo')).join('')}</div>
      ${outras.length ? `<details class="ctp-outras"><summary>Outras máquinas e implementos (${outras.length})</summary><div class="pce-mods">${outras.map(x => caixa(x)).join('')}</div></details>` : ''}
      <div class="actions"><button class="secondary" data-act="ctp-outro">Escolher outro PDF</button><button class="primary" data-act="ctp-salvar">Salvar catálogo</button></div></section>`;
};
TITLES.importarcatalogo = 'Máquinas e manutenção';
document.addEventListener('change', async e => {
  const t = e.target;
  if (t?.matches?.('[data-ctp-mod]')) { ctpi.marcados = $$('[data-ctp-mod]:checked').map(c => c.value); return; }
  if (t?.matches?.('[data-ctp-com-desenhos]')) { if (ctpi) ctpi.semDesenhos = !t.checked; return; }
  if (!t?.matches?.('[data-ctp-arquivo]')) return;
  const a = t.files?.[0]; if (!a || !ctpi) return;
  Object.assign(ctpi, {arquivo: a.name, lendo: true, pct: 0, txt: 'Abrindo o arquivo'}); render();
  try {
    const r = await ctpLerPdf(a, (fase, n, total, pecas) => {
      ctpi.pct = fase === 'pecas' ? Math.round(n / total * 70) : 70 + Math.round(n / total * 30);
      ctpi.txt = fase === 'pecas' ? `Página ${n} de ${total} • ${num(pecas)} peças` : `Guardando os desenhos: ${n} de ${total}`;
      const b = $('#ctpBarra'), p = $('#ctpProg'); if (b) b.style.width = ctpi.pct + '%'; if (p) p.textContent = ctpi.txt; }, !ctpi.semDesenhos);
    ctpi.lendo = false;
    if (!r.itens.length) { ctpi.r = null; render(); showToast('Não reconheci as peças deste PDF. Hoje o app lê catálogos Kuhn; mande o arquivo para incluirmos a marca.', true); return; }
    ctpi.r = r; render();
  } catch (err) { console.warn(err); ctpi.lendo = false; ctpi.r = null; render(); showToast('Não consegui abrir o PDF neste aparelho. Tente pelo computador.', true); }
});
Object.assign(ACTIONS, {
  'ctp-outro': () => { if (ctpi) { ctpi.r = null; ctpi.marcados = null; } render(); },
  'ctp-salvar': () => {
    if (!ctpi?.r || !ctpGestor()) return;
    const m = find('machines', ctpi.maqId), marc = ctpi.marcados || ['maq:' + m.id];
    if (!marc.length) { showToast('Marque pelo menos uma máquina', true); return; }
    const aplica = {modelos: marc.filter(v => v.startsWith('mod:')).map(v => v.slice(4)), maquinas: marc.filter(v => v.startsWith('maq:')).map(v => v.slice(4))};
    const c = ctpGravar(ctpi.r, aplica, ctpi.arquivo); ctpi = null;
    showToast(`Catálogo ${c.titulo} salvo: ${num(c.total)} peças`); go('pecas/' + m.id);
  }
});

// Aba Peças: catálogos importados e o atalho para importar o de uma máquina
function ctpLista() {
  const cabs = ctpCabs(), g = ctpGestor();
  const linhas = cabs.map(c => { const ms = db.machines.filter(m => ctpServe(c, m));
    return `<div class="list-row"><div><strong>📘 ${esc([c.fabricante, c.titulo].filter(Boolean).join(' '))}</strong><small>${esc([ms.map(m => m.name).join(', ') || 'sem máquina vinculada', `${num(c.total)} peças`].join(' • '))}</small></div><div class="row-actions">${ms[0] ? mini('Abrir', 'nav', 'pecas/' + ms[0].id) : ''}</div></div>`; }).join('');
  return `<section class="card panel ctp-lista"><div class="ctp-cab"><div><h3>📘 Catálogos dos fabricantes</h3><small>O PDF oficial de peças de cada máquina: busque a peça pelo nome e veja o código e o desenho.</small></div>${g ? btn('Importar catálogo (PDF)', 'ctp-escolher') : ''}</div>
    ${cabs.length ? `<div class="catm-busca"><input type="search" data-ctp-busca="*" value="${esc(ctpEstado['*']?.busca || '')}" placeholder="Buscar peça em todos os catálogos: rolamento, filtro de ar… ou o código" aria-label="Buscar peça em todos os catálogos" autocomplete="off" enterkeyhint="search"></div><div class="ctp-res" id="ctpResG">${ctpResultadosGeral()}</div>` : ''}
    ${linhas ? `<details class="ctp-cats" ${cabs.length <= 3 ? 'open' : ''}><summary>Catálogos importados (${cabs.length})</summary><div class="list">${linhas}</div></details>` : '<p class="nota" style="margin:0">Nenhum catálogo importado ainda. Toque em “Importar catálogo (PDF)” e escolha a máquina.</p>'}</section>`;
}
ACTIONS['ctp-escolher'] = () => {
  if (!ctpGestor()) return;
  const ord = typeof grupoDoTipoMaq === 'function' ? GRUPOS_TIPO_MAQ.map(([gr]) => gr) : [];
  const ops = db.machines.filter(m => !isInactive(m)).map(m => ({value: m.id, label: `${m.name}${m.model ? ' — ' + m.model : ''}`, grupo: m.type === 'Implemento' ? 'Implementos' : (typeof grupoDoTipoMaq === 'function' ? grupoDoTipoMaq(m.type) : 'Máquinas')}))
    .sort((a, b) => ((ord.indexOf(a.grupo) + 1 || 99) - (ord.indexOf(b.grupo) + 1 || 99)) || a.label.localeCompare(b.label, 'pt-BR', {numeric: true}));
  if (!ops.length) { showToast('Cadastre a máquina primeiro', true); return; }
  openForm({title: 'Importar catálogo de peças', sub: 'Escolha a máquina ou o implemento do catálogo. Depois você escolhe o PDF.', submit: 'Continuar',
    fields: [{k: 'maq', label: 'Máquina ou implemento', type: 'select', options: ops, required: true, full: true}],
    onSubmit: v => { setTimeout(() => go('importarcatalogo/' + v.maq), 0); }});
};

// Peças da máquina: o catálogo do fabricante vem primeiro
{
  const pecasSemCatalogo = VIEWS.pecas;
  VIEWS.pecas = arg => {
    const html = pecasSemCatalogo(arg), m = arg ? find('machines', arg) : null;
    const i = html.indexOf('</section>', html.indexOf('class="view-head"')) + '</section>'.length;
    if (!m) return html.slice(0, i) + ctpLista() + html.slice(i);
    return html.slice(0, i) + ctpSecao(m) + `<div class="section-title"><h3>Peças da fazenda</h3><small class="nota">cadastradas, importadas de planilha ou salvas do catálogo</small></div>` + html.slice(i);
  };
}
if (typeof NV_ROTA_TELA === 'object') NV_ROTA_TELA.importarcatalogo = 'maquinas';

// Pesquisa geral do sistema: peças dos catálogos e do cadastro de peças
{
  const buscaSemPecas = VIEWS.busca;
  VIEWS.busca = q => {
    let html = buscaSemPecas(q); const termo = decodeURIComponent(q || '').trim(); if (ctpN(termo).length < 3) return html;
    const doCat = ctpAchar(ctpCabs(), termo).slice(0, 30);
    const cad = db.pecas.filter(p => ctpN(`${p.codigo} ${p.nome} ${p.marca} ${(p.equivalentes || []).map(e => e.codigo).join(' ')}`).includes(ctpN(termo)) || pcNorm(p.codigo) === pcNorm(termo)).slice(0, 30);
    if (!doCat.length && !cad.length) return html;
    const linhaCat = x => { const m = ctpMaquinasDo(x.c)[0]; return `<div class="row clickable" data-act="${m ? 'ctp-abrir' : 'nav'}" data-id="${esc(m ? `${m.id}|${termo}` : 'pecas')}" style="cursor:pointer"><span class="status blue"></span><div><strong><span class="pc-cod">${esc(x.cod)}</span> ${esc(x.desc)}</strong><small>${esc([ctpMaquinasDo(x.c).map(y => y.name).join(', '), x.grupo, x.desenho ? `desenho pág. ${x.desenho}` : ''].filter(Boolean).join(' • '))}</small></div></div>`; };
    const linhaCad = p => `<div class="row clickable" data-act="nav" data-id="${esc(pcGestor() ? 'peca/' + p.id : 'pecas')}" style="cursor:pointer"><span class="status blue"></span><div><strong><span class="pc-cod">${esc(p.codigo || 's/ código')}</span> ${esc(p.nome)}</strong><small>${esc(pcAplicaTexto(p).join(', ') || p.marca || '')}</small></div></div>`;
    const bloco = `<div class="section-title"><h3>Peças (${doCat.length + cad.length})</h3></div><section class="card list">${doCat.map(linhaCat).join('')}${cad.map(linhaCad).join('')}</section>`;
    html = html.replace(`<section class="card">${empty('Nada encontrado', 'Tente outro termo.')}</section>`, '');
    const i = html.indexOf('</section>', html.indexOf('class="view-head"')) + '</section>'.length;
    return html.slice(0, i) + bloco + html.slice(i);
  };
}

// ---------------- Ver o desenho ----------------
// Tela cheia com o desenho do conjunto, o número da peça em destaque e a lista das peças daquele desenho
async function ctpVerDesenho(cid, idx) {
  const c = db[CTP_COL].find(r => r.id === cid), itens = c ? ctpItens(c) : [], x = itens[Number(idx)]; if (!x) return;
  const doG = itens.filter(y => y.gi === x.gi);
  const tela = Object.assign(document.createElement('div'), {className: 'ctp-tela'});
  const aviso = y => `<b>Procure o nº ${esc(String(Number(y.rep) || y.rep))}</b> — ${esc(y.desc)}${y.qt ? ` (${y.qt} un)` : ''} <span class="pc-cod">${esc(y.cod)}</span>`;
  tela.innerHTML = `<header><div><strong>${esc(x.grupo)}</strong><small>${esc([c.fabricante, c.titulo].filter(Boolean).join(' '))} • desenho na pág. ${x.desenho} do PDF</small></div>
      <div class="ctp-tela-bts"><button class="secondary" data-z="-1" aria-label="Diminuir">−</button><button class="secondary" data-z="1" aria-label="Aumentar">+</button><button class="secondary" data-fechar>Fechar</button></div></header>
    <div class="ctp-aviso" data-aviso>${aviso(x)}</div>
    <div class="ctp-img"><div class="ctp-carregando">Carregando o desenho…</div><img alt="Desenho do conjunto ${esc(x.grupo)}" hidden></div>
    <div class="ctp-tela-lista">${doG.map(y => `<button class="ctp-tela-it ${y.i === x.i ? 'on' : ''}" data-i="${y.i}"><span class="ctp-rep">${esc(y.rep)}</span><span><b>${esc(y.desc)}</b><small><span class="pc-cod">${esc(y.cod)}</span>${y.qt ? ` • qtd ${y.qt}` : ''}</small></span></button>`).join('')}</div>`;
  document.body.append(tela);
  $('.ctp-tela-it.on', tela)?.scrollIntoView({block: 'center'});
  const fechar = () => { tela.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = e => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', tecla);
  $('[data-fechar]', tela).onclick = fechar;
  const img = $('img', tela), area = $('.ctp-img', tela); let zoom = 1;
  const aplicar = () => { img.style.width = (zoom * 100) + '%'; };
  $$('[data-z]', tela).forEach(b => b.onclick = () => { zoom = Math.max(1, Math.min(5, zoom * (b.dataset.z === '1' ? 1.5 : 1 / 1.5))); aplicar(); });
  area.addEventListener('wheel', e => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoom = Math.max(1, Math.min(5, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); aplicar(); }, {passive: false});
  img.ondblclick = () => { zoom = zoom > 1 ? 1 : 2.5; aplicar(); };
  $$('.ctp-tela-it', tela).forEach(b => b.onclick = () => { $$('.ctp-tela-it', tela).forEach(o => o.classList.toggle('on', o === b)); $('[data-aviso]', tela).innerHTML = aviso(itens[Number(b.dataset.i)]); });
  const u = typeof urlDaFoto === 'function' ? await urlDaFoto(CTP_COL, cid, `${cid}d${x.desenho}`, true).catch(() => null) : null;
  if (u) { img.src = u; img.hidden = false; $('.ctp-carregando', tela)?.remove(); aplicar(); }
  else $('.ctp-carregando', tela).textContent = `Desenho ainda não disponível neste aparelho (sem internet, ou o envio de quem importou ainda não terminou). Veja na pág. ${x.desenho} do PDF.`;
}
ACTIONS['ctp-desenho'] = id => { const [cid, i] = String(id).split('|'); ctpVerDesenho(cid, i); };
// Miniaturas dos desenhos depois que a tela aparece
{ const renderSemCtp = render; render = function (...a) { const r = renderSemCtp.apply(this, a); setTimeout(() => ctpCarregarImgs(view), 0); return r; }; }
