import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fmtRisk } from "./hooks";
import { PackageSearch } from "lucide-react";

const card = "rounded-2xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md p-5 shadow-lg";

interface SearchResult {
  tripNumber: number;
  driverName: string;
  origin: string;
  destination: string;
  distanceKm: number;
  riskScore: number | null;
  location: string;
  eta: string;
  isLive: boolean;
}

export default function SimulationControl() {
  const [query, setQuery] = useState("");

  const { data: results = [], isLoading } = useQuery({
    queryKey: ["simulation-search", query],
    queryFn: () =>
      fetch(`/api/simulation/search?q=${encodeURIComponent(query)}`).then((r) => r.json()) as Promise<SearchResult[]>,
    enabled: query.trim().length > 0,
  });

  return (
    <div className={card}>
      <h2 className="text-[var(--text-primary)] font-medium mb-1 flex items-center gap-2">
        <PackageSearch size={17} className="text-sky-400 shrink-0" aria-hidden="true" />
        Find a load
      </h2>
      <p className="text-[var(--text-tertiary)] text-xs mb-3">
        Search by trip number, driver, or city to see its current status
      </p>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. 618819, Driver30, Milton…"
        className="w-full mb-3 text-sm bg-[var(--surface-strong)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-strong)]"
      />

      <div className="max-h-72 overflow-y-auto space-y-2">
        {query.trim() === "" && (
          <p className="text-[var(--text-muted)] text-xs">Start typing to look up a load.</p>
        )}
        {isLoading && <p className="text-[var(--text-muted)] text-xs">Searching…</p>}
        {!isLoading && query.trim() !== "" && results.length === 0 && (
          <p className="text-[var(--text-muted)] text-xs">No matching loads found.</p>
        )}
        {results.map((r) => (
          <div key={`${r.tripNumber}-${r.driverName}`} className="rounded-lg bg-[var(--surface-strong)] px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--text-primary)]">
                Trip {r.tripNumber} · {r.driverName}
              </div>
              {r.riskScore !== null && (
                <div className="text-xs font-medium px-2 py-0.5 rounded-lg bg-[var(--surface)] text-[var(--text-primary)]">
                  Risk {fmtRisk(r.riskScore)}
                </div>
              )}
            </div>
            <div className="text-[var(--text-tertiary)] text-xs mt-0.5">
              {r.origin} → {r.destination}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs">
              <span className={r.isLive ? "text-emerald-400" : "text-[var(--text-muted)]"}>
                {r.isLive ? "● Live" : "○ Not tracked"}
              </span>
              <span className="text-[var(--text-secondary)]">{r.location}</span>
              <span className="text-[var(--text-secondary)]">· {r.eta}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
