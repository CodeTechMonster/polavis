import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip, Legend } from "recharts";

interface Snapshot {
  hosRisk: number;
  delayRisk: number;
  detentionRisk: number;
  emptyMileRisk: number;
  riskScore: number;
}

interface Props {
  before: Snapshot;
  after: Snapshot;
  afterLabel: string;
}

// Weights must match risk_engine.py's WEIGHTS. Shown per-axis so the dispatcher can see that the
// combined score is a weighted average, not a max or a sum — which is the usual first assumption
// when a leg with one maxed-out sub-risk still lands mid-range overall.
const WEIGHTS: Record<string, number> = {
  HOS: 0.3,
  Delay: 0.3,
  Detention: 0.2,
  "Empty Mile": 0.2,
};

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const axis = payload[0]?.payload?.axis as string;
  const w = WEIGHTS[axis] ?? 0;
  const before = payload.find((p: any) => p.dataKey === "before")?.value ?? 0;
  const after = payload.find((p: any) => p.dataKey === "after")?.value ?? 0;
  const delta = after - before;
  return (
    <div className="rounded-lg bg-[var(--bg-modal)] border border-[var(--border)] px-2.5 py-1.5 text-xs shadow-lg">
      <div className="text-[var(--text-primary)] font-medium">
        {axis} <span className="text-[var(--text-muted)]">· weight {Math.round(w * 100)}%</span>
      </div>
      <div className="text-[var(--text-tertiary)]">Before {Math.round(before)}</div>
      <div className="text-indigo-400">After {Math.round(after)}</div>
      <div className={delta === 0 ? "text-[var(--text-muted)]" : delta < 0 ? "text-emerald-400" : "text-amber-400"}>
        {delta > 0 ? "+" : ""}{Math.round(delta)} on this axis
        {w > 0 && <> → {delta > 0 ? "+" : ""}{(delta * w).toFixed(1)} on total</>}
      </div>
    </div>
  );
}

/**
 * Overlays the current driver's sub-risk profile with the candidate's, so a reassignment is read as
 * a change in shape rather than a single number moving.
 *
 * This exists because the combined score is a weighted average: a leg can be legally un-runnable on
 * HOS (99) and still sit mid-range overall, and a candidate swap can move the total only a few
 * points while completely changing which risk is driving it. The two outlines make that visible;
 * the tooltip states each axis's weight and what its change contributed to the total.
 */
export default function WhatIfRadarChart({ before, after, afterLabel }: Props) {
  const data = [
    { axis: "HOS", before: before.hosRisk, after: after.hosRisk },
    { axis: "Delay", before: before.delayRisk, after: after.delayRisk },
    { axis: "Detention", before: before.detentionRisk, after: after.detentionRisk },
    { axis: "Empty Mile", before: before.emptyMileRisk, after: after.emptyMileRisk },
  ];

  const delta = after.riskScore - before.riskScore;

  return (
    <div>
      <div style={{ height: 210 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="62%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: "var(--text-secondary)", fontSize: 10 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              name="Before"
              dataKey="before"
              stroke="var(--text-muted)"
              fill="var(--text-muted)"
              fillOpacity={0.12}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <Radar
              name={`After · ${afterLabel}`}
              dataKey="after"
              stroke="#818cf8"
              fill="#818cf8"
              fillOpacity={0.3}
              strokeWidth={2}
            />
            <Legend
              wrapperStyle={{ fontSize: 10, color: "var(--text-tertiary)" }}
              iconSize={8}
              verticalAlign="bottom"
            />
            <Tooltip content={<CustomTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-axis contribution table: the radar shows the shape change, this shows the arithmetic
          that turns it into the single number above. */}
      <div className="mt-1 space-y-0.5">
        {data.map((d) => {
          const w = WEIGHTS[d.axis] ?? 0;
          const axisDelta = d.after - d.before;
          const totalDelta = axisDelta * w;
          return (
            <div key={d.axis} className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--text-tertiary)]">
                {d.axis} <span className="text-[var(--text-muted)]">×{w.toFixed(1)}</span>
              </span>
              <span className="text-[var(--text-muted)]">
                {Math.round(d.before)} → {Math.round(d.after)}
                <span
                  className={`ml-1.5 ${
                    Math.abs(totalDelta) < 0.05
                      ? "text-[var(--text-muted)]"
                      : totalDelta < 0
                      ? "text-emerald-400"
                      : "text-amber-400"
                  }`}
                >
                  {totalDelta > 0 ? "+" : ""}{totalDelta.toFixed(1)}
                </span>
              </span>
            </div>
          );
        })}
        <div className="flex items-center justify-between text-[10px] border-t border-[var(--border)] pt-1 mt-1">
          <span className="text-[var(--text-secondary)] font-medium">Total</span>
          <span className="text-[var(--text-secondary)]">
            {Math.round(before.riskScore)} → {Math.round(after.riskScore)}
            <span className={`ml-1.5 font-medium ${delta < 0 ? "text-emerald-400" : delta > 0 ? "text-amber-400" : "text-[var(--text-muted)]"}`}>
              {delta > 0 ? "+" : ""}{delta.toFixed(1)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
