import { promises as fs } from "fs";
import path from "path";
import type { SwingBand } from "@/lib/soxl/session-activity";
import type { NextSessionKind } from "@/lib/soxl/market-calendar";

export interface CallLogEntry {
  id: string;
  recordedAt: string;
  briefDateEt: string;
  predictionHeader: string;
  nextSessionKind: NextSessionKind;
  nextSessionIso: string;
  call: "UP" | "DOWN";
  swingBand: SwingBand;
  soxlDayPct: number | null;
  top3ImpactSharePct: number | null;
  /** Filled after the target session. */
  resultSoxlDayPct: number | null;
  result: "hit" | "miss" | "flat" | "pending";
  resolvedAt: string | null;
}

interface CallLogFile {
  version: 1;
  entries: CallLogEntry[];
}

const MAX_ENTRIES = 200;

function dataPath(): string {
  return path.join(process.cwd(), "lib/soxl/data/call-log.json");
}

function tmpPath(): string {
  return path.join("/tmp", "soxl-call-log.json");
}

async function readLogFile(filePath: string): Promise<CallLogFile | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as CallLogFile;
    if (!parsed?.entries || !Array.isArray(parsed.entries)) return null;
    return { version: 1, entries: parsed.entries };
  } catch {
    return null;
  }
}

async function loadLog(): Promise<CallLogFile> {
  const primary = await readLogFile(dataPath());
  if (primary) return primary;
  const tmp = await readLogFile(tmpPath());
  if (tmp) return tmp;
  return { version: 1, entries: [] };
}

async function saveLog(log: CallLogFile): Promise<void> {
  const payload = JSON.stringify(log, null, 2);
  // Prefer durable project path (works locally); always also write /tmp for serverless.
  try {
    await fs.mkdir(path.dirname(dataPath()), { recursive: true });
    await fs.writeFile(dataPath(), payload, "utf8");
  } catch (error) {
    console.warn("[soxl/call-log] project path write failed", error);
  }
  try {
    await fs.writeFile(tmpPath(), payload, "utf8");
  } catch (error) {
    console.warn("[soxl/call-log] tmp write failed", error);
  }
}

function scoreResult(
  call: "UP" | "DOWN",
  soxlDayPct: number | null,
): "hit" | "miss" | "flat" | "pending" {
  if (soxlDayPct == null) return "pending";
  if (Math.abs(soxlDayPct) < 0.15) return "flat";
  const up = soxlDayPct > 0;
  if (call === "UP") return up ? "hit" : "miss";
  return up ? "miss" : "hit";
}

export async function recordNightCall(input: {
  briefDateEt: string;
  predictionHeader: string;
  nextSessionKind: NextSessionKind;
  nextSessionIso: string;
  call: "UP" | "DOWN";
  swingBand: SwingBand;
  soxlDayPct: number | null;
  top3ImpactSharePct: number | null;
}): Promise<CallLogEntry> {
  const log = await loadLog();
  const id = `${input.briefDateEt}_${input.nextSessionIso}_${input.call}`;

  // Upsert same-day call
  const existingIdx = log.entries.findIndex(
    (e) =>
      e.briefDateEt === input.briefDateEt &&
      e.nextSessionIso === input.nextSessionIso,
  );

  const entry: CallLogEntry = {
    id,
    recordedAt: new Date().toISOString(),
    briefDateEt: input.briefDateEt,
    predictionHeader: input.predictionHeader,
    nextSessionKind: input.nextSessionKind,
    nextSessionIso: input.nextSessionIso,
    call: input.call,
    swingBand: input.swingBand,
    soxlDayPct: input.soxlDayPct,
    top3ImpactSharePct: input.top3ImpactSharePct,
    resultSoxlDayPct: null,
    result: "pending",
    resolvedAt: null,
  };

  if (existingIdx >= 0) {
    const prev = log.entries[existingIdx];
    entry.result = prev.result;
    entry.resultSoxlDayPct = prev.resultSoxlDayPct;
    entry.resolvedAt = prev.resolvedAt;
    log.entries[existingIdx] = entry;
  } else {
    log.entries.push(entry);
  }

  if (log.entries.length > MAX_ENTRIES) {
    log.entries = log.entries.slice(-MAX_ENTRIES);
  }

  await saveLog(log);
  return entry;
}

/**
 * Resolve pending calls whose target session ISO is today or earlier (ET calendar).
 */
export async function resolvePendingCalls(
  todayIsoEt: string,
  soxlDayPct: number | null,
): Promise<CallLogEntry[]> {
  const log = await loadLog();
  const resolved: CallLogEntry[] = [];

  for (const entry of log.entries) {
    if (entry.result !== "pending") continue;
    if (entry.nextSessionIso > todayIsoEt) continue;
    entry.resultSoxlDayPct = soxlDayPct;
    entry.result = scoreResult(entry.call, soxlDayPct);
    entry.resolvedAt = new Date().toISOString();
    resolved.push(entry);
  }

  if (resolved.length) await saveLog(log);
  return resolved;
}

export async function getCallLog(limit = 40): Promise<CallLogEntry[]> {
  const log = await loadLog();
  return log.entries.slice(-limit).reverse();
}

export function summarizeCallLog(entries: CallLogEntry[]): string {
  const decided = entries.filter((e) => e.result === "hit" || e.result === "miss");
  if (!decided.length) {
    return "Call log: no resolved predictions yet.";
  }
  const hits = decided.filter((e) => e.result === "hit").length;
  const misses = decided.filter((e) => e.result === "miss").length;
  const flats = entries.filter((e) => e.result === "flat").length;
  const pending = entries.filter((e) => e.result === "pending").length;
  const rate = ((hits / decided.length) * 100).toFixed(0);
  return `Call log (resolved): ${hits} hit / ${misses} miss (${rate}% hit rate); flat=${flats}; pending=${pending}.`;
}

export function extractCallFromBrief(text: string): "UP" | "DOWN" | null {
  const m = text.match(
    /(?:Tomorrow's prediction|Next week's prediction on open|Prediction):\s*(UP|DOWN)/i,
  );
  if (!m) return null;
  return m[1].toUpperCase() as "UP" | "DOWN";
}

export function formatCallLogBlock(entries: CallLogEntry[]): string {
  const recent = entries.slice(0, 8);
  const summary = summarizeCallLog(entries);
  if (!recent.length) {
    return `## Call log\n${summary}`;
  }
  const lines = recent.map((e) => {
    const res =
      e.result === "pending"
        ? "pending"
        : `${e.result}${e.resultSoxlDayPct != null ? ` (SOXL ${e.resultSoxlDayPct >= 0 ? "+" : ""}${e.resultSoxlDayPct.toFixed(2)}%)` : ""}`;
    return `- ${e.briefDateEt}: ${e.call} → ${res} [${e.swingBand}]`;
  });
  return `## Call log (scorekeeping — use as humility, not as a crystal ball)
${summary}
${lines.join("\n")}`;
}
