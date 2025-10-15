const admin = require('firebase-admin');
let db=null;
function ensureFirebase(){
  if (db) return db;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
  const svc = JSON.parse(raw);
  if (svc.private_key) svc.private_key = svc.private_key.replace(/\\n/g, '\n');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(svc),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
  db = admin.database();
  return db;
}
module.exports = async (req, res) => {
  try {
    const db = ensureFirebase();
    const now = Date.now();
    await db.ref('/logs').push({ from:'test-endpoint', body:'hello', receivedAt: now });
    await db.ref('/beacon').set({
      on:true, expiresAt: now + 15000,
      lastMessage: { from:'test-endpoint', body:'hello', receivedAt: now }
    });
    res.status(200).json({ ok:true });
  } catch (e) {
    console.error('test-write error:', e);
    res.status(500).json({ ok:false, error: String(e) });
  }
};
