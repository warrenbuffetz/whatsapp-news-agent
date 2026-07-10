import { NextRequest, NextResponse } from "next/server";
import { getCallLog, summarizeCallLog } from "@/lib/soxl/call-log";

export const dynamic = "force-dynamic";

/**
 * GET /api/soxl/calls — recent night prediction scorekeeping.
 * Local: reads lib/soxl/data/call-log.json; on Vercel may be /tmp-backed.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    const cronSecret = process.env.CRON_SECRET;
    const auth = request.headers.get("authorization");
    if (cronSecret && auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const entries = await getCallLog(50);
  return NextResponse.json({
    ok: true,
    summary: summarizeCallLog(entries),
    count: entries.length,
    entries,
  });
}
