/**
 * US equity session helpers (America/New_York).
 * Weekends + major NYSE holidays → next session is "next week open"
 * (or the next open after a mid-week holiday).
 */

export type NextSessionKind = "tomorrow" | "next_week_open";

/** YYYY-MM-DD dates when NYSE is closed (full-day holidays). */
const NYSE_HOLIDAYS = new Set([
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Day
  "2026-02-16", // Presidents' Day
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
  // 2027
  "2027-01-01", // New Year's Day
  "2027-01-18", // MLK Day
  "2027-02-15", // Presidents' Day
  "2027-03-26", // Good Friday
  "2027-05-31", // Memorial Day
  "2027-06-18", // Juneteenth (observed)
  "2027-07-05", // Independence Day (observed)
  "2027-09-06", // Labor Day
  "2027-11-25", // Thanksgiving
  "2027-12-24", // Christmas (observed)
]);

function etParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0=Sun … 6=Sat
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday ?? "Mon"] ?? 1,
  };
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number; weekday: number } {
  // Construct noon UTC-ish via Date from ET calendar components using a stable approach:
  // use Date.UTC then format back in ET after shifting.
  const utc = new Date(Date.UTC(year, month - 1, day + delta, 17, 0, 0));
  return etParts(utc);
}

export function isNyseHolidayIso(iso: string): boolean {
  return NYSE_HOLIDAYS.has(iso);
}

export function isWeekendWeekday(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

/** True if the given ET calendar day is not a full NYSE trading day. */
export function isMarketClosedDay(date: Date = new Date()): boolean {
  const p = etParts(date);
  const iso = toIsoDate(p.year, p.month, p.day);
  return isWeekendWeekday(p.weekday) || isNyseHolidayIso(iso);
}

/**
 * Next full NYSE session after "today" (ET).
 * Used for night briefs: what session the prediction targets.
 */
export function nextTradingSession(from: Date = new Date()): {
  kind: NextSessionKind;
  iso: string;
  dateLabel: string;
} {
  const start = etParts(from);
  let cursor = addCalendarDays(start.year, start.month, start.day, 1);
  let steps = 0;

  while (steps < 14) {
    const iso = toIsoDate(cursor.year, cursor.month, cursor.day);
    if (!isWeekendWeekday(cursor.weekday) && !isNyseHolidayIso(iso)) {
      // "Next week open" if we crossed a weekend or holiday gap (not simply next calendar day Mon–Thu).
      const tomorrow = addCalendarDays(start.year, start.month, start.day, 1);
      const tomorrowIso = toIsoDate(tomorrow.year, tomorrow.month, tomorrow.day);
      const kind: NextSessionKind =
        iso === tomorrowIso &&
        !isWeekendWeekday(tomorrow.weekday) &&
        !isNyseHolidayIso(tomorrowIso)
          ? "tomorrow"
          : "next_week_open";

      const dateLabel = new Date(
        Date.UTC(cursor.year, cursor.month - 1, cursor.day, 17, 0, 0),
      ).toLocaleDateString("en-US", {
        timeZone: "America/New_York",
        month: "numeric",
        day: "numeric",
        year: "numeric",
        weekday: "short",
      });

      return { kind, iso, dateLabel };
    }
    cursor = addCalendarDays(cursor.year, cursor.month, cursor.day, 1);
    steps += 1;
  }

  // Fallback — should not happen
  return {
    kind: "tomorrow",
    iso: toIsoDate(start.year, start.month, start.day),
    dateLabel: "next session",
  };
}

export function nextSessionKind(from: Date = new Date()): NextSessionKind {
  return nextTradingSession(from).kind;
}

export function predictionHeader(from: Date = new Date()): string {
  return nextSessionKind(from) === "tomorrow"
    ? "Tomorrow's prediction"
    : "Next week's prediction on open";
}

export function nextSessionDateLabel(from: Date = new Date()): string {
  return nextTradingSession(from).dateLabel;
}

/** Today's calendar date in America/New_York as YYYY-MM-DD. */
export function todayEtIso(from: Date = new Date()): string {
  const p = etParts(from);
  return toIsoDate(p.year, p.month, p.day);
}
