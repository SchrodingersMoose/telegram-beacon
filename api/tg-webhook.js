// /api/tg-webhook.js — robust parser + fast ACK + debug breadcrumbs
const admin = require('firebase-admin');

let db = null;
function ensureFirebase() {
  if (db) return db;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
  const svc = JSON.parse(raw);
  if (svc.private_key) svc.private_key = String(svc.private_key).replace(/\\n/g, '\n');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(svc),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
  db = admin.database();
  return db;
}

// Read raw body even if middleware didn’t parse JSON
function getRawBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined) {
      // Vercel may have parsed it already
      return resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    }
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data || ''));
    req.on('error', () => resolve(''));
  });
}

function parseDuration(text, fallbackMs) {
  const m = String(text || '').trim().match(/^(\d+)\s*([smh]?)$/i);
  if (!m) return fallbackMs;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 's').toLowerCase();
  return Math.max(1000, n * (unit === 'h' ? 3600_000 : unit === 'm' ? 60_000 : 1000));
}

function extractMessage(update) {
  return (
    update?.message ||
    update?.edited_message ||
    update?.channel_post ||
    update?.edited_channel_post ||
    (update?.callback_query && {
      text: update.callback_query.data,
      from: update.callback_query.from,
      chat: update.callback_query.message?.chat
    }) ||
    null
  );
}

module.exports = async (req, res) => {
  // ACK ASAP so Telegram never times out
  if (req.method !== 'POST') return res.status(200).send('ok');
  res.status(200).send('ok');

  try {
    const db = ensureFirebase();

    // Breadcrumb: heartbeat
    await db.ref('/debug/lastHit').set({ at: Date.now(), route: 'tg-webhook', method: req.method });

    // Parse update safely
    const raw = await getRawBody(req);
    let update = null;
    try { update = raw ? JSON.parse(raw) : (typeof req.body === 'object' ? req.body : null); }
    catch { /* ignore; logged below */ }

    if (!update) {
      await db.ref('/debug/lastError').set({ at: Date.now(), reason: 'no/update/body', rawLen: raw.length });
      return;
    }

    const msg = extractMessage(update);
    await db.ref('/debug/lastUpdate').set({
      at: Date.now(),
      hasMessage: !!msg,
      keys: Object.keys(update || {}),
    });

    if (!msg) return;

    const text = (msg.text || msg.caption || '').trim();
    const from = msg.from?.username
      ? '@' + msg.from.username
      : [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'unknown';

    const now = Date.now();
    const defaultMs = Math.max(1000, parseInt(process.env.BEACON_SECONDS || '30', 10) * 1000);

    let durationMs = defaultMs;
    if (/^\/off\b/i.test(text)) durationMs = 0;
    else if (/^\/on\b/i.test(text)) durationMs = parseDuration(text.replace(/^\/on/i, '').trim(), defaultMs);

    const expiresAt = now + (durationMs || 0);

    await Promise.all([
      db.ref('/logs').push({ from, body: text || '[non-text]', chatId: msg.chat?.id, receivedAt: now }),
      db.ref('/beacon').set({
        on: durationMs > 0,
        expiresAt,
        lastMessage: { from, body: text || '[non-text]', receivedAt: now }
      })
    ]);
  } catch (e) {
    try {
      const db = ensureFirebase();
      await db.ref('/debug/lastException').set({ at: Date.now(), error: String(e) });
    } catch {}
  }
};
