/**
 * Converts classified real-time conditions into point adjustments added on top of the XGBoost
 * Base Risk Score. These weights are assumptions -- the brief specifies relative severity tiers
 * (Major/Closure = high impact, Construction = medium, Minor = low) but no point values -- so
 * they're calibrated here to reproduce the brief's own worked example exactly:
 *   1 major collision + 2 construction zones -> Traffic Adjustment +8
 *   heavy rain + 500m visibility            -> Weather Adjustment +5
 * (Base 74 + Traffic 8 + Weather 5 = Adjusted 87, matching the demo scenario.)
 * Like the $75/h detention rate and $2.50/km empty-mile rate elsewhere in this app, these are
 * flagged [ASSUMPTION] and meant to be tuned once real operational data or a dispatcher's own
 * judgment is available.
 */
import type { ClassifiedTrafficEvent, TrafficSeverityTier } from "./ontario511.js";
import type { WeatherFlags } from "./weather.js";

export const TRAFFIC_WEIGHTS: Record<TrafficSeverityTier, number> = {
  major: 4,
  closure: 4,
  construction: 2,
  roadCondition: 2,
  minor: 1,
};
export const TRAFFIC_ADJUSTMENT_CAP = 20; // [ASSUMPTION] don't let a flood of minor events swamp the score

export const WEATHER_WEIGHTS = {
  heavyRain: 3,
  snow: 3,
  ice: 4,
  highWind: 2,
  lowVisibility: 2,
};
export const WEATHER_ADJUSTMENT_CAP = 15; // [ASSUMPTION]

export interface TrafficBreakdownItem {
  tier: TrafficSeverityTier;
  count: number;
  points: number;
}

export function computeTrafficAdjustment(events: ClassifiedTrafficEvent[]): {
  adjustment: number;
  breakdown: TrafficBreakdownItem[];
} {
  const counts: Record<TrafficSeverityTier, number> = { major: 0, closure: 0, construction: 0, roadCondition: 0, minor: 0 };
  for (const e of events) counts[e.tier]++;

  const breakdown = (Object.keys(counts) as TrafficSeverityTier[])
    .filter((tier) => counts[tier] > 0)
    .map((tier) => ({ tier, count: counts[tier], points: counts[tier] * TRAFFIC_WEIGHTS[tier] }));

  const raw = breakdown.reduce((sum, b) => sum + b.points, 0);
  return { adjustment: Math.min(raw, TRAFFIC_ADJUSTMENT_CAP), breakdown };
}

export interface WeatherBreakdownItem {
  flag: keyof WeatherFlags;
  points: number;
}

export function computeWeatherAdjustment(flags: WeatherFlags): {
  adjustment: number;
  breakdown: WeatherBreakdownItem[];
} {
  const breakdown: WeatherBreakdownItem[] = (Object.keys(flags) as (keyof WeatherFlags)[])
    .filter((flag) => flags[flag])
    .map((flag) => ({ flag, points: WEATHER_WEIGHTS[flag] }));

  const raw = breakdown.reduce((sum, b) => sum + b.points, 0);
  return { adjustment: Math.min(raw, WEATHER_ADJUSTMENT_CAP), breakdown };
}
