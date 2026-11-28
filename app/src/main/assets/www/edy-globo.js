'use strict';
/* Edy — globo da marca na tela do Edy e no botão do centro da barra de baixo.
   Tela do Edy (conversa vazia): o vídeo do logo girando (img/edy-globo.mp4, uma volta a cada 16 s) dentro de um painel
   tecnológico (anel com marcações, segmentos girando, textos curvos, grade holográfica, radar e linha de varredura).
   Se o aparelho não deixar o vídeo começar sozinho, fica a imagem parada; com "reduzir movimento", tudo parado. */

/** Recorte redondo do globo da imagem da tela de entrada (img/nexus-globo.jpg: centro 1240×407, raio 238). */
function edyGloboFoto(d) {
  const s = d / 2 / 238;
  return `background:#061625 url(img/nexus-globo.jpg) no-repeat;background-size:${(1672 * s).toFixed(1)}px ${(941 * s).toFixed(1)}px;background-position:${(-(1240 * s - d / 2)).toFixed(1)}px ${(-(407 * s - d / 2)).toFixed(1)}px`;
}

/** "28,26° S · 52,40° O" a partir do ponto da sede (vazio se a sede não foi marcada). */
function edyCoordTexto(l) {
  if (!l || !Number.isFinite(l.lat) || !Number.isFinite(l.lon)) return '';
  const f = v => Math.abs(v).toFixed(2).replace('.', ',');
  return `SEDE ${f(l.lat)}° ${l.lat < 0 ? 'S' : 'N'} · ${f(l.lon)}° ${l.lon < 0 ? 'O' : 'L'}`;
}

const EDY_CENA = 330; // tamanho de desenho (o CSS escala para caber na tela)
function edyCenaHtml(local) {
  const S = EDY_CENA, c = S / 2, rad = Math.PI / 180;
  const marcas = Array.from({length: 72}, (_, i) => {
    const a = i * 5 * rad, l = i % 6 === 0 ? 9 : 4, r1 = 158, r2 = r1 - l;
    return `<line x1="${(c + r1 * Math.cos(a)).toFixed(1)}" y1="${(c + r1 * Math.sin(a)).toFixed(1)}" x2="${(c + r2 * Math.cos(a)).toFixed(1)}" y2="${(c + r2 * Math.sin(a)).toFixed(1)}"/>`;
  }).join('');
  const coord = edyCoordTexto(local);
  return `<div class="edy-cena" aria-hidden="true">
    <div class="edy-cena-fundo"></div>
    <div class="edy-cena-video"><video muted loop playsinline preload="auto" poster="img/edy-globo.jpg" disablepictureinpicture><source src="img/edy-globo.mp4" type="video/mp4"></video></div>
    <div class="edy-cena-radar"></div><div class="edy-cena-scan"></div><canvas class="edy-cena-casca"></canvas>
    <svg viewBox="0 0 ${S} ${S}">
      <defs><path id="edyArcoTop" d="M${c - 138} ${c} a138 138 0 0 1 276 0"/><path id="edyArcoBase" d="M${c - 146} ${c} a146 146 0 0 0 292 0"/></defs>
      <g class="edy-gira lento" stroke="#59c2ff" stroke-opacity=".55" stroke-width="1">${marcas}</g>
      <g class="edy-gira medio" fill="none" stroke-width="2" stroke-linecap="round">
        <circle cx="${c}" cy="${c}" r="148" stroke="#5fe39a" stroke-opacity=".8" stroke-dasharray="60 870"/>
        <circle cx="${c}" cy="${c}" r="148" stroke="#59c2ff" stroke-opacity=".8" stroke-dasharray="28 902" stroke-dashoffset="-310"/>
        <circle cx="${c}" cy="${c}" r="148" stroke="#5fe39a" stroke-opacity=".5" stroke-dasharray="14 916" stroke-dashoffset="-620"/>
      </g>
      <g class="edy-gira rapido"><circle cx="${c}" cy="${c - 148}" r="2.6" fill="#b6ffd5"/><circle cx="${c}" cy="${c + 148}" r="2" fill="#9fdcff"/></g>
      <circle cx="${c}" cy="${c}" r="131" fill="none" stroke="#59c2ff" stroke-opacity=".25" stroke-dasharray="2 5"/>
      <text class="edy-cena-txt"><textPath href="#edyArcoTop" startOffset="50%" text-anchor="middle">MERCAPLANT · EDY · IA AGRONÔMICA</textPath></text>
      ${coord ? `<text class="edy-cena-txt b"><textPath href="#edyArcoBase" startOffset="50%" text-anchor="middle">${coord}</textPath></text>` : ''}
    </svg>
  </div>`;
}

/** Liga o vídeo e a grade holográfica (chamar depois que a cena entra na tela). */
function edyCenaIniciar() {
  const cena = document.querySelector('.edy-cena'); if (!cena || cena.dataset.ok) return;
  cena.dataset.ok = '1';
  const parado = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const v = cena.querySelector('video');
  if (v && !parado) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => { /* o aparelho não deixou: fica a imagem parada */ }); }
  const cv = cena.querySelector('canvas'); if (!cv || !cv.getContext) return;
  const W = cv.clientWidth || 140, R = W * 69 / 140, dpr = window.devicePixelRatio || 1, rad = Math.PI / 180, tilt = -18 * rad;
  cv.width = W * dpr; cv.height = W * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const t0 = performance.now(), m = W / 2;
  const proj = (lon, lat, l0) => {
    const l = (lon + l0) * rad, p = lat * rad, x = Math.cos(p) * Math.sin(l), y0 = Math.sin(p), z0 = Math.cos(p) * Math.cos(l);
    return [m + R * x, m - R * (y0 * Math.cos(tilt) - z0 * Math.sin(tilt)), y0 * Math.sin(tilt) + z0 * Math.cos(tilt)];
  };
  const linha = (pts, cor) => { g.beginPath(); let ok = false; pts.forEach(([x, y, z]) => { if (z > 0) { ok ? g.lineTo(x, y) : g.moveTo(x, y); ok = true; } else ok = false; }); g.strokeStyle = cor; g.stroke(); };
  (function quadro(t) {
    if (!cv.isConnected) return;
    const l0 = parado ? 0 : ((t - t0) / 1000) * 22.5; // uma volta a cada 16 s, junto com o globo do vídeo
    g.clearRect(0, 0, W, W); g.lineWidth = .6;
    for (let a = -180; a < 180; a += 20) linha(Array.from({length: 46}, (_, k) => proj(a, -90 + k * 4, l0)), 'rgba(130,210,255,.22)');
    for (let p = -60; p <= 60; p += 20) linha(Array.from({length: 91}, (_, k) => proj(-180 + k * 4, p, l0)), 'rgba(130,210,255,.16)');
    for (let k = 0; k < 16; k++) { const [x, y, z] = proj(k * 47 % 360 - 180, (k * 29 % 120) - 60, l0); if (z > .15) { g.fillStyle = `rgba(160,240,255,${.3 + .6 * z})`; g.beginPath(); g.arc(x, y, 1.4, 0, 7); g.fill(); } }
    if (!parado && !document.hidden) requestAnimationFrame(quadro);
    else if (!parado) document.addEventListener('visibilitychange', () => requestAnimationFrame(quadro), {once: true});
  })(t0);
}

/** Quanto o globo do Edy sobe acima da barra de baixo (para a conversa não ficar embaixo dele). */
function edyNavSobe() {
  const nav = document.querySelector('.mobile-nav'), g = nav && nav.querySelector('.edy-globo');
  if (!g || getComputedStyle(nav).display === 'none') return 0;
  return Math.max(0, Math.ceil(nav.getBoundingClientRect().top - g.getBoundingClientRect().top) + 6);
}

/** Botão do Edy no centro da barra de baixo (globo da marca com anel girando). */
function edyBotaoNav() {
  const b = document.querySelector('.mobile-nav .nv-edy'); if (!b || b.dataset.ok) return;
  b.dataset.ok = '1';
  b.innerHTML = `<span class="edy-globo" aria-hidden="true"><i style="${edyGloboFoto(58)}"></i></span>Edy`;
}
if (typeof document !== 'undefined' && document.querySelector) edyBotaoNav();
