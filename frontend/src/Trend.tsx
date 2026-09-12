import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export type Trend = "up" | "down" | "stable" | null;

// Tracks a metric's value across renders/polls and reports whether it went up, down, or stayed the
// same since the last time it changed. Returns null until there's been at least one prior value to
// compare against (so we don't show a "no change" icon on first load, only on real repeat polls).
export function useTrend(value: number | undefined): Trend {
  const prevRef = useRef<number | null>(null);
  const [trend, setTrend] = useState<Trend>(null);

  useEffect(() => {
    if (value === undefined) return;
    if (prevRef.current !== null) {
      if (value > prevRef.current) setTrend("up");
      else if (value < prevRef.current) setTrend("down");
      else setTrend("stable");
    }
    prevRef.current = value;
  }, [value]);

  return trend;
}

export function TrendIcon({ trend }: { trend: Trend }) {
  if (trend === null) return null;
  if (trend === "up") {
    return (
      <span className="text-emerald-400" title="Increased since last update">
        <TrendingUp size={16} strokeWidth={2.5} />
      </span>
    );
  }
  if (trend === "down") {
    return (
      <span className="text-red-400" title="Decreased since last update">
        <TrendingDown size={16} strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className="text-[var(--text-muted)]" title="No change since last update">
      <Minus size={16} strokeWidth={2.5} />
    </span>
  );
}
