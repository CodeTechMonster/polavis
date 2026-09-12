import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { getRecommendation, type RiskInput, type ShapFactor } from "../ai/recommendation-service.js";
import { getRouteRecommendation } from "../ai/route-recommendation-service.js";
import { migrate } from "../simulation/schema.js";
import { findGeofence } from "../simulation/geofences.js";
import { getThresholds, setThresholds, riskLevel, DEFAULT_THRESHOLDS } from "./settings.js";
import { fetchOntario511Events, filterEventsNearCorridor, type ClassifiedTrafficEvent } from "../route-conditions/ontario511.js";
import { fetchWeather, classifyWeatherFlags, type WeatherSnapshot } from "../route-conditions/weather.js";
import { computeTrafficAdjustment, computeWeatherAdjustment } from "../route-conditions/scoring.js";
import { mockTrafficEvents, mockWeather } from "../route-conditions/mock.js";
import { buildTripReportPdf } from "../reports/tripReport.js";
import { buildSummaryReportPdf } from "../reports/summaryReport.js";

const DATA_DIR = path.resolve(process.cwd(), "..", "data");
const db = new Database(path.join(DATA_DIR, "roadpilot.sqlite"));
migrate(db); // ensures live_telemetry/geofence_events exist even if the simulator hasn't run yet

const riskScores: any[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "risk_scores.json"), "utf-8"));
const explanations: Record<string, any> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "explanations.json"), "utf-8")
);

// Built once at startup: (trip, driver) -> distance in km, for the "Highest risk legs" list,
// the All Legs modal, and the High Risk Loads modal.
// A single (TRIP_NUMBER, NAME) pair can have several dispatch rows with *different* distances
// (multi-stop/relay sub-legs — e.g. trip 620258 shuttles 2.6km/0km back and forth 9 times under
// one TRIP_NUMBER). risk_scores.json dedupes to one row per (trip, driver) with no leg-level id,
// so there is no reliable way to know which of those sub-leg distances the displayed row actually
// corresponds to. Previously this picked "first row wins", which silently showed an arbitrary
// (and often misleading, e.g. "3km" for a real multi-stop route) distance. Now: only keep a
// distance when every dispatch row for that pair agrees on the same value; otherwise the pair is
// left out of the map entirely so distanceKm comes back null and the UI hides it rather than show
// a number that can't be trusted.
const distanceValuesByTripDriver = new Map<string, Set<number>>();
for (const r of db.prepare(`SELECT TRIP_NUMBER, NAME, LS_LEG_DIST FROM dispatch WHERE NAME IS NOT NULL AND NAME != '<null>'`).all() as any[]) {
  if (r.LS_LEG_DIST === null || r.LS_LEG_DIST === undefined) continue; // missing data, not a real 0
  const key = `${r.TRIP_NUMBER}|${r.NAME}`;
  if (!distanceValuesByTripDriver.has(key)) distanceValuesByTripDriver.set(key, new Set());
  distanceValuesByTripDriver.get(key)!.add(Math.round(Number(r.LS_LEG_DIST)));
}
const distanceByTripDriver = new Map<string, number>();
for (const [key, values] of distanceValuesByTripDriver) {
  if (values.size === 1) distanceByTripDriver.set(key, [...values][0]);
  // values.size > 1 -> ambiguous across sub-legs, left out of the map on purpose (renders as null)
}

// Built once at startup: driver names already over their legal Canadian 7-day HOS cycle
// (REMAINING_HOURS_CAN_7 < 0 — the same "already in violation" cutoff /api/edge-cases uses).
// Only 3 of 169 drivers hit this today, but those 3 alone carry 100+ distinct trips between them,
// and risk_engine.py's compliance guardrail forces hosRisk to 99 for every one of those trips
// regardless of the trip itself — so without this exclusion, "Highest risk legs" ends up showing
// the same 2-3 drivers over and over with an identical HOS 99 badge, crowding out other risk
// types (detention-only, empty-mile-only legs) that dispatchers should also be seeing. Those
// drivers' trips aren't hidden from the app — they're surfaced instead via the "Already Over HOS
// Limit" edge-case banner/modal, which is the more appropriate place for a fleet-compliance issue
// than a general "highest risk" leaderboard.
const chronicHosViolationDrivers = new Set<string>(
  (db.prepare(`SELECT FIRST_NAME FROM driver WHERE REMAINING_HOURS_CAN_7 < 0`).all() as any[]).map(
    (d) => d.FIRST_NAME
  )
);

// Same pattern, for PICKUP_BY (departure) / DELIVER_BY (ETA) — real order-level datetimes,
// confirmed consistent across every leg row of a given trip regardless of which driver/sub-leg
// (see the What-if schedule-conflict check, which relies on the same consistency).
const scheduleByTripDriver = new Map<string, { pickupBy: string | null; deliverBy: string | null }>();
for (const r of db.prepare(`SELECT TRIP_NUMBER, NAME, PICKUP_BY, DELIVER_BY FROM dispatch WHERE NAME IS NOT NULL AND NAME != '<null>'`).all() as any[]) {
  const key = `${r.TRIP_NUMBER}|${r.NAME}`;
  if (!scheduleByTripDriver.has(key)) scheduleByTripDriver.set(key, { pickupBy: r.PICKUP_BY ?? null, deliverBy: r.DELIVER_BY ?? null });
}

// Built once at startup: the full (trip, driver) deduped leg list (4,335 of the raw 10,479 rows,
// since a trip can have several dispatch rows for relay/multi-stop legs) with risk level,
// distance, and schedule already joined on — used by /api/legs/all so a "browse everything"
// search+sort view doesn't need to redo this dedup+join on every request.
const allLegsDeduped: any[] = (() => {
  const seen = new Set<string>();
  return riskScores.filter((r) => {
    const key = `${r.TRIP_NUMBER}|${r.DRIVER_NAME}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((r) => ({
    ...r,
    distanceKm: distanceByTripDriver.get(`${r.TRIP_NUMBER}|${r.DRIVER_NAME}`) ?? null,
    ...(scheduleByTripDriver.get(`${r.TRIP_NUMBER}|${r.DRIVER_NAME}`) ?? { pickupBy: null, deliverBy: null }),
  }));
})();
// One row per (trip, driver), which is the unit a dispatcher actually sees.
//
// risk_scores.json holds one row per raw dispatch leg, and a single trip can carry many relay
// sub-legs -- WHITBY<->OSHAWA shuttles run up to 20 sub-legs under one TRIP_NUMBER. Most endpoints
// already dedupe inline before counting; the ones that did not were reporting inflated totals
// (Oshawa showed 1,312 "high-detention legs" against 104 real trips, and it ranked first when it
// is actually third). Defined once here so aggregates cannot drift apart again.
const dedupedRiskScores = (() => {
  const seen = new Set<string>();
  return riskScores.filter((r) => {
    const key = `${r.TRIP_NUMBER}|${r.DRIVER_NAME}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})();

const featureImportances: any = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "feature_importances.json"), "utf-8")
);

// Held-out evaluation numbers written by backend/ml/evaluate.py. Loaded defensively rather than
// with a bare readFileSync like the files above: those three are pipeline outputs the app cannot
// run without, whereas metrics are an optional report — a checkout that hasn't run evaluate.py yet
// should still boot, with the UI simply not showing the panel.
const modelMetrics: any = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "model_metrics.json"), "utf-8"));
  } catch {
    console.warn("[startup] data/model_metrics.json not found - run `cd backend/ml && python evaluate.py` to generate it.");
    return null;
  }
})();

const app = express();
app.use(cors());
app.use(express.json());

// --- Executive Command Center summary ---
app.get("/api/summary", (_req, res) => {
  const activeLoads = db.prepare("SELECT COUNT(*) as n FROM tlorder").get() as any;
  const drivers = db.prepare("SELECT COUNT(*) as n FROM driver").get() as any;
  const availDrivers = db.prepare("SELECT COUNT(*) as n FROM driver WHERE STATUS = 'AVAIL'").get() as any;
  const th = getThresholds(db);
  // "High risk" on the KPI banner means High or Critical tier (score above the Medium boundary).
  // Must dedupe by (trip, driver) exactly like /api/risk/high does — this used to count every raw
  // dispatch-leg row with no dedup at all (27), while the drill-down modal behind this same banner
  // showed the deduped list (5), so the banner number and the list you got after clicking it never
  // matched. Both now use the same counting logic.
  const seen = new Set<string>();
  const highRisk = riskScores.filter((r) => {
    const key = `${r.TRIP_NUMBER}|${r.DRIVER_NAME}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return r.riskScore > th.riskLevels.medium;
  }).length;
  res.json({
    activeLoads: activeLoads.n,
    totalDrivers: drivers.n,
    availableDrivers: availDrivers.n,
    highRiskLoads: highRisk,
  });
});

// --- Risk threshold / risk-level settings (Admin Settings screen) ---
app.get("/api/settings/thresholds", (_req, res) => {
  res.json(getThresholds(db));
});

app.post("/api/settings/thresholds", (req, res) => {
  const updated = setThresholds(db, req.body ?? {});
  res.json(updated);
});

app.post("/api/settings/thresholds/reset", (_req, res) => {
  const reset = setThresholds(db, DEFAULT_THRESHOLDS);
  res.json(reset);
});

// --- Full driver list (for the Total Drivers banner drill-down and the driver-app dropdown) ---
app.get("/api/drivers/all", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT d.DRIVER_ID, d.FIRST_NAME, d.STATUS, d.REMAINING_HOURS_CAN_7, d.LAST_SAT_LOC,
              ds.duty_status as liveDutyStatus
       FROM driver d
       LEFT JOIN driver_status ds ON ds.driver_name = d.FIRST_NAME
       WHERE d.FIRST_NAME IS NOT NULL AND d.FIRST_NAME != '<null>'
       ORDER BY CASE WHEN d.DRIVER_ID IS NULL THEN 1 ELSE 0 END, d.DRIVER_ID ASC`
    )
    .all();
  res.json(rows);
});

// --- High-risk loads list (for the High Risk Loads banner drill-down) ---
app.get("/api/risk/high", (_req, res) => {
  const th = getThresholds(db);
  const seen = new Set<string>();
  const rows = riskScores
    // Dedupe by (trip, driver), not trip alone — a trip can have multiple relay legs assigned to
    // different drivers, each with its own real risk score. Deduping on trip number alone silently
    // dropped 15-64 legitimate high-risk legs at thresholds other than the current default (60);
    // it only looked correct at 60 because the counts happened to coincide for this dataset.
    .filter((r) => {
      const key = `${r.TRIP_NUMBER}|${r.DRIVER_NAME}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((r) => r.riskScore > th.riskLevels.medium)
    .sort((a, b) => b.riskScore - a.riskScore)
    .map((r) => ({
      ...r,
      level: riskLevel(r.riskScore, th.riskLevels),
      distanceKm: distanceByTripDriver.get(`${r.TRIP_NUMBER}|${r.DRIVER_NAME}`) ?? null,
      ...scheduleByTripDriver.get(`${r.TRIP_NUMBER}|${r.DRIVER_NAME}`) ?? { pickupBy: null, deliverBy: null },
    }));
  res.json(rows);
});

// --- Browse/search ALL legs (not just top-N or above-threshold) — the "Active loads" KPI
// banner's counterpart to Total/Available Drivers' DriverListModal. 4,335 deduped (trip, driver)
// pairs is too many to ship to the client and sort/filter there the way the 169-driver list does,
// so this does the search + sort + limit server-side against the precomputed allLegsDeduped.
app.get("/api/legs/all", (req, res) => {
  const th = getThresholds(db);
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const sortKey = String(req.query.sortKey ?? "riskScore");
  const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";
  const limit = Math.min(Number(req.query.limit ?? 100), 200);

  let rows = allLegsDeduped.map((r) => ({ ...r, level: riskLevel(r.riskScore, th.riskLevels) }));

  if (q) {
    rows = rows.filter((r) =>
      String(r.TRIP_NUMBER).includes(q) ||
      r.DRIVER_NAME.toLowerCase().includes(q) ||
      r.ORIG_ZONE_DESC.toLowerCase().includes(q) ||
      r.DEST_ZONE_DESC.toLowerCase().includes(q)
    );
  }

  const levelOrder: Record<string, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };
  rows.sort((a, b) => {
    let av: number | string, bv: number | string;
    if (sortKey === "level") { av = levelOrder[a.level] ?? -1; bv = levelOrder[b.level] ?? -1; }
    else if (sortKey === "TRIP_NUMBER" || sortKey === "riskScore" || sortKey === "distanceKm") {
      av = a[sortKey] ?? -Infinity; bv = b[sortKey] ?? -Infinity;
    } else {
      // DRIVER_NAME (and any other string column) can hold the literal "<null>" seen elsewhere in
      // this dataset. Sorting it as-is jumps it to the front alphabetically ('<' is an early ASCII
      // char); treating it as "" instead still sorts it first every time regardless of direction,
      // since "" is the smallest possible string. Push it to the end unconditionally instead —
      // "missing" should read as missing, not as suspiciously first or last depending on the
      // button you happened to click.
      const rawA = String(a[sortKey as keyof typeof a] ?? "");
      const rawB = String(b[sortKey as keyof typeof b] ?? "");
      const aMissing = rawA === "<null>" || rawA === "";
      const bMissing = rawB === "<null>" || rawB === "";
      if (aMissing !== bMissing) return aMissing ? 1 : -1; // missing always sorts last, unaffected by sortDir
      av = rawA;
      bv = rawB;
    }
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  res.json({ total: rows.length, legs: rows.slice(0, limit) });
});

// --- Highest-risk legs (for the fleet map / risk center) ---
// Split into two lists by Math.round(hosRisk) >= 99 — matching the ROUNDED value fmtRisk() shows
// on screen, not the raw one. Earlier versions of this split used the raw value directly, which
// fixed one rounding edge case (99.9 correctly counted as severe even though it displays as "100")
// but created the opposite one: a raw value like 98.6 displays as "99" (Math.round) yet failed a
// raw `>= 99` check and landed in the "< 99" list — a leg visibly showing "HOS: 99" appearing in
// the bucket labeled "< 99". Using the rounded value for both the split AND the display keeps them
// always in agreement, and still correctly buckets 99.9 (rounds to 100, still >= 99) as severe.
// hosRisk lands at/above 99 either via the hard compliance guardrail (driver already over their
// legal 7-day cycle — REMAINING_HOURS_CAN_7 < 0 forces exactly 99.0) or because the model itself
// predicted a near-max score for a driver whose buffer is merely critical (0-3h remaining, the
// guardrail's max(hos, 90.0) floor lets the model's own number through above that). Either way,
// mixing these into one "highest risk" ranking previously meant the same handful of drivers with
// an identical HOS ~99+ badge crowded out every other risk type (detention-only, empty-mile-only
// legs). Splitting into two same-size lists keeps both visible instead of hiding one.
app.get("/api/risk/top", (req, res) => {
  const limit = Number(req.query.limit ?? 20);
  const seen = new Set<string>();
  const deduped = riskScores.filter((r) => {
    const key = `${r.TRIP_NUMBER}|${r.DRIVER_NAME}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const withExtras = (r: any) => ({
    ...r,
    distanceKm: distanceByTripDriver.get(`${r.TRIP_NUMBER}|${r.DRIVER_NAME}`) ?? null,
    ...scheduleByTripDriver.get(`${r.TRIP_NUMBER}|${r.DRIVER_NAME}`) ?? { pickupBy: null, deliverBy: null },
  });

  const hos99 = deduped
    .filter((r) => Math.round(r.hosRisk) >= 99)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, limit)
    .map(withExtras);

  const other = deduped
    .filter((r) => Math.round(r.hosRisk) < 99)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, limit)
    .map(withExtras);

  res.json({ hos99, other });
});

// --- Risk + SHAP for one trip (a trip can have multiple relay legs with different drivers,
// so disambiguate by driver name when provided) ---
// Explanation lookup order: (1) the static data/explanations.json snapshot precompute.py wrote
// offline for a fixed top-N set of trips, tagged source: "precomputed"; (2) if this trip isn't in
// that snapshot, ask the live ML microservice (which already holds trained models in memory for
// What-if) to compute SHAP for this exact (trip, driver) pair on demand, tagged source: "live";
// (3) if the microservice is unreachable/times out, explanation comes back null and the UI shows
// an explicit "not available" message instead of a silent blank list.
app.get("/api/risk/:tripNumber", async (req, res) => {
  const tripNumber = Number(req.params.tripNumber);
  const driverName = req.query.driver as string | undefined;
  const row = driverName
    ? riskScores.find((r) => r.TRIP_NUMBER === tripNumber && r.DRIVER_NAME === driverName) ??
      riskScores.find((r) => r.TRIP_NUMBER === tripNumber)
    : riskScores.find((r) => r.TRIP_NUMBER === tripNumber);
  if (!row) return res.status(404).json({ error: "trip not found" });

  const precomputed = explanations[String(tripNumber)];
  if (precomputed && !precomputed.error) {
    return res.json({ risk: row, explanation: { ...precomputed, source: "precomputed" } });
  }

  const mlServiceUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  try {
    const driverParam = row.DRIVER_NAME ? `?driver=${encodeURIComponent(row.DRIVER_NAME)}` : "";
    const mlRes = await fetch(`${mlServiceUrl}/explain/${tripNumber}${driverParam}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (mlRes.ok) {
      const data = await mlRes.json();
      if (!data.error) return res.json({ risk: row, explanation: data });
    }
  } catch {
    // ml-service unreachable or timed out -> fall through to "no explanation available"
  }

  res.json({ risk: row, explanation: null });
});

// --- Available drivers (for load matching / reassignment) ---
app.get("/api/drivers/available", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT DRIVER_ID, FIRST_NAME, REMAINING_HOURS_CAN_7, REMAINING_HOURS_CAN_14, LAST_SAT_LOC, POSLAT, POSLONG
       FROM driver WHERE STATUS = 'AVAIL' ORDER BY REMAINING_HOURS_CAN_7 DESC LIMIT 25`
    )
    .all();
  res.json(rows);
});

// --- Claude AI recommendation for a risky trip ---
app.post("/api/recommend/:tripNumber", async (req, res) => {
  const tripNumber = Number(req.params.tripNumber);
  const row = riskScores.find((r) => r.TRIP_NUMBER === tripNumber);
  if (!row) return res.status(404).json({ error: "trip not found" });
  const explanation = explanations[String(tripNumber)];

  const riskInput: RiskInput = {
    tripNumber,
    driverName: row.DRIVER_NAME,
    origin: row.ORIG_ZONE_DESC,
    destination: row.DEST_ZONE_DESC,
    riskScore: row.riskScore,
    hosRisk: row.hosRisk,
    delayRisk: row.delayRisk,
    detentionRisk: row.detentionRisk,
    emptyMileRisk: row.emptyMileRisk,
  };
  const shapFactors: ShapFactor[] = (explanation?.top_factors ?? []).map((f: any) => ({
    friendly_name: f.friendly_name,
    value: f.value,
    direction: f.direction,
  }));

  try {
    const recommendation = await getRecommendation(
      riskInput, shapFactors, req.body?.candidateDriver, req.body?.routeConditions,
      getThresholds(db).useSpurAi
    );
    res.json(recommendation);
  } catch (err: any) {
    res.status(502).json({ error: "Claude recommendation failed", detail: String(err.message ?? err) });
  }
});

// --- Origin/destination coordinates for a leg, so the Fleet Map can draw that leg's route when a
// trip is selected from "Highest risk legs" (or any other list — this reads the same global
// `selected` state, so it works from All Legs / High Risk Loads / the edge-case modals too).
// Reuses the same city->coordinate geofence lookup Route Conditions/Empty Mile/Simulation already
// use, so it has the same known-cities limitation (see backend/simulation/geofences.ts).
app.get("/api/legs/:tripNumber/route", (req, res) => {
  const tripNumber = Number(req.params.tripNumber);
  const driverName = req.query.driver as string | undefined;
  const row = driverName
    ? riskScores.find((r) => r.TRIP_NUMBER === tripNumber && r.DRIVER_NAME === driverName) ??
      riskScores.find((r) => r.TRIP_NUMBER === tripNumber)
    : riskScores.find((r) => r.TRIP_NUMBER === tripNumber);
  if (!row) return res.status(404).json({ error: "trip not found" });

  const origin = findGeofence(row.ORIG_ZONE_DESC);
  const destination = findGeofence(row.DEST_ZONE_DESC);
  res.json({
    tripNumber,
    driverName: row.DRIVER_NAME,
    origLabel: row.ORIG_ZONE_DESC,
    destLabel: row.DEST_ZONE_DESC,
    origin: origin ? { name: origin.name, lat: origin.lat, lon: origin.lon } : null,
    destination: destination ? { name: destination.name, lat: destination.lat, lon: destination.lon } : null,
  });
});

// --- Analyze Route Conditions: enriches (never replaces) the XGBoost Base Risk Score with
// real-time traffic (Ontario 511) + weather (OpenWeather) adjustments and a Claude recommendation
// scoped to those conditions. See route-conditions/*.ts for the real API integrations and
// scoring.ts for the point-value assumptions. Falls back to realistic mock data when either API
// key is missing or MOCK_ROUTE_CONDITIONS=true, so the full flow is testable without live keys.
app.get("/api/route-conditions/:tripNumber", async (req, res) => {
  const tripNumber = Number(req.params.tripNumber);
  const leg = riskScores.find((r) => r.TRIP_NUMBER === tripNumber);
  if (!leg) return res.status(404).json({ error: "trip not found" });

  const origin = findGeofence(leg.ORIG_ZONE_DESC);
  const destination = findGeofence(leg.DEST_ZONE_DESC);
  if (!origin || !destination) {
    return res.status(422).json({ error: "Origin or destination city isn't in the geofence list, so the corridor can't be analyzed." });
  }

  // Ontario 511 needs no key at all (confirmed against the live docs), so real traffic data can
  // always be fetched regardless of whether a weather key is configured — only
  // MOCK_ROUTE_CONDITIONS=true forces it into mock mode. Weather still falls back to mock
  // independently if OPENWEATHERMAP_API_KEY is missing. This means "mixed" responses (real
  // traffic + mock weather) are possible now, which is more accurate than the old all-or-nothing
  // flag from before this was corrected.
  const forceMock = process.env.MOCK_ROUTE_CONDITIONS === "true";
  // .trim() defensively: a key that works when pasted directly into a browser URL but fails only
  // through this app is almost always a stray trailing newline/space picked up when copying into
  // .env (very easy to do from a terminal or certain editors) — dotenv preserves it verbatim, so
  // "abc123\n" gets sent as the appid and OpenWeather correctly rejects it as invalid.
  const weatherApiKey = process.env.OPENWEATHERMAP_API_KEY?.trim();
  const hasWeatherKey = !!weatherApiKey;

  try {
    const midLat = (origin.lat + destination.lat) / 2;
    const midLon = (origin.lon + destination.lon) / 2;
    const CORRIDOR_RADIUS_KM = 25; // [ASSUMPTION] how wide a band around the straight-line route counts as "on this corridor"

    let trafficEvents: ClassifiedTrafficEvent[];
    let originWeather: WeatherSnapshot;
    let destWeather: WeatherSnapshot;
    let trafficIsMock: boolean;
    let weatherIsMock: boolean;

    if (forceMock) {
      trafficEvents = mockTrafficEvents(origin.name, destination.name, midLat, midLon);
      originWeather = mockWeather(origin.name);
      destWeather = mockWeather(destination.name);
      trafficIsMock = true;
      weatherIsMock = true;
    } else {
      const rawEvents = await fetchOntario511Events();
      trafficEvents = filterEventsNearCorridor(rawEvents, origin, destination, CORRIDOR_RADIUS_KM);
      trafficIsMock = false;

      if (hasWeatherKey) {
        [originWeather, destWeather] = await Promise.all([
          fetchWeather(origin.lat, origin.lon, origin.name, weatherApiKey!),
          fetchWeather(destination.lat, destination.lon, destination.name, weatherApiKey!),
        ]);
        weatherIsMock = false;
      } else {
        originWeather = mockWeather(origin.name);
        destWeather = mockWeather(destination.name);
        weatherIsMock = true;
      }
    }

    const { adjustment: trafficAdjustment, breakdown: trafficBreakdown } = computeTrafficAdjustment(trafficEvents);

    const originFlags = classifyWeatherFlags(originWeather);
    const destFlags = classifyWeatherFlags(destWeather);
    // A leg spans two cities, so a condition affecting either end counts against the corridor.
    const flags = {
      heavyRain: originFlags.heavyRain || destFlags.heavyRain,
      snow: originFlags.snow || destFlags.snow,
      ice: originFlags.ice || destFlags.ice,
      highWind: originFlags.highWind || destFlags.highWind,
      lowVisibility: originFlags.lowVisibility || destFlags.lowVisibility,
    };
    const { adjustment: weatherAdjustment, breakdown: weatherBreakdown } = computeWeatherAdjustment(flags);

    const baseRiskScore = Math.round(leg.riskScore); // unchanged — same value the rest of the app already shows
    const adjustedRiskScore = Math.min(100, baseRiskScore + trafficAdjustment + weatherAdjustment);

    const trafficFactors = trafficEvents.map((e) => e.Description);
    const weatherFactors: string[] = [];
    if (flags.heavyRain) weatherFactors.push(`Heavy rain (${Math.max(originWeather.rain1hMm, destWeather.rain1hMm)}mm/h)`);
    if (flags.snow) weatherFactors.push("Snow");
    if (flags.ice) weatherFactors.push("Icy conditions likely");
    if (flags.highWind) weatherFactors.push(`High wind (${Math.max(originWeather.windSpeedMs, destWeather.windSpeedMs).toFixed(1)} m/s)`);
    if (flags.lowVisibility) weatherFactors.push(`Reduced visibility (${Math.min(originWeather.visibilityM, destWeather.visibilityM)}m)`);

    const recommendation = await getRouteRecommendation({
      tripNumber: leg.TRIP_NUMBER,
      driverName: leg.DRIVER_NAME,
      origin: origin.name,
      destination: destination.name,
      baseRiskScore,
      trafficAdjustment,
      weatherAdjustment,
      adjustedRiskScore,
      trafficFactors,
      weatherFactors,
    }, getThresholds(db).useSpurAi);

    res.json({
      trip: { tripNumber: leg.TRIP_NUMBER, driverName: leg.DRIVER_NAME, origin: origin.name, destination: destination.name },
      baseRiskScore,
      trafficAdjustment,
      weatherAdjustment,
      adjustedRiskScore,
      trafficConditions: {
        events: trafficEvents.map((e) => ({ description: e.Description, roadway: e.RoadwayName, tier: e.tier })),
        breakdown: trafficBreakdown,
      },
      weatherConditions: { origin: originWeather, destination: destWeather, flags, breakdown: weatherBreakdown },
      routeConditionFactors: [...trafficFactors, ...weatherFactors],
      recommendation,
      dataSource: trafficIsMock || weatherIsMock ? "mock" : "live",
      dataSourceDetail: { traffic: trafficIsMock ? "mock" : "live", weather: weatherIsMock ? "mock" : "live" },
    });
  } catch (err: any) {
    res.status(502).json({ error: "Route condition analysis failed", detail: String(err.message ?? err) });
  }
});


// --- PDF Reports ---
// Per-trip report: Base Risk Score + SHAP are always included (looked up server-side, same data
// every other trip endpoint uses). What-if and Route Conditions sections are only included if the
// frontend actually ran them and sends the results in the request body — omitted entirely
// otherwise, not shown as "not run" placeholders.
app.post("/api/report/trip/:tripNumber", (req, res) => {
  const tripNumber = Number(req.params.tripNumber);
  const row = riskScores.find((r) => r.TRIP_NUMBER === tripNumber);
  if (!row) return res.status(404).json({ error: "trip not found" });

  const explanation = explanations[String(tripNumber)];
  const shapFactors = (explanation?.top_factors ?? []).map((f: any) => ({
    feature: f.feature,
    friendly_name: f.friendly_name,
    value: f.value,
    direction: f.direction,
  }));

  const th = getThresholds(db);

  try {
    const doc = buildTripReportPdf({
      trip: { tripNumber: row.TRIP_NUMBER, driverName: row.DRIVER_NAME, origin: row.ORIG_ZONE_DESC, destination: row.DEST_ZONE_DESC },
      risk: {
        riskScore: row.riskScore,
        hosRisk: row.hosRisk,
        delayRisk: row.delayRisk,
        detentionRisk: row.detentionRisk,
        emptyMileRisk: row.emptyMileRisk,
      },
      levels: th.riskLevels,
      shapFactors,
      whatIf: req.body?.whatIf,
      routeConditions: req.body?.routeConditions,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="RoadPilot_Trip_${tripNumber}_Report.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate report", detail: String(err.message ?? err) });
  }
});

// Fleet-wide summary report: today's high-risk loads, edge cases, and detention billing —
// everything gathered fresh at request time from the same live data every other dashboard panel
// reads, so the report matches what's on screen at the moment it's downloaded.
app.get("/api/report/summary", (_req, res) => {
  const th = getThresholds(db);

  const activeLoads = (db.prepare("SELECT COUNT(*) as n FROM tlorder").get() as any).n;
  const totalDrivers = (db.prepare("SELECT COUNT(*) as n FROM driver").get() as any).n;
  const availableDrivers = (db.prepare("SELECT COUNT(*) as n FROM driver WHERE STATUS = 'AVAIL'").get() as any).n;

  const seenHigh = new Set<string>();
  const highRisk = riskScores
    .filter((r) => {
      const key = `${r.TRIP_NUMBER}|${r.DRIVER_NAME}`;
      if (seenHigh.has(key)) return false;
      seenHigh.add(key);
      return true;
    })
    .filter((r) => r.riskScore > th.riskLevels.medium)
    .sort((a, b) => b.riskScore - a.riskScore)
    .map((r) => ({ ...r, level: riskLevel(r.riskScore, th.riskLevels) }));

  const hosRows = db
    .prepare(`SELECT REMAINING_HOURS_CAN_7 FROM driver WHERE STATUS = 'AVAIL' AND REMAINING_HOURS_CAN_7 < ?`)
    .all(th.hosCriticalRemainingHours) as any[];
  const alreadyInViolation = hosRows.filter((d) => d.REMAINING_HOURS_CAN_7 < 0).length;
  const aboutToExhaust = hosRows.length - alreadyInViolation;

  const chronicDetentionMap = dedupedRiskScores
    .filter((r) => r.detentionRisk >= 80)
    .reduce((acc: Record<string, number>, r) => {
      acc[r.DEST_ZONE_DESC] = (acc[r.DEST_ZONE_DESC] ?? 0) + 1;
      return acc;
    }, {});
  const chronicDetentionZones = Object.entries(chronicDetentionMap)
    .sort((a, b) => b[1] - a[1])
    .map(([zone, count]) => ({ zone, highDetentionLegs: count }));

  const departs = db.prepare(`SELECT * FROM geofence_events WHERE event_type = 'depart' ORDER BY timestamp DESC`).all() as any[];
  const latestPerTrip = new Map<number, any>();
  for (const d of departs) if (!latestPerTrip.has(d.trip_number)) latestPerTrip.set(d.trip_number, d);
  const dedupedDeparts = [...latestPerTrip.values()];
  const totalDetentionFeesCAD = Math.round(dedupedDeparts.reduce((sum, d) => sum + (d.detention_fee ?? 0), 0));
  const billable = dedupedDeparts.filter((d) => (d.detention_fee ?? 0) > 0);
  const byCustomer: Record<string, number> = {};
  for (const d of billable) byCustomer[d.zone_name] = (byCustomer[d.zone_name] ?? 0) + d.detention_fee;
  const topCustomers = Object.entries(byCustomer).sort((a, b) => b[1] - a[1]).map(([zone, fee]) => ({ zone, feeCAD: Math.round(fee) }));

  try {
    // Fleet risk profile: mean sub-risk across all legs vs across the high-risk subset only.
    // Deduped by (trip, driver) the same way every other aggregate in this file is, so the averages
    // describe legs a dispatcher would actually see rather than counting relay sub-legs repeatedly.
    const seenProfile = new Set<string>();
    const profileRows = riskScores.filter((r) => {
      const k = `${r.TRIP_NUMBER}|${r.DRIVER_NAME}`;
      if (seenProfile.has(k)) return false;
      seenProfile.add(k);
      return true;
    });
    const mean = (rows: typeof profileRows) => ({
      hosRisk: rows.length ? rows.reduce((a, r) => a + r.hosRisk, 0) / rows.length : 0,
      delayRisk: rows.length ? rows.reduce((a, r) => a + r.delayRisk, 0) / rows.length : 0,
      detentionRisk: rows.length ? rows.reduce((a, r) => a + r.detentionRisk, 0) / rows.length : 0,
      emptyMileRisk: rows.length ? rows.reduce((a, r) => a + r.emptyMileRisk, 0) / rows.length : 0,
    });
    const highRiskRows = profileRows.filter((r) => r.riskScore > th.riskLevels.medium);

    const doc = buildSummaryReportPdf({
      generatedAt: new Date(),
      riskProfile: {
        fleetAverage: mean(profileRows),
        highRiskAverage: mean(highRiskRows),
        fleetLegs: profileRows.length,
        highRiskLegs: highRiskRows.length,
      },
      kpis: { activeLoads, totalDrivers, availableDrivers, highRiskLoads: highRisk.length },
      levels: th.riskLevels,
      highRiskLoads: highRisk,
      edgeCases: { counts: { alreadyInViolation, aboutToExhaust, chronicDetentionZones: chronicDetentionZones.length }, chronicDetentionZones },
      detention: { totalDetentionFeesCAD, billableStops: billable.length, topCustomers },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="RoadPilot_Fleet_Summary_${new Date().toISOString().slice(0, 10)}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate report", detail: String(err.message ?? err) });
  }
});

app.get("/api/live/positions", (_req, res) => {
  const rows = db.prepare(`SELECT * FROM live_telemetry ORDER BY updated_at DESC`).all();
  res.json(rows);
});

// --- Detention summary from real geofence events ---
app.get("/api/detention/summary", (_req, res) => {
  const departs = db
    .prepare(`SELECT * FROM geofence_events WHERE event_type = 'depart' ORDER BY timestamp DESC`)
    .all() as any[];

  // The demo simulation loops a selected leg indefinitely (swap origin/destination, repeat) so the
  // map and telemetry stay alive — but that means the SAME real leg's detention event was getting
  // logged, and billed, again on every loop. Left running, "Recovered revenue" grew without bound
  // (verified: one leg alone went $1,631 -> $3,262 -> $4,894 across three loops of the identical
  // 23.75h dwell) even though it's one real-world incident, not three. Aggregates below count each
  // trip's detention at most once (its most recent depart event); `events` stays un-deduped since
  // that list is a live activity feed, not a revenue total, and showing repeat cycles there is
  // expected/informative.
  const latestPerTrip = new Map<number, any>();
  for (const d of departs) {
    if (!latestPerTrip.has(d.trip_number)) latestPerTrip.set(d.trip_number, d);
  }
  const dedupedDeparts = [...latestPerTrip.values()];

  const totalFees = dedupedDeparts.reduce((sum, d) => sum + (d.detention_fee ?? 0), 0);
  const billable = dedupedDeparts.filter((d) => (d.detention_fee ?? 0) > 0);
  const byCustomer: Record<string, number> = {};
  for (const d of billable) byCustomer[d.zone_name] = (byCustomer[d.zone_name] ?? 0) + d.detention_fee;

  res.json({
    events: departs,
    totalDetentionFeesCAD: Math.round(totalFees),
    billableStops: billable.length,
    topCustomers: Object.entries(byCustomer)
      .sort((a, b) => b[1] - a[1])
      .map(([zone, fee]) => ({ zone, feeCAD: Math.round(fee) })),
  });
});

// --- Edge case discovery: HOS exhaustion, chronic-detention customers, empty return legs ---
app.get("/api/edge-cases", (_req, res) => {
  const th = getThresholds(db);
  const hosRows = db
    .prepare(
      `SELECT DRIVER_ID, FIRST_NAME, REMAINING_HOURS_CAN_7, LAST_SAT_LOC
       FROM driver WHERE STATUS = 'AVAIL' AND REMAINING_HOURS_CAN_7 < ?
       ORDER BY REMAINING_HOURS_CAN_7 ASC`
    )
    .all(th.hosCriticalRemainingHours) as any[];
  // Negative remaining hours = already over the legal cycle limit (logged violation in the source
  // data); 0-threshold = about to run out. Dispatchers need to see these as two different severities.
  const alreadyInViolation = hosRows.filter((d) => d.REMAINING_HOURS_CAN_7 < 0);
  const aboutToExhaust = hosRows.filter((d) => d.REMAINING_HOURS_CAN_7 >= 0);

  // Each chronic-violation driver's own trips, deduped the same way as everywhere else, sorted
  // highest-risk-first. These are the trips /api/risk/top now excludes by default (see
  // chronicHosViolationDrivers) — surfaced here instead so they aren't lost, just relocated to
  // where a fleet-compliance issue belongs.
  const seenViolationTrips = new Set<string>();
  const violationTripsByDriver = new Map<string, any[]>();
  for (const r of riskScores) {
    if (!chronicHosViolationDrivers.has(r.DRIVER_NAME)) continue;
    const key = `${r.TRIP_NUMBER}|${r.DRIVER_NAME}`;
    if (seenViolationTrips.has(key)) continue;
    seenViolationTrips.add(key);
    if (!violationTripsByDriver.has(r.DRIVER_NAME)) violationTripsByDriver.set(r.DRIVER_NAME, []);
    violationTripsByDriver.get(r.DRIVER_NAME)!.push(r);
  }
  for (const trips of violationTripsByDriver.values()) trips.sort((a, b) => b.riskScore - a.riskScore);
  const alreadyInViolationWithTrips = alreadyInViolation.map((d) => ({
    ...d,
    trips: violationTripsByDriver.get(d.FIRST_NAME) ?? [],
  }));

  const chronicDetentionZones = dedupedRiskScores
    .filter((r) => r.detentionRisk >= 80)
    .reduce((acc: Record<string, number>, r) => {
      acc[r.DEST_ZONE_DESC] = (acc[r.DEST_ZONE_DESC] ?? 0) + 1;
      return acc;
    }, {});

  const emptyLegByTrip = new Map<number, any>();
  for (const r of riskScores) {
    if (r.emptyMileRisk < 60) continue;
    const existing = emptyLegByTrip.get(r.TRIP_NUMBER);
    // Prefer a row that names a real driver: the export uses the literal string "<null>" for
    // unassigned legs, and showing that as a candidate's driver is meaningless to a dispatcher.
    if (!existing || (existing.DRIVER_NAME === "<null>" && r.DRIVER_NAME !== "<null>")) {
      emptyLegByTrip.set(r.TRIP_NUMBER, r);
    }
  }
  const emptyLegCandidates = [...emptyLegByTrip.values()]
    .slice(0, 10)
    .map((r) => ({ trip: r.TRIP_NUMBER, driver: r.DRIVER_NAME, from: r.ORIG_ZONE_DESC, to: r.DEST_ZONE_DESC }));

  res.json({
    driversAlreadyInHosViolation: alreadyInViolationWithTrips,
    driversAboutToExhaustHos: aboutToExhaust,
    chronicDetentionZones: Object.entries(chronicDetentionZones)
      .sort((a, b) => b[1] - a[1])
      .map(([zone, count]) => ({ zone, highDetentionLegs: count })),
    likelyEmptyReturnLegs: emptyLegCandidates,
    counts: {
      alreadyInViolation: alreadyInViolation.length,
      aboutToExhaust: aboutToExhaust.length,
      chronicDetentionZones: Object.keys(chronicDetentionZones).length,
    },
  });
});

// Driver sheet encodes coordinates as DDDMMSS + hemisphere letter (e.g. "0433201N" = 43°32'01"N),
// not decimal degrees. Verified against real Milton/London driver records vs known city coordinates.
function parseDmsCoord(raw: string): number | null {
  if (!raw || raw.length < 8) return null;
  const hemi = raw[raw.length - 1];
  const digits = raw.slice(0, raw.length - 1);
  if (digits.length !== 7 || !/^[0-9]+$/.test(digits)) return null;
  const deg = Number(digits.slice(0, 3));
  const min = Number(digits.slice(3, 5));
  const sec = Number(digits.slice(5, 7));
  const decimal = deg + min / 60 + sec / 3600;
  return hemi === "S" || hemi === "W" ? -decimal : decimal;
}

// --- Smart load matching: best available driver for a given trip's pickup ---
app.get("/api/match/:tripNumber", (req, res) => {
  const tripNumber = Number(req.params.tripNumber);
  const row = riskScores.find((r) => r.TRIP_NUMBER === tripNumber);
  if (!row) return res.status(404).json({ error: "trip not found" });

  // Real pickup/delivery window for the leg being reassigned — order-level fields, consistent
  // across every leg row of this trip regardless of which driver is on which leg.
  const targetWindow = db
    .prepare(`SELECT PICKUP_BY, DELIVER_BY FROM dispatch WHERE TRIP_NUMBER = ? AND PICKUP_BY IS NOT NULL LIMIT 1`)
    .get(tripNumber) as { PICKUP_BY: string; DELIVER_BY: string } | undefined;

  // Excludes any driver the driver app has live-marked as DRIVING/SLEEPER right now, in addition
  // to the static STATUS='AVAIL' snapshot from the Excel import — a driver can look "available"
  // in the stale import but have since accepted another load through the driver app.
  const candidates = db
    .prepare(
      `SELECT d.DRIVER_ID, d.FIRST_NAME, d.REMAINING_HOURS_CAN_7, d.POSLAT, d.POSLONG, d.LAST_SAT_LOC,
              ds.duty_status as liveDutyStatus
       FROM driver d
       LEFT JOIN driver_status ds ON ds.driver_name = d.FIRST_NAME
       WHERE d.STATUS = 'AVAIL' AND d.REMAINING_HOURS_CAN_7 > 4
         AND d.POSLAT IS NOT NULL AND d.POSLONG IS NOT NULL
         AND (ds.duty_status IS NULL OR ds.duty_status NOT IN ('DRIVING', 'SLEEPER'))`
    )
    .all() as any[];

  const origin = findGeofence(row.ORIG_ZONE_DESC);
  const R = 6371;
  const scored = candidates
    .map((c) => {
      const lat = parseDmsCoord(String(c.POSLAT));
      const lon = parseDmsCoord(String(c.POSLONG));
      if (lat === null || lon === null || !origin) return { ...c, distanceKm: null };
      const dLat = ((origin.lat - lat) * Math.PI) / 180;
      const dLon = ((origin.lon - lon) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) *
        Math.cos((origin.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      const distanceKm = Math.round(2 * R * Math.asin(Math.sqrt(a)));
      return { ...c, lat, lon, distanceKm };
    })
    .filter((c) => c.distanceKm !== null)
    .sort((a, b) => (a.distanceKm as number) - (b.distanceKm as number))
    .slice(0, 5);

  // For each of the top candidates, check whether they already have another trip whose real
  // pickup/delivery window overlaps this leg's — reassigning someone into a genuine double-booking
  // was previously invisible; distance/HOS/live-duty-status alone don't catch it.
  const withConflicts = scored.map((c) => {
    if (!targetWindow) return { ...c, scheduleConflict: null };
    const otherLegs = db
      .prepare(
        `SELECT DISTINCT TRIP_NUMBER, PICKUP_BY, DELIVER_BY FROM dispatch
         WHERE NAME = ? AND TRIP_NUMBER != ? AND PICKUP_BY IS NOT NULL AND DELIVER_BY IS NOT NULL`
      )
      .all(c.FIRST_NAME, tripNumber) as { TRIP_NUMBER: number; PICKUP_BY: string; DELIVER_BY: string }[];

    const targetStart = new Date(targetWindow.PICKUP_BY).getTime();
    const targetEnd = new Date(targetWindow.DELIVER_BY).getTime();
    const conflict = otherLegs.find((leg) => {
      const s = new Date(leg.PICKUP_BY).getTime();
      const e = new Date(leg.DELIVER_BY).getTime();
      return s < targetEnd && e > targetStart; // standard interval-overlap test
    });

    return {
      ...c,
      scheduleConflict: conflict
        ? { tripNumber: conflict.TRIP_NUMBER, pickupBy: conflict.PICKUP_BY, deliverBy: conflict.DELIVER_BY }
        : null,
    };
  });

  res.json({ trip: row, pickupZone: origin?.name ?? row.ORIG_ZONE_DESC, topCandidates: withConflicts });
});

// --- Empty-mile solution: given a leg flagged as likely-empty (high emptyMileRisk), find real
// candidate return loads whose pickup is near that leg's delivery point — the actual
// "proximity-based load matching" the brief describes (e.g. pairing a Milton->London delivery
// with a London->Kitchener return), not just flagging the risk. Detection of *which* legs are
// empty-risk already existed (/api/edge-cases' likelyEmptyReturnLegs); this is the missing
// matching step. Revenue-per-km rate now lives in Settings (emptyMileRevenuePerKmCAD) instead of
// a hardcoded constant — computed fresh on every request, so changing it in Settings is reflected
// immediately on the next fetch (unlike the detention rate, which is baked into already-logged
// events — see the note on /api/detention/summary).

app.get("/api/empty-mile-matches/:tripNumber", (req, res) => {
  const tripNumber = Number(req.params.tripNumber);
  const th = getThresholds(db);
  const leg = riskScores.find((r) => r.TRIP_NUMBER === tripNumber);
  if (!leg) return res.status(404).json({ error: "trip not found" });

  const dest = findGeofence(leg.DEST_ZONE_DESC);
  if (!dest) {
    return res.json({ trip: leg, deliveryZone: leg.DEST_ZONE_DESC, candidates: [], note: "Delivery city isn't in the geofence list, so a connection distance can't be computed." });
  }

  const rows = db
    .prepare(
      `SELECT DISTINCT TRIP_NUMBER, NAME, ORIG_ZONE_DESC, DEST_ZONE_DESC, LS_LEG_DIST, LS_SCHEDULED_ARRIVAL
       FROM dispatch
       WHERE TRIP_NUMBER != ? AND ORIG_ZONE_DESC IS NOT NULL AND DEST_ZONE_DESC IS NOT NULL
             AND NAME IS NOT NULL AND NAME != '<null>'`
    )
    .all(tripNumber) as any[];

  const R = 6371;
  const seen = new Set<number>();
  const candidates = rows
    .map((r) => {
      const origin = findGeofence(r.ORIG_ZONE_DESC);
      if (!origin) return null;
      const dLat = ((origin.lat - dest.lat) * Math.PI) / 180;
      const dLon = ((origin.lon - dest.lon) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos((dest.lat * Math.PI) / 180) *
        Math.cos((origin.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      const connectionDistanceKm = Math.round(2 * R * Math.asin(Math.sqrt(a)));
      const legDistanceKm = Math.round(Number(r.LS_LEG_DIST) || 0);
      return {
        tripNumber: r.TRIP_NUMBER,
        originalDriverName: r.NAME, // whoever this load happened to be dispatched to historically — irrelevant to the recommendation itself, kept only for internal/debug reference, never shown as if it means "assign this to that driver"
        pickupZone: origin.name,
        dropoffZone: findGeofence(r.DEST_ZONE_DESC)?.name ?? r.DEST_ZONE_DESC,
        connectionDistanceKm,
        legDistanceKm,
        potentialRevenueCAD: Math.round(legDistanceKm * th.emptyMileRevenuePerKmCAD),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.connectionDistanceKm <= th.emptyMileMatchRadiusKm)
    .filter((c) => (seen.has(c.tripNumber) ? false : (seen.add(c.tripNumber), true)))
    .sort((a, b) => a.connectionDistanceKm - b.connectionDistanceKm)
    .slice(0, 5);

  res.json({
    trip: { tripNumber: leg.TRIP_NUMBER, driverName: leg.DRIVER_NAME, origin: leg.ORIG_ZONE_DESC, destination: leg.DEST_ZONE_DESC },
    deliveryZone: dest.name,
    candidates,
    assumedRevenuePerKmCAD: th.emptyMileRevenuePerKmCAD,
    searchRadiusKm: th.emptyMileMatchRadiusKm,
  });
});

// --- What-if simulation: tries the real ML microservice (XGBoost re-inference) first, falls
// back to a fast in-process heuristic if the microservice isn't running (see backend/ml/service.py).
// --- Sensitivity explorer: re-score a real leg with some of its inputs overridden ---
// Unlike /api/whatif this has no heuristic fallback on purpose. A fabricated sensitivity curve
// would be worse than none: the whole point is showing what the model actually does, so if the ML
// service is unreachable the UI says so instead of drawing a made-up line.
app.post("/api/rescore/:tripNumber", async (req, res) => {
  const tripNumber = Number(req.params.tripNumber);
  const base = riskScores.find((r) => r.TRIP_NUMBER === tripNumber);
  if (!base) return res.status(404).json({ error: "trip not found" });

  const mlServiceUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  try {
    const mlRes = await fetch(`${mlServiceUrl}/rescore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trip_number: tripNumber,
        driver_name: req.body?.driverName ?? base.DRIVER_NAME,
        can7: req.body?.can7 ?? null,
        can14: req.body?.can14 ?? null,
        distance_km: req.body?.distanceKm ?? null,
        schedule_slack_hours: req.body?.scheduleSlackHours ?? null,
        route_complexity: req.body?.routeComplexity ?? null,
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!mlRes.ok) throw new Error(`ML service returned ${mlRes.status}`);
    const data = await mlRes.json();
    if (data.error) throw new Error(data.error);
    return res.json({ ...data, source: "ml-service" });
  } catch (e) {
    return res.status(503).json({
      error: "ML service unavailable - start it with `cd backend/ml && python -m uvicorn service:app --port 8000`",
      detail: (e as Error).message,
    });
  }
});

app.post("/api/whatif/:tripNumber", async (req, res) => {
  const tripNumber = Number(req.params.tripNumber);
  const candidateDriverId = Number(req.body?.candidateDriverId);
  const before = riskScores.find((r) => r.TRIP_NUMBER === tripNumber);
  if (!before) return res.status(404).json({ error: "trip not found" });

  const mlServiceUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  try {
    const mlRes = await fetch(`${mlServiceUrl}/whatif`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trip_number: tripNumber,
        candidate_driver_id: candidateDriverId,
        driver_name: before.DRIVER_NAME,
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (mlRes.ok) {
      const data = await mlRes.json();
      if (!data.error) {
        return res.json({
          before: { ...before, DRIVER_NAME: data.before.driver_name },
          after: { TRIP_NUMBER: tripNumber, DRIVER_NAME: data.after.driver_name, ...data.after },
          note: data.note,
          source: "ml-service",
        });
      }
    }
  } catch {
    // ml-service unreachable or timed out -> fall through to the heuristic below
  }

  return heuristicWhatIf(tripNumber, candidateDriverId, before, res);
});

function heuristicWhatIf(tripNumber: number, candidateDriverId: number, before: any, res: any) {
  const dispatchRow = db
    .prepare(`SELECT LS_LEG_DIST, ORIG_ZONE_DESC FROM dispatch WHERE TRIP_NUMBER = ? LIMIT 1`)
    .get(tripNumber) as any;
  const candidate = db
    .prepare(`SELECT DRIVER_ID, FIRST_NAME, REMAINING_HOURS_CAN_7, POSLAT, POSLONG FROM driver WHERE DRIVER_ID = ?`)
    .get(candidateDriverId) as any;
  if (!dispatchRow || !candidate) return res.status(404).json({ error: "trip or driver not found" });

  const distanceKm = Number(dispatchRow.LS_LEG_DIST) || 0;
  const estDriveHours = distanceKm / 80;
  const hosBuffer = Number(candidate.REMAINING_HOURS_CAN_7) - estDriveHours;
  // logistic-ish mapping: buffer <= 0 -> 95 risk, buffer >= 8h -> 5 risk, linear between
  const newHosRisk = Math.max(5, Math.min(95, 95 - (hosBuffer / 8) * 90));

  const origin = findGeofence(dispatchRow.ORIG_ZONE_DESC);
  const lat = parseDmsCoord(String(candidate.POSLAT));
  const lon = parseDmsCoord(String(candidate.POSLONG));
  let pickupDetourKm = 0;
  if (origin && lat !== null && lon !== null) {
    const R = 6371;
    const dLat = ((origin.lat - lat) * Math.PI) / 180;
    const dLon = ((origin.lon - lon) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) *
      Math.cos((origin.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    pickupDetourKm = 2 * R * Math.asin(Math.sqrt(a));
  }
  const newDelayRisk = Math.min(100, before.delayRisk + pickupDetourKm * 0.15);

  const newOverall =
    0.3 * newHosRisk + 0.3 * newDelayRisk + 0.2 * before.detentionRisk + 0.2 * before.emptyMileRisk;

  res.json({
    before,
    after: {
      TRIP_NUMBER: tripNumber,
      DRIVER_NAME: candidate.FIRST_NAME,
      hosRisk: Math.round(newHosRisk * 10) / 10,
      delayRisk: Math.round(newDelayRisk * 10) / 10,
      detentionRisk: before.detentionRisk,
      emptyMileRisk: before.emptyMileRisk,
      riskScore: Math.round(newOverall * 10) / 10,
    },
    note: "Heuristic re-score (HOS buffer + pickup detour) — ml-service unreachable, this is a fallback, not a live model re-inference.",
    source: "heuristic-fallback",
  });
}

// --- Real XGBoost feature importances per sub-model (Phase 6) ---
app.get("/api/model/feature-importance", (_req, res) => {
  res.json(featureImportances);
});

// --- Held-out model performance (Risk Score Drivers panel) ---
app.get("/api/model/metrics", (_req, res) => {
  if (!modelMetrics) {
    return res.status(404).json({ error: "model_metrics.json not generated - run backend/ml/evaluate.py" });
  }
  res.json(modelMetrics);
});

// --- Search-based status lookup (the only simulation-facing endpoint the dashboard uses since
// v1.1 — manual leg selection was removed per that request; the simulation engine now runs fully
// automatically via its own auto-seed behavior in simulation/engine.ts). Looks up a trip/driver/
// city and shows its current status — risk score, location, and live ETA/progress if the
// simulation engine happens to be tracking it right now. Read-only.
app.get("/api/simulation/search", (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json([]);

  const rows = db
    .prepare(
      `SELECT TRIP_NUMBER, NAME, ORIG_ZONE_DESC, DEST_ZONE_DESC, LS_LEG_DIST
       FROM dispatch
       WHERE NAME IS NOT NULL AND NAME != '<null>'
         AND (CAST(TRIP_NUMBER AS TEXT) LIKE ? OR NAME LIKE ? OR ORIG_ZONE_DESC LIKE ? OR DEST_ZONE_DESC LIKE ?)
       ORDER BY TRIP_NUMBER DESC LIMIT 200`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`) as any[];

  // A (trip, driver) pair can have several dispatch rows (multi-stop legs on the same relay
  // segment) — dedupe to one representative row per pair so the search doesn't show the same
  // trip/driver combo repeated with different leg distances.
  const seenPairs = new Set<string>();
  const dedupedRows = rows.filter((r) => {
    const key = `${r.TRIP_NUMBER}|${r.NAME}`;
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  }).slice(0, 25);

  const telemetryRows = db.prepare(`SELECT * FROM live_telemetry`).all() as any[];
  const telemetryByTrip = new Map(telemetryRows.map((t) => [t.trip_number, t]));

  const results = dedupedRows.map((r) => {
    const risk = riskScores.find((rs) => rs.TRIP_NUMBER === r.TRIP_NUMBER && rs.DRIVER_NAME === r.NAME) ??
      riskScores.find((rs) => rs.TRIP_NUMBER === r.TRIP_NUMBER);
    const live = telemetryByTrip.get(r.TRIP_NUMBER);
    let location = "Not currently tracked";
    let eta = "\u2014";
    if (live) {
      location = `${live.lat.toFixed(4)}, ${live.lon.toFixed(4)}`;
      if (live.status === "driving") eta = `En route \u2014 ${Math.round((live.progress ?? 0) * 100)}% of leg complete`;
      else if (live.status === "dwelling") eta = "Dwelling at destination";
    }
    return {
      tripNumber: r.TRIP_NUMBER,
      driverName: r.NAME,
      origin: r.ORIG_ZONE_DESC,
      destination: r.DEST_ZONE_DESC,
      distanceKm: Math.round(Number(r.LS_LEG_DIST) || 0),
      riskScore: risk?.riskScore ?? null,
      location,
      eta,
      isLive: !!live,
    };
  });

  res.json(results);
});

const PORT = process.env.PORT ?? 8787;
app.listen(PORT, () => {
  console.log(`RoadPilot backend listening on http://localhost:${PORT}`);
});
