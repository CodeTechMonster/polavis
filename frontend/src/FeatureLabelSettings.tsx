import { useState } from "react";
import { useFeatureLabelStore, DEFAULT_FEATURE_LABELS } from "./store";
import { useFeatureImportance } from "./hooks";

export default function FeatureLabelSettings() {
  const [open, setOpen] = useState(false);
  const { overrides, setLabel, resetLabel, resetAll, getLabel } = useFeatureLabelStore();
  const { data: importances } = useFeatureImportance();

  // Build the full set of raw column names actually in use right now (not just the hardcoded
  // defaults) by unioning every feature name that appears across all 4 risk sub-models — so a
  // newly-added model feature shows up here automatically without editing this file.
  const rawNames = Array.from(
    new Set([
      ...Object.keys(DEFAULT_FEATURE_LABELS),
      ...Object.values(importances ?? {}).flatMap((rows) => rows.map((r) => r.feature)),
    ])
  ).sort();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--text-secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 hover:bg-[var(--surface)]"
      >
        🏷 Column labels
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-modal)] p-6 shadow-xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[var(--text-primary)] text-lg font-medium">Column label mapping</h3>
              <button
                onClick={resetAll}
                className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                Reset all
              </button>
            </div>
            <p className="text-[var(--text-tertiary)] text-xs mb-4">
              Rename how raw dataset columns show up in the SHAP and feature-importance panels.
              Saved on this device — leave a field blank to fall back to the default.
            </p>

            <div className="space-y-3">
              {rawNames.map((raw) => (
                <div key={raw}>
                  <div className="flex items-center justify-between mb-1">
                    <code className="text-[10px] text-[var(--text-muted)]">{raw}</code>
                    {overrides[raw] && (
                      <button
                        onClick={() => resetLabel(raw)}
                        className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                      >
                        reset
                      </button>
                    )}
                  </div>
                  <input
                    defaultValue={getLabel(raw)}
                    onBlur={(e) => setLabel(raw, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="w-full text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-strong)]"
                  />
                </div>
              ))}
            </div>

            <button
              onClick={() => setOpen(false)}
              className="w-full mt-5 text-xs rounded-lg py-2 bg-[var(--surface-strong)] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
