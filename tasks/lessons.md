# Lessons

## SOXL data sources
- Prefer ticker-native free APIs (Finnhub company-news) over blasting TheNewsAPI per ticker — free tiers die fast (~13 calls/brief).
- Never print "not available today" for optional stats; omit the line when null.
- Format impact tables in code for Telegram (no tab columns); don't rely on the LLM to layout numbers.
- Yahoo spark often 429s; Nasdaq is a good day-% fallback but skips VIX — enrich VIX via Finnhub.
- Dedicated TELEGRAM_SOXL_* creds; do not fall back to run-club Telegram.

## Company blurbs
- Never paste raw headlines into blurbs — Finnhub often returns generic "S&P movers" / wrong-company wire.
- Relevance-gate headlines in code; if none pass, force "No new company-specific news…; {Name} was a {top/bottom-five|high/mid/low} SOXL-impact name."
- Impact tier is computed from |SOXL impact| rank, not guessed by the LLM.
- Mid-pack coverage only when relevant news exists; always include top + bottom five.

## Predictions & Telegram
- Night label is dynamic: "Tomorrow's prediction" vs "Next week's prediction on open" (Friday/weekend/NYSE holiday gap) via market-calendar.ts; enforce in code.
- Day brief = intraday / pre-EOD stance only; night = next-session action plan + swing/risk from session activity.
- Multi-chunk Telegram messages must be prefixed with (i/n) for reference.
- Append code playbooks (up/down scenarios) + concentration/relative strength/events; log night calls for hit-rate scorekeeping (call-log.json + /tmp on serverless).
- Gemini: retry 429 with capped backoff; on daily quota exhaustion use code-only fallback brief (do not wait out the day). Finnhub: retry 429/503 up to 3×.

