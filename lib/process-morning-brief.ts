import { generateMorningBrief } from "@/lib/gemini";
import { fetchNewsArticles, serializeArticlesForPrompt } from "@/lib/news";
import { fetchTorontoWeather, serializeWeatherForPrompt } from "@/lib/weather";
import { sendWhatsAppMessage } from "@/lib/twilio";

export async function processMorningBrief(to: string): Promise<void> {
  try {
    const [weather, articles] = await Promise.all([
      fetchTorontoWeather(),
      fetchNewsArticles(),
    ]);

    const brief = await generateMorningBrief(
      serializeWeatherForPrompt(weather),
      serializeArticlesForPrompt(articles),
    );

    await sendWhatsAppMessage(to, brief);
  } catch (error) {
    console.error("[processMorningBrief]", error);

    const message =
      error instanceof Error
        ? `Sorry, I couldn't prepare your brief: ${error.message}`
        : "Sorry, something went wrong preparing your brief.";

    await sendWhatsAppMessage(to, message).catch((sendError) => {
      console.error("[processMorningBrief] failed to send error message", sendError);
    });
  }
}
