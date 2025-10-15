// api/tg-webhook.js
// Fast-ACK Telegram webhook -> Firebase Realtime DB beacon

const admin = require('firebase-admin');

let appInited = false;
function initAdmin() {
  if (!appInited) {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(svc),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    appInited = true;
  }
}

function parseDuration(text, fallbackMs) {
  const m = String(text||"").trim().match(/^(\d+)\s*([smh]?)$/i);
  if (!m) return fallbackMs;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 's').toLowerCase();
  return Math.max(1000, n * (unit==='h'?3600_000 : unit==='m'?60_000 : 1000));
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(200).send('ok');

    // OPTIONAL secret check (comment out if unsure)
    const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
    if (SECRET) {
      const got = req.headers['x-telegram-bot-api-secret-token'];
      if (got !== SECRET) return res.status(401).send('nope');
    }

    // Telegram sometimes retries; always ACK quickly
    // Parse minimal fields without blocking on DB writes
    const update = req.body || {};
    const msg = update.message || update.edited_message || null;

    // ACK ASAP so Telegram won't time out
    res.status(200).send('ok');

    if (!msg) return;

    // From here on, do the work best-effort
    initAdmin();
    const db = admin.database();

    const text = (msg.text || msg.caption || '').trim();
    const from = msg.from?.username
      ? '@' + msg.from.username
      : [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'unknown';

    const now = Date.now();
    const defaultMs = Math.max(1000, (parseInt(process.env.BEACON_SECONDS || '30', 10) * 1000));

    let durationMs = defaultMs;
    if (/^\/off\b/i.test(text)) {
      await db.ref('/beacon').set({
        on: false,
        expiresAt: now,
        lastMessage: { from, body: text, receivedAt: now }
      });
      await db.ref('/logs').push({ from, body: text, chatId: msg.chat?.id, receivedAt: now });
      return;
    }
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
    // swallow errors post-ACK to avoid retries; use Vercel logs for debugging
    console.error('tg-webhook error:', e);
    try { res.headersSent || res.status(200).send('ok'); } catch {}
  }
};    : [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'unknown';

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
