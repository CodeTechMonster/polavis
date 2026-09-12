import { useDetentionSummary, useThresholds } from "./hooks";
import InfoTooltip from "./InfoTooltip";
import { Receipt } from "lucide-react";

const card = "rounded-2xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md p-5 shadow-lg";

export default function DetentionBilling() {
  const { data: summary } = useDetentionSummary();
  const { data: thresholds } = useThresholds();

  if (!summary) return null;

  const freeHours = thresholds?.detentionThresholdHours ?? 2;
  const rate = thresholds?.detentionRatePerHourCAD ?? 75;
  const exampleTotal = freeHours + 3;
  const exampleCost = 3 * rate;

  return (
    <div className={card}>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-[var(--text-primary)] font-medium flex items-center gap-2">
          <Receipt size={17} className="text-amber-400 shrink-0" aria-hidden="true" />
          Detention billing (live from geofence events)
        </h2>
        <InfoTooltip title="Detention Billing">
          <p>Detention billing is the fee that can be charged when a driver waits at a pickup or delivery site longer than the free waiting time allowance.</p>
          <div>
            <div className="text-[var(--text-primary)] text-xs font-medium mb-1">Formula</div>
            <p className="font-mono text-xs">Billable Hours = Total Detention Hours − Free Hours</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">Example: {exampleTotal}h total detention − {freeHours}h free = 3h billable</p>
          </div>
          <div>
            <div className="text-[var(--text-primary)] text-xs font-medium mb-1">Cost example (current rate: ${rate}/h)</div>
            <p className="font-mono text-xs">3h × ${rate}/h = ${exampleCost}</p>
          </div>
          <p className="text-[10px] text-[var(--text-muted)]">Free hours and rate are editable in ⚙ Settings → Detention.</p>
        </InfoTooltip>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg bg-[var(--surface)] p-3">
          <div className="text-[10px] text-[var(--text-tertiary)] uppercase">Recovered revenue</div>
          <div className="text-emerald-400 text-xl font-medium">${summary.totalDetentionFeesCAD} CAD</div>
        </div>
        <div className="rounded-lg bg-[var(--surface)] p-3">
          <div className="text-[10px] text-[var(--text-tertiary)] uppercase">Billable stops</div>
          <div className="text-[var(--text-primary)] text-xl font-medium">{summary.billableStops}</div>
        </div>
      </div>
      <div className="text-[var(--text-secondary)] text-xs uppercase mb-2">Top detention locations</div>
      <ul className="space-y-1 mb-4">
        {summary.topCustomers.slice(0, 5).map((c) => (
          <li key={c.zone} className="text-sm text-[var(--text-primary)] flex justify-between">
            <span>{c.zone}</span>
            <span className="text-amber-400">${c.feeCAD} CAD</span>
          </li>
        ))}
      </ul>
      <div className="text-[var(--text-secondary)] text-xs uppercase mb-2">Recent stops (2h free, then billed)</div>
      <ul className="space-y-1 max-h-40 overflow-y-auto">
        {summary.events.slice(0, 8).map((e, i) => (
          <li key={i} className="text-xs text-[var(--text-secondary)] flex justify-between">
            <span>Trip {e.trip_number} · {e.zone_name}</span>
            <span className={e.detention_fee > 0 ? "text-red-400" : "text-emerald-400"}>
              {e.real_dwell_hours.toFixed(1)}h → ${Math.round(e.detention_fee)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
