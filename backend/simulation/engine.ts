/**
 * RoadPilot AI Dispatch Advisor — Fleet Telematics Simulator (brief requirement #6:
 * "a separate simulation engine"). Runs as its own process, independent of the API
 * server, writing live telemetry + geofence events into the same SQLite database.
 *
 * Which trips get simulated is controlled dynamically via the `simulation_selection`
 * table (written by the Node API when a dispatcher picks routes in the UI). This
 * process polls that table every SYNC_INTERVAL_MS and adds/removes tracked legs
 * without needing a restart.
 *
 * For each simulated leg it:
 *   1. Interpolates GPS position from a real origin geofence to a real destination
 *      geofence over a compressed timescale.
 *   2. On arrival, writes a geofence "arrive" event with a real-clock timestamp.
 *   3. Holds at the destination for a compressed dwell period proportional to that
 *      leg's REAL historical dock-dwell hours (from LS_DET_PICK_ARRIVE/LS_DET_DELV_ARRIVE),
 *      then writes a "depart" event with the real dwell hours + computed detention fee
 *      (first 2 hours free, per the brief's FTL detention rule), then clears itself so
 *      the same trip can be re-selected fresh later.
 *   4. Decrements a simulated remaining-HOS counter for the assigned driver.
 *
 * Run: npx tsx simulation/engine.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
import { migrate } from "./schema.js";
import { findGeofence, type Geofence } from "./geofences.js";
import { getThresholds } from "../src/settings.js";

const DATA_DIR = path.resolve(process.cwd(), "..", "data");
const db = new Database(path.join(DATA_DIR, "roadpilot.sqlite"));
migrate(db);

// Detention free-hours and rate now come from Settings (detentionThresholdHours,
// detentionRatePerHourCAD) instead of hardcoded constants — read fresh in logEvent() below so a
// change in Settings takes effect on the next real depart event without restarting this process.
// Note: this only affects *future* events. Fees already written to geofence_events are historical
// records computed at that moment and are not retroactively recalculated when the rate changes —
// same as a real rate-card change wouldn't re-bill a shipment that already happened.
const SIM_SECONDS_PER_REAL_HOUR = 3; // compression factor so a demo run finishes in minutes, not hours
const TICK_MS = 500;
const SYNC_INTERVAL_MS = 2000; // how often to re-read the selection table
const DEFAULT_SEED_COUNT = 10; // auto-populated only if the selection table is empty on first run

type Phase = "driving" | "dwelling";

interface SimLeg {
  tripNumber: number;
  driverName: string;
  origin: Geofence;
  dest: Geofence;
  distanceKm: number;
  driveHours: number;
  realDwellHours: number;
  driveSimSeconds: number;
  dwellSimSeconds: number;
  phase: Phase;
  elapsedSec: number;
  hosRemaining: number;
}

function haversineKm(a: Geofence, b: Geofence): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildLeg(tripNumber: number): SimLeg | null {
  const r = db
    .prepare(
      `SELECT TRIP_NUMBER, NAME, ORIG_ZONE_DESC, DEST_ZONE_DESC, LS_LEG_DIST,
              LS_DET_PICK_ARRIVE, LS_DET_DELV_ARRIVE
       FROM dispatch
       WHERE TRIP_NUMBER = ? AND ORIG_ZONE_DESC IS NOT NULL AND DEST_ZONE_DESC IS NOT NULL
         AND NAME IS NOT NULL AND NAME != '<null>'
       LIMIT 1`
    )
    .get(tripNumber) as any;
  if (!r) return null;

  const origin = findGeofence(r.ORIG_ZONE_DESC);
  const dest = findGeofence(r.DEST_ZONE_DESC);
  if (!origin || !dest || origin.name === dest.name) return null;

  let realDwellHours = 2.5;
  if (r.LS_DET_PICK_ARRIVE && r.LS_DET_DELV_ARRIVE) {
    const arr = new Date(r.LS_DET_PICK_ARRIVE.replace(" ", "T")).getTime();
    const dep = new Date(r.LS_DET_DELV_ARRIVE.replace(" ", "T")).getTime();
    const h = (dep - arr) / 3_600_000;
    if (h > 0 && h < 72) realDwellHours = h;
  }

  const distanceKm = Number(r.LS_LEG_DIST) || haversineKm(origin, dest);
  const driveHours = distanceKm / 80;
  return {
    tripNumber: r.TRIP_NUMBER,
    driverName: r.NAME,
    origin,
    dest,
    distanceKm,
    driveHours,
    realDwellHours,
    driveSimSeconds: Math.max(3, driveHours * SIM_SECONDS_PER_REAL_HOUR),
    dwellSimSeconds: Math.max(2, realDwellHours * SIM_SECONDS_PER_REAL_HOUR),
    phase: "driving",
    elapsedSec: 0,
    hosRemaining: 11,
  };
}

function seedDefaultSelectionIfEmpty() {
  const count = (db.prepare(`SELECT COUNT(*) as n FROM simulation_selection`).get() as any).n;
  if (count > 0) return;
  const rows = db
    .prepare(
      `SELECT TRIP_NUMBER, ORIG_ZONE_DESC, DEST_ZONE_DESC FROM dispatch
       WHERE ORIG_ZONE_DESC IS NOT NULL AND DEST_ZONE_DESC IS NOT NULL
         AND NAME IS NOT NULL AND NAME != '<null>'
       ORDER BY RANDOM() LIMIT 200`
    )
    .all() as any[];
  const insert = db.prepare(`INSERT OR IGNORE INTO simulation_selection (trip_number, selected_at) VALUES (?, ?)`);
  let seeded = 0;
  for (const r of rows) {
    if (seeded >= DEFAULT_SEED_COUNT) break;
    const origin = findGeofence(r.ORIG_ZONE_DESC);
    const dest = findGeofence(r.DEST_ZONE_DESC);
    if (!origin || !dest || origin.name === dest.name) continue;
    insert.run(r.TRIP_NUMBER, new Date().toISOString());
    seeded++;
  }
  console.log(`[simulation] selection table was empty — seeded ${seeded} default legs (editable from the dashboard)`);
}

function logEvent(leg: SimLeg, eventType: "arrive" | "depart") {
  const th = getThresholds(db);
  const detentionFee =
    eventType === "depart"
      ? Math.max(0, leg.realDwellHours - th.detentionThresholdHours) * th.detentionRatePerHourCAD
      : null;
  db.prepare(
    `INSERT INTO geofence_events (trip_number, driver_name, zone_name, event_type, timestamp, real_dwell_hours, detention_fee)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    leg.tripNumber,
    leg.driverName,
    leg.dest.name,
    eventType,
    new Date().toISOString(),
    eventType === "depart" ? leg.realDwellHours : null,
    detentionFee
  );
  const tag = eventType === "depart" ? ` | detention fee: $${detentionFee!.toFixed(0)} CAD` : "";
  console.log(
    `[geofence] trip ${leg.tripNumber} (${leg.driverName}) ${eventType.toUpperCase()} at ${leg.dest.name}` +
      ` | real dwell: ${leg.realDwellHours.toFixed(1)}h${tag}`
  );
}

function upsertTelemetry(leg: SimLeg, lat: number, lon: number, speedKmh: number) {
  db.prepare(
    `INSERT INTO live_telemetry (trip_number, driver_name, lat, lon, speed_kmh, hos_remaining, progress, status, updated_at)
     VALUES (@trip, @driver, @lat, @lon, @speed, @hos, @progress, @status, @updated)
     ON CONFLICT(trip_number) DO UPDATE SET
       lat=excluded.lat, lon=excluded.lon, speed_kmh=excluded.speed_kmh,
       hos_remaining=excluded.hos_remaining, progress=excluded.progress,
       status=excluded.status, updated_at=excluded.updated_at`
  ).run({
    trip: leg.tripNumber,
    driver: leg.driverName,
    lat,
    lon,
    speed: speedKmh,
    hos: Math.max(0, leg.hosRemaining),
    progress: leg.phase === "driving" ? leg.elapsedSec / leg.driveSimSeconds : 1,
    status: leg.phase,
    updated: new Date().toISOString(),
  });
}

function removeTelemetry(tripNumber: number) {
  db.prepare(`DELETE FROM live_telemetry WHERE trip_number = ?`).run(tripNumber);
}

function tick(leg: SimLeg) {
  leg.elapsedSec += TICK_MS / 1000;

  if (leg.phase === "driving") {
    const t = Math.min(1, leg.elapsedSec / leg.driveSimSeconds);
    const lat = leg.origin.lat + (leg.dest.lat - leg.origin.lat) * t;
    const lon = leg.origin.lon + (leg.dest.lon - leg.origin.lon) * t;
    const speed = leg.distanceKm / leg.driveHours;
    leg.hosRemaining -= (TICK_MS / 1000 / leg.driveSimSeconds) * (leg.distanceKm / 80);
    upsertTelemetry(leg, lat, lon, Math.round(speed));
    if (t >= 1) {
      logEvent(leg, "arrive");
      leg.phase = "dwelling";
      leg.elapsedSec = 0;
    }
    return;
  }
  // dwelling
  upsertTelemetry(leg, leg.dest.lat, leg.dest.lon, 0);
  if (leg.elapsedSec >= leg.dwellSimSeconds) {
    logEvent(leg, "depart");
    // Loop the leg (swap origin/destination) instead of terminating it — a selected route should
    // keep running until the dispatcher deselects it, not vanish after one drive+dwell cycle.
    // A short-distance leg's full cycle can finish in well under a minute at this compression
    // factor, which is what made routes look like they "flash and disappear" before this fix.
    const swap = leg.origin;
    leg.origin = leg.dest;
    leg.dest = swap;
    leg.phase = "driving";
    leg.elapsedSec = 0;
  }
}

function syncSelection(legs: Map<number, SimLeg>) {
  const selected = new Set(
    (db.prepare(`SELECT trip_number FROM simulation_selection`).all() as any[]).map((r) => r.trip_number)
  );

  // Remove legs that were deselected (or already finished) so the map clears them immediately
  for (const tripNumber of [...legs.keys()]) {
    if (!selected.has(tripNumber)) {
      legs.delete(tripNumber);
      removeTelemetry(tripNumber);
      console.log(`[simulation] trip ${tripNumber} deselected -> removed from active tracking`);
    }
  }

  // Add newly selected legs not yet tracked
  for (const tripNumber of selected) {
    if (legs.has(tripNumber)) continue;
    const leg = buildLeg(tripNumber);
    if (!leg) {
      console.log(`[simulation] trip ${tripNumber} selected but not simulatable (missing geofence/data) — skipping`);
      continue;
    }
    legs.set(tripNumber, leg);
    console.log(`[simulation] trip ${tripNumber} selected -> now tracking: ${leg.driverName} | ${leg.origin.name} -> ${leg.dest.name} | real dwell ${leg.realDwellHours.toFixed(1)}h`);
  }
}

function main() {
  seedDefaultSelectionIfEmpty();
  const legs = new Map<number, SimLeg>();
  syncSelection(legs);
  console.log(`[simulation] started, tracking ${legs.size} legs (compression: 1 real hour = ${SIM_SECONDS_PER_REAL_HOUR}s)`);
  console.log(`[simulation] polling simulation_selection every ${SYNC_INTERVAL_MS}ms for dashboard changes`);

  let msSinceSync = 0;
  setInterval(() => {
    for (const leg of legs.values()) {
      tick(leg);
    }
    msSinceSync += TICK_MS;
    if (msSinceSync >= SYNC_INTERVAL_MS) {
      msSinceSync = 0;
      syncSelection(legs);
    }
  }, TICK_MS);
}

main();
