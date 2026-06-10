import { after } from "next/server";
import { NextRequest } from "next/server";
import { processMorningBrief } from "@/lib/process-morning-brief";
import { twimlEmptyAck, twimlResponse } from "@/lib/twiml";
import { validateTwilioRequest } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GOOD_MORNING_PATTERN = /^good morning\b/i;

/**
 * Inbound Trigger webhook for Twilio WhatsApp.
 *
 * Fast path: validate, ack immediately with empty TwiML (HTTP 200).
 * Slow path: after() fetches weather + news, summarizes via Gemini,
 * and pushes the brief back via Twilio REST API.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const params = Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, String(value)]),
  );

  const signature = request.headers.get("x-twilio-signature");
  const webhookUrl = process.env.TWILIO_WEBHOOK_URL ?? request.url;

  if (process.env.NODE_ENV === "production") {
    const isValid = validateTwilioRequest(webhookUrl, params, signature);
    if (!isValid) {
      return new Response("Invalid Twilio signature", { status: 403 });
    }
  }

  const body = params.Body?.trim() ?? "";
  const from = params.From ?? "";

  if (!body) {
    return twimlResponse("Send a message to get started.");
  }

  if (!GOOD_MORNING_PATTERN.test(body)) {
    return twimlResponse(
      'Text "Good morning" to receive your daily news and weather brief.',
    );
  }

  if (!from) {
    return new Response("Missing sender", { status: 400 });
  }

  console.log(`[whatsapp] trigger from=${from} — acking, processing async`);

  after(async () => {
    await processMorningBrief(from);
  });

  return twimlEmptyAck();
}
