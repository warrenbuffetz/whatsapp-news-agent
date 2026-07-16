import { NextRequest, NextResponse } from "next/server";
import { buildSoXlBrief, type SoXlBriefResult } from "@/lib/soxl/process";
import type { SoXlBriefMode } from "@/lib/soxl/brief";
import { sendSoXlTelegramMessage } from "@/lib/soxl/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorizeCron(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error(
      "CRON_SECRET is missing from production environment variables",
    );
    return NextResponse.json(
      {
        error: "CRON_SECRET is missing from production environment variables",
      },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export async function handleSoXlCron(
  request: NextRequest,
  mode: SoXlBriefMode,
): Promise<NextResponse> {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const dryRun = request.nextUrl.searchParams.get("dry") === "1";

  try {
    const brief: SoXlBriefResult = await buildSoXlBrief(mode);
    const chunks = dryRun ? 0 : await sendSoXlTelegramMessage(brief.text);

    console.log("[soxl] telegram sent", {
      mode: brief.mode,
      direction: brief.direction,
      soxlDayPct: brief.soxlDayPct,
      holdingsSource: brief.holdingsSource,
      holdingsAsOf: brief.holdingsAsOf,
      holdingsCount: brief.holdingsCount,
      chunks,
      dryRun,
      dataQuality: brief.dataQuality ?? null,
    });

    return NextResponse.json({
      ok: true,
      sent: !dryRun,
      dryRun,
      mode: brief.mode,
      direction: brief.direction,
      soxlDayPct: brief.soxlDayPct,
      holdingsSource: brief.holdingsSource,
      holdingsAsOf: brief.holdingsAsOf,
      holdingsCount: brief.holdingsCount,
      chunks,
      preview: brief.text.slice(0, 2000),
      previewTail: brief.text.slice(-1200),
      swingBand: brief.swingBand ?? null,
      call: brief.call ?? null,
      callLogRecorded: brief.callLogRecorded ?? false,
      usedFallback: brief.usedFallback ?? false,
      dataQuality: brief.dataQuality ?? null,
      hasPrediction:
        /(?:Tomorrow's prediction|Next week's prediction on open|Prediction):\s*(UP|DOWN)/i.test(
          brief.text,
        ),
      hasPlaybook: /Momentum playbook/i.test(brief.text),
    });
  } catch (error) {
    console.error("[soxl]", error);
    const message =
      error instanceof Error ? error.message : "SOXL brief failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
