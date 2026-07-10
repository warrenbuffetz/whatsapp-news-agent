# WhatsApp / Telegram Market Agents

Serverless apartments on Next.js (Vercel):

1. **SOXL carbon-copy brief** — WhatsApp on-demand + Telegram morning/night cron  
2. **Run club coach** — Telegram cron (Tue/Thu/Sat)

## SOXL architecture

```
Cron (weekday)
  → GET /api/soxl/morning  (7:00 AM ET / 11:00 UTC EDT)
  → GET /api/soxl/night    (5:00 PM ET / 21:00 UTC EDT)
  → Live iShares SOXX holdings + Yahoo/Nasdaq quotes
  → Finnhub (VIX / P/E / shares / ticker news) + optional TheNewsAPI macro + Reddit
  → Gemini 2.5 Flash (morning = why up/down; night = wrap + UP/DOWN prediction)
  → Dedicated SOXL Telegram bot/group (HTML-formatted)

WhatsApp
  → POST /api/whatsapp ("Good morning")
  → same SOXL generator (auto morning/night by ET hour)
  → Twilio outbound (truncated for WhatsApp length)
```

## Cron schedules (`vercel.json`)

| Path | Schedule | Meaning (EDT) |
|------|----------|---------------|
| `/api/run-club` | `0 10 * * 2,4,6` | Tue/Thu/Sat 6:00 AM ET |
| `/api/soxl/morning` | `0 11 * * 1-5` | Weekdays 7:00 AM ET |
| `/api/soxl/night` | `0 21 * * 1-5` | Weekdays 5:00 PM ET |

When EST returns (UTC-5), shift UTC hours +1 if you want to keep wall-clock ET times.

## Setup

```bash
npm install
cp .env.example .env.local
# also see lib/soxl/env.example and lib/run-club/env.example
npm run dev
```

### Local SOXL smoke

```bash
curl "http://localhost:3000/api/soxl/morning"
curl "http://localhost:3000/api/soxl/night"
```

No `Authorization` header required when `NODE_ENV !== production`.

### Production cron auth

Vercel sends `Authorization: Bearer $CRON_SECRET`. Set `CRON_SECRET` in the Vercel dashboard.

### Telegram

**Run-club** uses `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.

**SOXL** uses a **dedicated** bot and group (no fallback to run-club):

| Variable | Required | Notes |
|----------|----------|-------|
| `TELEGRAM_SOXL_BOT_TOKEN` | yes (SOXL cron) | New BotFather HTTP API token |
| `TELEGRAM_SOXL_CHAT_ID` | yes (SOXL cron) | New group ID (often `-100…`) |

```bash
# After adding the bot to the group and sending a message:
curl "https://api.telegram.org/bot<TELEGRAM_SOXL_BOT_TOKEN>/getUpdates"
```

## Env vars (SOXL)

| Variable | Required | Notes |
|----------|----------|-------|
| `GEMINI_API_KEY` | yes | Brief generation (`gemini-2.5-flash`) |
| `FINNHUB_API_KEY` | recommended | VIX, P/E, shares, ticker-native news |
| `THE_NEWS_API_TOKEN` | optional | Single macro search per brief (not per-ticker) |
| `TELEGRAM_SOXL_BOT_TOKEN` | yes (cron) | Dedicated SOXL bot |
| `TELEGRAM_SOXL_CHAT_ID` | yes (cron) | Dedicated SOXL group |
| `CRON_SECRET` | yes (prod) | Cron bearer token |
| Twilio vars | yes (WhatsApp) | On-demand “Good morning” |

Holdings are fetched daily (iShares CSV → StockAnalysis via Jina → static JSON fallback). Quotes use Yahoo spark with Nasdaq fallback, then Finnhub fills VIX / ETF metrics. Ticker news comes from Finnhub; TheNewsAPI is at most one macro call. Missing stats are omitted (not printed as “not available”). Reddit may 403; the brief still runs.

**Brief modes**
- Morning: why SOXL is up/down (momentum) — no prediction
- Night: full carbon-copy wrap + `Prediction: UP|DOWN`


## Deploy (Vercel)

1. Framework Preset: **Next.js**; Output Directory override **OFF** (blank).
2. Add env vars from `.env.example` + `lib/soxl/env.example`.
3. Redeploy so crons register from `vercel.json`.

## Status

- [x] SOXL holdings + impact math (weight × day% × ~3x)
- [x] Yahoo/Nasdaq quotes + Finnhub VIX / fundamentals merge
- [x] Finnhub ticker news + optional TheNewsAPI macro (1 call)
- [x] Reddit sentiment (r/SOXL, semis, stocks, WSB)
- [x] Gemini brief (no EOY footer) + night prediction
- [x] Telegram HTML formatting (impact in monospace)
- [x] WhatsApp “Good morning” → SOXL brief
- [x] Run club apartment (unchanged)
