import { useHighRiskLoads, fmtRisk, riskLevelColorClasses } from "./hooks";
import { useDashboardStore } from "./store";
import { TriangleAlert } from "lucide-react";

export default function HighRiskLoadsModal({ onClose }: { onClose: () => void }) {
  const { data: loads = [], isLoading } = useHighRiskLoads();
  const selectTrip = useDashboardStore((s) => s.selectTrip);

  function pick(r: (typeof loads)[number]) {
    selectTrip(r); // also resets any stale what-if candidate/result from a previously-selected trip
    onClose();
    // Wait a tick for the modal to unmount and the risk detail section to render the newly
    // selected trip before scrolling — scrolling in the same tick would target stale layout.
    setTimeout(() => {
      document.getElementById("risk-detail-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--bg-modal)] p-6 shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[var(--text-primary)] text-lg font-medium flex items-center gap-2">
            <TriangleAlert size={18} className="text-red-400 shrink-0" aria-hidden="true" />
            High Risk Loads ({loads.length})
          </h3>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-sm">
            ✕
          </button>
        </div>
        <p className="text-[var(--text-tertiary)] text-xs mb-3">Click a load to inspect it on the dashboard (risk detail, SHAP, and what-if).</p>

        {isLoading && <p className="text-[var(--text-muted)] text-sm">Loading…</p>}

        <div className="space-y-1">
          {loads.map((r) => (
            <button
              key={`${r.TRIP_NUMBER}-${r.DRIVER_NAME}`}
              onClick={() => pick(r)}
              className="w-full flex items-center justify-between text-sm rounded-lg px-3 py-2 bg-[var(--surface)] hover:bg-[var(--surface-strong)] text-left"
            >
              <div>
                <div className="text-[var(--text-primary)]">
                  Trip {r.TRIP_NUMBER} · {r.DRIVER_NAME}
                </div>
                <div className="text-[var(--text-tertiary)] text-xs">
                  {r.ORIG_ZONE_DESC} → {r.DEST_ZONE_DESC}
                </div>
              </div>
              <div className={`text-xs font-medium px-2 py-1 rounded-lg border ${riskLevelColorClasses(r.level)}`}>
                {fmtRisk(r.riskScore)} · {r.level}
              </div>
            </button>
          ))}
          {!isLoading && loads.length === 0 && (
            <p className="text-[var(--text-muted)] text-sm px-3">No loads above the High/Critical threshold right now.</p>
          )}
        </div>
      </div>
    </div>
  );
}
