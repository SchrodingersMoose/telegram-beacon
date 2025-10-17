// /api/echo.js — logs ANY request to /debug/lastEcho so we can see Telegram's payload
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

function getRawBody(req) {
  return new Promise((resolve) => {
    // If Vercel already parsed the body:
    if (req.body && typeof req.body !== 'undefined') {
      return resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    }
    // Otherwise collect the stream:
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data || ''));
    req.on('error', () => resolve(''));
  });
}

module.exports = async (req, res) => {
  try {
    const db = ensureFirebase();
    const raw = await getRawBody(req);

    let parsed=null, parseError=null, text=null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parseError = String(e); }
    if (parsed) {
      const msg = parsed.message || parsed.edited_message || parsed.channel_post || parsed.edited_channel_post || null;
      text = (msg && (msg.text || msg.caption)) || null;
    }

    await db.ref('/debug/lastEcho').set({
      at: Date.now(),
      method: req.method,
      url: req.url,
      headers: {
        'content-type': req.headers['content-type'] || null,
        'user-agent': req.headers['user-agent'] || null,
        'x-telegram-bot-api-secret-token': req.headers['x-telegram-bot-api-secret-token'] || null
      },
      rawLen: raw.length,
      parseError,
      hasParsed: !!parsed,
      text
    });

    // Always ACK so Telegram doesn't retry
    res.status(200).send('ok');
  } catch (e) {
    try { res.status(200).send('ok'); } catch {}
  }
};
