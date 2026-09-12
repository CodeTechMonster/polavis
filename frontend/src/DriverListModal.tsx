import { useMemo, useState } from "react";
import { useAllDrivers, type DriverRow, cleanLoc } from "./hooks";
import { Users, UserCheck } from "lucide-react";

type SortKey = "DRIVER_ID" | "FIRST_NAME" | "LAST_SAT_LOC" | "STATUS" | "REMAINING_HOURS_CAN_7";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "DRIVER_ID", label: "Driver #" },
  { key: "FIRST_NAME", label: "Name" },
  { key: "LAST_SAT_LOC", label: "Location" },
  { key: "STATUS", label: "Available" },
  { key: "REMAINING_HOURS_CAN_7", label: "HOS remaining" },
];

// Location text (e.g. "0.21M W of MILTON, ON") needs more room than the narrow columns — an equal
// 5-way grid-cols-5 was truncating it to "..." regardless of how wide the modal itself was.
const GRID_COLS = "grid-cols-[64px_100px_minmax(0,1fr)_80px_100px]";

function sortValue(d: DriverRow, key: SortKey): string | number {
  if (key === "STATUS") {
    // The column displays a binary Yes/No ("Yes" only for STATUS === 'AVAIL'), but real STATUS
    // values include things like ARRCONS/ARRSHIP/ASSGN that sort alphabetically *before* "AVAIL" —
    // so sorting the raw string put several "No" rows above "Yes" rows. Sort by the same Yes/No
    // the user actually sees instead.
    // Map to 0/1 so ascending (the default on first click) puts "Yes" first — matches what a
    // dispatcher actually wants to see first when they click this column.
    return d.STATUS === "AVAIL" ? 0 : 1;
  }
  const v = d[key];
  if (v === null || v === undefined || v === "<null>") return key === "REMAINING_HOURS_CAN_7" || key === "DRIVER_ID" ? -Infinity : "";
  return v;
}

export default function DriverListModal({
  onClose,
  availableOnly,
}: {
  onClose: () => void;
  availableOnly: boolean;
}) {
  const { data: drivers = [], isLoading } = useAllDrivers();
  const [sortKey, setSortKey] = useState<SortKey>("DRIVER_ID");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const rows: DriverRow[] = useMemo(() => {
    const filtered = availableOnly ? drivers.filter((d) => d.STATUS === "AVAIL") : drivers;
    const sorted = [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv);
      return (av as number) - (bv as number);
    });
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [drivers, availableOnly, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--bg-modal)] p-6 shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[var(--text-primary)] text-lg font-medium flex items-center gap-2">
            {availableOnly
              ? <UserCheck size={18} className="text-emerald-400 shrink-0" aria-hidden="true" />
              : <Users size={18} className="text-sky-400 shrink-0" aria-hidden="true" />}
            {availableOnly ? "Available Drivers" : "Total Drivers"} ({rows.length})
          </h3>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-sm">
            ✕
          </button>
        </div>
        <p className="text-[var(--text-muted)] text-[11px] mb-3">Click a column header to sort by it — click again to reverse.</p>

        {isLoading && <p className="text-[var(--text-muted)] text-sm">Loading…</p>}

        <div className="space-y-1">
          <div className={`grid ${GRID_COLS} gap-2 px-3 pb-2`}>
            {COLUMNS.map((col) => (
              <button
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className={`text-[10px] uppercase text-left flex items-center gap-1 hover:text-[var(--text-primary)] ${
                  sortKey === col.key ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
                }`}
              >
                {col.label}
                {sortKey === col.key && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
              </button>
            ))}
          </div>
          {rows.map((d) => (
            <div
              key={d.DRIVER_ID}
              className={`grid ${GRID_COLS} gap-2 text-sm text-[var(--text-primary)] rounded-lg px-3 py-2 bg-[var(--surface)]`}
            >
              <span>{d.DRIVER_ID}</span>
              <span className="truncate" title={d.FIRST_NAME}>{d.FIRST_NAME}</span>
              <span className="text-[var(--text-secondary)] truncate" title={cleanLoc(d.LAST_SAT_LOC)}>
                {cleanLoc(d.LAST_SAT_LOC)}
              </span>
              <span className={d.STATUS === "AVAIL" ? "text-emerald-400" : "text-[var(--text-tertiary)]"}>
                {d.STATUS === "AVAIL" ? "Yes" : "No"}
              </span>
              <span>{d.REMAINING_HOURS_CAN_7?.toFixed(1) ?? "\u2014"}h</span>
            </div>
          ))}
          {!isLoading && rows.length === 0 && (
            <p className="text-[var(--text-muted)] text-sm px-3">No drivers match.</p>
          )}
        </div>
      </div>
    </div>
  );
}
