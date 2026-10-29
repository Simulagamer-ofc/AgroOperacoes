'use strict';
/* MercaPlant — Máquinas e Implementos organizados por categoria, para achar mais rápido.
   Busca por nome, modelo, tipo ou placa; filtro por categoria (com a quantidade de cada uma);
   cada categoria é uma seção que abre e fecha. Máquinas inativas ficam numa seção própria, no fim, fechada.
   O filtro escolhido e as seções fechadas ficam guardados neste aparelho. */

const CATM_CHAVE = 'mp-catmaq';
let catmEstado = {};
try { catmEstado = JSON.parse(localStorage.getItem(CATM_CHAVE) || '{}') || {}; } catch { catmEstado = {}; }
const catmSalvar = () => { try { localStorage.setItem(CATM_CHAVE, JSON.stringify(catmEstado)); } catch { /* sem armazenamento: vale só nesta tela */ } };
const catmSt = tela => (catmEstado[tela] = catmEstado[tela] || {filtro: '', fechadas: []});
const catmBusca = {}; // o que foi digitado na busca (só enquanto o app está aberto)
const catmNorm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CATM_INATIVAS = 'Inativas';
// Todas as palavras digitadas precisam aparecer (em qualquer ordem): “kuhn 002”, “hilux”, “IZM”
const catmCasa = (texto, busca) => catmNorm(busca).split(/\s+/).filter(Boolean).every(p => texto.includes(p));
const catmFechada = (st, g) => g === CATM_INATIVAS ? !st.inativasAbertas : (st.fechadas || []).includes(g);

// tela: 'maquinas' | 'implementos'; itens: cadastros; o: {grupos: [nomes na ordem], grupoDe, cartao, atencao, texto, nome}
function catmLista(tela, itens, o) {
  const st = catmSt(tela), busca = catmBusca[tela] || '';
  const ativos = itens.filter(m => !isInactive(m)), inativos = itens.filter(m => isInactive(m));
  const grupos = o.grupos.map(g => [g, ativos.filter(m => o.grupoDe(m) === g)]).filter(([, l]) => l.length);
  if (inativos.length) grupos.push([CATM_INATIVAS, inativos]);
  const filtro = grupos.some(([g]) => g === st.filtro) ? st.filtro : '';
  const txt = m => catmNorm(o.texto(m));
  const achados = busca ? itens.filter(m => catmCasa(txt(m), busca)).length : 0;
  const nAt = l => l.filter(o.atencao).length;
  const chipF = (g, n, at) => `<button class="${g === filtro ? 'active' : ''}" data-act="catm-filtro" data-id="${esc(tela)}|${esc(g)}">${esc(g || 'Todas')} (${n})${at ? `<span class="catm-dot" title="${at} com atenção"></span>` : ''}</button>`;
  // Barra só quando há o que filtrar (poucos cadastros dispensam)
  const barra = itens.length < 5 && grupos.length < 2 ? '' : `<section class="catm-barra" data-catm-tela="${esc(tela)}">
    <div class="catm-busca"><input type="search" data-catm-busca="${esc(tela)}" value="${esc(busca)}" placeholder="${esc(o.placeholder || 'Buscar por nome, modelo, tipo ou placa')}" aria-label="Buscar ${esc(o.nome)}" autocomplete="off" enterkeyhint="search">
      <small class="catm-achados" ${busca ? '' : 'hidden'}>${achados} ${achados === 1 ? 'encontrado' : 'encontrados'}</small></div>
    ${grupos.length > 1 ? `<div class="filters catm-chips">${chipF('', itens.length, nAt(ativos))}${grupos.map(([g, l]) => chipF(g, l.length, g === CATM_INATIVAS ? 0 : nAt(l))).join('')}</div>` : ''}</section>`;
  const secao = ([g, l]) => {
    const casa = l.filter(m => !busca || catmCasa(txt(m), busca)), at = g === CATM_INATIVAS ? 0 : nAt(l);
    const escondida = busca ? !casa.length : !!filtro && filtro !== g, aberta = busca ? true : !!filtro || !catmFechada(st, g);
    return `<details class="catm-grupo" data-catm-grupo="${esc(g)}" ${aberta ? 'open' : ''} ${escondida ? 'hidden' : ''}>
      <summary><span class="catm-tit">${esc(g)}</span><span class="catm-n" data-total="${l.length}">${busca ? `${casa.length} de ${l.length}` : l.length}</span>${at ? `<span class="catm-at" title="Em manutenção ou com revisão vencida">⚠ ${at}</span>` : ''}</summary>
      <section class="cards">${l.map(m => o.cartao(m).replace(/^\s*<article /, `<article data-catm-item data-busca="${esc(txt(m))}" ${busca && !catmCasa(txt(m), busca) ? 'hidden ' : ''}`)).join('')}</section></details>`;
  };
  return barra + `<div class="catm-lista" data-catm-lista="${esc(tela)}">${grupos.map(secao).join('')}<section class="card catm-nada" ${busca && !achados ? '' : 'hidden'}>${empty('Nada encontrado', `Nenhum cadastro com “${esc(busca)}”. Confira a escrita ou limpe a busca.`)}</section></div>`;
}

// Busca: filtra na hora, sem redesenhar a tela (o teclado continua aberto)
function catmAplicar(tela) {
  const lista = $(`[data-catm-lista="${tela}"]`); if (!lista) return;
  const busca = catmBusca[tela] || '', st = catmSt(tela);
  const filtro = $(`[data-catm-tela="${tela}"] .catm-chips .active`)?.dataset.id.split('|')[1] || '';
  let total = 0;
  $$('[data-catm-grupo]', lista).forEach(sec => {
    const g = sec.dataset.catmGrupo; let n = 0;
    $$('[data-catm-item]', sec).forEach(it => { const ok = !busca || catmCasa(it.dataset.busca, busca); it.hidden = !ok; if (ok) n++; });
    total += n;
    const cn = $('.catm-n', sec); if (cn) cn.textContent = busca ? `${n} de ${cn.dataset.total}` : cn.dataset.total;
    sec.hidden = busca ? !n : !!filtro && filtro !== g;
    sec.open = busca ? true : !!filtro || !catmFechada(st, g);
  });
  const ach = $(`[data-catm-tela="${tela}"] .catm-achados`);
  if (ach) { ach.hidden = !busca; ach.textContent = `${total} ${total === 1 ? 'encontrado' : 'encontrados'}`; }
  const nada = $('.catm-nada', lista); if (nada) { nada.hidden = !busca || !!total; const p = $('p', nada); if (p) p.textContent = `Nenhum cadastro com “${busca}”. Confira a escrita ou limpe a busca.`; }
}
document.addEventListener('input', e => {
  const tela = e.target?.dataset?.catmBusca; if (!tela) return;
  catmBusca[tela] = e.target.value.trim(); catmAplicar(tela);
});
// Abrir ou fechar uma categoria fica guardado (só quando não há busca nem filtro, que abrem tudo)
document.addEventListener('toggle', e => {
  const sec = e.target; if (!sec?.matches?.('[data-catm-grupo]')) return;
  const tela = sec.closest('[data-catm-lista]')?.dataset.catmLista; if (!tela || catmBusca[tela]) return;
  const st = catmSt(tela), g = sec.dataset.catmGrupo; if (st.filtro) return;
  if (g === CATM_INATIVAS) st.inativasAbertas = sec.open;
  else st.fechadas = sec.open ? (st.fechadas || []).filter(x => x !== g) : [...new Set([...(st.fechadas || []), g])];
  catmSalvar();
}, true);
Object.assign(ACTIONS, {
  'catm-filtro': id => {
    const [tela, g] = String(id).split('|'), st = catmSt(tela);
    st.filtro = st.filtro === g ? '' : g; catmBusca[tela] = ''; catmSalvar(); render();
  }
});

// Atenção: em manutenção ou com revisão vencida (aparece no título da categoria)
const catmAtencaoMaq = m => !isInactive(m) && (machineStatus(m) === 'Em manutenção' || (Number(m.nextService) > 0 && temMedidor(m) && hoursToService(m) <= 0) || (revisaoTempo(m)?.dias < 0));
const catmAtencaoImpl = m => !isInactive(m) && (machineStatus(m) === 'Em manutenção' || (typeof revisaoImplemento === 'function' && revisaoImplemento(m).nivel === 'vencida'));
const catmTextoMaq = m => [m.name, m.model, m.type, m.tipoImpl, m.placa, m.carroceria, m.catalogo?.marca, m.catalogo?.nome, grupoDoTipoMaq(m.type)].filter(Boolean).join(' ');
