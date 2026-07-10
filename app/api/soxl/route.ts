import { NextRequest } from "next/server";
import { handleSoXlCron } from "@/lib/soxl/handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * SOXL brief cron entry.
 * Prefer /api/soxl/morning and /api/soxl/night for Vercel Cron.
 * Query fallback: ?mode=morning|night
 */
export async function GET(request: NextRequest) {
  const modeParam = request.nextUrl.searchParams.get("mode");
  const mode =
    modeParam === "morning" || modeParam === "night" ? modeParam : "auto";
  return handleSoXlCron(request, mode);
}
