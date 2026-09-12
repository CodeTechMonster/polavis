import { useEmptyMileMatches } from "./hooks";
import { Truck } from "lucide-react";

export default function EmptyMileMatchModal({ tripNumber, onClose }: { tripNumber: number; onClose: () => void }) {
  const { data, isLoading } = useEmptyMileMatches(tripNumber);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--bg-modal)] p-6 shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[var(--text-primary)] text-lg font-medium flex items-center gap-2">
            <Truck size={18} className="text-indigo-400 shrink-0" aria-hidden="true" />
            Return-load candidates{data ? ` for ${data.trip.driverName}` : ""}
          </h3>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-sm">
            ✕
          </button>
        </div>

        {isLoading && <p className="text-[var(--text-muted)] text-sm mt-3">Loading…</p>}

        {data && (
          <>
            <p className="text-[var(--text-tertiary)] text-xs mb-4">
              These are real <strong className="text-[var(--text-secondary)]">loads</strong> — not other drivers —
              picking up near where trip {data.trip.tripNumber} delivers ({data.deliveryZone}, within{" "}
              {data.searchRadiusKm ?? 80}km). <strong className="text-[var(--text-secondary)]">{data.trip.driverName}</strong> could
              chain onto any of these instead of deadheading back empty.
            </p>

            {data.note && <p className="text-amber-400 text-sm">{data.note}</p>}

            {!data.note && data.candidates.length === 0 && (
              <p className="text-[var(--text-muted)] text-sm">No pickups within {data.searchRadiusKm ?? 80}km of {data.deliveryZone} in this dataset right now.</p>
            )}

            <ul className="space-y-2">
              {data.candidates.map((c) => (
                <li key={c.tripNumber} className="rounded-lg bg-[var(--surface)] px-3 py-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--text-primary)]">Trip {c.tripNumber}</span>
                    <span className="text-emerald-400 font-medium">~${c.potentialRevenueCAD} CAD</span>
                  </div>
                  <div className="text-[var(--text-tertiary)] text-xs mt-0.5">
                    {c.pickupZone} → {c.dropoffZone} · {c.legDistanceKm}km leg · pickup {c.connectionDistanceKm}km from delivery
                  </div>
                </li>
              ))}
            </ul>

            {data.assumedRevenuePerKmCAD && (
              <p className="text-[var(--text-muted)] text-[10px] mt-3">
                Potential revenue is an estimate (${data.assumedRevenuePerKmCAD}/km assumption, not a real rate card) —
                meant to size the opportunity, not to quote a customer. Each load's own historical driver assignment
                (if any) isn't shown here — it isn't relevant to whether {data.trip.driverName} could pick it up.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
