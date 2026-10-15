'use strict';
/* Ícones do menu no estilo da tela de abertura (hexágonos com brilho): verde para campo e gestão,
   azul para máquinas e sistema. Desenhados em linha (SVG), sem arquivos externos, funcionam offline. */
(() => {
  const ICONES = {
    inicio: ['verde', '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'],
    operacoes: ['verde', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>'],
    talhoes: ['verde', '<path d="M3 20h18M4 20 9 5M9 20l2-15M15 20l-2-15M20 20 15 5M6.5 12.5h11"/>'],
    chuva: ['verde', '<path d="M7 15a4 4 0 0 1 .6-8 5.2 5.2 0 0 1 9.9 1.7A3.4 3.4 0 0 1 17 15z"/><path d="M8.5 18 7.5 20.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>'],
    pragas: ['verde', '<ellipse cx="12" cy="14.5" rx="4.2" ry="5.5"/><circle cx="12" cy="7" r="2.2"/><path d="M12 9.2V20M7.8 12.5H4.5M7.8 16.5H4.5M16.2 12.5h3.3M16.2 16.5h3.3M10.8 5.2 9.5 3M13.2 5.2 14.5 3"/>'],
    aplicacoes: ['verde', '<path d="M12 3.5s6 6.8 6 10.8a6 6 0 0 1-12 0c0-4 6-10.8 6-10.8z"/><path d="M9.5 15a2.6 2.6 0 0 0 2.5 2.5"/>'],
    maodeobra: ['verde', '<circle cx="12" cy="8" r="3.5"/><path d="M5 20.5c.9-4 3.6-6 7-6s6.1 2 7 6"/>'],
    maquinas: ['azul', '<circle cx="7.5" cy="16" r="3.5"/><circle cx="18" cy="17.5" r="2"/><path d="M11 16h5M4 12.5V8h6.5l1.8 4.5M12 8V4.5h3V8M4 12.5h12.5a2.5 2.5 0 0 1 2.5 2.5"/>'],
    combustivel: ['azul', '<path d="M5 20.5V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15.5M3.5 20.5h12M7.5 8.5h4M14 9.5h2l2 2v5.5a1.5 1.5 0 0 0 3 0V8.5l-3-3"/>'],
    afericao: ['azul', '<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="M12 17l3.8-5.2"/><circle cx="12" cy="17" r="1.3"/><path d="M6.5 13.5l1 .6M17.5 13.5l-1 .6M12 8.5v1.2"/>'],
    catalogo: ['azul', '<path d="M3 6.5h11v10H3zM14 10h4l3 3.2v3.3h-7"/><circle cx="7" cy="17.5" r="1.9"/><circle cx="17" cy="17.5" r="1.9"/>'],
    pontas: ['azul', '<path d="M9 3h6v4l-1.2 3h-3.6L9 7zM12 10v2.5M8.5 15.5 6.5 20M12 15.5V21M15.5 15.5l2 4.5"/>'],
    graos: ['verde', '<path d="M5.5 21V8.5a3.5 3.5 0 0 1 7 0V21M12.5 21V11h6v10M3.5 21h17M5.5 13h7M5.5 17h7"/>'],
    secagem: ['verde', '<path d="M5.5 21V8.5a3.5 3.5 0 0 1 7 0V21M12.5 21V11h6v10M3.5 21h17M5.5 13h7M5.5 17h7"/>'],
    sementes: ['verde', '<ellipse cx="9" cy="10" rx="3.4" ry="5" transform="rotate(-30 9 10)"/><ellipse cx="15.5" cy="14.5" rx="3.4" ry="5" transform="rotate(-30 15.5 14.5)"/><path d="M7.6 7.6l2.8 4.8M14.1 12.1l2.8 4.8"/>'],
    estoque: ['verde', '<path d="M3.5 8 12 3.5 20.5 8v8.5L12 21l-8.5-4.5z"/><path d="M3.5 8 12 12.5 20.5 8M12 12.5V21"/>'],
    financeiro: ['verde', '<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.4c-.5-1-1.5-1.6-2.6-1.6-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2.1 2.6.9 2.6 2.1-1.1 2.1-2.6 2.1c-1.1 0-2.1-.6-2.6-1.6M12 6.3v1.5M12 16.2v1.5"/>'],
    producao: ['verde', '<path d="M3.5 20.5h17M6.5 17v-4M11 17v-6.5M15.5 17V12M20 17V7.5M5.5 10.5l5-4.5 4 3 5.5-5M16.5 4h3.5v3.5"/>'],
    relatorios: ['verde', '<path d="M6.5 3h8l4.5 4.5V21h-12.5z"/><path d="M14.5 3v4.5H19M9.5 12.5h6M9.5 16.5h6"/>'],
    cadastros: ['azul', '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8"/>']
  };
  // Hexágono "deitado" como os da abertura, com o desenho no meio
  const icone = (rota, tam = 32) => {
    const [cor, desenho] = ICONES[rota] || [];
    if (!desenho) return '';
    return `<svg class="hex-icone ${cor}" width="${tam}" height="${tam}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <polygon class="hex" points="9,3 23,3 30,16 23,29 9,29 2,16"/>
      <g class="glifo" transform="translate(6.4 6.4) scale(.8)">${desenho}</g></svg>`;
  };
  window.iconeMenu = icone; window.ICONES_MENU = ICONES;
  // Menu lateral: ícone + nome numa linha (o nome some quando o menu está recolhido)
  document.querySelectorAll('.sidebar .nav button[data-route]').forEach(b => {
    const nome = [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    b.title = nome; b.setAttribute('aria-label', nome);
    b.innerHTML = icone(b.dataset.route) + `<span class="nav-txt">${nome}</span>`;
  });
  // Barra inferior do celular
  document.querySelectorAll('.mobile-nav button[data-route]').forEach(b => {
    const s = b.querySelector('span'); if (s && ICONES[b.dataset.route]) s.innerHTML = icone(b.dataset.route, 26);
  });
})();
