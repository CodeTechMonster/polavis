/**
 * OpenWeather current-weather integration.
 *
 * Real API, verified against current public documentation:
 *   GET https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={API_KEY}&units=metric
 * Real response fields used here: weather[0].main / weather[0].description, main.temp,
 * visibility (meters, capped at 10000 by the API), wind.speed (m/s in metric units),
 * rain['1h'] / snow['1h'] (mm in the last hour, field absent when not applicable).
 *
 * NOTE: not exercised against the live endpoint in this environment (api.openweathermap.org
 * isn't reachable from this sandbox's network allowlist) — verify against a real
 * OPENWEATHERMAP_API_KEY before relying on this in production. MOCK_ROUTE_CONDITIONS=true
 * bypasses this with realistic synthetic data so the rest of the feature can be built/tested
 * without one.
 */

export interface WeatherSnapshot {
  zoneName: string;
  conditionMain: string; // "Rain", "Snow", "Clear", "Clouds", etc.
  description: string;
  tempC: number;
  windSpeedMs: number;
  visibilityM: number;
  rain1hMm: number;
  snow1hMm: number;
}

const OPENWEATHER_URL = "https://api.openweathermap.org/data/2.5/weather";

export async function fetchWeather(lat: number, lon: number, zoneName: string, apiKey: string): Promise<WeatherSnapshot> {
  const url = `${OPENWEATHER_URL}?lat=${lat}&lon=${lon}&appid=${encodeURIComponent(apiKey)}&units=metric`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenWeather API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    zoneName,
    conditionMain: data.weather?.[0]?.main ?? "Unknown",
    description: data.weather?.[0]?.description ?? "",
    tempC: data.main?.temp ?? null,
    windSpeedMs: data.wind?.speed ?? 0,
    visibilityM: data.visibility ?? 10000,
    rain1hMm: data.rain?.["1h"] ?? 0,
    snow1hMm: data.snow?.["1h"] ?? 0,
  };
}

export interface WeatherFlags {
  heavyRain: boolean;
  snow: boolean;
  ice: boolean; // approximated: snow + sub-zero temp
  highWind: boolean;
  lowVisibility: boolean;
}

// Thresholds are assumptions (not specified in the brief), documented the same way as the
// detention rate / empty-mile revenue rate elsewhere in this app.
export const WEATHER_THRESHOLDS = {
  heavyRainMmPerHour: 4, // [ASSUMPTION] "heavy rain" per Environment Canada's rough intensity bands
  highWindMs: 11, // [ASSUMPTION] ~40 km/h, commonly cited high-wind driving advisory threshold
  lowVisibilityM: 1000, // [ASSUMPTION] under 1km is when highway signage typically posts visibility warnings
  iceTempC: 0,
};

export function classifyWeatherFlags(w: WeatherSnapshot): WeatherFlags {
  return {
    heavyRain: w.rain1hMm >= WEATHER_THRESHOLDS.heavyRainMmPerHour || w.conditionMain === "Rain" && w.rain1hMm > 0 && w.rain1hMm >= WEATHER_THRESHOLDS.heavyRainMmPerHour,
    snow: w.conditionMain === "Snow" || w.snow1hMm > 0,
    ice: (w.conditionMain === "Snow" || w.snow1hMm > 0) && w.tempC <= WEATHER_THRESHOLDS.iceTempC,
    highWind: w.windSpeedMs >= WEATHER_THRESHOLDS.highWindMs,
    lowVisibility: w.visibilityM <= WEATHER_THRESHOLDS.lowVisibilityM,
  };
}
