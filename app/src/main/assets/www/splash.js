'use strict';
// Abertura da Plataforma Nexus: uma vez por carregamento do documento, nunca por rota.
(() => {
  const root = document.documentElement, inicio = performance.now(), DURACAO = 5000;
  root.classList.add('nexus-booting');
  let encerrado = false;
  const encerrar = () => {
    if (encerrado) return;
    encerrado = true;
    root.classList.remove('nexus-booting');
    document.getElementById('nexusSplash')?.remove();
    document.querySelectorAll('.app, .mobile-nav').forEach(el => { el.inert = false; });
  };
  // Se outro script falhar, a tela de abertura não bloqueia o acesso ao aplicativo.
  const limite = setTimeout(encerrar, 8000);
  document.addEventListener('DOMContentLoaded', () => {
    if (encerrado) return;
    document.querySelectorAll('.app, .mobile-nav').forEach(el => { el.inert = true; });
    setTimeout(() => { clearTimeout(limite); encerrar(); }, Math.max(0, DURACAO - (performance.now() - inicio)));
  }, {once: true});
})();
