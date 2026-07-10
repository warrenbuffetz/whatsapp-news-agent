/**
 * Gate Finnhub/wire headlines so blurbs only use company-specific,
 * potentially price-moving news — not generic "market movers" paste.
 */

const JUNK_HEADLINE =
  /\b(movers?|most active|stay informed|roundup|wall street roundup|s&p\s*500|s&p500|dow jones|nasdaq composite|today'?s session|what'?s going on in today|stocks to watch|pre[- ]?market movers|after[- ]?hours movers)\b/i;

const CATALYST =
  /\b(earnings?|guidance|outlook|raises?|cuts?|price target|upgrade|downgrade|initiates?|export|ban|sanction|china|taiwan|gpu|ai chip|semiconductor|foundry|fab|capacity|capex|lawsuit|settlement|acquisition|acquire|merger|buyback|dividend|ceo|cfo|resign|appoint|recall|shortage|supply|customer|design.?win|datacenter|h100|b200|blackwell)\b/i;

/** Other mega-cap names that often pollute ticker feeds. */
const OTHER_NAMES =
  /\b(docusign|spacex|openai|anthropic|tesla|apple|microsoft|amazon|meta|google|alphabet|netflix|allegro microsystems)\b/i;

/** Semi peers — if another ticker is named and ours is not, treat as mis-tagged. */
const SEMI_TICKERS =
  /\b(NVDA|AMD|AVGO|TSM|TSMC|MU|INTC|QCOM|AMAT|LRCX|KLAC|MRVL|TXN|ADI|ASML|ARM|SMCI|DELL|AVT|TER|STM|ON|SWKS|QRVO|MPWR|MCHP|NXPI|CRDO|ALAB)\b/gi;

function normalizeName(name: string): string {
  return name
    .replace(/\b(Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|Co\.?|Company|PLC|N\.?V\.?|SA|AG)\b/gi, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(name: string): string[] {
  return normalizeName(name)
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .map((t) => t.toLowerCase());
}

export interface NewsCandidate {
  headline: string;
  url: string | null;
  publishedAt: string | null;
}

export function scoreHeadlineRelevance(
  ticker: string,
  companyName: string,
  headline: string,
): number {
  const h = headline.trim();
  if (!h) return -100;

  let score = 0;
  const lower = h.toLowerCase();
  const tickerRe = new RegExp(`\\b${ticker}\\b`, "i");
  const hasTicker = tickerRe.test(h);

  if (JUNK_HEADLINE.test(h)) score -= 50;

  if (hasTicker) score += 40;

  const tokens = nameTokens(companyName);
  const hits = tokens.filter((tok) => lower.includes(tok)).length;
  if (hits > 0) score += Math.min(30, hits * 12);

  const hasIdentity = hasTicker || hits > 0;
  // Must be about this company — catalysts alone are not enough.
  if (!hasIdentity) score -= 45;

  if (CATALYST.test(h)) score += 25;

  // Mentions another famous company but not this ticker/name → likely mis-tagged.
  if (OTHER_NAMES.test(h) && !hasIdentity) {
    score -= 35;
  }

  const peerHits = [...h.matchAll(SEMI_TICKERS)].map((m) => m[0].toUpperCase());
  const foreignPeers = peerHits.filter((p) => p !== ticker.toUpperCase());
  if (foreignPeers.length > 0 && !hasIdentity) {
    score -= 40;
  } else if (foreignPeers.length > 0 && hasIdentity && foreignPeers.length >= 2) {
    // Roundup naming many semis — weaker single-name cue.
    score -= 15;
  }

  if (h.length < 28 && !hasTicker) score -= 10;

  return score;
}

/**
 * Pick the best company-specific headline, or null if nothing is relevant enough.
 * Threshold keeps "S&P movers" / wrong-company wires out of blurbs.
 */
export function pickRelevantHeadline(
  ticker: string,
  companyName: string,
  candidates: NewsCandidate[],
  minScore = 20,
): NewsCandidate | null {
  let best: NewsCandidate | null = null;
  let bestScore = minScore - 1;

  for (const c of candidates) {
    const score = scoreHeadlineRelevance(ticker, companyName, c.headline);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}
