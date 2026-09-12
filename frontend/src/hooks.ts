import { useQuery } from "@tanstack/react-query";
import { useLiveUpdatesStore } from "./store";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    // Previously this discarded whatever detail the backend actually sent back (e.g. the real
    // underlying exception message from a failed external API call) and only ever showed
    // "URL -> 502" — impossible to diagnose a real failure from the UI. Now it surfaces the
    // server's own error/detail JSON fields when present.
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ?? body.error ?? detail;
    } catch {
      // response wasn't JSON — keep the status-only message
    }
    throw new Error(`${url} -> ${detail}`);
  }
  return res.json();
}

export interface Summary {
  activeLoads: number;
  totalDrivers: number;
  availableDrivers: number;
  highRiskLoads: number;
}

export interface RiskRow {
  TRIP_NUMBER: number;
  DRIVER_NAME: string;
  ORIG_ZONE_DESC: string;
  DEST_ZONE_DESC: string;
  hosRisk: number;
  delayRisk: number;
  detentionRisk: number;
  emptyMileRisk: number;
  riskScore: number;
  distanceKm?: number | null;
  pickupBy?: string | null;
  deliverBy?: string | null;
}

export interface ShapFactor {
  feature: string;
  friendly_name: string;
  value: number;
  direction: string;
}

export interface RiskDetail {
  risk: RiskRow;
  explanation: { top_factors: ShapFactor[]; explanation: string; model?: string; guardrail_applied?: boolean; source?: "precomputed" | "live" } | null;
}

export interface LivePosition {
  trip_number: number;
  driver_name: string;
  lat: number;
  lon: number;
  speed_kmh: number;
  hos_remaining: number;
  status: string;
}

export interface DetentionSummary {
  events: { trip_number: number; driver_name: string; zone_name: string; real_dwell_hours: number; detention_fee: number; timestamp: string }[];
  totalDetentionFeesCAD: number;
  billableStops: number;
  topCustomers: { zone: string; feeCAD: number }[];
}

export interface EdgeCasesData {
  driversAlreadyInHosViolation: {
    DRIVER_ID: number;
    FIRST_NAME: string;
    REMAINING_HOURS_CAN_7: number;
    LAST_SAT_LOC: string;
    trips: RiskRow[];
  }[];
  driversAboutToExhaustHos: { DRIVER_ID: number; FIRST_NAME: string; REMAINING_HOURS_CAN_7: number; LAST_SAT_LOC: string }[];
  chronicDetentionZones: { zone: string; highDetentionLegs: number }[];
  likelyEmptyReturnLegs: { trip: number; driver: string; from: string; to: string }[];
  counts: { alreadyInViolation: number; aboutToExhaust: number; chronicDetentionZones: number };
}

export interface EmptyMileMatch {
  tripNumber: number;
  originalDriverName: string; // whoever this load was historically dispatched to — not relevant to the recommendation itself, not shown in the UI
  pickupZone: string;
  dropoffZone: string;
  connectionDistanceKm: number;
  legDistanceKm: number;
  potentialRevenueCAD: number;
}

export interface EmptyMileMatchResult {
  trip: { tripNumber: number; driverName: string; origin: string; destination: string };
  deliveryZone: string;
  candidates: EmptyMileMatch[];
  assumedRevenuePerKmCAD?: number;
  searchRadiusKm?: number;
  note?: string;
}

export function useEmptyMileMatches(tripNumber: number | undefined) {
  return useQuery({
    queryKey: ["empty-mile-matches", tripNumber],
    queryFn: () => getJson<EmptyMileMatchResult>(`/api/empty-mile-matches/${tripNumber}`),
    enabled: tripNumber !== undefined,
  });
}

export type FeatureImportanceMap = Record<string, { feature: string; importance: number }[]>;

export function useSummary() {
  const liveUpdates = useLiveUpdatesStore((s) => s.enabled);
  return useQuery({
    queryKey: ["summary"],
    queryFn: () => getJson<Summary>("/api/summary"),
    refetchInterval: liveUpdates ? 5000 : false, // needed so KPI trend icons have something to compare against over time
  });
}

export interface TopRiskSplit {
  hos99: RiskRow[];
  other: RiskRow[];
}

export function useTopRisk(limit = 8) {
  return useQuery({
    queryKey: ["risk-top", limit],
    queryFn: () => getJson<TopRiskSplit>(`/api/risk/top?limit=${limit}`),
  });
}

export function useRiskDetail(tripNumber: number | undefined, driverName: string | undefined) {
  return useQuery({
    queryKey: ["risk-detail", tripNumber, driverName],
    queryFn: () => getJson<RiskDetail>(`/api/risk/${tripNumber}?driver=${encodeURIComponent(driverName ?? "")}`),
    enabled: tripNumber !== undefined,
  });
}

export interface LegRoute {
  tripNumber: number;
  driverName: string;
  origLabel: string;
  destLabel: string;
  origin: { name: string; lat: number; lon: number } | null;
  destination: { name: string; lat: number; lon: number } | null;
}

export function useLegRoute(tripNumber: number | undefined, driverName: string | undefined) {
  return useQuery({
    queryKey: ["leg-route", tripNumber, driverName],
    queryFn: () => getJson<LegRoute>(`/api/legs/${tripNumber}/route?driver=${encodeURIComponent(driverName ?? "")}`),
    enabled: tripNumber !== undefined,
  });
}

export interface ModelMetric {
  trained: boolean;
  operatingThreshold?: number;
  thresholdSelection?: string;
  atDefaultThreshold?: { threshold: number; precision: number; recall: number; f1: number };
  reason?: string;
  label?: string;
  rocAuc?: number;
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  trainRows?: number;
  testRows?: number;
  positiveRateTest?: number;
  confusion?: { tn: number; fp: number; fn: number; tp: number };
  features?: string[];
}

export interface ModelMetrics {
  generatedAt: string;
  totalLegs: number;
  modelConfig: Record<string, unknown>;
  ensembleWeights: Record<string, number>;
  models: Record<string, ModelMetric>;
}

export function useModelMetrics() {
  return useQuery({
    queryKey: ["model-metrics"],
    // 404 just means evaluate.py hasn't been run; the panel hides itself rather than erroring.
    queryFn: () => getJson<ModelMetrics>("/api/model/metrics"),
    retry: false,
  });
}

export function useLivePositions() {
  const liveUpdates = useLiveUpdatesStore((s) => s.enabled);
  return useQuery({
    queryKey: ["live-positions"],
    queryFn: () => getJson<LivePosition[]>("/api/live/positions"),
    refetchInterval: liveUpdates ? 2000 : false,
  });
}

export function useDetentionSummary() {
  const liveUpdates = useLiveUpdatesStore((s) => s.enabled);
  return useQuery({
    queryKey: ["detention-summary"],
    queryFn: () => getJson<DetentionSummary>("/api/detention/summary"),
    refetchInterval: liveUpdates ? 3000 : false,
  });
}

export function useEdgeCases() {
  return useQuery({ queryKey: ["edge-cases"], queryFn: () => getJson<EdgeCasesData>("/api/edge-cases") });
}

export function useFeatureImportance() {
  return useQuery({
    queryKey: ["feature-importance"],
    queryFn: () => getJson<FeatureImportanceMap>("/api/model/feature-importance"),
  });
}

// --- v1.1: configurable risk thresholds / risk levels ---
export interface Thresholds {
  hosCriticalRemainingHours: number;
  detentionThresholdHours: number;
  detentionRatePerHourCAD: number;
  topRiskLegsCount: number;
  emptyMileMatchRadiusKm: number;
  emptyMileRevenuePerKmCAD: number;
  riskLevels: { low: number; medium: number; high: number };
  showDetentionBilling: boolean;
  showKpiBanner: boolean;
  showEdgeCaseBanners: boolean;
  showFleetMap: boolean;
  showSimulationControl: boolean;
  showHighestRiskLegs: boolean;
  showRiskExplanation: boolean;
  showEdgeCaseDiscovery: boolean;
  showFeatureImportance: boolean;
  useSpurAi: boolean;
}

export function useThresholds() {
  return useQuery({
    queryKey: ["thresholds"],
    queryFn: () => getJson<Thresholds>("/api/settings/thresholds"),
    staleTime: 60_000,
  });
}

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export function riskLevelFor(score: number, levels: Thresholds["riskLevels"]): RiskLevel {
  if (score <= levels.low) return "Low";
  if (score <= levels.medium) return "Medium";
  if (score <= levels.high) return "High";
  return "Critical";
}

export function riskLevelColorClasses(level: RiskLevel): string {
  switch (level) {
    case "Low":
      return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
    case "Medium":
      return "text-amber-400 border-amber-500/40 bg-amber-500/10";
    case "High":
      return "text-orange-400 border-orange-500/40 bg-orange-500/10";
    case "Critical":
      return "text-red-400 border-red-500/40 bg-red-500/10";
  }
}

// Risk scores should always render as whole numbers in the UI (the underlying calculation is
// untouched — this only affects display).
export function fmtRisk(score: number): number {
  return Math.round(score);
}

// Shared short date formatter for schedule fields (PICKUP_BY/DELIVER_BY) coming back from the
// backend as "YYYY-MM-DD HH:MM:SS" or ISO strings. Some legs in this dataset only carry a date
// (time defaults to midnight) while others have real hour:minute precision — showing "12:00 AM"
// on a date-only row would look like a specific time that was never actually recorded, so the
// time portion is only shown when it isn't exactly midnight.
export function fmtSchedule(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return null;
  const isMidnight = d.getHours() === 0 && d.getMinutes() === 0;
  return d.toLocaleString("en-CA", isMidnight
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Some source columns (LAST_SAT_LOC, and previously NAME elsewhere) contain the literal string
// "<null>" instead of a real null/empty value — an artifact of how the original Excel export
// represented missing data. Anywhere one of these fields is displayed should route through this
// so the raw "<null>" text never leaks into the UI.
export function cleanLoc(value: string | null | undefined): string {
  if (!value || value === "<null>" || value.trim() === "") return "—";
  return value;
}

// --- v1.1: full driver list (banner drill-downs + driver-app dropdown) ---
export interface DriverRow {
  DRIVER_ID: number;
  FIRST_NAME: string;
  STATUS: string;
  REMAINING_HOURS_CAN_7: number;
  LAST_SAT_LOC: string;
  liveDutyStatus: string | null;
}

export function useAllDrivers() {
  return useQuery({
    queryKey: ["drivers-all"],
    queryFn: () => getJson<DriverRow[]>("/api/drivers/all"),
  });
}

export interface AllLegsResult {
  total: number;
  legs: (RiskRow & { level: RiskLevel })[];
}

export function useAllLegs(q: string, sortKey: string, sortDir: "asc" | "desc") {
  return useQuery({
    queryKey: ["legs-all", q, sortKey, sortDir],
    queryFn: () =>
      getJson<AllLegsResult>(`/api/legs/all?q=${encodeURIComponent(q)}&sortKey=${sortKey}&sortDir=${sortDir}&limit=100`),
  });
}

export function useHighRiskLoads() {
  return useQuery({
    queryKey: ["risk-high"],
    queryFn: () => getJson<(RiskRow & { level: RiskLevel })[]>("/api/risk/high"),
  });
}

// --- Analyze Route Conditions: enriches the Base Risk Score with real-time traffic/weather ---
export interface TrafficConditionEvent {
  description: string;
  roadway: string;
  tier: "major" | "closure" | "construction" | "minor" | "roadCondition";
}

export interface WeatherSnapshot {
  zoneName: string;
  conditionMain: string;
  description: string;
  tempC: number;
  windSpeedMs: number;
  visibilityM: number;
  rain1hMm: number;
  snow1hMm: number;
}

export interface RouteConditionsResult {
  trip: { tripNumber: number; driverName: string; origin: string; destination: string };
  baseRiskScore: number;
  trafficAdjustment: number;
  weatherAdjustment: number;
  adjustedRiskScore: number;
  trafficConditions: {
    events: TrafficConditionEvent[];
    breakdown: { tier: string; count: number; points: number }[];
  };
  weatherConditions: {
    origin: WeatherSnapshot;
    destination: WeatherSnapshot;
    flags: { heavyRain: boolean; snow: boolean; ice: boolean; highWind: boolean; lowVisibility: boolean };
    breakdown: { flag: string; points: number }[];
  };
  routeConditionFactors: string[];
  recommendation: { summary: string; recommendedActions: string[]; source: "mock" | "live"; provider?: "anthropic" | "spur"; model?: string };
  dataSource: "mock" | "live";
  dataSourceDetail?: { traffic: "mock" | "live"; weather: "mock" | "live" };
}

export function useRouteConditions(tripNumber: number | undefined) {
  return useQuery({
    queryKey: ["route-conditions", tripNumber],
    queryFn: () => getJson<RouteConditionsResult>(`/api/route-conditions/${tripNumber}`),
    enabled: false, // never auto-fires — only ever runs via an explicit refetch() call from a button click, so conditions are always freshly re-analyzed rather than served from a stale cache
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
