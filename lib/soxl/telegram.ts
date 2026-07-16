import axios from "axios";

const TELEGRAM_MAX = 4000;
/** Reserve room for "(i/n)\n" page prefix on multi-chunk sends. */
const PAGE_PREFIX_BUDGET = 12;

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

/**
 * Chunk for Telegram and, when multi-page, prefix each part with (i/n).
 * Uses a slightly smaller body budget so the prefix still fits under TELEGRAM_MAX.
 */
export function chunkTelegramMessageWithPages(
  text: string,
  max = TELEGRAM_MAX,
): string[] {
  const provisional = chunkTelegramMessage(text, max);
  if (provisional.length <= 1) return provisional;

  const bodyMax = max - PAGE_PREFIX_BUDGET;
  const bodies = chunkTelegramMessage(text, bodyMax);
  const n = bodies.length;
  return bodies.map((body, i) => `(${i + 1}/${n})\n${body}`);
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
 * Light HTML for Telegram: bold title/headers, monospace impact block.
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

    if (/^Impact \(est\. SOXL contribution\)$/.test(line)) {
      flushImpact();
      inImpact = true;
      impactLines.push(line);
      continue;
    }

    if (inImpact) {
      if (
        /^(Other Stats|My Take:|Tomorrow's prediction:|Next week's prediction on open:|Prediction:|No News to Mention:|Info|Main story:|Momentum playbook)/.test(
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
      /^(Main story:|My Take:|No News to Mention:|Other Stats|Info|Momentum playbook)(.*)$/,
    );
    if (headerMatch) {
      out.push(`<b>${headerMatch[1]}</b>${headerMatch[2]}`);
      continue;
    }

    out.push(line);
  }

  flushImpact();
  return out.join("\n");
}

/**
 * Posts to the dedicated SOXL Telegram bot/group.
 * Does not fall back to run-club TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID.
 */
type TelegramSendResponse = {
  ok: boolean;
  description?: string;
  error_code?: number;
};

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
