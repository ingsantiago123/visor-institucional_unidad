/* GENERADO por herramientas-visor/construir.mjs (plantilla-sw.js): no editar a mano.
 *
 * Cache propia del visor en el navegador. GitHub Pages solo deja cachear 10 minutos (max-age=600): sin esto, cada
 * visita despues de 10 minutos vuelve a preguntar por todos los archivos. Reglas:
 *  - Solo peticiones GET de este mismo sitio y dentro de esta carpeta (nunca Drive, YouTube ni las imagenes de Moodle).
 *  - Archivos del visor (llevan ?v= o viven en assets/): primero la cache; si no estan, la red (y se guardan).
 *  - La pagina (index.html): se entrega la guardada al instante y se actualiza en segundo plano.
 *  - Ante cualquier error, la peticion normal a la red: el visor nunca queda peor que sin cache.
 *  - Version nueva = cache nueva (el nombre lleva la version); las viejas de este visor se borran al activarse.
 *
 * APAGADO DE EMERGENCIA: publicar en esta misma ruta un sw.js con solo:
 *   self.addEventListener("install", () => self.skipWaiting());
 *   self.addEventListener("activate", (e) => e.waitUntil(caches.keys()
 *     .then((k) => Promise.all(k.filter((n) => n.indexOf("visor-") === 0).map((n) => caches.delete(n))))
 *     .then(() => self.registration.unregister())));
 */
"use strict";
const VERSION = "10.0.0";
const PREFIJO = "visor-unidad-v10-";
const CACHE = PREFIJO + VERSION;
const PRECARGA = [
  "./",
  "./?v=10.0.0",
  "./index.html",
  "./assets/dist/visor.min.css?v=10.0.0",
  "./assets/dist/main.min.js?v=10.0.0",
  "./assets/dist/fondo.min.js?v=10.0.0",
  "./assets/dist/iconos-solid.woff2?v=10.0.0",
  "./assets/dist/iconos-regular.woff2?v=10.0.0",
  "./assets/fonts/outfit-latin.woff2?v=3",
  "./assets/fonts/jost-latin.woff2?v=3"
];
const ALCANCE = new URL("./", self.location.href).pathname;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(PRECARGA.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => null))))
    .catch(() => null)
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((k) => Promise.all(k.filter((n) => n.indexOf(PREFIJO) === 0 && n !== CACHE).map((n) => caches.delete(n))))
    .catch(() => null)
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin || url.pathname.indexOf(ALCANCE) !== 0) return;
  const esPagina = req.mode === "navigate" || req.destination === "document";
  if (esPagina) {
    e.respondWith(pagina(req, e));
  } else if (url.search.indexOf("v=") !== -1 || url.pathname.indexOf(ALCANCE + "assets/") === 0) {
    e.respondWith(archivo(req));
  }
});

function guardar(req, res) {
  if (res && res.ok && res.type === "basic") {
    const copia = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => null);
  }
  return res;
}

function archivo(req) {
  return caches.open(CACHE)
    .then((c) => c.match(req))
    .then((r) => r || fetch(req).then((res) => guardar(req, res)))
    .catch(() => fetch(req));
}

function pagina(req, e) {
  const red = fetch(req).then((res) => guardar(req, res));
  e.waitUntil(red.catch(() => null));
  return caches.open(CACHE)
    .then((c) => c.match(req).then((r) => r || c.match(req, { ignoreSearch: true })))
    .then((r) => r || red)
    .catch(() => red);
}
