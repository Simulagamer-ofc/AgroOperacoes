'use strict';
/* MercaPlant — lista de sugestões ao digitar, desenhada pelo app.
   No lugar da lista nativa do navegador (datalist): no celular ela abria transparente, por cima dos outros campos.
   Vale para todo campo com list="…" (cultura, espécie, safra, nomes da análise…): o campo continua igual,
   só a lista é nossa — opaca, com o tema do app, abre embaixo do campo (ou em cima, se o teclado tapar). */
(() => {
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const escS = t => String(t).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  let caixa = null, alvo = null, itens = [], sel = -1, escolhendo = false;
  const converter = el => { const id = el.getAttribute('list'); if (!id) return; el.dataset.sug = id; el.removeAttribute('list'); el.setAttribute('autocomplete', 'off'); };
  const campoDe = el => el?.matches?.('input[list], input[data-sug]') ? el : null;
  const opcoes = el => [...new Set([...(document.getElementById(el.dataset.sug)?.options || [])].map(o => o.value).filter(Boolean))];
  // Onde a busca bate: no começo do nome ou de uma palavra dele ("mou" acha Trigo mourisco; "ca" não acha Ervilhaca)
  const posicao = (o, q) => { if (!q) return 0; const n = norm(o); if (n.startsWith(q)) return 0; const m = n.search(new RegExp(`[\\s\\-/(]${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)); return m < 0 ? -1 : m + 1; };
  const realce = (o, q) => { if (!q) return escS(o); const i = posicao(o, q); return i < 0 ? escS(o) : `${escS(o.slice(0, i))}<b>${escS(o.slice(i, i + q.length))}</b>${escS(o.slice(i + q.length))}`; };
  function fechar() { if (caixa) caixa.hidden = true; alvo = null; itens = []; sel = -1; }
  function posicionar() {
    if (!alvo || !caixa || caixa.hidden) return;
    if (!document.body.contains(alvo)) return fechar();
    const r = alvo.getBoundingClientRect(), vv = window.visualViewport, fundo = vv ? vv.offsetTop + vv.height : innerHeight;
    const abaixo = fundo - r.bottom - 8, acima = r.top - 8;
    caixa.style.left = `${Math.max(4, r.left)}px`; caixa.style.width = `${Math.min(r.width, innerWidth - 8)}px`;
    caixa.style.maxHeight = `${Math.max(96, Math.min(264, Math.max(abaixo, acima)))}px`;
    const h = caixa.offsetHeight;
    caixa.style.top = `${abaixo >= h || abaixo >= acima ? r.bottom + 4 : Math.max(4, r.top - 4 - h)}px`;
  }
  function marcar(i) {
    sel = i; [...caixa.children].forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', String(k === i)); });
    caixa.children[i]?.scrollIntoView({block: 'nearest'});
  }
  function mostrar(el) {
    const q = norm(el.value), com = opcoes(el).filter(o => posicao(o, q) >= 0);
    const lista = [...com.filter(o => posicao(o, q) === 0), ...com.filter(o => posicao(o, q) > 0)].slice(0, 40);
    if (!lista.length || (lista.length === 1 && norm(lista[0]) === q)) return fechar();
    if (!caixa) {
      caixa = document.createElement('div'); caixa.className = 'sug-lista'; caixa.setAttribute('role', 'listbox'); caixa.hidden = true; document.body.append(caixa);
      caixa.addEventListener('pointerdown', e => e.preventDefault()); // tocar na lista não tira o foco do campo (o teclado fica)
      caixa.addEventListener('mousedown', e => e.preventDefault());
      caixa.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) escolher(itens[Number(b.dataset.i)]); });
    }
    alvo = el; itens = lista; sel = -1; caixa.hidden = false;
    caixa.innerHTML = lista.map((o, i) => `<button type="button" role="option" aria-selected="false" data-i="${i}">${realce(o, q)}</button>`).join('');
    caixa.scrollTop = 0; posicionar();
  }
  function escolher(v) {
    const el = alvo; if (!el || v == null) return;
    escolhendo = true; el.value = v;
    el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}));
    escolhendo = false; fechar();
  }
  document.addEventListener('focusin', e => { const el = campoDe(e.target); if (!el) return; converter(el); mostrar(el); });
  document.addEventListener('input', e => { const el = campoDe(e.target); if (!el || escolhendo) return; converter(el); mostrar(el); });
  document.addEventListener('focusout', e => { if (e.target === alvo) setTimeout(() => { if (document.activeElement !== alvo) fechar(); }, 120); });
  document.addEventListener('keydown', e => {
    if (!alvo || e.target !== alvo || !caixa || caixa.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); marcar(Math.min(itens.length - 1, sel + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(Math.max(0, sel - 1)); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); escolher(itens[sel]); }
    else if (e.key === 'Escape') fechar();
  });
  addEventListener('scroll', posicionar, true); addEventListener('resize', posicionar);
  window.visualViewport?.addEventListener('resize', posicionar); window.visualViewport?.addEventListener('scroll', posicionar);
  addEventListener('hashchange', fechar);
  // Campos novos já entram sem a lista nativa (antes de qualquer toque)
  const tirar = raiz => raiz.querySelectorAll?.('input[list]').forEach(converter);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches('input[list]')) converter(n); tirar(n); } })))
    .observe(document.documentElement, {childList: true, subtree: true});
  tirar(document);
  window.sugFechar = fechar;
})();
