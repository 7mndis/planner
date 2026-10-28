/* Offline copy of the planner page. Same-site GET requests try the network first and fall back to the
   saved copy after 4 seconds or when offline. Calls to Google (your data) are never touched.
   Push: the planner's server sends an empty push; this worker asks the server what to show, shows it,
   updates the icon badge and opens the planner on the right screen when the notification is tapped. */
const CACHE = "planner-v5";
const CFG = "planner-cfg";
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-180.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CFG).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
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
/* The page hands over the server address and key so a push can be read while the planner is closed. */
self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.type === "pa-config" && d.key && d.api) e.waitUntil(caches.open(CFG).then(c => c.put("cfg", new Response(JSON.stringify({ key: d.key, api: d.api })))));
});
async function cfg() { try { const r = await (await caches.open(CFG)).match("cfg"); return r ? await r.json() : null; } catch (e) { return null; } }
async function nextMessage() {
  const c = await cfg(), sub = await self.registration.pushManager.getSubscription();
  if (!c || !sub) return null;
  const r = await fetch(c.api, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ key: c.key, fn: "getPush", args: [sub.endpoint] }), redirect: "follow", cache: "no-store" });
  const j = await r.json();
  return j && j.ok ? j.data : null;
}
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let m = null;
    try { if (e.data) m = e.data.json(); } catch (x) {}
    if (!m) { try { m = await nextMessage(); } catch (x) {} }
    m = m || { title: "Planner", body: "Open the planner to see what's due." };
    try { if (typeof m.badge === "number" && self.navigator.setAppBadge) await (m.badge ? self.navigator.setAppBadge(m.badge) : self.navigator.clearAppBadge()); } catch (x) {}
    await self.registration.showNotification(m.title || "Planner", { body: m.body || "", tag: m.tag || undefined, data: { url: m.url || "" }, icon: "icon-180.png" });
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || "";
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if (c.url.startsWith(self.registration.scope)) { try { await c.focus(); } catch (x) {} if (hash) c.postMessage({ type: "pa-open", hash }); return; } }
    await clients.openWindow(new URL("./" + hash, self.registration.scope).href);
  })());
});
