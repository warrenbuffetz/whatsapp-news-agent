# WhatsApp News & Weather Agent

Serverless **Inbound Trigger** backend for a WhatsApp morning brief bot.

## Architecture

```
User WhatsApp
  → Twilio Sandbox (POST /api/whatsapp)
  → HTTP 200 empty TwiML ack (immediate)
  → after() background job:
      ├── OpenWeatherMap  (Toronto)
      ├── The News API   (US + CA headlines + market movers)
      ├── Gemini 1.5 Flash (curated brief)
      └── Twilio REST API (outbound WhatsApp reply)
```

## Stack

- **Next.js App Router** (Vercel serverless)
- **Twilio** — inbound webhook ack + async outbound messages
- **OpenWeatherMap** — Toronto weather (free tier)
- **The News API** — US/CA top stories + S&P/tech market search (free tier)
- **Google Gemini 1.5 Flash** (`@google/generative-ai`) — concise morning brief

## News pipeline

Three concurrent The News API requests are merged and deduplicated by URL/title:

| Request | Endpoint | Purpose |
|---------|----------|---------|
| A | `GET /v1/news/top?locale=us` | US top stories |
| B | `GET /v1/news/top?locale=ca` | Canada top stories |
| C | `GET /v1/news/all?search=...` | S&P 500 / Fed / NASDAQ / tech / rates |

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment template and add your API keys:

   ```bash
   cp .env.example .env.local
   ```

3. Run locally:

   ```bash
   npm run dev
   ```

4. Expose the webhook for Twilio (local dev):

   ```bash
   ngrok http 3000
   ```

   Set your Twilio WhatsApp sandbox **"When a message comes in"** URL to:

   ```
   https://<your-ngrok-host>/api/whatsapp
   ```

   Also set `TWILIO_WEBHOOK_URL` in `.env.local` to the same URL.

## Webhook

| Method | Path           | Purpose                        |
|--------|----------------|--------------------------------|
| POST   | `/api/whatsapp`| Twilio inbound message webhook |

Send **Good morning** to the sandbox number. The endpoint acks immediately; your brief arrives via outbound WhatsApp within ~10–30 seconds.

## Deploy (Vercel)

1. Push to GitHub and import the repo in [Vercel](https://vercel.com).
2. In **Project → Settings → General → Build & Development Settings**, confirm:
   - **Framework Preset:** `Next.js`
   - **Build Command:** `npm run build` (or leave default)
   - **Output Directory:** **turn OFF the override** — the field must be completely blank. Do not type `empty`, `public`, or `.next`; Vercel sets this automatically for Next.js.
3. Add all variables from `.env.example` in Project → Settings → Environment Variables.
4. Set `TWILIO_WEBHOOK_URL` to `https://<your-vercel-domain>/api/whatsapp`.
5. Update the Twilio sandbox webhook URL to match.

> **Build errors about `public` or `empty` output directory?** The Output Directory override is misconfigured. Disable the override so the field is blank, set Framework Preset to Next.js, then redeploy.

## Status

- [x] Next.js scaffold + `/api/whatsapp` webhook
- [x] "Good morning" trigger phrase validation
- [x] Async ack + outbound Twilio REST reply
- [x] OpenWeatherMap fetch (Toronto)
- [x] The News API fetch (US, CA, market movers) with deduplication
- [x] Gemini 1.5 Flash summarization
