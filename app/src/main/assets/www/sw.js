const CACHE = "agro-ops-v80";
const ASSETS = ["./", "index.html", "styles.css", "splash.js", "img/nexus-globo.jpg", "app.js", "lib/jspdf.umd.min.js", "relatorio-pdf.js", "icones.js", "avaliador.js", "inteligencia.js", "afericao.js", "inspecao.js", "secagem.js", "gastos.js", "estoque.js", "ubs.js", "combustivel.js", "financeiro.js", "producao.js", "orcamento.js", "lib/qrcode.js", "lib/webp/webp_enc.js", "lib/webp/webp_enc.wasm", "rastreio.js", "campo.js", "nfe.js", "sync.js", "nuvem.js", "mapa.js", "lcdpr.js", "graficos.js", "automacao.js", "alertas.js", "comparativo.js", "graos.js", "referencias.js", "fotos.js", "agronomo.js", "visual.js", "catalogo.js", "maqconfig.js", "pontas.js", "dados/pontas.json", "dados/regras-afericao.json", "dados/catalogo-modelos.json", "dados/finame.json", "dados/marcas.json", "manifest.webmanifest", "icon.svg", "img/centro-operacoes.jpg", "img/logo-nexus.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) return;
  // Cache primeiro (abre rápido mesmo com sinal fraco); a cópia é atualizada pela rede em segundo plano para a próxima abertura
  const rede = fetch(event.request).then(response => {
    if (!response.ok) return response;
    const copy = response.clone();
    return caches.open(CACHE).then(cache => cache.put(event.request, copy)).then(() => response, () => response);
  });
  event.waitUntil(rede.catch(() => {}));
  event.respondWith(caches.match(event.request, {ignoreSearch: true}).then(cached => cached || rede.catch(() => caches.match("index.html"))));
});
// Toque na notificação de alerta: abre (ou traz para frente) o MercaPlant na tela do aviso
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const rota = String(event.notification.data?.rota || "inicio").replace(/[^a-z0-9/_-]/gi, "");
  const url = new URL("./#/" + rota, self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(lista => {
    const aberto = lista.find(c => c.url.startsWith(self.registration.scope));
    if (aberto) return aberto.focus().then(c => c.navigate ? c.navigate(url) : c);
    return self.clients.openWindow(url);
  }));
});
