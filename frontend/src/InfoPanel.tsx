import { useState } from "react";

const APP_NAME = "RoadPilot AI Dispatch Advisor";
// Exported so the dashboard header shows the same version as this panel. Previously the header
// hardcoded a separate "v2.0" string, which drifted out of date as patch versions shipped.
export const VERSION = "v2.2.4";
const TEAM_NAME = "Polavis";
const TEAM_MEMBERS = ["Hyunsoo Hwang", "Jung Yu", "Chaeyoon Kim"];

const GLOSSARY: { term: string; def: string }[] = [
  { term: "HOS (Hours of Service)", def: "Legal limits on how long a commercial driver may drive/work before a mandatory rest. This app uses the real Canadian rules: 13h driving limit, 14h on-duty limit, 16h elapsed window, 10h daily off-duty." },
  { term: "CAN_7 / CAN_14", def: "Hours remaining in the driver's 7-day (70h) or 14-day (120h) Canadian HOS cycle \u2014 the key regulatory fields the hosRisk model is built on." },
  { term: "FTL (Full Truck Load)", def: "A shipment that fills an entire trailer, origin to destination, no other freight mixed in." },
  { term: "LTL (Less-Than-Truckload)", def: "A smaller shipment consolidated with other shippers' freight on one truck, with multiple stops." },
  { term: "Detention", def: "The fee billed to a customer when dock wait time exceeds the free allowance (2 hours in this app) before loading/unloading." },
  { term: "Dock dwell time", def: "How long a truck actually sits at a facility, from arrival to departure. The portion past 2 hours is what gets billed as detention." },
  { term: "Geofence", def: "A virtual boundary drawn around a real location. Crossing it in real GPS coordinates auto-triggers an \"arrive\" or \"depart\" event." },
  { term: "Empty mile / Deadhead", def: "Distance driven with no paying freight on board \u2014 a pure cost, minimized via smart load matching." },
  { term: "TMS", def: "Transportation Management System \u2014 software for managing dispatch, rates, and routing. TruckMate is one; this app's dataset uses its schema." },
  { term: "ELD", def: "Electronic Logging Device \u2014 the hardware that automatically records a driver's HOS, replacing paper logbooks." },
  { term: "XGBoost", def: "A tree-based machine learning algorithm, strong on tabular data. Powers the 4 risk sub-models here (HOS, delay, detention, empty-mile)." },
  { term: "SHAP", def: "Explains *why* a model produced a specific score, by attributing credit to each input feature for that one prediction." },
  { term: "Feature importance", def: "How much a model relied on each input column overall, across all predictions \u2014 different from SHAP, which explains one prediction at a time." },
  { term: "Label leakage", def: "When a model is accidentally given the same information its training label was derived from, so it memorizes instead of learning. Found and fixed twice in this project." },
  { term: "Re-inference", def: "Re-running an already-trained model on new input (e.g. a different candidate driver) to get a fresh prediction \u2014 what the What-if feature does live." },
  { term: "What-if", def: "Swap in a different driver for a load and see the risk score recalculated by the real model, not a canned estimate." },
  { term: "Guardrail", def: "A hard rule that overrides the ML score for cases the model must never get wrong \u2014 e.g. forcing hosRisk high when a driver is already over their legal HOS limit." },
];

export default function InfoPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--text-secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 hover:bg-[var(--surface)]"
      >
        ⓘ Info
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--bg-modal)] p-6 shadow-xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[var(--text-primary)] text-lg font-medium mb-1">{APP_NAME}</h3>
            <p className="text-[var(--text-tertiary)] text-xs mb-5">{VERSION}</p>

            <div className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1">Team</div>
            <div className="text-[var(--text-primary)] text-sm mb-4">{TEAM_NAME}</div>

            <div className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-1">Members</div>
            <ul className="text-[var(--text-primary)] text-sm space-y-0.5 mb-5">
              {TEAM_MEMBERS.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>

            <div className="text-[var(--text-secondary)] text-xs uppercase tracking-wide mb-2">Glossary</div>
            <ul className="space-y-3 mb-5">
              {GLOSSARY.map((g) => (
                <li key={g.term}>
                  <div className="text-[var(--text-primary)] text-sm font-medium">{g.term}</div>
                  <div className="text-[var(--text-secondary)] text-xs leading-relaxed">{g.def}</div>
                </li>
              ))}
            </ul>

            <button
              onClick={() => setOpen(false)}
              className="w-full text-xs rounded-lg py-2 bg-[var(--surface-strong)] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
