import axios from "axios";

const TELEGRAM_MAX = 4000;
/** Reserve room for "(i/n)\n" page prefix on multi-chunk sends. */
const PAGE_PREFIX_BUDGET = 12;
const CONTINUATION_HEADER = "Company updates (cont.)";
const CONTINUATION_HEADER_BUDGET = CONTINUATION_HEADER.length + 2;

const TICKER_BLURB_RE =
  /^([A-Z][A-Z0-9.]{0,4}) \(P\/E: (.+?)\) (.+)$/;
const SECTION_START_RE =
  /^(Day update|Nightly update|Why is SOXL |SOXL overnight|Info|Main story:|Impact \(est\. SOXL contribution\)|No News to Mention:|Other Stats|My Take:|Tomorrow's prediction:|Next week's prediction on open:|Prediction:|What to do|Momentum playbook|Event risk|Night call log)/;

function getSoXlBotToken(): string {
  const botToken = process.env.TELEGRAM_SOXL_BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error("Missing TELEGRAM_SOXL_BOT_TOKEN");
  }
  return botToken;
}

function getSoXlChatId(): string {
  const chatId = process.env.TELEGRAM_SOXL_CHAT_ID?.trim();
  if (!chatId) {
    throw new Error("Missing TELEGRAM_SOXL_CHAT_ID");
  }
  return chatId;
}

function isTickerBlurbLine(line: string): boolean {
  return TICKER_BLURB_RE.test(line.trim());
}

function isSoXlBrief(text: string): boolean {
  return /^(Day update|Nightly update) —/m.test(text);
}

/**
 * Split a SOXL brief into packable blocks — never breaks a ticker blurb mid-line.
 * Each company line is its own block so page 2+ starts on a clean ticker row.
 */
export function splitSoXlBriefIntoBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    const joined = buffer.join("\n").trim();
    if (joined) blocks.push(joined);
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (isTickerBlurbLine(trimmed)) {
      flushBuffer();
      blocks.push(trimmed);
      continue;
    }

    if (SECTION_START_RE.test(trimmed) && buffer.length > 0) {
      flushBuffer();
    }

    buffer.push(line);
  }

  flushBuffer();
  return blocks;
}

/** Greedy pack — prefers section/ticker boundaries over arbitrary newline splits. */
export function packBlocksIntoChunks(
  blocks: string[],
  max: number,
): string[] {
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };

  for (const block of blocks) {
    if (block.length > max) {
      pushCurrent();
      chunks.push(...chunkTelegramMessage(block, max));
      continue;
    }

    const separator = current ? "\n\n" : "";
    const candidate = current ? `${current}${separator}${block}` : block;

    if (candidate.length <= max) {
      current = candidate;
      continue;
    }

    pushCurrent();
    current = block;
  }

  pushCurrent();
  return chunks;
}

export function chunkTelegramMessage(text: string, max = TELEGRAM_MAX): string[] {
  if (text.length <= max) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > max) {
    let splitAt = remaining.lastIndexOf("\n", max);
    if (splitAt < max * 0.5) {
      splitAt = max;
    }
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function chunkSoXlBriefBodies(text: string, bodyMax: number): string[] {
  const blocks = splitSoXlBriefIntoBlocks(text);
  const packed = packBlocksIntoChunks(blocks, bodyMax);

  // Safety: if packing still produced an oversize chunk, fall back to line splits.
  return packed.flatMap((chunk) =>
    chunk.length > bodyMax ? chunkTelegramMessage(chunk, bodyMax) : [chunk],
  );
}

function needsContinuationHeader(body: string): boolean {
  const first = body.trimStart().split("\n")[0]?.trim() ?? "";
  return isTickerBlurbLine(first);
}

/**
 * Chunk for Telegram and, when multi-page, prefix each part with (i/n).
 * SOXL briefs use section-aware packing so page 2+ keeps full ticker rows.
 */
export function chunkTelegramMessageWithPages(
  text: string,
  max = TELEGRAM_MAX,
): string[] {
  const provisional = chunkTelegramMessage(text, max);
  if (provisional.length <= 1) return provisional;

  const bodyMax = max - PAGE_PREFIX_BUDGET;
  const bodies = isSoXlBrief(text)
    ? chunkSoXlBriefBodies(text, bodyMax)
    : chunkTelegramMessage(text, bodyMax);

  const n = bodies.length;
  return bodies.map((body, i) => {
    let content = body;
    if (i > 0 && needsContinuationHeader(body)) {
      const budget = bodyMax - CONTINUATION_HEADER_BUDGET;
      if (content.length > budget) {
        content = chunkTelegramMessage(content, budget)[0] ?? content;
      }
      content = `${CONTINUATION_HEADER}\n\n${content}`;
    }
    return `(${i + 1}/${n})\n${content}`;
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const PREDICTION_HEADER_RE =
  /^(Tomorrow's prediction|Next week's prediction on open|Prediction):(.*)$/;

/**
 * Light HTML for Telegram: bold title/headers, monospace impact block, bold tickers.
 */
export function formatTelegramHtml(text: string): string {
  const escaped = escapeHtml(text);
  const lines = escaped.split("\n");
  const out: string[] = [];
  let inImpact = false;
  const impactLines: string[] = [];
  let contentStart = 0;

  if (lines[0] && /^\(\d+\/\d+\)$/.test(lines[0])) {
    out.push(`<b>${lines[0]}</b>`);
    contentStart = 1;
  }

  const flushImpact = () => {
    if (!impactLines.length) return;
    out.push(`<pre>${impactLines.join("\n")}</pre>`);
    impactLines.length = 0;
    inImpact = false;
  };

  for (let i = contentStart; i < lines.length; i++) {
    const line = lines[i];

    if (line === CONTINUATION_HEADER) {
      flushImpact();
      out.push(`<b>${line}</b>`);
      continue;
    }

    const tickerBlurb = line.match(TICKER_BLURB_RE);
    if (tickerBlurb) {
      flushImpact();
      out.push(
        `<b>${tickerBlurb[1]}</b> (P/E: ${tickerBlurb[2]}) ${tickerBlurb[3]}`,
      );
      continue;
    }

    if (/^Impact \(est\. SOXL contribution\)$/.test(line)) {
      flushImpact();
      inImpact = true;
      impactLines.push(line);
      continue;
    }

    if (inImpact) {
      if (
        /^(Other Stats|My Take:|Tomorrow's prediction:|Next week's prediction on open:|Prediction:|No News to Mention:|Info|Main story:|What to do|Momentum playbook|Company updates)/.test(
          line,
        )
      ) {
        flushImpact();
        // fall through to format this line
      } else {
        impactLines.push(line);
        continue;
      }
    }

    if (
      (i === contentStart || (contentStart === 1 && i === 1)) &&
      /^(Day update|Nightly update|Why is SOXL |SOXL overnight)/.test(line)
    ) {
      out.push(`<b>${line}</b>`);
      continue;
    }

    const predMatch = line.match(PREDICTION_HEADER_RE);
    if (predMatch) {
      out.push(`<b>${predMatch[1]}:</b>${predMatch[2]}`);
      continue;
    }

    const headerMatch = line.match(
      /^(Main story:|My Take:|No News to Mention:|Other Stats|Info|Momentum playbook|What to do)(.*)$/,
    );
    if (headerMatch) {
      out.push(`<b>${headerMatch[1]}</b>${headerMatch[2]}`);
      continue;
    }

    const actionMatch = line.match(/^(SELL|BUY MORE|HOLD):(.*)$/);
    if (actionMatch) {
      out.push(`<b>${actionMatch[1]}:</b>${actionMatch[2]}`);
      continue;
    }

    out.push(line);
  }

  flushImpact();
  return out.join("\n");
}

type TelegramSendResponse = {
  ok: boolean;
  description?: string;
  error_code?: number;
};

/**
 * Posts to the dedicated SOXL Telegram bot/group.
 * Does not fall back to run-club TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID.
 */
export async function sendSoXlTelegramMessage(text: string): Promise<number> {
  const botToken = getSoXlBotToken();
  const chatId = getSoXlChatId();
  // Chunk plain text first (with page numbers) so HTML tags are never split.
  const chunks = chunkTelegramMessageWithPages(text).map(formatTelegramHtml);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const { data } = await axios.post<TelegramSendResponse>(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: chunk,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 20_000,
      },
    );

    if (!data.ok) {
      const detail = data.description ?? "unknown Telegram error";
      throw new Error(
        `Telegram send failed (chunk ${i + 1}/${chunks.length}, code ${data.error_code ?? "?"}): ${detail}`,
      );
    }
  }

  return chunks.length;
}
