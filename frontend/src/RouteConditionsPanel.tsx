import { useEffect, useState } from "react";
import { useRouteConditions } from "./hooks";
import { useDashboardStore } from "./store";
import { Gauge, TrafficCone, CloudRain, Sparkles } from "lucide-react";

const TIER_LABELS: Record<string, string> = {
  major: "Major Incidents",
  closure: "Road Closures",
  construction: "Construction Zones",
  minor: "Minor Incidents",
  roadCondition: "Road Condition Alerts",
};
const TIER_COLORS: Record<string, string> = {
  major: "text-red-400",
  closure: "text-red-400",
  construction: "text-amber-400",
  minor: "text-[var(--text-secondary)]",
  roadCondition: "text-amber-400",
};

/**
 * This endpoint does two independent things — fetches traffic/weather, then asks a model what to
 * do about it — and each has its own mock flag. The panel used to print
 * "set MOCK_ROUTE_CONDITIONS=true" for every failure, which is the wrong flag whenever the failure
 * was on the AI side: it would send someone to mock out the data feed while the real problem was an
 * invalid API key. Pick the hint from what actually failed.
 */
function mockHintFor(error: Error): string {
  const m = (error.message ?? "").toLowerCase();
  const aiSide =
    m.includes("api key") ||
    m.includes("authentication") ||
    m.includes("401") ||
    m.includes("claude") ||
    m.includes("spur") ||
    m.includes("max_tokens") ||
    m.includes("anthropic");

  if (aiSide) {
    return (
      "This failed on the AI call, not the traffic/weather fetch. Check ANTHROPIC_API_KEY in " +
      "backend/.env (and restart the backend — .env is read at startup), or set MOCK_CLAUDE=true " +
      "to run without a key. SPUR AI can also be switched on in Settings if you have a key for it."
    );
  }
  return "Set MOCK_ROUTE_CONDITIONS=true in backend/.env to test the traffic/weather fetch without live keys.";
}

export default function RouteConditionsPanel({ tripNumber }: { tripNumber: number }) {
  const { data, isLoading, isFetching, isError, error, refetch } = useRouteConditions(tripNumber);
  const setLastRouteConditions = useDashboardStore((s) => s.setLastRouteConditions);
  const [showTrafficDetails, setShowTrafficDetails] = useState(false);
  const [showFactorDetails, setShowFactorDetails] = useState(false);

  // Same lesson as WhatIfPanel: this component is reused (not remounted) when the dispatcher
  // picks a different trip, so without this reset a previous trip's route-conditions results
  // would stay on screen looking current until "Analyze" was clicked again for the new trip.
  useEffect(() => {
    setShowTrafficDetails(false);
    setShowFactorDetails(false);
  }, [tripNumber]);

  useEffect(() => {
    if (data) setLastRouteConditions(data);
  }, [data, setLastRouteConditions]);

  const busy = isLoading || isFetching;

  return (
    <div className="border-t border-[var(--border)] pt-3 space-y-3">
      <button
        onClick={() => {
          // Real traffic/weather conditions change over time, so every click re-runs the whole
          // analysis against the live APIs instead of quietly reusing a cached result from
          // earlier in the session — refetch() bypasses the cache entirely.
          setShowTrafficDetails(false);
          setShowFactorDetails(false);
          refetch();
        }}
        disabled={busy}
        className="w-full rounded-xl bg-sky-500/80 hover:bg-sky-500 text-white text-sm py-2 disabled:opacity-50"
      >
        {busy ? "Analyzing route conditions…" : "Analyze Route Conditions"}
      </button>

      {isError && (
        <div className="text-red-400 text-xs space-y-1">
          <p>{(error as Error).message}</p>
          <p className="text-[var(--text-tertiary)]">{mockHintFor(error as Error)}</p>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          {data.dataSource === "mock" && (
            <p className="text-amber-400 text-[11px]">
              {data.dataSourceDetail
                ? `Traffic: ${data.dataSourceDetail.traffic === "mock" ? "mock" : "live Ontario 511"} · Weather: ${data.dataSourceDetail.weather === "mock" ? "mock (no OPENWEATHERMAP_API_KEY set)" : "live OpenWeather"}`
                : "Mock route conditions (MOCK_ROUTE_CONDITIONS=true or no API keys set) — not live Ontario 511 / OpenWeather data"}
            </p>
          )}

          {/* Risk Impact */}
          <div className="rounded-xl bg-[var(--surface)] p-3">
            <div className="text-[var(--text-secondary)] text-xs uppercase mb-2 flex items-center gap-1.5">
              <Gauge size={13} className="text-indigo-400 shrink-0" aria-hidden="true" />
              Risk Impact
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-[10px] text-[var(--text-tertiary)] uppercase">Base</div>
                <div className="text-[var(--text-primary)] text-lg font-medium">{data.baseRiskScore}</div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--text-tertiary)] uppercase">Traffic</div>
                <div className="text-amber-400 text-lg font-medium">+{data.trafficAdjustment}</div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--text-tertiary)] uppercase">Weather</div>
                <div className="text-sky-400 text-lg font-medium">+{data.weatherAdjustment}</div>
              </div>
              <div className="rounded-lg bg-indigo-500/15 border border-indigo-400/30">
                <div className="text-[10px] text-indigo-300 uppercase pt-1">Adjusted</div>
                <div className="text-indigo-300 text-lg font-semibold pb-1">{data.adjustedRiskScore}</div>
              </div>
            </div>
            <p className="text-[var(--text-muted)] text-[10px] mt-2">
              Base Risk Score is the unchanged XGBoost output — this panel only adds context on top, it never modifies the model.
            </p>
          </div>

          {/* Traffic Conditions — tier counts always visible, full event list collapsed behind Details */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[var(--text-secondary)] text-xs uppercase flex items-center gap-1.5">
                <TrafficCone size={13} className="text-amber-400 shrink-0" aria-hidden="true" />
                Traffic Conditions
              </div>
              {data.trafficConditions.events.length > 0 && (
                <button
                  onClick={() => setShowTrafficDetails((v) => !v)}
                  className="text-[10px] text-sky-400 hover:text-sky-300"
                >
                  {showTrafficDetails ? "Hide details" : `Show details (${data.trafficConditions.events.length})`}
                </button>
              )}
            </div>

            {data.trafficConditions.events.length === 0 ? (
              <p className="text-[var(--text-muted)] text-xs">No traffic events reported on this corridor right now.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {data.trafficConditions.breakdown.map((b) => (
                    <span
                      key={b.tier}
                      className={`text-[10px] px-2 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)] ${TIER_COLORS[b.tier]}`}
                    >
                      {TIER_LABELS[b.tier]}: {b.count}
                    </span>
                  ))}
                </div>

                {showTrafficDetails && (
                  <ul className="space-y-1.5 mt-2 max-h-64 overflow-y-auto pr-1">
                    {data.trafficConditions.events.map((e, i) => (
                      <li key={i} className="text-xs">
                        <span className={`font-medium ${TIER_COLORS[e.tier]}`}>{TIER_LABELS[e.tier]}</span>
                        <span className="text-[var(--text-secondary)]"> — {e.description}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Weather Conditions */}
          <div>
            <div className="text-[var(--text-secondary)] text-xs uppercase mb-2 flex items-center gap-1.5">
              <CloudRain size={13} className="text-sky-400 shrink-0" aria-hidden="true" />
              Weather Conditions
            </div>
            <div className="grid grid-cols-5 gap-2 text-center">
              <div className="rounded-lg bg-[var(--surface)] p-2">
                <div className="text-[9px] text-[var(--text-tertiary)] uppercase">Rain</div>
                <div className="text-[var(--text-primary)] text-xs font-medium">
                  {Math.max(data.weatherConditions.origin.rain1hMm, data.weatherConditions.destination.rain1hMm)}mm/h
                </div>
              </div>
              <div className="rounded-lg bg-[var(--surface)] p-2">
                <div className="text-[9px] text-[var(--text-tertiary)] uppercase">Snow</div>
                <div className="text-[var(--text-primary)] text-xs font-medium">
                  {Math.max(data.weatherConditions.origin.snow1hMm, data.weatherConditions.destination.snow1hMm)}mm/h
                </div>
              </div>
              <div className="rounded-lg bg-[var(--surface)] p-2">
                <div className="text-[9px] text-[var(--text-tertiary)] uppercase">Wind</div>
                <div className="text-[var(--text-primary)] text-xs font-medium">
                  {Math.max(data.weatherConditions.origin.windSpeedMs, data.weatherConditions.destination.windSpeedMs).toFixed(1)}m/s
                </div>
              </div>
              <div className="rounded-lg bg-[var(--surface)] p-2">
                <div className="text-[9px] text-[var(--text-tertiary)] uppercase">Temp</div>
                <div className="text-[var(--text-primary)] text-xs font-medium">
                  {Math.round((data.weatherConditions.origin.tempC + data.weatherConditions.destination.tempC) / 2)}°C
                </div>
              </div>
              <div className="rounded-lg bg-[var(--surface)] p-2">
                <div className="text-[9px] text-[var(--text-tertiary)] uppercase">Visibility</div>
                <div className="text-[var(--text-primary)] text-xs font-medium">
                  {Math.min(data.weatherConditions.origin.visibilityM, data.weatherConditions.destination.visibilityM)}m
                </div>
              </div>
            </div>
          </div>

          {/* Model Factors vs Route Condition Factors — kept visually separate on purpose, and
              collapsed behind Details for the same reason as Traffic Conditions above: a busy
              corridor can produce dozens of factors, which used to all render at once. */}
          <div className="rounded-lg bg-[var(--surface)] p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-indigo-300 text-xs uppercase">Route Condition Factors</div>
              {data.routeConditionFactors.length > 0 && (
                <button
                  onClick={() => setShowFactorDetails((v) => !v)}
                  className="text-[10px] text-sky-400 hover:text-sky-300"
                >
                  {showFactorDetails ? "Hide details" : `Show details (${data.routeConditionFactors.length})`}
                </button>
              )}
            </div>
            <p className="text-[var(--text-muted)] text-[10px] mb-1.5">
              Real-time, not part of the XGBoost model — see "Top SHAP factors" above for the model's own reasoning.
            </p>
            {showFactorDetails && (
              <ul className="space-y-0.5 max-h-64 overflow-y-auto pr-1">
                {data.routeConditionFactors.map((f, i) => (
                  <li key={i} className="text-[var(--text-secondary)] text-xs">• {f}</li>
                ))}
              </ul>
            )}
          </div>

          {/* AI Recommendation */}
          <div className="rounded-lg bg-[var(--surface)] p-3">
            <div className="text-[var(--text-secondary)] text-xs uppercase mb-1.5 flex items-center gap-1.5">
              <Sparkles size={13} className="text-indigo-400 shrink-0" aria-hidden="true" />
              AI Recommendation
            </div>
            <p className="text-[var(--text-primary)] text-sm mb-2">{data.recommendation.summary}</p>
            <ul className="space-y-1">
              {data.recommendation.recommendedActions.map((a, i) => (
                <li key={i} className="text-[var(--text-secondary)] text-xs">• {a}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
