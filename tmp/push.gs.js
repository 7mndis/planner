/* ---------- Web Push from the planner itself: VAPID (ES256 on P-256) signing, subscriptions, a message queue and a 5-minute check ----------
   Pushes carry no payload. The app's service worker asks the server what to show (getPush), so nothing needs encrypting here. */
const EC_ = (() => {
  const B = s => BigInt(s), p = B('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'), n = B('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const G = [B('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), B('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'), B(1)];
  const Z0 = B(0), O1 = B(1), T2 = B(2), T3 = B(3), F4 = B(4), E8 = B(8);
  const md = (a, m) => { const r = a % m; return r < Z0 ? r + m : r; };
  const pow = (b, e, m) => { let r = O1; b = md(b, m); while (e > Z0) { if (e & O1) r = r * b % m; b = b * b % m; e >>= O1; } return r; };
  const inv = (a, m) => pow(md(a, m), m - T2, m);
  function dbl(P) {
    if (!P || P[1] === Z0) return null;
    const [X, Y, Z] = P, delta = Z * Z % p, gamma = Y * Y % p, beta = X * gamma % p, alpha = T3 * md(X - delta, p) % p * ((X + delta) % p) % p;
    const X3 = md(alpha * alpha - E8 * beta, p), Z3 = md((Y + Z) * (Y + Z) - gamma - delta, p), Y3 = md(alpha * md(F4 * beta - X3, p) - E8 * (gamma * gamma % p), p);
    return [X3, Y3, Z3];
  }
  function addP(P, Q) {
    if (!P) return Q; if (!Q) return P;
    const [X1, Y1, Z1] = P, [X2, Y2, Z2] = Q, Z1Z1 = Z1 * Z1 % p, Z2Z2 = Z2 * Z2 % p, U1 = X1 * Z2Z2 % p, U2 = X2 * Z1Z1 % p;
    const S1 = Y1 * Z2 % p * Z2Z2 % p, S2 = Y2 * Z1 % p * Z1Z1 % p, H = md(U2 - U1, p), r = md(T2 * (S2 - S1), p);
    if (H === Z0) return r === Z0 ? dbl(P) : null;
    const I = (T2 * H) * (T2 * H) % p, J = H * I % p, V = U1 * I % p, X3 = md(r * r - J - T2 * V, p);
    return [X3, md(r * md(V - X3, p) - T2 * S1 * J, p), md((Z1 + Z2) * (Z1 + Z2) - Z1Z1 - Z2Z2, p) * H % p];
  }
  function mul(k, P) { let R = null; for (let i = k.toString(2), j = 0; j < i.length; j++) { R = dbl(R); if (i[j] === '1') R = addP(R, P); } return R; }
  function aff(P) { const zi = inv(P[2], p), z2 = zi * zi % p; return [P[0] * z2 % p, P[1] * z2 % p * zi % p]; }
  const toBytes = (x, len) => { const h = x.toString(16).padStart(len * 2, '0'), o = []; for (let i = 0; i < len; i++) o.push(parseInt(h.substr(i * 2, 2), 16)); return o; };
  const toBig = bytes => B('0x' + (bytes.map(b => ((b & 255) + 256).toString(16).slice(1)).join('') || '0'));
  const sha = bytes => Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes.map(b => b > 127 ? b - 256 : b)).map(b => b & 255);
  const rand = extra => sha([...Utilities.newBlob(Utilities.getUuid() + Utilities.getUuid() + Date.now()).getBytes().map(b => b & 255), ...(extra || [])]);
  const b64u = bytes => Utilities.base64EncodeWebSafe(bytes.map(b => b > 127 ? b - 256 : b)).replace(/=+$/, '');
  const unb64u = s => Utilities.base64DecodeWebSafe(s + '==='.slice((s.length + 3) % 4)).map(b => b & 255);
  function keygen() {
    const d = md(toBig(rand()), n - O1) + O1, Q = aff(mul(d, G));
    return { d: b64u(toBytes(d, 32)), pub: b64u([4, ...toBytes(Q[0], 32), ...toBytes(Q[1], 32)]) };
  }
  /* ES256: r and s, 32 bytes each, over SHA-256 of the message bytes. */
  function sign(msgBytes, dB64) {
    const d = toBig(unb64u(dB64)), e = toBig(sha(msgBytes));
    for (;;) {
      const k = md(toBig(rand([...toBytes(d, 32), ...toBytes(e, 32)])), n - O1) + O1, R = aff(mul(k, G)), r = md(R[0], n);
      if (r === Z0) continue;
      const s = inv(k, n) * md(e + r * d, n) % n;
      if (s === Z0) continue;
      return [...toBytes(r, 32), ...toBytes(s, 32)];
    }
  }
  return { keygen, sign, b64u, unb64u };
})();
/* VAPID keys live in Script Properties, made once. */
function vapid_() {
  let d = PROPS.getProperty('VAPID_D'), pub = PROPS.getProperty('VAPID_PUB');
  if (!d || !pub) { const k = EC_.keygen(); d = k.d; pub = k.pub; PROPS.setProperties({ VAPID_D: d, VAPID_PUB: pub }); }
  return { d: d, pub: pub };
}
function getVapid_() { return vapid_().pub; }
const pushSubs_ = () => { try { return JSON.parse(PROPS.getProperty('PUSH_SUBS') || '[]'); } catch (e) { return []; } };
const pushKey_ = ep => Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(ep)).map(b => ((b & 255) + 256).toString(16).slice(1)).join('').slice(0, 16);
/** Saves this device's push subscription (endpoint and keys from the browser). */
function savePush_(sub, label) {
  if (!sub || !/^https:\/\//.test(String(sub.endpoint || ''))) throw new Error('No subscription');
  const li = pushSubs_().filter(x => x.endpoint !== sub.endpoint);
  li.push({ id: pushKey_(sub.endpoint), endpoint: sub.endpoint, label: String(label || '').slice(0, 60), at: new Date().toISOString() });
  PROPS.setProperty('PUSH_SUBS', JSON.stringify(li.slice(-6)));
  ensurePushTrigger_();
  return { id: pushKey_(sub.endpoint), devices: li.length };
}
function removePush_(endpoint) { PROPS.setProperty('PUSH_SUBS', JSON.stringify(pushSubs_().filter(x => x.endpoint !== endpoint))); return true; }
/** The service worker calls this when a push arrives: the next message waiting for this device, or a summary. */
function getPush_(endpoint) {
  const q = JSON.parse(PROPS.getProperty('PUSH_Q') || '{}'), k = pushKey_(endpoint), li = q[k] || [];
  const m = li.shift(); q[k] = li; PROPS.setProperty('PUSH_Q', JSON.stringify(q));
  return m || { title: 'Planner', body: pushSummary_().text, url: '', badge: pushSummary_().badge };
}
/** Tasks of yours due today or overdue (work only on workdays), for the icon badge and the fallback text. */
function pushSummary_() {
  const now = new Date(), d = Utilities.formatDate(now, TZ, 'yyyy-MM-dd'), dow = Number(Utilities.formatDate(now, TZ, 'u')) % 7, wk = dow === 5 || dow === 6;
  const open = readAll_('Tasks').filter(t => !/^(done|skipped|waiting)$/.test(t.status) && (!t.owner || t.owner === 'Me') && /^\d{4}-\d{2}-\d{2}$/.test(t.due) && t.due <= d && !(t.scope === 'work' && wk && t.due === d));
  const late = open.filter(t => t.due < d).length;
  return { badge: open.length, text: open.length ? open.length + ' due today' + (late ? ', ' + late + ' overdue' : '') : 'Nothing due right now.' };
}
/** A signed token per push service, reused for up to 12 hours. */
function vapidJwt_(endpoint) {
  const aud = endpoint.match(/^https:\/\/[^/]+/)[0], cache = JSON.parse(PROPS.getProperty('VAPID_JWT') || '{}'), now = Math.floor(Date.now() / 1000);
  if (cache[aud] && cache[aud].exp - 600 > now) return cache[aud].t;
  const enc = o => EC_.b64u(Utilities.newBlob(JSON.stringify(o)).getBytes().map(b => b & 255));
  const exp = now + 12 * 3600, input = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: aud, exp: exp, sub: 'https://7mndis.github.io/planner/' });
  const t = input + '.' + EC_.b64u(EC_.sign(Utilities.newBlob(input).getBytes().map(b => b & 255), vapid_().d));
  cache[aud] = { t: t, exp: exp }; PROPS.setProperty('VAPID_JWT', JSON.stringify(cache));
  return t;
}
function webPush_(endpoint) {
  const r = UrlFetchApp.fetch(endpoint, { method: 'post', headers: { Authorization: 'vapid t=' + vapidJwt_(endpoint) + ', k=' + vapid_().pub, TTL: '86400', Urgency: 'high' }, payload: '', muteHttpExceptions: true });
  return { code: r.getResponseCode(), body: r.getContentText().slice(0, 200) };
}
/** Queues a message for each device (or one) and wakes it with an empty push. Devices the push service no longer knows are dropped. */
function sendPush_(msg, onlyEndpoint) {
  const subs = pushSubs_().filter(x => !onlyEndpoint || x.endpoint === onlyEndpoint); if (!subs.length) return [];
  const q = JSON.parse(PROPS.getProperty('PUSH_Q') || '{}'), sum = pushSummary_();
  const m = { title: msg.title, body: msg.body || '', url: msg.url || '', tag: msg.tag || '', badge: sum.badge, at: new Date().toISOString() };
  subs.forEach(s => { q[s.id] = (q[s.id] || []).concat([m]).slice(-5); });
  PROPS.setProperty('PUSH_Q', JSON.stringify(q));
  const out = subs.map(s => { let r; try { r = webPush_(s.endpoint); } catch (e) { r = { code: 0, body: String(e.message || e) }; } return { device: s.label, code: r.code, body: r.body, endpoint: s.endpoint }; });
  const gone = out.filter(r => r.code === 404 || r.code === 410).map(r => r.endpoint);
  if (gone.length) PROPS.setProperty('PUSH_SUBS', JSON.stringify(pushSubs_().filter(x => gone.indexOf(x.endpoint) < 0)));
  return out.map(r => ({ device: r.device, code: r.code, body: r.body }));
}
function testPush_(endpoint) { return sendPush_({ title: 'Planner alerts are on', body: 'This came from your planner itself. ' + pushSummary_().text, url: '', tag: 'test' }, endpoint); }
/** Runs every 5 minutes: Plan Your Day at 8 AM, and a nudge once when a timed task of yours is missed. */
function pushTick() {
  if (!pushSubs_().length) return;
  const now = new Date(), d = Utilities.formatDate(now, TZ, 'yyyy-MM-dd'), n = Number(Utilities.formatDate(now, TZ, 'H')) * 60 + Number(Utilities.formatDate(now, TZ, 'm'));
  const dow = Number(Utilities.formatDate(now, TZ, 'u')) % 7, wk = dow === 5 || dow === 6;
  let sent = {}; try { sent = JSON.parse(PROPS.getProperty('PUSH_SENT') || '{}'); } catch (e) {}
  Object.keys(sent).forEach(k => { if (k.indexOf(d) < 0) delete sent[k]; });
  const tm = s => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
  const fmt = m => ((Math.floor(m / 60) % 12) || 12) + ':' + ('0' + (m % 60)).slice(-2) + (m >= 720 ? ' PM' : ' AM');
  const tasks = readAll_('Tasks'), mine = t => !t.owner || t.owner === 'Me';
  // Plan Your Day: once, between 8:00 and 9:00, unless already planned or skipped
  if (n >= 480 && n < 540 && !sent['plan:' + d]) {
    const r = readAll_('Routines').filter(x => x.id === 'r_plan' && x.active !== false)[0];
    const lg = readAll_('Log').filter(x => x.id === 'r_plan_' + d)[0];
    if (r && !(lg && /^(done|skipped)$/.test(lg.status))) {
      const left = tasks.filter(t => mine(t) && !/^(done|skipped|waiting)$/.test(t.status) && /^\d{4}-\d{2}-\d{2}$/.test(t.due) && t.due < d && !(t.scope === 'work' && wk)).length;
      const untimed = tasks.filter(t => mine(t) && !/^(done|skipped|waiting)$/.test(t.status) && t.due === d && !t.time && !(t.scope === 'work' && wk)).length;
      sendPush_({ title: 'Plan Your Day', body: (left ? left + ' left over, ' : '') + (untimed ? untimed + ' without a time. ' : '') + 'About two minutes.', url: '#plan', tag: 'plan' });
      sent['plan:' + d] = 1;
    }
  }
  // Missed: a timed task of yours still open 10 minutes after it should have ended (within 3 hours), once
  tasks.filter(t => mine(t) && !/^(done|skipped|waiting)$/.test(t.status) && t.due === d && tm(t.time) >= 0 && !(t.scope === 'work' && wk)).forEach(t => {
    const end = tm(t.time) + (Number(t.dur) || 30), k = 'miss:' + t.id + ':' + d;
    if (n >= end + 10 && n <= end + 180 && !sent[k]) { sendPush_({ title: 'Missed: ' + t.title, body: 'It was at ' + fmt(tm(t.time)) + '. Tap to do it now or move it.', url: '#task=' + t.id, tag: 'miss-' + t.id }); sent[k] = 1; }
  });
  PROPS.setProperty('PUSH_SENT', JSON.stringify(sent));
}
function ensurePushTrigger_() {
  if (ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'pushTick')) return;
  ScriptApp.newTrigger('pushTick').timeBased().everyMinutes(5).create();
}
/** Run once from the editor: makes the keys, asks for the push and trigger permissions and starts the 5-minute check. */
function setupPush() { const k = vapid_(); ensurePushTrigger_(); Logger.log('Push ready. Public key length ' + k.pub.length); return k.pub.length; }
/** Checks the signed token against Apple's push service without a real device: Apple answers BadDeviceToken when the token is good, BadJwtToken when it isn't. */
function pushProbe_() { const r = UrlFetchApp.fetch('https://web.push.apple.com/QGJhZGRldmljZXRva2Vu', { method: 'post', headers: { Authorization: 'vapid t=' + vapidJwt_('https://web.push.apple.com/x') + ', k=' + vapid_().pub, TTL: '60' }, payload: '', muteHttpExceptions: true }); return { code: r.getResponseCode(), body: r.getContentText().slice(0, 200) }; }
