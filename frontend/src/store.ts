import { create } from "zustand";
import type { RiskRow, RouteConditionsResult } from "./hooks";

export interface CandidateDriver {
  name: string;
  remainingHoursCan7: number;
  distanceToPickupKm: number;
}

// Full sub-scores, not just riskScore: the trip PDF draws a before/after radar from these, and a
// single combined number can't be decomposed back into the four axes.
export interface WhatIfSnapshot {
  hosRisk: number;
  delayRisk: number;
  detentionRisk: number;
  emptyMileRisk: number;
  riskScore: number;
}

export interface WhatIfReportData {
  candidateName: string;
  before: WhatIfSnapshot;
  after: WhatIfSnapshot;
  note: string;
}

interface DashboardState {
  selected: RiskRow | null;
  selectTrip: (row: RiskRow) => void;
  clearSelection: () => void;
  selectedCandidate: CandidateDriver | null;
  setSelectedCandidate: (c: CandidateDriver) => void;
  // Latest What-if / Route Conditions results for the selected trip, so the "Download PDF Report"
  // button can include whichever of these the dispatcher actually ran — kept in the shared store
  // rather than local component state because WhatIfPanel/RouteConditionsPanel are siblings of the
  // report button, not its parent.
  lastWhatIf: WhatIfReportData | null;
  setLastWhatIf: (w: WhatIfReportData) => void;
  lastRouteConditions: RouteConditionsResult | null;
  setLastRouteConditions: (r: RouteConditionsResult) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  selected: null,
  // Picking a new trip invalidates any candidate driver / what-if / route-conditions result
  // computed for the previous one.
  selectTrip: (row) => set({ selected: row, selectedCandidate: null, lastWhatIf: null, lastRouteConditions: null }),
  clearSelection: () => set({ selected: null, selectedCandidate: null, lastWhatIf: null, lastRouteConditions: null }),
  selectedCandidate: null,
  setSelectedCandidate: (c) => set({ selectedCandidate: c }),
  lastWhatIf: null,
  setLastWhatIf: (w) => set({ lastWhatIf: w }),
  lastRouteConditions: null,
  setLastRouteConditions: (r) => set({ lastRouteConditions: r }),
}));

type Theme = "dark" | "light";
const THEME_STORAGE_KEY = "roadpilot-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" ? "light" : "dark";
}

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getInitialTheme(),
  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    set({ theme: next });
  },
}));

// --- Feature name mapping: raw XGBoost/Excel column names -> user-editable display labels ---
// The model and SHAP output speak in raw dataset column names (REMAINING_HOURS_CAN_7, etc.).
// These defaults mirror backend/ml/explainability.py's FRIENDLY_NAMES dict, but the user can
// override any of them from the UI; overrides persist in localStorage.
export const DEFAULT_FEATURE_LABELS: Record<string, string> = {
  distance_km: "Trip distance",
  schedule_slack_hours: "Schedule slack",
  remaining_hours: "Remaining drive hours",
  REMAINING_HOURS_CAN_7: "7-day HOS cycle remaining",
  REMAINING_HOURS_CAN_14: "14-day HOS cycle remaining",
  est_drive_hours: "Estimated drive time",
  hos_buffer_hours: "HOS buffer",
  route_complexity: "Route complexity",
  customer_detention_history: "Customer detention history",
};

const FEATURE_LABELS_STORAGE_KEY = "roadpilot-feature-labels";

function loadFeatureLabelOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FEATURE_LABELS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

interface FeatureLabelState {
  overrides: Record<string, string>;
  setLabel: (rawName: string, displayName: string) => void;
  resetLabel: (rawName: string) => void;
  resetAll: () => void;
  getLabel: (rawName: string, backendFallback?: string) => string;
}

export const useFeatureLabelStore = create<FeatureLabelState>((set, get) => ({
  overrides: loadFeatureLabelOverrides(),
  setLabel: (rawName, displayName) => {
    const trimmed = displayName.trim();
    set((state) => {
      const next = { ...state.overrides };
      if (trimmed) next[rawName] = trimmed;
      else delete next[rawName];
      window.localStorage.setItem(FEATURE_LABELS_STORAGE_KEY, JSON.stringify(next));
      return { overrides: next };
    });
  },
  resetLabel: (rawName) => {
    set((state) => {
      const next = { ...state.overrides };
      delete next[rawName];
      window.localStorage.setItem(FEATURE_LABELS_STORAGE_KEY, JSON.stringify(next));
      return { overrides: next };
    });
  },
  resetAll: () => {
    window.localStorage.removeItem(FEATURE_LABELS_STORAGE_KEY);
    set({ overrides: {} });
  },
  getLabel: (rawName, backendFallback) => {
    const { overrides } = get();
    return overrides[rawName] ?? DEFAULT_FEATURE_LABELS[rawName] ?? backendFallback ?? rawName;
  },
}));

// --- Live updates toggle: a client-side preference (not a business threshold, so it lives in
// localStorage like theme/feature-labels rather than the backend app_config table). Every
// polling-based query hook reads this so a single Settings switch controls all of them at once. ---
const LIVE_UPDATES_STORAGE_KEY = "roadpilot-live-updates";

function getInitialLiveUpdates(): boolean {
  if (typeof window === "undefined") return true;
  const saved = window.localStorage.getItem(LIVE_UPDATES_STORAGE_KEY);
  return saved === null ? true : saved === "true";
}

interface LiveUpdatesState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

export const useLiveUpdatesStore = create<LiveUpdatesState>((set) => ({
  enabled: getInitialLiveUpdates(),
  setEnabled: (v) => {
    window.localStorage.setItem(LIVE_UPDATES_STORAGE_KEY, String(v));
    set({ enabled: v });
  },
}));
