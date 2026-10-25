/* Offline copy of the planner page. Same-site GET requests try the network first and fall back to the
   saved copy after 4 seconds or when offline. Calls to Google (your data) are never touched. */
const CACHE = "planner-v3";
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-180.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  const key = r.mode === "navigate" ? "index.html" : r;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const req = r.mode === "navigate" ? fetch(r.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(r, { cache: "no-cache" }); // always ask GitHub for the latest page
      const net = await Promise.race([req, new Promise((_, no) => setTimeout(() => no(new Error("slow")), 4000))]);
      if (net && net.ok && !net.redirected) c.put(key, net.clone());
      return net;
    } catch (err) {
      return (await c.match(key, { ignoreSearch: true })) || (await c.match("index.html")) || Response.error();
    }
  })());
});
