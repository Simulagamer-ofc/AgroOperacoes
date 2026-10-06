'use strict';
/* Catálogo por marca: marcas → tipos → modelos. Une as fichas dos fabricantes e a lista oficial do BNDES/FINAME
   pela marca comercial (dados/marcas.json, gerado por referencias/ferramentas/gerar_dados_app.py). Offline. */

ARQ.marcas = 'dados/marcas.json';
let catTipo = '', catPagina = 24;
const CAT_PASSO = 48;

const iniciais = nome => nome.replace(/[^A-Za-zÀ-ú0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
const relevancia = m => m.f * 5 + m.b; // fichas técnicas pesam mais que itens só identificados
const qtdNoTipo = (m, tipo) => tipo ? (m.t[tipo] || 0) : m.f + m.b;
const rotTipo = (d, id) => (d.tipos.find(t => t[0] === id) || [, 'Outros'])[1];

function cartaoMarca(d, m) {
  const tipos = Object.entries(m.t).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => rotTipo(d, t));
  return `<button class="marca-card" data-act="nav" data-id="catalogo/marca~${esc(m.id)}">
    <span class="marca-ini" aria-hidden="true">${esc(iniciais(m.nome))}</span>
    <span class="marca-txt"><strong>${esc(m.nome)}</strong><small>${[m.f ? `${num(m.f)} ${m.f === 1 ? 'ficha' : 'fichas'}` : '', m.b ? `${num(m.b)} BNDES` : ''].filter(Boolean).join(' • ')}</small>
    <small class="marca-tipos">${esc(tipos.join(' · '))}</small></span></button>`;
}

// No BNDES o nome do produto é genérico ("TRATOR AGRÍCOLA DE RODAS"); o modelo identifica o item
const itemModelo = r => {
  const bn = r.fonte === 'finame' && r.modelo, titulo = bn ? r.modelo : r.nome;
  const sub = bn ? [r.nome, 'FINAME ' + r.codigoFiname] : [r.modelo && r.modelo !== r.nome ? r.modelo : '', r.codigoFiname ? 'FINAME ' + r.codigoFiname : ''];
  return `<button class="cat-item" data-act="nav" data-id="catalogo/${esc(encodeURIComponent(r.id))}" title="${esc([r.nome, r.modelo].filter(Boolean).join(' — '))}">
  <strong>${esc(titulo)}</strong><small>${esc(sub.filter(Boolean).join(' • '))}</small>
  ${r.fonte === 'finame' ? '<span class="cat-tag bndes">BNDES</span>' : `<span class="cat-tag">${r.temFicha ? 'Ficha técnica' : 'Fabricante'}</span>`}</button>`;
};

// Todos os itens de uma marca (fichas + BNDES), já com tipo
async function itensDaMarca(b) {
  const [c, f] = await Promise.all([dados('catalogo'), dados('finame')]);
  const out = [];
  c.modelos.forEach(x => { if (x.b === b) out.push({fonte: 'fabricante', id: x.i, nome: x.n, modelo: x.l || '', tipo: x.t, temFicha: !!x.e}); });
  f.produtos.forEach(p => { if (p[4] === b) out.push({fonte: 'finame', id: 'finame-' + p[1], nome: p[2], modelo: p[3], codigoFiname: p[1], tipo: p[5]}); });
  return out;
}

VIEWS.catalogo = arg => {
  if (arg && arg.startsWith('marca~')) { setTimeout(() => paginaMarca(arg.slice(6)), 0); return '<div class="empty">Carregando…</div>'; }
  if (arg) { setTimeout(() => detalheCatalogo(decodeURIComponent(arg)), 0); return '<div class="empty">Carregando…</div>'; }
  setTimeout(inicioCatalogo, 0);
  return `<div id="catTopo">${head('Catálogo de máquinas e implementos', 'Carregando…')}</div>
    <div class="cat-busca"><span aria-hidden="true">⌕</span><input id="catQ" type="search" value="${esc(catBusca)}" placeholder="Buscar marca, modelo ou código FINAME" aria-label="Buscar no catálogo"></div>
    <div class="filters chips-rolagem" id="catTipos"></div><div id="catCorpo"><div class="empty">Carregando catálogo…</div></div>`;
};
VIEWS.catalogo.after = () => {
  const q = $('#catQ'); if (!q) return;
  let t; q.oninput = () => { clearTimeout(t); t = setTimeout(() => { catBusca = q.value; catPagina = 24; inicioCatalogo(); }, 200); };
};

async function inicioCatalogo() {
  const corpo = $('#catCorpo'); if (!corpo) return;
  let d;
  try { d = await dados('marcas'); } catch { corpo.innerHTML = empty('Catálogo indisponível', 'Não foi possível carregar os dados offline.'); return; }
  if (!corpo.isConnected) return; // o usuário já saiu do catálogo
  const totF = d.marcas.reduce((s, m) => s + m.f, 0), totB = d.marcas.reduce((s, m) => s + m.b, 0);
  $('#catTopo').innerHTML = head('Catálogo de máquinas e implementos', `${num(d.marcas.length)} marcas • ${num(totF)} modelos com ficha técnica • ${num(totB)} produtos da lista oficial BNDES/FINAME • funciona sem internet`);
  const porTipo = Object.fromEntries(d.tipos.map(([id]) => [id, d.marcas.reduce((s, m) => s + (m.t[id] || 0), 0)]));
  $('#catTipos').innerHTML = `<button class="${!catTipo ? 'active' : ''}" data-act="cat-tipo" data-id="">Todos</button>` +
    d.tipos.filter(([id]) => porTipo[id]).map(([id, r]) => `<button class="${catTipo === id ? 'active' : ''}" data-act="cat-tipo" data-id="${id}">${esc(r)}</button>`).join('');
  const termos = semAcento(catBusca).split(/\s+/).filter(Boolean);
  let marcas = d.marcas.filter(m => qtdNoTipo(m, catTipo) > 0);
  if (termos.length) marcas = marcas.filter(m => { const t = semAcento(m.nome + ' ' + m.razoes.join(' ')); return termos.every(x => t.includes(x)); });
  marcas.sort((a, b) => relevancia(b) - relevancia(a) || a.nome.localeCompare(b.nome, 'pt-BR'));
  let html = '';
  if (!termos.length) {
    html += `<div class="section-title"><h3>${catTipo ? esc(rotTipo(d, catTipo)) + ' — ' : ''}Marcas (${num(marcas.length)})</h3><small class="cat-nota">Ordenadas por quantidade de modelos</small></div>
      <section class="marcas-grid">${marcas.slice(0, catPagina).map(m => cartaoMarca(d, m)).join('')}</section>
      ${marcas.length > catPagina ? `<div class="cat-mais"><button class="secondary" data-act="cat-mais">Mostrar mais marcas (${num(marcas.length - catPagina)} restantes)</button></div>` : ''}`;
  } else {
    // Busca: marcas com o nome + modelos que batem, agrupados pela marca
    const res = await buscarModelos(termos, catTipo, 80);
    if (!corpo.isConnected) return;
    html += marcas.length ? `<div class="section-title"><h3>Marcas (${num(marcas.length)})</h3></div><section class="marcas-grid">${marcas.slice(0, 8).map(m => cartaoMarca(d, m)).join('')}</section>` : '';
    const grupos = {};
    res.forEach(r => (grupos[r.b] ||= []).push(r));
    html += `<div class="section-title"><h3>Modelos ${res.length >= 80 ? '(primeiros 80 — refine a busca)' : `(${res.length})`}</h3></div>` +
      (res.length ? Object.entries(grupos).map(([b, rs]) => `<section class="card panel cat-grupo"><div class="cat-grupo-cab"><h4>${esc(d.marcas[b].nome)}</h4><button class="link" data-act="nav" data-id="catalogo/marca~${esc(d.marcas[b].id)}">Ver marca →</button></div><div class="cat-lista">${rs.map(itemModelo).join('')}</div></section>`).join('')
        : `<section class="card">${empty('Nenhum modelo encontrado', 'Tente outro termo, outro tipo ou só o nome da marca.')}</section>`);
  }
  corpo.innerHTML = html;
}

async function buscarModelos(termos, tipo, limite) {
  const [c, f] = await Promise.all([dados('catalogo'), dados('finame')]);
  const out = [];
  for (const x of c.modelos) {
    if (tipo && x.t !== tipo) continue;
    if (termos.every(t => textoModelo(c, x).includes(t))) out.push({fonte: 'fabricante', id: x.i, nome: x.n, modelo: x.l || '', b: x.b, temFicha: !!x.e});
    if (out.length >= limite) return out;
  }
  for (const p of f.produtos) {
    if (tipo && p[5] !== tipo) continue;
    const t = semAcento(`${f.fabricantes[p[0]][1]} ${p[1]} ${p[2]} ${p[3]}`);
    if (termos.every(x => t.includes(x))) out.push({fonte: 'finame', id: 'finame-' + p[1], nome: p[2], modelo: p[3], codigoFiname: p[1], b: p[4]});
    if (out.length >= limite) break;
  }
  return out;
}

async function paginaMarca(id) {
  const rota = location.hash;
  const d = await dados('marcas');
  const b = d.marcas.findIndex(m => m.id === id), m = d.marcas[b];
  if (location.hash !== rota) return;
  if (!m) { view.innerHTML = empty('Marca não encontrada', ''); return; }
  const itens = await itensDaMarca(b);
  if (location.hash !== rota) return; // o usuário já saiu desta tela
  const grupos = d.tipos.map(([t, r]) => [t, r, itens.filter(x => x.tipo === t).sort((a, z) => (a.fonte === 'finame') - (z.fonte === 'finame') || a.nome.localeCompare(z.nome, 'pt-BR'))]).filter(g => g[2].length);
  // Abre só o que é curto; listas longas ficam recolhidas (os botões de tipo levam direto a cada uma)
  const aberto = (l, i) => grupos.length === 1 || (i === 0 && l.length <= 24) || l.length <= 6;
  view.innerHTML = head(m.nome, [m.f ? `${num(m.f)} modelos com ficha técnica do fabricante` : '', m.b ? `${num(m.b)} produtos na lista oficial BNDES/FINAME` : ''].filter(Boolean).join(' • '), btn('← Catálogo', 'nav', 'catalogo', 'secondary')) +
    `<div class="filters chips-rolagem">${grupos.map(([t, r, l]) => `<button data-act="cat-ir" data-id="tipo-${t}">${esc(r)} (${l.length})</button>`).join('')}</div>` +
    grupos.map(([t, r, l], i) => `<details class="card cat-tipo" id="tipo-${t}" ${aberto(l, i) ? 'open' : ''}><summary><strong>${esc(r)}</strong><span>${l.length}</span></summary><div class="cat-lista">${l.map(itemModelo).join('')}</div></details>`).join('') +
    (m.razoes.length ? `<p class="nota">Fabricante na lista do BNDES: ${esc(m.razoes.map(r => r.replace(/\.+$/, '')).join('; '))}. Itens “BNDES” trazem identificação oficial (código FINAME), sem especificações técnicas.${m.f ? ' Itens com “Ficha técnica” vêm do site do fabricante.' : ''}</p>` : '<p class="nota">Itens copiados do site oficial do fabricante.</p>');
}

Object.assign(ACTIONS, {
  'cat-tipo': id => { catTipo = id; catPagina = 24; inicioCatalogo(); },
  'cat-mais': () => { catPagina += CAT_PASSO; inicioCatalogo(); },
  'cat-ir': id => { const el = document.getElementById(id); if (el) { el.open = true; el.scrollIntoView({behavior: 'smooth', block: 'start'}); } }
});
