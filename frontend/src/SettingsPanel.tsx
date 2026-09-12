import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useThresholds, type Thresholds } from "./hooks";
import { useLiveUpdatesStore } from "./store";


function NumberField({
  label, value, onChange, suffix, helper,
}: { label: string; value: number; onChange: (v: number) => void; suffix?: string; helper?: string }) {
  return (
    <label className="block mb-3 last:mb-0">
      <span className="text-[var(--text-secondary)] text-xs">{label}</span>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-28 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-strong)]"
        />
        {suffix && <span className="text-[var(--text-tertiary)] text-xs">{suffix}</span>}
        {helper && <span className="text-[var(--text-muted)] text-xs">({helper})</span>}
      </div>
    </label>
  );
}

// Reusable on/off switch row, used for Live Updates and every per-section visibility toggle below.
function ToggleRow({
  label, description, value, onChange,
}: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div>
        <div className="text-[var(--text-primary)] text-xs">{label}</div>
        {description && <div className="text-[var(--text-muted)] text-[10px]">{description}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`shrink-0 w-11 h-6 rounded-full relative transition-colors ${
          value ? "bg-emerald-500" : "bg-[var(--border-strong)]"
        }`}
        aria-pressed={value}
        aria-label={`Toggle ${label}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
            value ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

// Groups related settings under one visual card with a colored dot, so the growing settings list
// stays scannable instead of one long undifferentiated stack of fields.
function Category({ dot, title, children }: { dot: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-[var(--surface-strong)] p-3 mb-3">
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-[var(--text-primary)] text-xs font-medium">{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const { data } = useThresholds();
  const [draft, setDraft] = useState<Thresholds | null>(null);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const liveUpdates = useLiveUpdatesStore((s) => s.enabled);
  const setLiveUpdates = useLiveUpdatesStore((s) => s.setEnabled);

  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  // Every query whose displayed numbers derive from Thresholds gets invalidated here so saving
  // actually refreshes the dashboard instead of only updating the Settings modal itself. Two
  // exceptions, called out to the person rather than silently: (1) detentionRatePerHourCAD only
  // affects *future* simulation depart events — fees already written to geofence_events are
  // historical and don't get recalculated, so "Recovered revenue" won't visibly jump on save; (2)
  // the emptyMileRisk>=60 threshold that decides which legs count as "likely empty return" is not
  // yet itself configurable, only the search radius and revenue rate used once a leg is flagged.
  async function save() {
    if (!draft) return;
    setSaving(true);
    await fetch("/api/settings/thresholds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ["thresholds"] });
    queryClient.invalidateQueries({ queryKey: ["summary"] });
    queryClient.invalidateQueries({ queryKey: ["edge-cases"] });
    queryClient.invalidateQueries({ queryKey: ["risk-high"] });
    queryClient.invalidateQueries({ queryKey: ["risk-top"] });
    queryClient.invalidateQueries({ queryKey: ["empty-mile-matches"] });
    queryClient.invalidateQueries({ queryKey: ["detention-summary"] });
  }

  async function reset() {
    setSaving(true);
    const res = await fetch("/api/settings/thresholds/reset", { method: "POST" });
    const fresh = await res.json();
    setDraft(fresh);
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ["thresholds"] });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--text-secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 hover:bg-[var(--surface)]"
      >
        ⚙ Settings
      </button>

      {open && draft && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-modal)] p-6 shadow-xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[var(--text-primary)] text-lg font-medium mb-1">Risk Threshold Settings</h3>
            <p className="text-[var(--text-tertiary)] text-xs mb-4">
              Changes apply immediately to edge-case detection, KPI banners, and risk-level colors.
            </p>

            <div className="rounded-xl bg-[var(--surface-strong)] px-3 py-2.5 mb-4">
              <ToggleRow
                label="Live updates"
                description="When on, the dashboard KPIs, fleet map, detention panel, and driver activity feed poll the API on a timer. Turn off to fetch once and stop."
                value={liveUpdates}
                onChange={setLiveUpdates}
              />
            </div>

            <Category dot="bg-red-400" title="HOS">
              <NumberField
                label="Critical HOS remaining"
                value={draft.hosCriticalRemainingHours}
                onChange={(v) => setDraft({ ...draft, hosCriticalRemainingHours: v })}
                suffix="hours"
              />
            </Category>

            <Category dot="bg-orange-400" title="Detention">
              <NumberField
                label="Free hours before billing"
                value={draft.detentionThresholdHours}
                onChange={(v) => setDraft({ ...draft, detentionThresholdHours: v })}
                suffix="hours"
              />
              <NumberField
                label="Billing rate"
                value={draft.detentionRatePerHourCAD}
                onChange={(v) => setDraft({ ...draft, detentionRatePerHourCAD: v })}
                suffix="CAD/hour"
              />
            </Category>

            <Category dot="bg-indigo-400" title="Empty Mile">
              <NumberField
                label="Return-load search radius"
                value={draft.emptyMileMatchRadiusKm}
                onChange={(v) => setDraft({ ...draft, emptyMileMatchRadiusKm: v })}
                suffix="km"
              />
              <NumberField
                label="Return-load revenue estimate"
                value={draft.emptyMileRevenuePerKmCAD}
                onChange={(v) => setDraft({ ...draft, emptyMileRevenuePerKmCAD: v })}
                suffix="CAD/km"
              />
            </Category>

            <Category dot="bg-blue-400" title="Dashboard display">
              <NumberField
                label='"Highest risk legs" — rows to show'
                value={draft.topRiskLegsCount}
                onChange={(v) => setDraft({ ...draft, topRiskLegsCount: v })}
              />
            </Category>

            <Category dot="bg-fuchsia-400" title="AI provider">
              <ToggleRow
                label="Use SPUR AI"
                description="Off = Claude Opus 5. On routes the risk recommendation and route-conditions analysis to SPUR AI, which needs SPUR_API_KEY in backend/.env."
                value={draft.useSpurAi}
                onChange={(v) => setDraft({ ...draft, useSpurAi: v })}
              />
            </Category>

            <Category dot="bg-cyan-400" title="Dashboard sections">
              <p className="text-[var(--text-muted)] text-[10px] mb-2">
                Hide sections you don't need — e.g. for a focused demo or a smaller screen. This only
                hides the UI; the underlying data keeps updating in the background either way.
              </p>
              <ToggleRow
                label="KPI banner"
                description="Active loads / Total drivers / Available drivers / High risk loads"
                value={draft.showKpiBanner}
                onChange={(v) => setDraft({ ...draft, showKpiBanner: v })}
              />
              <ToggleRow
                label="Edge case banners"
                description="Already Over HOS Limit / About to Run Out of HOS / Chronic Detention Zones"
                value={draft.showEdgeCaseBanners}
                onChange={(v) => setDraft({ ...draft, showEdgeCaseBanners: v })}
              />
              <ToggleRow
                label="Fleet Map"
                value={draft.showFleetMap}
                onChange={(v) => setDraft({ ...draft, showFleetMap: v })}
              />
              <ToggleRow
                label="Simulation control"
                description="Analyze Route Conditions / Find a load"
                value={draft.showSimulationControl}
                onChange={(v) => setDraft({ ...draft, showSimulationControl: v })}
              />
              <ToggleRow
                label="Highest risk legs"
                value={draft.showHighestRiskLegs}
                onChange={(v) => setDraft({ ...draft, showHighestRiskLegs: v })}
              />
              <ToggleRow
                label="Risk explanation & AI recommendation"
                value={draft.showRiskExplanation}
                onChange={(v) => setDraft({ ...draft, showRiskExplanation: v })}
              />
              <ToggleRow
                label="Detention Billing panel"
                description="Hidden by default"
                value={draft.showDetentionBilling}
                onChange={(v) => setDraft({ ...draft, showDetentionBilling: v })}
              />
              <ToggleRow
                label="Edge case discovery"
                description="The detailed HOS/detention/empty-mile write-up panel"
                value={draft.showEdgeCaseDiscovery}
                onChange={(v) => setDraft({ ...draft, showEdgeCaseDiscovery: v })}
              />
              <ToggleRow
                label="Feature importance"
                value={draft.showFeatureImportance}
                onChange={(v) => setDraft({ ...draft, showFeatureImportance: v })}
              />
            </Category>

            <Category dot="bg-[var(--text-muted)]" title="Risk level boundaries (score 0-100)">
              <NumberField
                label="Low / Medium boundary"
                value={draft.riskLevels.low}
                onChange={(v) => setDraft({ ...draft, riskLevels: { ...draft.riskLevels, low: v } })}
              />
              <NumberField
                label="Medium / High boundary"
                value={draft.riskLevels.medium}
                onChange={(v) => setDraft({ ...draft, riskLevels: { ...draft.riskLevels, medium: v } })}
              />
              <NumberField
                label="High / Critical boundary"
                value={draft.riskLevels.high}
                onChange={(v) => setDraft({ ...draft, riskLevels: { ...draft.riskLevels, high: v } })}
              />
            </Category>

            <div className="flex gap-2 mt-2">
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 text-xs rounded-lg py-2 bg-indigo-500/80 hover:bg-indigo-500 text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={reset}
                disabled={saving}
                className="text-xs rounded-lg py-2 px-3 bg-[var(--surface-strong)] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
              >
                Reset to defaults
              </button>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-full mt-2 text-xs rounded-lg py-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
