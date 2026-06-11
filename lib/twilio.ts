import type { NextRequest } from "next/server";
import twilio from "twilio";

let client: ReturnType<typeof twilio> | null = null;

/**
 * Resolve the public webhook URL Twilio signed against.
 * On Vercel, prefer proxy headers over TWILIO_WEBHOOK_URL so a stale ngrok
 * value in env vars cannot break production signature validation.
 */
export function resolveTwilioWebhookUrl(request: NextRequest): string {
  const { pathname, search } = request.nextUrl;

  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    request.headers.get("host")?.trim();

  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (process.env.VERCEL === "1" ? "https" : "http");

  if (host) {
    return `${proto}://${host}${pathname}${search}`;
  }

  const vercelHost = process.env.VERCEL_URL?.trim();
  if (vercelHost) {
    return `https://${vercelHost}${pathname}${search}`;
  }

  const configured = process.env.TWILIO_WEBHOOK_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  return request.url;
}

/**
 * Parse Twilio's application/x-www-form-urlencoded POST body.
 */
export async function parseTwilioParams(
  request: NextRequest,
): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const body = await request.text();
    return Object.fromEntries(new URLSearchParams(body));
  }

  const formData = await request.formData();
  return Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, String(value)]),
  );
}

/**
 * Lazily initialize the Twilio REST client for outbound WhatsApp messages.
 */
export function getTwilioClient() {
  if (!client) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
    }

    client = twilio(accountSid, authToken);
  }

  return client;
}

export function getTwilioWhatsAppFrom(): string {
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) {
    throw new Error("Missing TWILIO_WHATSAPP_FROM");
  }
  return from;
}

/**
 * Validate the X-Twilio-Signature header on inbound webhook requests.
 * Tries the live request URL first, then TWILIO_WEBHOOK_URL as a fallback.
 */
export function validateTwilioRequest(
  request: NextRequest,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !signature) {
    return false;
  }

  const candidates = new Set<string>([
    resolveTwilioWebhookUrl(request),
    request.url,
  ]);

  const configured = process.env.TWILIO_WEBHOOK_URL?.trim();
  if (configured) {
    candidates.add(configured.replace(/\/$/, ""));
  }

  for (const url of candidates) {
    if (twilio.validateRequest(authToken, signature, url, params)) {
      return true;
    }

    // Twilio signs the URL without a trailing slash.
    const withoutTrailingSlash = url.replace(/\/$/, "");
    if (
      withoutTrailingSlash !== url &&
      twilio.validateRequest(authToken, signature, withoutTrailingSlash, params)
    ) {
      return true;
    }
  }

  return false;
}

export async function sendWhatsAppMessage(
  to: string,
  body: string,
): Promise<void> {
  const client = getTwilioClient();
  const from = getTwilioWhatsAppFrom();

  await client.messages.create({
    from,
    to,
    body,
  });
}
