// Telegram webhook -> Firebase Realtime DB beacon
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(svc),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}
const db = admin.database();
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";

function parseDuration(text, fallbackMs) {
  const m = String(text||"").trim().match(/^(\d+)\s*([smh]?)$/i);
  if (!m) return fallbackMs;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 's').toLowerCase();
  return Math.max(1000, n * (unit==='h'?3600_000 : unit==='m'?60_000 : 1000));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ok');

  if (SECRET) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== SECRET) return res.status(401).send('nope');
  }

  const update = req.body || {};
  const msg = update.message || update.edited_message;
  if (!msg) return res.status(200).send('ok');

  const text = (msg.text || msg.caption || '').trim();
  const from = msg.from?.username
    ? '@' + msg.from.username
    : [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'unknown';

  const now = Date.now();
  const defaultMs = Math.max(1000, (parseInt(process.env.BEACON_SECONDS || '30', 10) * 1000));

  if (/^\/off\b/i.test(text)) {
    await db.ref('/beacon').set({ on:false, expiresAt:now, lastMessage:{ from, body:text, receivedAt:now } });
    return res.status(200).send('ok');
  }

  let durationMs = defaultMs;
  if (/^\/on\b/i.test(text)) {
    durationMs = parseDuration(text.replace(/^\/on/i, '').trim(), defaultMs);
  }

  const expiresAt = now + durationMs;

  await db.ref('/logs').push({
    from, body: text || '[non-text]', chatId: msg.chat?.id, receivedAt: now
  });

  await db.ref('/beacon').set({
    on:true, expiresAt,
    lastMessage: { from, body: text || '[non-text]', receivedAt: now }
  });

  return res.status(200).send('ok');
};
