import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_PROMPT =
  "You are an expert financial and geopolitical analyst. Review the attached raw articles from the US, Canada, and global markets. Filter out low-value noise and synthesize a hyper-concise daily brief. Explicitly highlight any news item that could impact tech stock volatility or the direction of the S&P 500.";

export async function generateMorningBrief(
  weatherPayload: string,
  newsPayload: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const modelId = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: SYSTEM_PROMPT,
  });

  const userPrompt = `Below is the raw weather data for Toronto and a JSON array of deduplicated news articles. Write a hyper-concise WhatsApp-friendly morning brief (aim for under 1500 characters).

## Weather (Toronto — raw OpenWeatherMap payload)
${weatherPayload}

## News articles (US, Canada, and market movers — raw JSON)
${newsPayload}`;

  const result = await model.generateContent(userPrompt);
  const text = result.response.text();

  if (!text.trim()) {
    throw new Error("Gemini returned an empty response");
  }

  return text.trim();
}
