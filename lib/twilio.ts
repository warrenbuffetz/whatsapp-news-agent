import twilio from "twilio";

let client: ReturnType<typeof twilio> | null = null;

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
 */
export function validateTwilioRequest(
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return false;
  }

  if (!signature) {
    return false;
  }

  return twilio.validateRequest(authToken, signature, url, params);
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
