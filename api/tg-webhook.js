// api/tg-webhook.js — debug-friendly & handles more update types

const admin = require('firebase-admin');

let db=null;
function ensureFirebase(){
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

function parseDuration(text, fallbackMs) {
  const m = String(text||'').trim().match(/^(\d+)\s*([smh]?)$/i);
  if (!m) return fallbackMs;
  const n = parseInt(m[1],10);
  const unit = (m[2]||'s').toLowerCase();
  return Math.max(1000, n * (unit==='h'?3600_000 : unit==='m'?60_000 : 1000));
}

function extractMessage(update) {
  // Support DMs, groups, channels, edits, and callback queries
  const msg =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.edited_channel_post ||
    (update.callback_query && {
      // synthesize a "message-like" object
      text: update.callback_query.data,
      from: update.callback_query.from,
      chat: update.callback_query.message?.chat
    }) ||
    null;
  return msg;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(200).send('ok');

    const update = req.body || {};
    const msg = extractMessage(update);

    // Always ACK so Telegram won't time out
    res.status(200).send('ok');

    // From here on, do best-effort work and log what we saw
    const db = ensureFirebase();
    const now = Date.now();

    // Log the raw update (trimmed) to /debug so we can see what Telegram sent
    const debugPayload = {
      at: now,
      hasMessage: !!msg,
      text: msg?.text || msg?.caption || null,
      from: msg?.from?.username
        ? '@' + msg.from.username
        : [msg?.from?.first_name, msg?.from?.last_name].filter(Boolean).join(' ') || null,
      chatId: msg?.chat?.id || null,
      updateKeys: Object.keys(update || {})
    };
    await db.ref('/debug/lastUpdate').set(debugPayload);

    if (!msg) return; // nothing actionable

    const text = (msg.text || msg.caption || '').trim();
    const from = debugPayload.from || 'unknown';
    const defaultMs = Math.max(1000, (parseInt(process.env.BEACON_SECONDS || '30', 10) * 1000));

    let durationMs = defaultMs;
    if (/^\/off\b/i.test(text)) durationMs = 0;
    else if (/^\/on\b/i.test(text)) durationMs = parseDuration(text.replace(/^\/on/i,'').trim(), defaultMs);

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
    console.error('tg-webhook error:', e && e.message ? e.message : e);
    try { if (!res.headersSent) res.status(200).send('ok'); } catch {}
  }
};
