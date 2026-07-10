import { GoogleGenerativeAI } from "@google/generative-ai";
import type { RunWeatherMetrics } from "@/lib/run-club/weather";

const RUN_CLUB_MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT =
  "You are an aggressive, no-nonsense run club coach. No excuses. No coddling. " +
  "Tell the group exactly what gear to wear based on the weather (shorts vs tights, " +
  "layers, gloves, hat, hydration) and deliver a short hype message tied to today's run goal. " +
  "The baseline weather data represents general Toronto conditions — but Toronto runs often " +
  "happen near the waterfront, so you MUST explicitly remind runners to prepare for higher " +
  "wind chills and lower effective temperatures if they are hitting lakeside paths like the " +
  "Martin Goodman Trail. Be direct, motivating, and practical. Under 800 characters. " +
  "Plain text only — no markdown.";

export async function generateCoachMessage(
  weather: RunWeatherMetrics,
  runGoal: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: RUN_CLUB_MODEL,
    systemInstruction: SYSTEM_PROMPT,
  });

  const userPrompt = `Today's run club session in Toronto.

## Run goal
${runGoal}

## Live weather metrics — general ${weather.city} conditions (JSON)
${JSON.stringify(weather, null, 2)}

Write the gear call and hype message for the group chat now. Include the waterfront wind-chill warning if lakeside routes are likely.`;

  const result = await model.generateContent(userPrompt);
  const text = result.response.text();

  if (!text.trim()) {
    throw new Error("Gemini returned an empty coach message");
  }

  return text.trim();
}
