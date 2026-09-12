import { useState } from "react";
import { useEdgeCases, cleanLoc, fmtRisk, riskLevelColorClasses, riskLevelFor, useThresholds, type RiskRow } from "./hooks";
import { useDashboardStore } from "./store";
import { ShieldAlert, Clock, MapPin } from "lucide-react";

type Kind = "violation" | "exhausting" | "detention";

// Each edge-case kind gets the same icon its dashboard banner uses, so the banner and the modal
// it opens read as the same thing.
const ICONS: Record<Kind, { Icon: typeof ShieldAlert; color: string }> = {
  violation: { Icon: ShieldAlert, color: "text-red-400" },
  exhausting: { Icon: Clock, color: "text-amber-400" },
  detention: { Icon: MapPin, color: "text-orange-400" },
};

const TITLES: Record<Kind, string> = {
  violation: "Already Over HOS Legal Limit",
  exhausting: "About to Run Out of HOS",
  detention: "Chronic High Detention Zones",
};

export default function EdgeCaseModal({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const { data } = useEdgeCases();
  const { data: thresholds } = useThresholds();
  const levels = thresholds?.riskLevels ?? { low: 30, medium: 60, high: 80 };
  const selectTrip = useDashboardStore((s) => s.selectTrip);
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);

  function pickTrip(trip: RiskRow) {
    selectTrip(trip);
    onClose();
    setTimeout(() => {
      document.getElementById("risk-detail-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--bg-modal)] p-6 shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[var(--text-primary)] text-lg font-medium flex items-center gap-2">
            {(() => {
              const { Icon, color } = ICONS[kind];
              return <Icon size={18} className={`${color} shrink-0`} aria-hidden="true" />;
            })()}
            {TITLES[kind]}
          </h3>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-sm">
            ✕
          </button>
        </div>
        {kind === "violation" && (
          <p className="text-[var(--text-tertiary)] text-xs mb-4">
            These drivers' trips are excluded from "Highest risk legs" by default (they'd otherwise
            crowd it out with an identical HOS 99 score) — click a driver to see and jump to their
            actual trips instead.
          </p>
        )}

        {!data && <p className="text-[var(--text-muted)] text-sm">Loading…</p>}

        {data && kind === "violation" && (
          <ul className="space-y-1">
            {data.driversAlreadyInHosViolation.map((d) => {
              const isExpanded = expandedDriver === d.FIRST_NAME;
              return (
                <li key={d.DRIVER_ID} className="rounded-lg bg-[var(--surface)] overflow-hidden">
                  <button
                    onClick={() => setExpandedDriver(isExpanded ? null : d.FIRST_NAME)}
                    className="w-full flex justify-between items-center text-sm px-3 py-2 hover:bg-[var(--surface-strong)]"
                  >
                    <span className="text-[var(--text-primary)] flex items-center gap-1.5">
                      <span className="text-[var(--text-muted)] text-xs">{isExpanded ? "▼" : "▶"}</span>
                      {d.FIRST_NAME} · {cleanLoc(d.LAST_SAT_LOC)}
                      <span className="text-[var(--text-muted)] text-xs">
                        ({d.trips.length} trip{d.trips.length === 1 ? "" : "s"})
                      </span>
                    </span>
                    <span className="text-red-400">{d.REMAINING_HOURS_CAN_7.toFixed(2)}h</span>
                  </button>
                  {isExpanded && (
                    <div className="px-2 pb-2 space-y-1">
                      {d.trips.length === 0 && (
                        <p className="text-[var(--text-muted)] text-xs px-2">No trips found for this driver.</p>
                      )}
                      {d.trips.map((t) => {
                        const level = riskLevelFor(t.riskScore, levels);
                        return (
                          <button
                            key={t.TRIP_NUMBER}
                            onClick={() => pickTrip(t)}
                            className="w-full flex justify-between items-center gap-2 text-left text-xs rounded-lg px-3 py-2 bg-[var(--surface-strong)] hover:bg-[var(--border-strong)]"
                          >
                            <span className="text-[var(--text-secondary)] truncate">
                              Trip {t.TRIP_NUMBER} · {t.ORIG_ZONE_DESC} → {t.DEST_ZONE_DESC}
                            </span>
                            <span className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${riskLevelColorClasses(level)}`}>
                              {fmtRisk(t.riskScore)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {data && kind === "exhausting" && (
          <ul className="space-y-1">
            {data.driversAboutToExhaustHos.map((d) => (
              <li key={d.DRIVER_ID} className="flex justify-between text-sm rounded-lg px-3 py-2 bg-[var(--surface)]">
                <span className="text-[var(--text-primary)]">
                  {d.FIRST_NAME} · {cleanLoc(d.LAST_SAT_LOC)}
                </span>
                <span className="text-amber-400">{d.REMAINING_HOURS_CAN_7.toFixed(2)}h</span>
              </li>
            ))}
          </ul>
        )}

        {data && kind === "detention" && (
          <ul className="space-y-1">
            {data.chronicDetentionZones.map((z) => (
              <li key={z.zone} className="flex justify-between text-sm rounded-lg px-3 py-2 bg-[var(--surface)]">
                <span className="text-[var(--text-primary)]">{z.zone}</span>
                <span className="text-[var(--text-secondary)]">{z.highDetentionLegs} high-risk legs</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
