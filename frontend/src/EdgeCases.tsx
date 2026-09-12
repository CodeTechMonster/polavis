import { useState } from "react";
import { useEdgeCases, cleanLoc } from "./hooks";
import InfoTooltip from "./InfoTooltip";
import EmptyMileMatchModal from "./EmptyMileMatchModal";
import { ScanSearch } from "lucide-react";

const card = "rounded-2xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md p-5 shadow-lg";

export default function EdgeCases() {
  const { data } = useEdgeCases();
  const [matchTrip, setMatchTrip] = useState<number | null>(null);

  if (!data) return null;

  return (
    <div className={card}>
      <h2 className="text-[var(--text-primary)] font-medium mb-4 flex items-center gap-2">
        <ScanSearch size={17} className="text-teal-400 shrink-0" aria-hidden="true" />
        Edge case discovery
      </h2>

      {data.driversAlreadyInHosViolation.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-red-400 text-xs uppercase">Already over HOS legal limit</div>
            <InfoTooltip title="Already Over HOS Legal Limit">
              <p>Drivers whose remaining hours in the Canadian 7-day cycle (REMAINING_HOURS_CAN_7) have already gone negative — meaning they are currently over their legal driving limit, not just approaching it.</p>
              <p>This is a hard compliance violation, not a probability. hosRisk is not a model at all — it is computed by rule, and CAN_7 &lt; 0 sets it to 99 outright.</p>
            </InfoTooltip>
          </div>
          <ul className="space-y-1">
            {data.driversAlreadyInHosViolation.map((d) => (
              <li key={d.DRIVER_ID} className="text-sm text-[var(--text-primary)] flex justify-between">
                <span>{d.FIRST_NAME} · {cleanLoc(d.LAST_SAT_LOC)}</span>
                <span className="text-red-400">{d.REMAINING_HOURS_CAN_7.toFixed(1)}h</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.driversAboutToExhaustHos.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-amber-400 text-xs uppercase">About to run out of HOS</div>
            <InfoTooltip title="About to Run Out of HOS">
              <p>Drivers who are still within their legal limit, but have less than the configurable threshold (default 2 hours) of REMAINING_HOURS_CAN_7 left.</p>
              <p>Unlike the violation list above, these drivers are not breaking any rule yet — this is an early warning so a dispatcher can reassign before it becomes a violation. The threshold is adjustable in Settings under "HOS Risk - Critical HOS remaining".</p>
            </InfoTooltip>
          </div>
          <ul className="space-y-1">
            {data.driversAboutToExhaustHos.map((d) => (
              <li key={d.DRIVER_ID} className="text-sm text-[var(--text-primary)] flex justify-between">
                <span>{d.FIRST_NAME} · {cleanLoc(d.LAST_SAT_LOC)}</span>
                <span className="text-amber-400">{d.REMAINING_HOURS_CAN_7.toFixed(2)}h left</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[var(--text-secondary)] text-xs uppercase">Chronic high-detention zones</div>
          <InfoTooltip title="Chronic High-Detention Zones">
            <p>Destination cities where the XGBoost detentionRisk model predicts a High or Critical score (&gt;= 80) on multiple legs.</p>
            <p>This is a predicted, structural pattern from the model's own detentionRisk output -- not a live billing total (see the Detention Billing panel for that). Multiple high-risk legs at the same destination suggest that customer or facility chronically causes long dock waits, which is worth renegotiating rather than treating as a one-off delay.</p>
          </InfoTooltip>
        </div>
        <ul className="space-y-1">
          {data.chronicDetentionZones.slice(0, 5).map((z) => (
            <li key={z.zone} className="text-sm text-[var(--text-primary)] flex justify-between">
              <span>{z.zone}</span>
              <span className="text-[var(--text-secondary)]">{z.highDetentionLegs} high-risk legs</span>
            </li>
          ))}
        </ul>
      </div>

      {data.likelyEmptyReturnLegs.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="text-indigo-400 text-xs uppercase">Likely empty-return legs</div>
            <InfoTooltip title="Likely Empty-Return Legs">
              <p>Legs where the XGBoost emptyMileRisk model predicts a score of 60 or higher — this driver is likely to have no load lined up after this delivery and would deadhead back empty.</p>
              <p>Click a leg to search for real return-load candidates picking up near its delivery point (the "proximity-based load matching" the brief describes) instead of just flagging the risk with no next step.</p>
            </InfoTooltip>
          </div>
          <ul className="space-y-1">
            {data.likelyEmptyReturnLegs.slice(0, 5).map((leg) => (
              <li key={leg.trip}>
                <button
                  onClick={() => setMatchTrip(leg.trip)}
                  className="w-full text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-strong)] rounded-lg px-2 py-1 -mx-2 flex justify-between items-center"
                >
                  <span>Trip {leg.trip} · {leg.driver}</span>
                  <span className="text-indigo-400 text-xs">{leg.from} → {leg.to} · find return load →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {matchTrip !== null && <EmptyMileMatchModal tripNumber={matchTrip} onClose={() => setMatchTrip(null)} />}
    </div>
  );
}
