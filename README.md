# Telegram Beacon (Vercel + Firebase)

DM a Telegram bot → lights a beacon on a webpage for N seconds and logs the message.

## Stack
- **Telegram bot** (inbound via webhook)
- **Vercel serverless function** (`/api/tg-webhook`) to receive updates
- **Firebase Realtime Database** for state/logs
- **Static page** (`/public/index.html`) subscribes to realtime updates

---

## 1) Firebase setup
1. Create a Firebase project → enable **Realtime Database** (test mode OK).
2. Project Settings → **Service accounts** → "Generate new private key" (download JSON).
3. Project Settings → **General → Your apps (Web)** → copy web config (apiKey, projectId, databaseURL).

You will use:
- `FIREBASE_SERVICE_ACCOUNT_JSON` → paste the *entire* JSON as a single line in Vercel env var.
- `FIREBASE_DATABASE_URL` → from your Firebase project (e.g., `https://YOURID-default-rtdb.firebaseio.com`).
- Web config → paste into `public/index.html` (search for "paste your Firebase web config").

## 2) Vercel deployment
- Import this repo into Vercel (or upload).
- In **Project → Settings → Environment Variables**, add:
  - `FIREBASE_SERVICE_ACCOUNT_JSON` = one-line JSON from the service account key
  - `FIREBASE_DATABASE_URL` = your database URL
  - `BEACON_SECONDS` = `30` (default on-time; optional)
  - `TELEGRAM_WEBHOOK_SECRET` = any random string (e.g., `p9Qn_7zR`)

Deploy. Your endpoints will be:
- Site: `https://<project>.vercel.app/`
- Webhook: `https://<project>.vercel.app/api/tg-webhook`

## 3) Telegram webhook
With your **bot token** from @BotFather, set the webhook (replace placeholders):
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<project>.vercel.app/api/tg-webhook&secret_token=<YOUR_SECRET>
```
- `<YOUR_SECRET>` must equal the `TELEGRAM_WEBHOOK_SECRET` you set in Vercel.

## 4) Test
- Visit your site root: should show **OFF**.
- DM your bot any message: beacon flips **ON** and your message appears in the log.
- Commands:
  - `/on 45s`, `/on 2m`, `/on 1h`
  - `/off`
  - arbitrary text also triggers default duration

## Troubleshooting
- **403 "nope"** in logs → mismatch between webhook `secret_token` and Vercel `TELEGRAM_WEBHOOK_SECRET`.
- **No updates** → check Vercel logs for JSON parse errors. Ensure service account JSON is one line.
- **Beacon stuck OFF** → verify `/beacon` is written in Realtime DB and your web config is correct in `index.html`.

## Notes
- Bot tokens are secrets; rotate with @BotFather if exposed.
- This is intentionally simple and unauthenticated. Add a passphrase or rate limit if you plan to share the URL widely.