import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { fmtRisk } from "./hooks";

interface Snapshot {
  hosRisk: number;
  delayRisk: number;
  detentionRisk: number;
  emptyMileRisk: number;
  riskScore: number;
}

interface RescoreResult {
  before: Snapshot;
  after: Snapshot;
  effective: { can7: number; distanceKm: number; estDriveHours: number; hosBufferHours: number };
}

const AXES: { key: keyof Snapshot; label: string; weight: number }[] = [
  { key: "hosRisk", label: "HOS", weight: 0.3 },
  { key: "delayRisk", label: "Delay", weight: 0.3 },
  { key: "detentionRisk", label: "Detention", weight: 0.2 },
  { key: "emptyMileRisk", label: "Empty Mile", weight: 0.2 },
];

/**
 * "Try it yourself" panel: take a real leg and move its inputs, watching the model re-score live.
 *
 * Deliberately built on overrides to an existing leg rather than a blank entry form. The scoring
 * path reads the HOS rule's inputs from one structure and the models' inputs from another, and
 * hand-building a full feature row means keeping those in sync manually — which is exactly what
 * broke the What-if feature twice. Starting from a real row means every field the dispatcher does
 * not touch is already correct, and the backend is round-trip tested: sending no overrides
 * reproduces the leg's stored score exactly.
 */
export default function SensitivityPanel({
  tripNumber,
  driverName,
}: {
  tripNumber: number;
  driverName: string;
}) {
  const [open, setOpen] = useState(false);
  const [can7, setCan7] = useState<number | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [result, setResult] = useState<RescoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  // Reset when the dispatcher picks a different leg — otherwise the previous leg's curve stays on
  // screen looking current.
  useEffect(() => {
    setCan7(null);
    setDistanceKm(null);
    setResult(null);
    setError(null);
  }, [tripNumber]);

  useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/rescore/${tripNumber}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ driverName, can7, distanceKm }),
        });
        const data = await res.json();
        if (id !== reqId.current) return; // a newer slider move already superseded this one
        if (!res.ok) {
          setError(data.error ?? "Re-score failed");
          setResult(null);
        } else {
          setResult(data);
          setError(null);
        }
      } catch {
        if (id === reqId.current) setError("Could not reach the backend");
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 180); // debounce so dragging a slider doesn't fire a request per pixel
    return () => clearTimeout(t);
  }, [open, tripNumber, driverName, can7, distanceKm]);

  const dirty = can7 !== null || distanceKm !== null;

  return (
    <div className="border-t border-[var(--border)] pt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-[var(--text-primary)] text-sm font-medium hover:text-indigo-400"
      >
        <SlidersHorizontal size={15} className="text-indigo-400 shrink-0" aria-hidden="true" />
        Try it yourself — move the inputs, watch the model re-score
        <span className="text-[var(--text-muted)] text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[var(--text-tertiary)] text-[11px]">
            Starts from this leg's real values. Anything you don't move stays exactly as recorded.
          </p>

          <Slider
            label="Driver's remaining 7-day cycle hours"
            unit="h"
            min={-10}
            max={70}
            step={1}
            value={can7 ?? result?.effective.can7 ?? 0}
            overridden={can7 !== null}
            onChange={setCan7}
          />
          <Slider
            label="Trip distance"
            unit="km"
            min={2}
            max={2500}
            step={2}
            value={distanceKm ?? result?.effective.distanceKm ?? 0}
            overridden={distanceKm !== null}
            onChange={setDistanceKm}
          />

          {dirty && (
            <button
              onClick={() => {
                setCan7(null);
                setDistanceKm(null);
              }}
              className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline"
            >
              Reset to the leg's real values
            </button>
          )}

          {error && <p className="text-amber-400 text-[11px]">{error}</p>}

          {result && (
            <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
              <div className="space-y-1">
                {AXES.map((a) => {
                  const b = result.before[a.key];
                  const af = result.after[a.key];
                  const contrib = (af - b) * a.weight;
                  return (
                    <div key={a.key} className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--text-tertiary)]">
                        {a.label} <span className="text-[var(--text-muted)]">×{a.weight.toFixed(1)}</span>
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        {Math.round(b)} → <span className="text-[var(--text-primary)]">{Math.round(af)}</span>
                        <span
                          className={`ml-2 ${
                            Math.abs(contrib) < 0.05
                              ? "text-[var(--text-muted)]"
                              : contrib < 0
                              ? "text-emerald-400"
                              : "text-amber-400"
                          }`}
                        >
                          {contrib > 0 ? "+" : ""}
                          {contrib.toFixed(1)}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-[var(--border)] mt-2 pt-2">
                <span className="text-[var(--text-secondary)] text-xs font-medium">Total risk</span>
                <span className="text-sm">
                  <span className="text-[var(--text-tertiary)]">{fmtRisk(result.before.riskScore)}</span>
                  <span className="text-[var(--text-muted)] mx-1.5">→</span>
                  <span
                    className={`font-medium ${
                      result.after.riskScore < result.before.riskScore
                        ? "text-emerald-400"
                        : result.after.riskScore > result.before.riskScore
                        ? "text-amber-400"
                        : "text-[var(--text-primary)]"
                    }`}
                  >
                    {fmtRisk(result.after.riskScore)}
                  </span>
                </span>
              </div>

              <p className="text-[var(--text-muted)] text-[10px] mt-1.5">
                HOS buffer after this leg: {result.effective.hosBufferHours.toFixed(1)}h
                {" · "}est. drive {result.effective.estDriveHours.toFixed(1)}h
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  unit,
  min,
  max,
  step,
  value,
  overridden,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  overridden: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-[var(--text-tertiary)]">{label}</span>
        <span className={overridden ? "text-indigo-400 font-medium" : "text-[var(--text-secondary)]"}>
          {Math.round(value)}
          {unit}
          {overridden && <span className="text-[var(--text-muted)] ml-1">(changed)</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-400"
        aria-label={label}
      />
    </div>
  );
}
