import axios from "axios";

/** Local running loop coordinates (Toronto waterfront area). */
const RUN_LAT = 43.6426;
const RUN_LON = -79.3871;

export interface RunWeatherMetrics {
  tempC: number;
  feelsLikeC: number;
  windSpeedMs: number;
  humidity: number;
  uvIndex: number | null;
  condition: string;
}

export async function fetchRunWeather(): Promise<RunWeatherMetrics> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENWEATHER_API_KEY");
  }

  const [weatherResponse, uvResponse] = await Promise.all([
    axios.get("https://api.openweathermap.org/data/2.5/weather", {
      params: {
        lat: RUN_LAT,
        lon: RUN_LON,
        appid: apiKey,
        units: "metric",
      },
    }),
    axios
      .get("https://api.openweathermap.org/data/2.5/uvi", {
        params: {
          lat: RUN_LAT,
          lon: RUN_LON,
          appid: apiKey,
        },
      })
      .catch(() => ({ data: { value: null } })),
  ]);

  const data = weatherResponse.data;

  return {
    tempC: data.main?.temp ?? 0,
    feelsLikeC: data.main?.feels_like ?? 0,
    windSpeedMs: data.wind?.speed ?? 0,
    humidity: data.main?.humidity ?? 0,
    uvIndex: uvResponse.data?.value ?? null,
    condition: data.weather?.[0]?.description ?? "unknown",
  };
}

export function serializeRunWeather(metrics: RunWeatherMetrics): string {
  return JSON.stringify(metrics, null, 2);
}
