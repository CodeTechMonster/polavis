import { useState, lazy, Suspense } from "react";
import { motion } from "framer-motion";
import DetentionBilling from "./DetentionBilling";
import EdgeCases from "./EdgeCases";
import WhatIfPanel from "./WhatIfPanel";
import SensitivityPanel from "./SensitivityPanel";
import RouteConditionsPanel from "./RouteConditionsPanel";
import RiskRadarChart from "./RiskRadarChart";
import FeatureImportance from "./FeatureImportance";
import SimulationControl from "./SimulationControl";
import ThemeToggle from "./ThemeToggle";
import InfoPanel, { VERSION } from "./InfoPanel";
import { TriangleAlert, Sparkles, Package, Users, UserCheck, ShieldAlert, Clock, MapPin } from "lucide-react";
import InfoTooltip from "./InfoTooltip";
import SettingsPanel from "./SettingsPanel";
import DriverListModal from "./DriverListModal";
import HighRiskLoadsModal from "./HighRiskLoadsModal";
import AllLegsModal from "./AllLegsModal";
import EdgeCaseModal from "./EdgeCaseModal";
import { useTrend, TrendIcon } from "./Trend";
import { useSummary, useTopRisk, useRiskDetail, useThresholds, useEdgeCases, riskLevelFor, riskLevelColorClasses, fmtRisk, fmtSchedule, type RiskRow } from "./hooks";
import { useDashboardStore, useFeatureLabelStore } from "./store";

const FleetMap = lazy(() => import("./FleetMap"));

interface Recommendation {
  summary: string;
  risks: string[];
  recommendations: string[];
  alternativeDispatchPlan: string;
  expectedImpact: { riskReduction: string; detentionSavings: string; delayReduction: string };
  source?: "mock" | "live";
  provider?: "anthropic" | "spur";
  model?: string;
}

const card = "rounded-2xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md p-5 shadow-lg";
const DEFAULT_LEVELS = { low: 30, medium: 60, high: 80 };

type BannerModal = "total" | "available" | "highrisk" | "alllegs" | null;
type EdgeModal = "violation" | "exhausting" | "detention" | null;

export default function App() {
  const { data: summary } = useSummary();
  const { data: thresholds } = useThresholds();
  const levels = thresholds?.riskLevels ?? DEFAULT_LEVELS;
  const topRiskCount = thresholds?.topRiskLegsCount ?? 10;
  const { data: topRisk } = useTopRisk(topRiskCount);
  const { data: edgeCases } = useEdgeCases();
  const { selected, selectTrip, selectedCandidate, lastWhatIf, lastRouteConditions } = useDashboardStore();
  const { getLabel } = useFeatureLabelStore();
  const { data: riskDetail, isLoading: riskDetailLoading } = useRiskDetail(selected?.TRIP_NUMBER, selected?.DRIVER_NAME);
  const shap = riskDetail?.explanation?.top_factors ?? [];

  const activeLoadsTrend = useTrend(summary?.activeLoads);
  const totalDriversTrend = useTrend(summary?.totalDrivers);
  const availableDriversTrend = useTrend(summary?.availableDrivers);
  const highRiskTrend = useTrend(summary?.highRiskLoads);
  const [bannerModal, setBannerModal] = useState<BannerModal>(null);
  const [edgeModal, setEdgeModal] = useState<EdgeModal>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  async function getRecommendation() {
    if (!selected) return;
    setRecLoading(true);
    setRecError(null);
    setRecommendation(null);
    try {
      const res = await fetch(`/api/recommend/${selected.TRIP_NUMBER}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateDriver: selectedCandidate ?? undefined, routeConditions: lastRouteConditions ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? data.error ?? "unknown error");
      setRecommendation(data);
    } catch (e: any) {
      setRecError(e.message);
    } finally {
      setRecLoading(false);
    }
  }

  async function downloadTripReport() {
    if (!selected) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await fetch(`/api/report/trip/${selected.TRIP_NUMBER}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatIf: lastWhatIf ?? undefined, routeConditions: lastRouteConditions ?? undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? data.error ?? "unknown error");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RoadPilot_Trip_${selected.TRIP_NUMBER}_Report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setReportError(e.message);
    } finally {
      setReportLoading(false);
    }
  }

  async function downloadSummaryReport() {
    const res = await fetch("/api/report/summary");
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `RoadPilot_Fleet_Summary_${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderLegRow(row: RiskRow, compact = false) {
    const level = riskLevelFor(row.riskScore, levels);
    const isSelected = selected?.TRIP_NUMBER === row.TRIP_NUMBER;
    if (compact) {
      return (
        <button
          key={row.TRIP_NUMBER}
          onClick={() => selectTrip(row)}
          className={`w-full text-left rounded-lg border p-2 transition hover:bg-[var(--surface-strong)] ${
            isSelected
              ? "border-indigo-400 bg-indigo-500/10 ring-1 ring-indigo-400/40"
              : "border-[var(--border)]"
          }`}
        >
          <div className="flex justify-between items-start gap-1.5">
            <div className="min-w-0">
              <div className="text-[var(--text-primary)] text-xs font-medium truncate flex items-center gap-1">
                {isSelected && <span className="text-indigo-400 shrink-0">●</span>}
                <span className="truncate">Trip {row.TRIP_NUMBER} · {row.DRIVER_NAME}</span>
              </div>
              <div className="text-[var(--text-tertiary)] text-[10px] truncate">
                {row.ORIG_ZONE_DESC} → {row.DEST_ZONE_DESC}
              </div>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-0.5">
              <div className={`text-xs font-medium px-1.5 py-0.5 rounded-md border ${riskLevelColorClasses(level)}`}>
                {fmtRisk(row.riskScore)}
              </div>
            </div>
          </div>
        </button>
      );
    }
    return (
      <button
        key={row.TRIP_NUMBER}
        onClick={() => selectTrip(row)}
        className={`w-full text-left rounded-xl border p-3 transition hover:bg-[var(--surface-strong)] ${
          isSelected
            ? "border-indigo-400 bg-indigo-500/10 ring-1 ring-indigo-400/40"
            : "border-[var(--border)]"
        }`}
      >
        <div className="flex justify-between items-center">
          <div>
            <div className="text-[var(--text-primary)] text-sm flex items-center gap-1.5">
              {isSelected && <span className="text-indigo-400">●</span>}
              Trip {row.TRIP_NUMBER} · {row.DRIVER_NAME}
            </div>
            <div className="text-[var(--text-tertiary)] text-xs">
              {row.ORIG_ZONE_DESC} → {row.DEST_ZONE_DESC}
            </div>
            {(fmtSchedule(row.pickupBy) || fmtSchedule(row.deliverBy)) && (
              <div className="text-[var(--text-muted)] text-[10px] mt-0.5">
                {fmtSchedule(row.pickupBy) && <span>Depart {fmtSchedule(row.pickupBy)}</span>}
                {fmtSchedule(row.pickupBy) && fmtSchedule(row.deliverBy) && <span> · </span>}
                {fmtSchedule(row.deliverBy) && <span>ETA {fmtSchedule(row.deliverBy)}</span>}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className={`text-sm font-medium px-2 py-1 rounded-lg border ${riskLevelColorClasses(level)}`}>
              {fmtRisk(row.riskScore)}
            </div>
            <span className={`text-[9px] uppercase tracking-wide font-medium px-1.5 rounded ${riskLevelColorClasses(level)}`}>
              {level}
            </span>
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,var(--bg-radial-1)_0%,var(--bg-radial-2)_60%)] p-6 md:p-10">
      <header className="mb-8 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-medium text-[var(--text-primary)]">RoadPilot AI Dispatch Advisor</h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">Southern Ontario city dispatch · {VERSION}</p>
        </div>
        <div className="flex items-center gap-2">
          <InfoPanel />
          <SettingsPanel />
          <button
            onClick={downloadSummaryReport}
            className="text-xs text-[var(--text-secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 hover:bg-[var(--surface)]"
          >
            Download Fleet Summary
          </button>
          <ThemeToggle />
        </div>
      </header>

      {(thresholds?.showKpiBanner ?? true) && (
      <motion.section
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.08 } } }}
      >
        {[
          { label: "Active loads", value: summary?.activeLoads, trend: activeLoadsTrend, Icon: Package, iconColor: "text-sky-400", onClick: () => setBannerModal("alllegs") },
          { label: "Total drivers", value: summary?.totalDrivers, trend: totalDriversTrend, Icon: Users, iconColor: "text-[var(--text-tertiary)]", onClick: () => setBannerModal("total") },
          { label: "Available drivers", value: summary?.availableDrivers, trend: availableDriversTrend, Icon: UserCheck, iconColor: "text-emerald-400", onClick: () => setBannerModal("available") },
          { label: "High risk loads", value: summary?.highRiskLoads, trend: highRiskTrend, danger: true, Icon: TriangleAlert, iconColor: "text-red-400", onClick: () => setBannerModal("highrisk") },
        ].map((k) => (
          <motion.button
            key={k.label}
            onClick={k.onClick}
            className={`${card} text-left cursor-pointer hover:bg-[var(--surface-strong)]`}
            variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
          >
            <div className="text-[var(--text-secondary)] text-xs uppercase tracking-wide flex items-center gap-1.5">
              <k.Icon size={13} className={`${k.iconColor} shrink-0`} aria-hidden="true" />
              {k.label}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className={`text-3xl font-medium ${k.danger ? "text-red-400" : "text-[var(--text-primary)]"}`}>
                {k.value ?? "…"}
              </div>
              <TrendIcon trend={k.trend} />
            </div>
            <div className="text-[var(--text-muted)] text-[10px] mt-1">Click to view list →</div>
          </motion.button>
        ))}
      </motion.section>
      )}

      {/* Edge case discovery banners (v1.1): live counts, click for detail */}
      {(thresholds?.showEdgeCaseBanners ?? true) && (
      <section className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Already Over HOS Limit", count: edgeCases?.counts.alreadyInViolation, kind: "violation" as const, color: "text-red-400", Icon: ShieldAlert },
          { label: "About to Run Out of HOS", count: edgeCases?.counts.aboutToExhaust, kind: "exhausting" as const, color: "text-amber-400", Icon: Clock },
          { label: "Chronic Detention Zones", count: edgeCases?.counts.chronicDetentionZones, kind: "detention" as const, color: "text-orange-400", Icon: MapPin },
        ].map((b) => (
          <button
            key={b.kind}
            onClick={() => setEdgeModal(b.kind)}
            className={`${card} text-left hover:bg-[var(--surface-strong)]`}
          >
            <div className="text-[var(--text-secondary)] text-xs uppercase tracking-wide flex items-center gap-1.5">
              <b.Icon size={13} className={`${b.color} shrink-0`} aria-hidden="true" />
              {b.label}
            </div>
            <div className={`text-2xl font-medium mt-1 ${b.color}`}>{b.count ?? "…"}</div>
          </button>
        ))}
      </section>
      )}

      {(thresholds?.showFleetMap ?? true) || (thresholds?.showSimulationControl ?? true) ? (
      <section className={`mb-6 grid gap-6 items-start ${
        (thresholds?.showFleetMap ?? true) && (thresholds?.showSimulationControl ?? true) ? "md:grid-cols-[1fr_360px]" : "md:grid-cols-1"
      }`}>
        {(thresholds?.showFleetMap ?? true) && (
          <Suspense fallback={<div className={`${card} h-[420px] flex items-center justify-center text-[var(--text-muted)] text-sm`}>Loading map…</div>}>
            <FleetMap />
          </Suspense>
        )}
        {(thresholds?.showSimulationControl ?? true) && <SimulationControl />}
      </section>
      ) : null}

      {(thresholds?.showHighestRiskLegs ?? true) || (thresholds?.showRiskExplanation ?? true) ? (
      <section className={`grid gap-6 mb-6 ${
        (thresholds?.showHighestRiskLegs ?? true) && (thresholds?.showRiskExplanation ?? true) ? "md:grid-cols-2" : "md:grid-cols-1"
      }`}>
        {(thresholds?.showHighestRiskLegs ?? true) && (
        <div className={card}>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[var(--text-primary)] font-medium flex items-center gap-2">
              <TriangleAlert size={17} className="text-amber-400 shrink-0" aria-hidden="true" />
              Highest risk legs
            </h2>
            <span className="text-[10px] text-[var(--text-muted)]">
              Top {topRiskCount} per list by score · not all shown are necessarily "High" — see badge
            </span>
          </div>
          <p className="text-[var(--text-muted)] text-[10px] mb-3">
            Split into two columns so severe/guardrail-forced HOS legs (≥99) don't crowd out other risk types.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wide">HOS ≥ 99</span>
              </div>
              <div className="space-y-1.5">
                {topRisk?.hos99.map((row) => renderLegRow(row, true))}
                {topRisk && topRisk.hos99.length === 0 && (
                  <p className="text-[var(--text-muted)] text-xs">No legs with HOS ≥ 99 right now.</p>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]" />
                <span className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wide">HOS &lt; 99</span>
              </div>
              <div className="space-y-1.5">
                {topRisk?.other.map((row) => renderLegRow(row, true))}
                {topRisk && topRisk.other.length === 0 && (
                  <p className="text-[var(--text-muted)] text-xs">No legs found.</p>
                )}
              </div>
            </div>
          </div>
        </div>
        )}

        {(thresholds?.showRiskExplanation ?? true) && (
        <div className={card} id="risk-detail-section">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-[var(--text-primary)] font-medium flex items-center gap-2">
              <Sparkles size={17} className="text-indigo-400 shrink-0" aria-hidden="true" />
              Risk explanation &amp; AI recommendation
            </h2>
            <InfoTooltip title="Risk Explanation & AI Recommendation">
              <div>
                <div className="text-[var(--text-primary)] text-xs font-medium mb-1">Risk factor signs</div>
                <p><span className="text-red-400 font-medium">+</span> means a risk-increasing factor (e.g. "+ HOS Remaining &lt; 2h" → risk increases).</p>
                <p><span className="text-emerald-400 font-medium">−</span> means a risk-reducing factor (e.g. "− Nearby Available Driver" → risk decreases).</p>
              </div>
              <div>
                <div className="text-[var(--text-primary)] text-xs font-medium mb-1">Top SHAP factors</div>
                <p>See the dedicated info icon next to "Top SHAP factors" below for how to read these — it explains which specific model is being shown for the currently-selected leg.</p>
              </div>
              <div>
                <div className="text-[var(--text-primary)] text-xs font-medium mb-1">Risk level scale</div>
                <table className="w-full text-xs">
                  <tbody>
                    <tr><td className="py-0.5">0–{levels.low}</td><td className="text-emerald-400">Low</td></tr>
                    <tr><td className="py-0.5">{levels.low + 1}–{levels.medium}</td><td className="text-amber-400">Medium</td></tr>
                    <tr><td className="py-0.5">{levels.medium + 1}–{levels.high}</td><td className="text-orange-400">High</td></tr>
                    <tr><td className="py-0.5">{levels.high + 1}–100</td><td className="text-red-400">Critical</td></tr>
                  </tbody>
                </table>
                <p className="text-[10px] text-[var(--text-muted)] mt-1">Editable from ⚙ Settings.</p>
              </div>
            </InfoTooltip>
          </div>
          {selected && (
            <button
              onClick={() => document.getElementById("fleet-map-section")?.scrollIntoView({ behavior: "smooth", block: "center" })}
              disabled={!(thresholds?.showFleetMap ?? true)}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 disabled:text-[var(--text-muted)] disabled:cursor-not-allowed -mt-3 mb-3"
            >
              {(thresholds?.showFleetMap ?? true)
                ? "📍 View this leg's route on the Fleet Map ↑"
                : "📍 Route on map — enable \"Fleet Map\" in ⚙ Settings to see it"}
            </button>
          )}
          {!selected && <p className="text-[var(--text-tertiary)] text-sm">Select a leg on the left to inspect it.</p>}
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-5 gap-2 text-center">
                <div className="rounded-lg bg-indigo-500/15 border border-indigo-400/30 p-2">
                  <div className="text-[10px] text-indigo-300 uppercase">Total</div>
                  <div className="text-indigo-300 text-sm font-semibold">{fmtRisk(selected.riskScore)}</div>
                </div>
                {(["hosRisk", "delayRisk", "detentionRisk", "emptyMileRisk"] as const).map((k) => (
                  <div key={k} className="rounded-lg bg-[var(--surface)] p-2">
                    <div className="text-[10px] text-[var(--text-tertiary)] uppercase">{k.replace("Risk", "")}</div>
                    <div className="text-[var(--text-primary)] text-sm font-medium">{fmtRisk(selected[k])}</div>
                  </div>
                ))}
              </div>

              <div className="grid md:grid-cols-2 gap-4 items-start">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-[var(--text-secondary)] text-xs uppercase">Top SHAP factors</div>
                    {riskDetail?.explanation?.source === "live" && (
                      <span className="text-emerald-400 text-[10px] bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
                        live re-inference
                      </span>
                    )}
                    <InfoTooltip title="Top SHAP Factors">
                      <p>
                        The number shown is the leg's actual raw value for that feature (not a SHAP score) —
                        e.g. "Schedule slack ↑ 131" means the real schedule_slack_hours for this leg is 131.
                      </p>
                      <p>
                        The arrow shows whether that feature pushed the explained model's score up (↑) or
                        down (↓) — not whether the raw value itself went up or down.
                      </p>
                      <p>
                        These 5 are explaining <strong className="text-[var(--text-primary)]">{riskDetail?.explanation?.model ?? "the dominant risk model"}</strong>{" "}
                        specifically — whichever of hosRisk/delayRisk/detentionRisk/emptyMileRisk is actually
                        this leg's highest sub-score — not a blend of all four.
                      </p>
                      <p>
                        Legs in the small offline-precomputed set show instantly ("precomputed"). Any other
                        leg is explained on demand by the live ML microservice instead ("live
                        re-inference") — this needs <code>2-ml-microservice.bat</code> (or `uvicorn
                        service:app --port 8000`) running; if it isn't, or times out, no explanation is
                        shown for that leg.
                      </p>
                    </InfoTooltip>
                  </div>
                  {riskDetailLoading && (
                    <p className="text-[var(--text-muted)] text-xs">Loading explanation…</p>
                  )}
                  {!riskDetailLoading && shap.length > 0 && (
                    <ul className="space-y-1">
                      {shap.map((f) => (
                        <li key={f.feature} className="text-sm text-[var(--text-primary)] flex justify-between">
                          <span>{getLabel(f.feature, f.friendly_name)}</span>
                          <span className={f.direction === "increases risk" ? "text-red-400" : "text-emerald-400"}>
                            {f.direction === "increases risk" ? "↑" : "↓"} {Math.round(Math.abs(f.value))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!riskDetailLoading && shap.length === 0 && (
                    <p className="text-[var(--text-muted)] text-xs">
                      No SHAP explanation available for this leg. It's outside the small offline-precomputed
                      set, and the live ML microservice (<code>2-ml-microservice.bat</code>, port 8000)
                      either isn't running or didn't respond in time — start it and reselect this leg to
                      compute one on demand. The sub-scores above and the radar chart are still real, live
                      numbers either way.
                    </p>
                  )}
                </div>

                <RiskRadarChart
                  hosRisk={selected.hosRisk}
                  delayRisk={selected.delayRisk}
                  detentionRisk={selected.detentionRisk}
                  emptyMileRisk={selected.emptyMileRisk}
                  riskScore={selected.riskScore}
                />
              </div>

              <SensitivityPanel tripNumber={selected.TRIP_NUMBER} driverName={selected.DRIVER_NAME} />

              <WhatIfPanel tripNumber={selected.TRIP_NUMBER} />
              <RouteConditionsPanel tripNumber={selected.TRIP_NUMBER} />

              <button
                onClick={getRecommendation}
                disabled={recLoading}
                className="w-full rounded-xl bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm py-2 disabled:opacity-50"
              >
                {recLoading ? "Asking AI…" : "Get AI recommendation"}
              </button>
              {(selectedCandidate || lastRouteConditions) && (
                <p className="text-[var(--text-tertiary)] text-[11px] -mt-2">
                  Will include: {[
                    selectedCandidate && `candidate driver ${selectedCandidate.name} (What-if)`,
                    lastRouteConditions && "Route Conditions analysis",
                  ].filter(Boolean).join(" + ")}
                </p>
              )}

              {recError && (
                <p className="text-red-400 text-xs">
                  {recError} — set ANTHROPIC_API_KEY in backend/.env to enable this call.
                </p>
              )}

              {recommendation && (
                <div className="space-y-2 border-t border-[var(--border)] pt-3">
                  {recommendation.source === "mock" && (
                    <p className="text-amber-400 text-[11px]">
                      Mock response (MOCK_CLAUDE=true) — not a real API call
                    </p>
                  )}
                  {/* Name the provider that actually answered. With a Settings toggle that swaps
                      models, "did it really switch?" should be answerable from the screen. */}
                  {recommendation.source === "live" && recommendation.provider && (
                    <p className="text-[var(--text-muted)] text-[10px]">
                      Answered by{" "}
                      <span className={recommendation.provider === "spur" ? "text-fuchsia-400" : "text-indigo-400"}>
                        {recommendation.provider === "spur" ? "SPUR AI" : "Anthropic"}
                      </span>
                      {recommendation.model ? ` · ${recommendation.model}` : ""}
                    </p>
                  )}
                  <p className="text-[var(--text-primary)] text-sm">{recommendation.summary}</p>
                  <p className="text-[var(--text-secondary)] text-xs">{recommendation.alternativeDispatchPlan}</p>
                  <div className="text-xs text-emerald-400">
                    Risk reduction: {recommendation.expectedImpact.riskReduction}
                  </div>
                </div>
              )}

              <div className="border-t border-[var(--border)] pt-3">
                <button
                  onClick={downloadTripReport}
                  disabled={reportLoading}
                  className="w-full rounded-xl bg-[var(--surface-strong)] hover:bg-[var(--border-strong)] text-[var(--text-primary)] text-sm py-2 disabled:opacity-50"
                >
                  {reportLoading ? "Generating PDF…" : "Download PDF Report"}
                </button>
                {(lastWhatIf || lastRouteConditions) && (
                  <p className="text-[var(--text-tertiary)] text-[11px] mt-1.5">
                    Will include: {[lastWhatIf && "What-if result", lastRouteConditions && "Route Conditions analysis"].filter(Boolean).join(" + ")}
                  </p>
                )}
                {reportError && <p className="text-red-400 text-xs mt-1.5">{reportError}</p>}
              </div>
            </div>
          )}
        </div>
        )}
      </section>
      ) : null}

      {(thresholds?.showDetentionBilling || (thresholds?.showEdgeCaseDiscovery ?? true)) && (
      <section className={`grid gap-6 ${thresholds?.showDetentionBilling && (thresholds?.showEdgeCaseDiscovery ?? true) ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
        {thresholds?.showDetentionBilling && <DetentionBilling />}
        {(thresholds?.showEdgeCaseDiscovery ?? true) && <EdgeCases />}
      </section>
      )}

      {(thresholds?.showFeatureImportance ?? true) && (
      <section className="mt-6">
        <FeatureImportance />
      </section>
      )}

      {bannerModal === "total" && <DriverListModal availableOnly={false} onClose={() => setBannerModal(null)} />}
      {bannerModal === "available" && <DriverListModal availableOnly={true} onClose={() => setBannerModal(null)} />}
      {bannerModal === "highrisk" && <HighRiskLoadsModal onClose={() => setBannerModal(null)} />}
      {bannerModal === "alllegs" && <AllLegsModal onClose={() => setBannerModal(null)} />}
      {edgeModal && <EdgeCaseModal kind={edgeModal} onClose={() => setEdgeModal(null)} />}
    </div>
  );
}
