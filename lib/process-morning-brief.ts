import { buildSoXlBrief } from "@/lib/soxl/process";
import { sendWhatsAppMessage } from "@/lib/twilio";

/**
 * WhatsApp "Good morning" handler — now delivers the SOXL carbon-copy brief
 * (replaces the old news/weather morning brief).
 */
export async function processMorningBrief(to: string): Promise<void> {
  try {
    const brief = await buildSoXlBrief("auto");
    await sendWhatsAppMessage(to, brief.whatsappText);
  } catch (error) {
    console.error("[processMorningBrief]", error);

    const message =
      error instanceof Error
        ? `Sorry, I couldn't prepare your SOXL brief: ${error.message}`
        : "Sorry, something went wrong preparing your SOXL brief.";

    await sendWhatsAppMessage(to, message).catch((sendError) => {
      console.error("[processMorningBrief] failed to send error message", sendError);
    });
  }
}
