// api/tg-webhook.js
// Fast-ACK Telegram webhook -> Firebase Realtime DB beacon (with key normalization)

const admin = require('firebase-admin');

let db = null;

function ensureFirebase() {
  if (db) return db;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
  const svc = JSON.parse(raw);
  if (svc.private_key && typeof svc.private_key === 'string') {
    // Convert literal "\n" into real newlines
    svc.private_key = svc.private_key.replace(/\\n/g, '\n');
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(svc),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
  db = admin.database();
  return db;
}

function parseDuration(text, fallbackMs) {
  const m = String(text || '').trim().match(/^(\d+)\s*([smh]?)$/i);
  if (!m) return fallbackMs;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 's').toLowerCase();
  return Math.max(1000, n * (unit === 'h' ? 3600_000 : unit === 'm' ? 60_000 : 1000));
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(200).send('ok');

    // Optional shared-secret check
  

    // Parse minimal fields first, then ACK immediately
    const update = req.body || {};
    const msg = update.message || update.edited_message || null;

    // ACK ASAP so Telegram doesn't time out
    res.status(200).send('ok');

    if (!msg) return;

    const db = ensureFirebase();

    const text = (msg.text || msg.caption || '').trim();
    const from = msg.from?.username
      ? '@' + msg.from.username
      : [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'unknown';

    const now = Date.now();
    const defaultMs = Math.max(1000, (parseInt(process.env.BEACON_SECONDS || '30', 10) * 1000));

    if (/^\/off\b/i.test(text)) {
      await Promise.all([
        db.ref('/logs').push({ from, body: text, chatId: msg.chat?.id, receivedAt: now }),
        db.ref('/beacon').set({
          on: false,
          expiresAt: now,
          lastMessage: { from, body: text, receivedAt: now }
        })
      ]);
      return;
    }

    let durationMs = defaultMs;
    if (/^\/on\b/i.test(text)) {
      durationMs = parseDuration(text.replace(/^\/on/i, '').trim(), defaultMs);
    }

    const expiresAt = now + durationMs;

    await Promise.all([
      db.ref('/logs').push({ from, body: text || '[non-text]', chatId: msg.chat?.id, receivedAt: now }),
      db.ref('/beacon').set({
        on: true,
        expiresAt,
        lastMessage: { from, body: text || '[non-text]', receivedAt: now }
      })
    ]);
  } catch (e) {
    console.error('tg-webhook error:', e && e.message ? e.message : e);
    try { if (!res.headersSent) res.status(200).send('ok'); } catch {}
  }
};
