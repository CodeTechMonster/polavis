import { useState, type ReactNode } from "react";

export default function InfoTooltip({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`About ${title}`}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] border border-[var(--border-strong)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] shrink-0"
      >
        i
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
            <h3 className="text-[var(--text-primary)] text-base font-medium mb-3">{title}</h3>
            <div className="text-[var(--text-secondary)] text-sm space-y-3 leading-relaxed">{children}</div>
            <button
              onClick={() => setOpen(false)}
              className="w-full mt-5 text-xs rounded-lg py-2 bg-[var(--surface-strong)] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
