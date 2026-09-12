import type Database from "better-sqlite3";

export interface Thresholds {
  hosCriticalRemainingHours: number; // default 2h
  detentionThresholdHours: number; // default 2h
  detentionRatePerHourCAD: number; // default 75 CAD/h — billing rate after the free hours
  emptyMileMatchRadiusKm: number; // default 80km — search radius for return-load matching
  emptyMileRevenuePerKmCAD: number; // default 2.5 CAD/km — return-load revenue estimate
  topRiskLegsCount: number; // default 10 — how many rows the "Highest risk legs" panel shows
  riskLevels: {
    low: number; // 0-30
    medium: number; // 31-60
    high: number; // 61-80
    // critical = anything above `high`
  };
  showDetentionBilling: boolean; // default false (hidden) — v2.0: dashboard visibility toggle
  // v2.0.8: per-section dashboard visibility toggles. All default to true (visible) except
  // showDetentionBilling above, which keeps its existing default-hidden behavior. These only hide
  // the section's UI — none of them stop the underlying data from being computed/polled.
  showKpiBanner: boolean;
  showEdgeCaseBanners: boolean;
  showFleetMap: boolean;
  showSimulationControl: boolean;
  showHighestRiskLegs: boolean;
  showRiskExplanation: boolean;
  showEdgeCaseDiscovery: boolean;
  showFeatureImportance: boolean;
  // v2.2.3: route AI calls to SPUR AI instead of Anthropic. Off by default -- Anthropic is the
  // configured, tested path, and SPUR additionally needs SPUR_API_KEY in .env to work at all.
  useSpurAi: boolean;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  hosCriticalRemainingHours: 2,
  detentionThresholdHours: 2,
  detentionRatePerHourCAD: 75,
  emptyMileMatchRadiusKm: 80,
  emptyMileRevenuePerKmCAD: 2.5,
  topRiskLegsCount: 10,
  riskLevels: { low: 30, medium: 60, high: 80 },
  showDetentionBilling: false,
  showKpiBanner: true,
  showEdgeCaseBanners: true,
  showFleetMap: true,
  showSimulationControl: true,
  showHighestRiskLegs: true,
  showRiskExplanation: true,
  showEdgeCaseDiscovery: true,
  showFeatureImportance: true,
  useSpurAi: false,
};

const CONFIG_KEY = "thresholds";

export function getThresholds(db: Database.Database): Thresholds {
  const row = db.prepare(`SELECT value FROM app_config WHERE key = ?`).get(CONFIG_KEY) as any;
  if (!row) return DEFAULT_THRESHOLDS;
  try {
    // Only keys that still exist in DEFAULT_THRESHOLDS are accepted. An install that saved its
    // settings before v2.1.7 will have `delayThresholdHours` / `emptyMileThresholdMiles` in its
    // stored JSON; those settings were removed because nothing read them, and a plain spread would
    // keep resurrecting them into the API response. Dropping unknown keys here means a stale row
    // heals itself on the next save instead of needing a manual DB edit.
    const saved = JSON.parse(row.value) as Record<string, unknown>;
    const known = Object.fromEntries(
      Object.entries(saved).filter(([k]) => k in DEFAULT_THRESHOLDS)
    );
    return { ...DEFAULT_THRESHOLDS, ...known } as Thresholds;
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

export function setThresholds(db: Database.Database, thresholds: Partial<Thresholds>): Thresholds {
  const merged = { ...getThresholds(db), ...thresholds };
  db.prepare(
    `INSERT INTO app_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(CONFIG_KEY, JSON.stringify(merged));
  return merged;
}

export function riskLevel(score: number, levels: Thresholds["riskLevels"]): "Low" | "Medium" | "High" | "Critical" {
  if (score <= levels.low) return "Low";
  if (score <= levels.medium) return "Medium";
  if (score <= levels.high) return "High";
  return "Critical";
}
