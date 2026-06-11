import axios from "axios";

export async function sendTelegramMessage(text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }
  if (!chatId) {
    throw new Error("Missing TELEGRAM_CHAT_ID");
  }

  await axios.post(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      chat_id: chatId,
      text,
    },
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}
