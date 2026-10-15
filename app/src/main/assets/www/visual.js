'use strict';
/* Nexus Agro — padrão visual: um só estilo de ícone (linha), menu lateral com grupos que abrem e fecham e
   “Mais usados” (aprende com o uso), e acabamento comum a todas as telas. Carregado por último. */

// ---------- Ícones de linha (mesmo traço dos ícones do menu, sem o hexágono) ----------
const ICONES_EXTRA = {
  alerta: '<path d="M12 3.8 21 19.5H3z"/><path d="M12 10v4.2M12 16.9v.2"/>',
  engrenagem: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.8M12 18.4v2.8M2.8 12h2.8M18.4 12h2.8M5.5 5.5l2 2M16.5 16.5l2 2M5.5 18.5l2-2M16.5 7.5l2-2"/>',
  espiga: '<path d="M12 21V8.5"/><path d="M12 8.5C10.2 7.6 9.4 5.8 9.6 3.8c1.8.4 2.6 2 2.4 3.8M12 8.5c1.8-.9 2.6-2.7 2.4-4.7-1.8.4-2.6 2-2.4 3.8M12 12.8c-2-.5-3.3-2-3.4-4 2 .1 3.3 1.6 3.4 3.6M12 12.8c2-.5 3.3-2 3.4-4-2 .1-3.3 1.6-3.4 3.6M12 17c-2-.5-3.3-2-3.4-4 2 .1 3.3 1.6 3.4 3.6M12 17c2-.5 3.3-2 3.4-4-2 .1-3.3 1.6-3.4 3.6"/>',
  frasco: '<path d="M9.5 3.5h5M10.5 3.5v5.2L5.2 18.4a1.4 1.4 0 0 0 1.2 2.1h11.2a1.4 1.4 0 0 0 1.2-2.1L13.5 8.7V3.5"/><path d="M7.4 14.5h9.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  lista: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1"/><circle cx="4.8" cy="12" r="1"/><circle cx="4.8" cy="17.5" r="1"/>',
  horimetro: '<circle cx="12" cy="13" r="7.5"/><path d="M12 13V9M9.5 2.8h5M12 2.8v2.7"/>',
  setas: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  nuvem: '<path d="M7 18a4.5 4.5 0 0 1 .7-9 5.8 5.8 0 0 1 11 1.9A3.6 3.6 0 0 1 18.2 18z"/>',
  sync: '<path d="M19.5 9A8 8 0 0 0 5 7.5M4.5 15A8 8 0 0 0 19 16.5"/><path d="M19.8 4.5V9h-4.5M4.2 19.5V15h4.5"/>'
};
function iconeLinha(nome, tam = 18) {
  const d = ICONES_EXTRA[nome] || (window.ICONES_MENU?.[nome] || [])[1];
  return d ? `<svg class="ic-linha" width="${tam}" height="${tam}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>` : '';
}
// Símbolos antigos (texto) → ícone de linha
const GLIFO_ICONE = {'!': 'alerta', '⚠': 'alerta', '⚠️': 'alerta', '◷': 'operacoes', '⚙': 'engrenagem', '□': 'estoque', '$': 'financeiro', '✱': 'pragas', '🌾': 'espiga', '⌁': 'frasco', '◎': 'afericao', '♨': 'secagem', '⛽': 'combustivel', '🌧': 'chuva', '☂': 'chuva', '⇄': 'setas', '✓': 'check', '+': 'mais', '▲': 'producao', '⚗': 'aplicacoes'};
function trocarGlifos(raiz = document) {
  raiz.querySelectorAll('.alert-icon:not([data-ic])').forEach(el => {
    const g = el.textContent.trim(), nome = GLIFO_ICONE[g];
    el.dataset.ic = '1'; if (nome) el.innerHTML = iconeLinha(nome);
  });
  // Ações rápidas: “◷ Registrar horímetro” → ícone + texto
  raiz.querySelectorAll('.nx-acoes button:not([data-ic])').forEach(b => {
    b.dataset.ic = '1'; const m = b.textContent.match(/^\s*(\S+)\s+(.+)$/); if (!m) return;
    const nome = m[1] === '◷' && /horímetro/i.test(m[2]) ? 'horimetro' : GLIFO_ICONE[m[1]];
    if (nome) b.innerHTML = iconeLinha(nome) + `<span>${esc(m[2])}</span>`;
  });
}

// ---------- Menu lateral: grupos que abrem e fecham + “Mais usados” ----------
const MENU_FECHADOS = 'agro-menu-fechados', USO_ROTAS = 'agro-uso-rotas';
const lerJSON = (k, padrao) => { try { return JSON.parse(safeStorage.get(k) || '') ?? padrao; } catch { return padrao; } };
function aplicarGruposMenu() {
  const fechados = new Set(lerJSON(MENU_FECHADOS, [])), ativo = document.querySelector('.sidebar .nav button.active[data-route]:not(.nav-fav-bt)');
  document.querySelectorAll('.sidebar .nav .nav-grupo:not(.nav-fav-tit)').forEach(g => {
    const nome = g.textContent.trim();
    if (!g.dataset.grupo) {
      g.dataset.grupo = nome; g.setAttribute('role', 'button'); g.tabIndex = 0;
      const alternar = () => { const f = new Set(lerJSON(MENU_FECHADOS, [])); f.has(nome) ? f.delete(nome) : f.add(nome); safeStorage.set(MENU_FECHADOS, JSON.stringify([...f])); aplicarGruposMenu(); };
      g.addEventListener('click', alternar); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
    }
    const itens = []; let el = g.nextElementSibling;
    while (el && !el.classList.contains('nav-grupo')) { if (el.matches('[data-route]')) itens.push(el); el = el.nextElementSibling; }
    const fechado = fechados.has(nome) && !itens.includes(ativo); // o grupo da tela aberta fica sempre aberto
    g.classList.toggle('fechado', fechado); g.setAttribute('aria-expanded', String(!fechado));
    itens.forEach(b => b.classList.toggle('nav-oculto', fechado));
  });
}
// Conta as telas abertas (com o tempo, as antigas pesam menos) e mostra as 4 mais usadas logo abaixo da Visão geral
function registrarUso(rota) {
  if (!rota || rota === 'inicio' || !document.querySelector(`.sidebar .nav button[data-route="${rota}"]`)) return;
  const uso = lerJSON(USO_ROTAS, {});
  Object.keys(uso).forEach(k => { uso[k] *= 0.97; if (uso[k] < 0.05) delete uso[k]; });
  uso[rota] = (uso[rota] || 0) + 1; safeStorage.set(USO_ROTAS, JSON.stringify(uso));
}
function montarMaisUsados() {
  const nav = document.querySelector('.sidebar .nav'), inicio = nav?.querySelector('button[data-route="inicio"]'); if (!inicio) return;
  nav.querySelectorAll('.nav-fav-tit, .nav-fav-bt').forEach(e => e.remove());
  const uso = lerJSON(USO_ROTAS, {});
  const top = Object.entries(uso).filter(([r, n]) => n >= 1.5 && nav.querySelector(`button[data-route="${r}"]:not([hidden])`)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r]) => r);
  if (top.length < 2) return; // só aparece depois de algum uso
  const rota = typeof parseRoute === 'function' ? parseRoute().name : '';
  const tit = Object.assign(document.createElement('small'), {className: 'nav-grupo nav-fav-tit', textContent: 'Mais usados'});
  const bts = top.map(r => {
    const b = nav.querySelector(`button[data-route="${r}"]:not(.nav-fav-bt)`).cloneNode(true);
    b.classList.add('nav-fav-bt'); b.classList.remove('nav-oculto'); b.classList.toggle('active', r === rota); b.removeAttribute('data-route'); b.dataset.favRota = r;
    b.addEventListener('click', () => { go(r); closeMenu(); }); return b;
  });
  inicio.after(tit, ...bts);
}
function atualizarMenu() { montarMaisUsados(); aplicarGruposMenu(); }

// ---------- Depois de cada tela ----------
let rotaAnterior = '';
const renderSemVisual = render;
render = function (...a) {
  const r = renderSemVisual.apply(this, a);
  const rota = typeof parseRoute === 'function' ? parseRoute().name : '';
  if (rota !== rotaAnterior) { registrarUso(rota); rotaAnterior = rota; }
  trocarGlifos(document); atualizarMenu();
  return r;
};
addEventListener('DOMContentLoaded', () => { trocarGlifos(document); atualizarMenu(); });
