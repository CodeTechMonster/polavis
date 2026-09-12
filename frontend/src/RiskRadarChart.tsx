import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip } from "recharts";

interface Props {
  hosRisk: number;
  delayRisk: number;
  detentionRisk: number;
  emptyMileRisk: number;
  riskScore: number;
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg bg-[var(--bg-modal)] border border-[var(--border)] px-2.5 py-1.5 text-xs shadow-lg">
      <div className="text-[var(--text-primary)] font-medium">{p.axis}</div>
      <div className="text-red-400">{Math.round(p.value)} / 100</div>
    </div>
  );
}

// 4-axis radar of the sub-risk scores, with the combined score prominently overlaid in the
// center — a "the shape itself looks dangerous" visual to complement the always-visible exact
// numbers already shown in the KPI grid above this chart.
export default function RiskRadarChart({ hosRisk, delayRisk, detentionRisk, emptyMileRisk, riskScore }: Props) {
  const data = [
    { axis: "HOS", value: hosRisk },
    { axis: "Delay", value: delayRisk },
    { axis: "Detention", value: detentionRisk },
    { axis: "Empty Mile", value: emptyMileRisk },
  ];

  return (
    <div className="relative" style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="65%">
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar dataKey="value" stroke="#dc2626" fill="#f87171" fillOpacity={0.35} strokeWidth={2} />
          <Tooltip content={<CustomTooltip />} />
        </RadarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">Total Risk</div>
        <div className="text-2xl font-bold text-red-400">{Math.round(riskScore)}</div>
        <div className="text-[9px] text-[var(--text-muted)]">/ 100</div>
      </div>
    </div>
  );
}
