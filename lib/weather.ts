import axios from "axios";

export interface WeatherData {
  city: string;
  country: string;
  description: string;
  tempC: number;
  feelsLikeC: number;
  humidity: number;
  windSpeed: number;
  raw: unknown;
}

export async function fetchTorontoWeather(): Promise<WeatherData> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENWEATHER_API_KEY");
  }

  const { data } = await axios.get(
    "https://api.openweathermap.org/data/2.5/weather",
    {
      params: {
        q: "Toronto,CA",
        appid: apiKey,
        units: "metric",
      },
    },
  );

  return {
    city: data.name,
    country: data.sys?.country ?? "CA",
    description: data.weather?.[0]?.description ?? "",
    tempC: data.main?.temp ?? 0,
    feelsLikeC: data.main?.feels_like ?? 0,
    humidity: data.main?.humidity ?? 0,
    windSpeed: data.wind?.speed ?? 0,
    raw: data,
  };
}

export function serializeWeatherForPrompt(weather: WeatherData): string {
  return JSON.stringify(weather.raw, null, 2);
}
