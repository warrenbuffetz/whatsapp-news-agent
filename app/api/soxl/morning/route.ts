import { NextRequest } from "next/server";
import { handleSoXlCron } from "@/lib/soxl/handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron: weekdays 7:00 AM Eastern (11:00 UTC during EDT). */
export async function GET(request: NextRequest) {
  return handleSoXlCron(request, "morning");
}
