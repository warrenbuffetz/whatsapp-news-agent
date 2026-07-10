import axios from "axios";

export interface RunWeatherMetrics {
  tempC: number;
  feelsLikeC: number;
  windSpeedMs: number;
  humidity: number;
  uvIndex: number | null;
  condition: string;
  city: string;
}

export async function fetchRunWeather(city: string): Promise<RunWeatherMetrics> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENWEATHER_API_KEY");
  }

  const weatherUrl =
    `https://api.openweathermap.org/data/2.5/weather` +
    `?q=${encodeURIComponent(city)}` +
    `&appid=${encodeURIComponent(apiKey)}` +
    `&units=metric`;

  const weatherResponse = await axios.get(weatherUrl);
  const data = weatherResponse.data;

  const lat = data.coord?.lat;
  const lon = data.coord?.lon;

  let uvIndex: number | null = null;
  if (lat != null && lon != null) {
    try {
      const uvResponse = await axios.get(
        "https://api.openweathermap.org/data/2.5/uvi",
        {
          params: { lat, lon, appid: apiKey },
        },
      );
      uvIndex = uvResponse.data?.value ?? null;
    } catch {
      uvIndex = null;
    }
  }

  return {
    tempC: data.main?.temp ?? 0,
    feelsLikeC: data.main?.feels_like ?? 0,
    windSpeedMs: data.wind?.speed ?? 0,
    humidity: data.main?.humidity ?? 0,
    uvIndex,
    condition: data.weather?.[0]?.description ?? "unknown",
    city: data.name ?? city,
  };
}

export function serializeRunWeather(metrics: RunWeatherMetrics): string {
  return JSON.stringify(metrics, null, 2);
}
