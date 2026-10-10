const CACHE = "agro-ops-v34";
const ASSETS = ["./", "index.html", "styles.css", "app.js", "avaliador.js", "afericao.js", "secagem.js", "gastos.js", "estoque.js", "ubs.js", "combustivel.js", "financeiro.js", "producao.js", "lib/qrcode.js", "rastreio.js", "campo.js", "nfe.js", "sync.js", "mapa.js", "lcdpr.js", "graficos.js", "catalogo.js", "maqconfig.js", "pontas.js", "dados/pontas.json", "dados/regras-afericao.json", "dados/catalogo-modelos.json", "dados/finame.json", "dados/marcas.json", "manifest.webmanifest", "icon.svg", "img/centro-operacoes.jpg", "icon-192.png", "icon-512.png", "icon-maskable-512.png"];
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
