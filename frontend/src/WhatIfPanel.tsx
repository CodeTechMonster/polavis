import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDashboardStore } from "./store";
import { fmtRisk } from "./hooks";
import WhatIfRadarChart from "./WhatIfRadarChart";

interface Candidate {
  DRIVER_ID: number;
  FIRST_NAME: string;
  REMAINING_HOURS_CAN_7: number;
  distanceKm: number | null;
  scheduleConflict: { tripNumber: number; pickupBy: string; deliverBy: string } | null;
}

interface RiskSnapshot {
  DRIVER_NAME?: string;
  hosRisk: number;
  delayRisk: number;
  detentionRisk: number;
  emptyMileRisk: number;
  riskScore: number;
}

function fmtDate(iso: string): string {
  const d = new Date(iso.replace(" ", "T"));
  return d.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function WhatIfPanel({ tripNumber }: { tripNumber: number }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateScores, setCandidateScores] = useState<Record<number, number>>({});
  const [loadingMatch, setLoadingMatch] = useState(false);
  const [result, setResult] = useState<{ before: RiskSnapshot; after: RiskSnapshot; note: string } | null>(null);
  const [pickedConflict, setPickedConflict] = useState<Candidate["scheduleConflict"]>(null);
  const setSelectedCandidate = useDashboardStore((s) => s.setSelectedCandidate);
  const setLastWhatIf = useDashboardStore((s) => s.setLastWhatIf);

  // The panel is reused (not remounted) when the dispatcher picks a different high-risk leg, so
  // without this reset the previous trip's candidate distances/what-if result stayed on screen
  // looking "current" until the dispatcher happened to click the button again for the new trip.
  useEffect(() => {
    setCandidates([]);
    setCandidateScores({});
    setResult(null);
    setPickedConflict(null);
  }, [tripNumber]);

  async function loadCandidates() {
    setLoadingMatch(true);
    setResult(null);
    setCandidateScores({});
    const res = await fetch(`/api/match/${tripNumber}`);
    const data = await res.json();
    const list: Candidate[] = data.topCandidates ?? [];
    setCandidates(list);
    setLoadingMatch(false);

    // Real score per candidate (not a guess): the same what-if re-inference the "reassign" click
    // uses, just run for every listed candidate up front so the list itself shows what each one
    // would actually score, not only the one the dispatcher ends up clicking.
    list.forEach(async (c) => {
      try {
        const r = await fetch(`/api/whatif/${tripNumber}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateDriverId: c.DRIVER_ID }),
        });
        const data = await r.json();
        if (data?.after?.riskScore !== undefined) {
          setCandidateScores((prev) => ({ ...prev, [c.DRIVER_ID]: data.after.riskScore }));
        }
      } catch {
        // leave that candidate's score blank rather than blocking the others
      }
    });
  }

  async function runWhatIf(candidate: Candidate) {
    setPickedConflict(candidate.scheduleConflict);
    // Record this pick in the shared store too, so the "Get Claude AI recommendation" button
    // (in App.tsx) can include the same candidate driver in its prompt to Claude — previously
    // that call always went out with no candidate driver at all, even after running a what-if here.
    setSelectedCandidate({
      name: candidate.FIRST_NAME,
      remainingHoursCan7: candidate.REMAINING_HOURS_CAN_7,
      distanceToPickupKm: candidate.distanceKm ?? 0,
    });
    const res = await fetch(`/api/whatif/${tripNumber}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateDriverId: candidate.DRIVER_ID }),
    });
    const r = await res.json();
    setResult(r);
    setLastWhatIf({
      candidateName: candidate.FIRST_NAME,
      before: r.before,
      after: r.after,
      note: r.note,
    });
  }

  return (
    <div className="border-t border-[var(--border)] pt-3 space-y-3">
      <button
        onClick={loadCandidates}
        disabled={loadingMatch}
        className="w-full rounded-xl bg-[var(--surface-strong)] hover:bg-[var(--surface-strong)] text-[var(--text-primary)] text-sm py-2 disabled:opacity-50"
      >
        {loadingMatch ? "Finding candidates…" : "What-if: reassign driver"}
      </button>

      {candidates.length > 0 && !result && (
        <div className="space-y-1">
          {candidates.map((c) => (
            <button
              key={c.DRIVER_ID}
              onClick={() => runWhatIf(c)}
              className="w-full text-left text-sm text-[var(--text-primary)] hover:bg-[var(--surface-strong)] rounded-lg px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 shrink-0">
                  <span>{c.FIRST_NAME}</span>
                  <span className="text-[10px] rounded px-1.5 py-0.5 bg-[var(--surface)] text-[var(--text-secondary)]">
                    {candidateScores[c.DRIVER_ID] !== undefined ? `Score ${fmtRisk(candidateScores[c.DRIVER_ID])}` : "Score …"}
                  </span>
                  {c.scheduleConflict && (
                    <span className="text-[10px] rounded px-1.5 py-0.5 bg-red-500/15 text-red-400 border border-red-500/30">
                      ⚠ Double-booked
                    </span>
                  )}
                </span>
                <span className="text-[var(--text-tertiary)] text-right">
                  {c.distanceKm}km away · {c.REMAINING_HOURS_CAN_7.toFixed(0)}h HOS
                </span>
              </div>
              {c.scheduleConflict && (
                <div className="text-[10px] text-red-400/80 mt-1">
                  Already assigned to trip {c.scheduleConflict.tripNumber}: {fmtDate(c.scheduleConflict.pickupBy)} → {fmtDate(c.scheduleConflict.deliverBy)} — overlaps this leg's window
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {result && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          {pickedConflict && (
            <p className="text-red-400 text-[11px] bg-red-500/10 border border-red-500/30 rounded-lg px-2 py-1.5">
              ⚠ This driver is already assigned to trip {pickedConflict.tripNumber} ({fmtDate(pickedConflict.pickupBy)} → {fmtDate(pickedConflict.deliverBy)}), which overlaps this leg's window — confirm before dispatching.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg bg-[var(--surface)] p-2">
              <div className="text-[10px] text-[var(--text-tertiary)] uppercase">Before</div>
              <div className="text-[var(--text-primary)] text-lg font-medium">{fmtRisk(result.before.riskScore)}</div>
            </div>
            <div className="rounded-lg bg-[var(--surface)] p-2">
              <div className="text-[10px] text-[var(--text-tertiary)] uppercase">After ({result.after.DRIVER_NAME})</div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={result.after.riskScore}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.35 }}
                  className={`text-lg font-medium ${
                    result.after.riskScore < result.before.riskScore ? "text-emerald-400" : "text-amber-400"
                  }`}
                >
                  {fmtRisk(result.after.riskScore)}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          {/* Sub-risk comparison. The single before/after number above can move only a little while
              the underlying profile changes completely (e.g. detention collapses but empty-mile
              climbs), because the total is a weighted average — this makes that visible. */}
          <div className="border-t border-[var(--border)] pt-2">
            <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1">
              Where the change comes from
            </div>
            <WhatIfRadarChart
              before={result.before}
              after={result.after}
              afterLabel={result.after.DRIVER_NAME ?? "candidate"}
            />
          </div>

          <p className="text-[var(--text-tertiary)] text-[11px]">{result.note}</p>
          <p className="text-[var(--text-tertiary)] text-[11px]">
            This candidate will also be included if you get an AI recommendation.
          </p>
        </motion.div>
      )}
    </div>
  );
}
