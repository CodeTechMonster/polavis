import { useState } from "react";
import { useAllLegs, fmtRisk, fmtSchedule, riskLevelColorClasses, type RiskLevel } from "./hooks";
import { useDashboardStore } from "./store";
import { List } from "lucide-react";

type SortKey = "TRIP_NUMBER" | "DRIVER_NAME" | "riskScore" | "level";
type SortDir = "asc" | "desc";

const HEADER_ORDER: (SortKey | "route")[] = ["TRIP_NUMBER", "DRIVER_NAME", "route", "riskScore", "level"];
const HEADER_LABEL: Record<SortKey | "route", string> = {
  TRIP_NUMBER: "Trip",
  DRIVER_NAME: "Driver",
  route: "Route",
  riskScore: "Score",
  level: "Level",
};
const GRID_COLS = "grid-cols-[85px_100px_minmax(0,1fr)_75px_75px]";

export default function AllLegsModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("riskScore");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { data, isLoading } = useAllLegs(query, sortKey, sortDir);
  const selectTrip = useDashboardStore((s) => s.selectTrip);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function pick(leg: NonNullable<typeof data>["legs"][number]) {
    selectTrip(leg);
    onClose();
    setTimeout(() => {
      document.getElementById("risk-detail-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--bg-modal)] p-6 shadow-xl max-h-[85vh] overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[var(--text-primary)] text-lg font-medium flex items-center gap-2">
            <List size={18} className="text-sky-400 shrink-0" aria-hidden="true" />
            All Legs {data && <span className="text-[var(--text-tertiary)] text-sm font-normal">({data.total.toLocaleString()})</span>}
          </h3>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-sm">
            ✕
          </button>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by trip number, driver, or city…"
          className="w-full mb-3 text-sm bg-[var(--surface-strong)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-strong)]"
        />

        <div className={`grid ${GRID_COLS} gap-2 px-3 pb-2`}>
          {HEADER_ORDER.map((key) =>
            key === "route" ? (
              <span key={key} className="text-left text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                {HEADER_LABEL[key]}
              </span>
            ) : (
              <button
                key={key}
                onClick={() => toggleSort(key)}
                className="text-left text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex items-center gap-0.5"
              >
                {HEADER_LABEL[key]}
                {sortKey === key && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
              </button>
            )
          )}
        </div>

        <div className="space-y-1 overflow-y-auto">
          {isLoading && <p className="text-[var(--text-muted)] text-sm px-3">Loading…</p>}
          {data?.legs.map((leg) => (
            <button
              key={`${leg.TRIP_NUMBER}-${leg.DRIVER_NAME}`}
              onClick={() => pick(leg)}
              className={`w-full grid ${GRID_COLS} gap-2 items-center text-left text-sm rounded-lg px-3 py-2 bg-[var(--surface)] hover:bg-[var(--surface-strong)]`}
            >
              <span className="text-[var(--text-primary)]">{leg.TRIP_NUMBER}</span>
              <span className="text-[var(--text-secondary)] truncate">{leg.DRIVER_NAME === "<null>" ? "—" : leg.DRIVER_NAME}</span>
              <span className="text-[var(--text-tertiary)] text-xs truncate">
                {leg.ORIG_ZONE_DESC} → {leg.DEST_ZONE_DESC}
                {(fmtSchedule(leg.pickupBy) || fmtSchedule(leg.deliverBy)) && (
                  <span className="text-[var(--text-muted)]">
                    {" · "}
                    {fmtSchedule(leg.pickupBy) && `Depart ${fmtSchedule(leg.pickupBy)}`}
                    {fmtSchedule(leg.pickupBy) && fmtSchedule(leg.deliverBy) && " · "}
                    {fmtSchedule(leg.deliverBy) && `ETA ${fmtSchedule(leg.deliverBy)}`}
                  </span>
                )}
              </span>
              <span className="text-[var(--text-primary)] font-medium">{fmtRisk(leg.riskScore)}</span>
              <span className={`text-[9px] uppercase font-medium px-1.5 py-0.5 rounded text-center ${riskLevelColorClasses(leg.level as RiskLevel)}`}>
                {leg.level}
              </span>
            </button>
          ))}
          {data && data.legs.length === 0 && (
            <p className="text-[var(--text-muted)] text-sm px-3">No legs match "{query}".</p>
          )}
        </div>

        {data && data.total > data.legs.length && (
          <p className="text-[var(--text-muted)] text-[10px] mt-2 px-1">
            Showing top {data.legs.length} of {data.total.toLocaleString()} matching legs — refine your search to narrow further.
          </p>
        )}
      </div>
    </div>
  );
}
