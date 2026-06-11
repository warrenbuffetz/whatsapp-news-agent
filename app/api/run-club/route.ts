import { NextRequest, NextResponse } from "next/server";
import { generateCoachMessage } from "@/lib/run-club/coach";
import { sendTelegramMessage } from "@/lib/run-club/telegram";
import { fetchRunWeather } from "@/lib/run-club/weather";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Weekly run schedule (Eastern Time club calendar).
 * Tuesday = tempo, Thursday = recovery, Saturday = long run.
 */
function getWeeklyRunGoal(dayOfWeek: number): string {
  switch (dayOfWeek) {
    case 2:
      return "5-mile tempo — controlled suffering, hit your splits";
    case 4:
      return "3-mile recovery — easy pace, shake the legs out";
    case 6:
      return "10-mile long run — fuel up, lock in, no shortcuts";
    default:
      return "flexible run — show up, move, no excuses";
  }
}

function getEasternDayOfWeek(): number {
  const eastern = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  return eastern.getDay();
}

function isAuthorizedCron(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[run-club] CRON_SECRET is not configured");
    return false;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * The Anti-Excuse Running Weather Dial — isolated run-club apartment.
 * GET /api/run-club
 *
 * Triggered by Vercel Cron Tue/Thu/Sat 6:00 AM Eastern (10:00 UTC during EDT).
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const runGoal = getWeeklyRunGoal(getEasternDayOfWeek());
    const weather = await fetchRunWeather();
    const message = await generateCoachMessage(weather, runGoal);

    await sendTelegramMessage(message);

    console.log("[run-club] coach message sent", {
      goal: runGoal,
      tempC: weather.tempC,
      condition: weather.condition,
    });

    return NextResponse.json({
      ok: true,
      sent: true,
      runGoal,
      weather,
    });
  } catch (error) {
    console.error("[run-club]", error);

    const message =
      error instanceof Error ? error.message : "Run club dial failed";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
