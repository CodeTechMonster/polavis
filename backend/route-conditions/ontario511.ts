/**
 * Ontario 511 traffic events integration.
 *
 * Real API, verified directly against the live documentation page
 * (https://511on.ca/help/endpoint/event) on 2026-09-08:
 *   GET https://511on.ca/api/v2/get/event?format=json&lang=en
 * The URI Parameters table lists only `format` (xml|json, default json) and `lang` (en|fr,
 * default en) — both optional, and **no API key parameter at all**. This corrected an earlier
 * version of this file that incorrectly assumed a `key=` query param modeled after sibling
 * 511 platforms in other regions; Ontario's own public API genuinely requires no key.
 *
 * EventType is a fixed 3-value enum per the real docs: "roadwork", "closures", or
 * "accidentsAndIncidents" (not a free-form string) — used directly for severity classification
 * below instead of guessing from free-text description keywords.
 *
 * Real fields used here (from the documented sample response): RoadwayName, DirectionOfTravel,
 * Description, EventType, IsFullClosure (boolean), Severity, Latitude, Longitude.
 *
 * Throttling: 10 calls/60s per the docs — callers should not poll this on a tight interval.
 *
 * NOTE: still not exercised against the live endpoint in this environment (511on.ca isn't
 * reachable from this sandbox's network allowlist) — the request shape above is confirmed
 * correct from the docs, but hasn't been run against a real response here.
 * MOCK_ROUTE_CONDITIONS=true bypasses this entirely with realistic synthetic data so the rest
 * of the feature can be built/tested regardless.
 */
import type { Geofence } from "../simulation/geofences.js";

export type Ontario511EventType = "roadwork" | "closures" | "accidentsAndIncidents";

export interface Ontario511Event {
  ID: number;
  RoadwayName: string;
  DirectionOfTravel: string;
  Description: string;
  EventType: Ontario511EventType;
  IsFullClosure: boolean;
  Severity: string; // documented default "Unknown" — inconsistently populated in practice
  Latitude: number;
  Longitude: number;
}

export type TrafficSeverityTier = "major" | "closure" | "construction" | "minor" | "roadCondition";

export interface ClassifiedTrafficEvent extends Ontario511Event {
  tier: TrafficSeverityTier;
}

const ONTARIO_511_EVENTS_URL = "https://511on.ca/api/v2/get/event";

export async function fetchOntario511Events(): Promise<Ontario511Event[]> {
  const url = `${ONTARIO_511_EVENTS_URL}?format=json&lang=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ontario 511 API error ${res.status}: ${await res.text()}`);
  return (await res.json()) as Ontario511Event[];
}

// Classifies a raw event into the brief's four severity tiers. EventType itself only has 3 real
// values (roadwork / closures / accidentsAndIncidents), so IsFullClosure and Description keywords
// still do the finer-grained work of telling "major collision" apart from "minor incident" within
// the single accidentsAndIncidents bucket, and "construction" apart from a generic road-condition
// advisory within roadwork.
export function classifyTrafficSeverity(e: Ontario511Event): TrafficSeverityTier {
  const desc = (e.Description ?? "").toLowerCase();
  if (e.IsFullClosure || e.EventType === "closures") return "closure";
  if (e.EventType === "accidentsAndIncidents") {
    if (desc.includes("collision") || desc.includes("crash") || desc.includes("major")) return "major";
    return "minor";
  }
  if (e.EventType === "roadwork") {
    if (desc.includes("road condition") || desc.includes("slippery") || desc.includes("ice on road")) return "roadCondition";
    return "construction";
  }
  return "minor";
}

// Haversine distance in km between two points.
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Approximates "distance from this event to the route corridor" by sampling points along the
// straight line between origin and destination and taking the minimum distance to any sample.
// This is a simplification (real driving routes aren't straight lines), but reasonable for
// Southern Ontario's relatively direct highway corridors, and avoids depending on a routing API
// the brief didn't ask for.
function distanceToCorridorKm(event: Ontario511Event, origin: Geofence, destination: Geofence): number {
  const SAMPLES = 6;
  let min = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const lat = origin.lat + (destination.lat - origin.lat) * t;
    const lon = origin.lon + (destination.lon - origin.lon) * t;
    const d = haversineKm(event.Latitude, event.Longitude, lat, lon);
    if (d < min) min = d;
  }
  return min;
}

export function filterEventsNearCorridor(
  events: Ontario511Event[],
  origin: Geofence,
  destination: Geofence,
  corridorRadiusKm: number
): ClassifiedTrafficEvent[] {
  return events
    .filter((e) => typeof e.Latitude === "number" && typeof e.Longitude === "number")
    .filter((e) => distanceToCorridorKm(e, origin, destination) <= corridorRadiusKm)
    .map((e) => ({ ...e, tier: classifyTrafficSeverity(e) }));
}
