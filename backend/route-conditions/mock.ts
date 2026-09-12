/**
 * MOCK_ROUTE_CONDITIONS=true short-circuits both external API calls with this generator instead.
 * Reproduces the brief's own worked demo scenario exactly (1 major collision + 2 construction
 * zones -> Traffic +8; heavy rain + 500m visibility -> Weather +5), personalized with the real
 * origin/destination city names for whichever trip was actually requested, so it reads as
 * corridor-specific rather than obviously canned.
 */
import type { ClassifiedTrafficEvent } from "./ontario511.js";
import type { WeatherSnapshot } from "./weather.js";

export function mockTrafficEvents(originName: string, destName: string, midLat: number, midLon: number): ClassifiedTrafficEvent[] {
  return [
    {
      ID: 900001,
      RoadwayName: "HWY 401",
      DirectionOfTravel: "Westbound",
      Description: `Major collision on HWY 401 Westbound near ${originName}. Two lanes blocked.`,
      EventType: "accidentsAndIncidents",
      IsFullClosure: false,
      Severity: "Major",
      Latitude: midLat + 0.05,
      Longitude: midLon + 0.05,
      tier: "major",
    },
    {
      ID: 900002,
      RoadwayName: "HWY 401",
      DirectionOfTravel: "Both Directions",
      Description: `Active construction zone on HWY 401 between ${originName} and ${destName}. Single lane alternating.`,
      EventType: "roadwork",
      IsFullClosure: false,
      Severity: "Unknown",
      Latitude: midLat,
      Longitude: midLon,
      tier: "construction",
    },
    {
      ID: 900003,
      RoadwayName: "HWY 401",
      DirectionOfTravel: "Eastbound",
      Description: `Active construction zone on HWY 401 approaching ${destName}. Reduced speed limit.`,
      EventType: "roadwork",
      IsFullClosure: false,
      Severity: "Unknown",
      Latitude: midLat - 0.05,
      Longitude: midLon - 0.05,
      tier: "construction",
    },
  ];
}

export function mockWeather(zoneName: string): WeatherSnapshot {
  return {
    zoneName,
    conditionMain: "Rain",
    description: "heavy intensity rain",
    tempC: 9,
    windSpeedMs: 6.5,
    visibilityM: 500,
    rain1hMm: 6.2,
    snow1hMm: 0,
  };
}
