# WhatsApp News & Weather Agent

Serverless **Inbound Trigger** backend for a WhatsApp morning brief bot.

## Architecture

```
User WhatsApp
  → Twilio Sandbox (POST /api/whatsapp)
  → HTTP 200 empty TwiML ack (immediate)
  → after() background job:
      ├── OpenWeatherMap  (Toronto)
      ├── NewsAPI         (US + CA headlines + market movers)
      ├── Gemini 1.5 Flash (curated brief)
      └── Twilio REST API (outbound WhatsApp reply)
```

## Stack

- **Next.js App Router** (Vercel serverless)
- **Twilio** — inbound webhook ack + async outbound messages
- **OpenWeatherMap** — Toronto weather (free tier)
- **NewsAPI** — US/CA top headlines + S&P/tech market query (free developer tier)
- **Google Gemini 1.5 Flash** (`@google/generative-ai`) — concise morning brief

## News pipeline

Three concurrent NewsAPI requests are merged and deduplicated by URL/title:

| Request | Endpoint | Purpose |
|---------|----------|---------|
| A | `top-headlines?country=us` | US headlines |
| B | `top-headlines?country=ca` | Canada headlines |
| C | `everything?q=(...)` | S&P 500 / Fed / NASDAQ / tech / rates |

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
2. Add all variables from `.env.example` in Project → Settings → Environment Variables.
3. Set `TWILIO_WEBHOOK_URL` to `https://<your-vercel-domain>/api/whatsapp`.
4. Update the Twilio sandbox webhook URL to match.

> **NewsAPI note:** The free developer tier only allows requests from `localhost`. For production you need a paid NewsAPI plan, or run fetches through a proxy during development.

## Status

- [x] Next.js scaffold + `/api/whatsapp` webhook
- [x] "Good morning" trigger phrase validation
- [x] Async ack + outbound Twilio REST reply
- [x] OpenWeatherMap fetch (Toronto)
- [x] NewsAPI fetch (US, CA, market movers) with deduplication
- [x] Gemini 1.5 Flash summarization
