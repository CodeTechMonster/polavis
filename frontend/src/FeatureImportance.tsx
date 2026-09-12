import { motion } from "framer-motion";
import { useFeatureImportance, useModelMetrics } from "./hooks";
import { useFeatureLabelStore } from "./store";
import FeatureLabelSettings from "./FeatureLabelSettings";
import InfoTooltip from "./InfoTooltip";
import { BarChart3, Gauge } from "lucide-react";

const card = "rounded-2xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur-md p-5 shadow-lg";
const MODELS = ["hosRisk", "delayRisk", "detentionRisk", "emptyMileRisk"] as const;
const MODEL_LABELS: Record<string, string> = {
  hosRisk: "HOS risk",
  delayRisk: "Delay risk",
  detentionRisk: "Detention risk",
  emptyMileRisk: "Empty-mile risk",
};
const MODEL_ACCENTS: Record<string, string> = {
  hosRisk: "bg-red-400",
  delayRisk: "bg-amber-400",
  detentionRisk: "bg-orange-400",
  emptyMileRisk: "bg-indigo-400",
};

export default function FeatureImportance() {
  const { data } = useFeatureImportance();
  const { data: metrics } = useModelMetrics();
  const { getLabel } = useFeatureLabelStore();

  if (!data) return null;

  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[var(--text-primary)] font-medium flex items-center gap-2">
            <BarChart3 size={17} className="text-violet-400 shrink-0" aria-hidden="true" />
            Risk Score Drivers
          </h2>
          <InfoTooltip title="Risk Score Drivers">
            <p>Shows how much each input feature influences each risk sub-model's score overall — not just for one leg, but across everything that model learned.</p>
            <div>
              <div className="text-[var(--text-primary)] text-xs font-medium mb-1">Risk calculation example</div>
              <table className="w-full text-xs">
                <tbody>
                  <tr><td className="py-0.5">Base risk</td><td className="text-right">35</td></tr>
                  <tr><td className="py-0.5">HOS risk (1.5h remaining)</td><td className="text-right text-red-400">+25</td></tr>
                  <tr><td className="py-0.5">Delay risk (3h delay)</td><td className="text-right text-red-400">+18</td></tr>
                  <tr><td className="py-0.5">Detention risk (4h detention)</td><td className="text-right text-red-400">+12</td></tr>
                  <tr><td className="py-0.5">Empty-mile risk (85 miles)</td><td className="text-right text-red-400">+10</td></tr>
                  <tr className="border-t border-[var(--border)]"><td className="py-1 font-medium text-[var(--text-primary)]">Final risk score</td><td className="text-right font-medium text-[var(--text-primary)]">100</td></tr>
                </tbody>
              </table>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">Illustrative example values, not a live calculation.</p>
            </div>
          </InfoTooltip>
        </div>
        <FeatureLabelSettings />
      </div>
      <p className="text-[var(--text-tertiary)] text-xs mb-4">
        Real XGBoost importances — what each of the 4 risk models actually learned to weight
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MODELS.map((m) => {
          const rows = (data[m] ?? []).slice(0, 4);
          // hosRisk is a deterministic compliance rule, not a trained model, so it has no learned
          // feature weights. Say so rather than rendering an empty card.
          if (m === "hosRisk") {
            return (
              <div key={m} className="rounded-xl bg-[var(--surface-strong)] p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${MODEL_ACCENTS[m]}`} />
                  <span className="text-[var(--text-primary)] text-xs font-medium">{MODEL_LABELS[m]}</span>
                  <span className="text-[10px] text-[var(--text-muted)] border border-[var(--border)] rounded px-1.5">rule-based</span>
                </div>
                <p className="text-[var(--text-tertiary)] text-[11px]">
                  Not a trained model. Hours of Service is a legal threshold, not a probability, so
                  hosRisk is computed directly from REMAINING_HOURS_CAN_7 and the buffer this leg
                  would leave — no learned weights to show.
                </p>
              </div>
            );
          }
          return (
            <div key={m} className="rounded-xl bg-[var(--surface-strong)] p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${MODEL_ACCENTS[m]}`} />
                <span className="text-[var(--text-primary)] text-xs font-medium">{MODEL_LABELS[m]}</span>
              </div>
              <div className="space-y-1.5">
                {rows.map((r) => (
                  <div key={r.feature}>
                    <div className="flex justify-between text-[11px] text-[var(--text-secondary)] mb-0.5">
                      <span className="truncate pr-2">{getLabel(r.feature)}</span>
                      <span className="shrink-0">{(r.importance * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-1 rounded-full bg-[var(--surface)] overflow-hidden">
                      <motion.div
                        className={`h-full ${MODEL_ACCENTS[m]}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${r.importance * 100}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {metrics && (
        <div className="mt-5 pt-4 border-t border-[var(--border)]">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[var(--text-primary)] text-sm font-medium flex items-center gap-2">
              <Gauge size={15} className="text-violet-400 shrink-0" aria-hidden="true" />
              Held-out model performance
            </h3>
            <InfoTooltip title="Held-out Model Performance">
              <p>
                Measured on the 20% of legs each model never saw during training (stratified split,
                seed 42), so these are out-of-sample numbers, not training fit.
              </p>
              <p>
                <strong className="text-[var(--text-primary)]">Base rate</strong> is the share of that
                test split which is actually positive. When it is low, accuracy is misleading — a model
                predicting "no" every time would still score high — so read ROC-AUC and recall instead.
              </p>
              <p>
                <strong className="text-[var(--text-primary)]">Cutoff</strong> is the probability
                above which a leg counts as positive. It is swept for best F1 on the training split
                only — never on the test split, which would be tuning on the data used to report the
                result. <strong className="text-[var(--text-primary)]">F1 @0.5</strong> shows what
                the arbitrary default cutoff would have scored, so the gain is checkable rather than
                quietly swapped in.
              </p>
              <p>
                hosRisk has no row here on purpose. It used to be a model and scored a perfect
                ROC-AUC of 1.000 — which was leakage, not skill: its label was arithmetic on two
                features it still received. It is now a deterministic compliance rule, so there is
                nothing to evaluate.
              </p>
            </InfoTooltip>
          </div>
          <p className="text-[var(--text-tertiary)] text-xs mb-3">
            Out-of-sample, on the 20% split held back from training
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--text-tertiary)] text-[10px] uppercase tracking-wide">
                  <th className="text-left font-medium pb-2">Model</th>
                  <th className="text-right font-medium pb-2">ROC-AUC</th>
                  <th className="text-right font-medium pb-2">Cutoff</th>
                  <th className="text-right font-medium pb-2">Precision</th>
                  <th className="text-right font-medium pb-2">Recall</th>
                  <th className="text-right font-medium pb-2">F1</th>
                  <th className="text-right font-medium pb-2">Base rate</th>
                  <th className="text-right font-medium pb-2">F1 @0.5</th>
                </tr>
              </thead>
              <tbody>
                {MODELS.map((m) => {
                  const mm = metrics.models?.[m];
                  if (m === "hosRisk") {
                    return (
                      <tr key={m} className="border-t border-[var(--border)]">
                        <td className="py-1.5 text-[var(--text-primary)]">
                          <span className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${MODEL_ACCENTS[m]}`} />
                            {MODEL_LABELS[m]}
                          </span>
                        </td>
                        <td colSpan={7} className="py-1.5 text-right text-[var(--text-muted)]">
                          deterministic rule — nothing to score
                        </td>
                      </tr>
                    );
                  }
                  if (!mm?.trained) {
                    return (
                      <tr key={m} className="border-t border-[var(--border)]">
                        <td className="py-1.5 text-[var(--text-primary)]">{MODEL_LABELS[m]}</td>
                        <td colSpan={7} className="py-1.5 text-right text-[var(--text-muted)]">
                          not trained{mm?.reason ? ` — ${mm.reason}` : ""}
                        </td>
                      </tr>
                    );
                  }
                  // A perfect AUC on real data is a red flag, not a win — surface it as such.
                  const suspicious = (mm.rocAuc ?? 0) >= 0.999;
                  return (
                    <tr key={m} className="border-t border-[var(--border)]">
                      <td className="py-1.5 text-[var(--text-primary)]">
                        <span className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${MODEL_ACCENTS[m]}`} />
                          {MODEL_LABELS[m]}
                        </span>
                      </td>
                      <td className={`py-1.5 text-right font-medium ${suspicious ? "text-amber-400" : "text-[var(--text-primary)]"}`}>
                        {mm.rocAuc?.toFixed(3)}
                        {suspicious && <span title="Label is reconstructible from retained features"> ⚠</span>}
                      </td>
                      <td className="py-1.5 text-right text-[var(--text-tertiary)]">{mm.operatingThreshold?.toFixed(2)}</td>
                      <td className="py-1.5 text-right text-[var(--text-secondary)]">{mm.precision?.toFixed(3)}</td>
                      <td className="py-1.5 text-right text-[var(--text-secondary)]">{mm.recall?.toFixed(3)}</td>
                      <td className="py-1.5 text-right text-[var(--text-secondary)]">{mm.f1?.toFixed(3)}</td>
                      <td className="py-1.5 text-right text-[var(--text-muted)]">
                        {mm.positiveRateTest !== undefined ? `${(mm.positiveRateTest * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="py-1.5 text-right text-[var(--text-muted)]">
                        {mm.atDefaultThreshold?.f1?.toFixed(3) ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[var(--text-muted)] text-[10px] mt-2">
            {/* Read from the first trained model rather than a hardcoded name: hosRisk was removed
                from `models` in v2.1.6 when it became a rule, which left this line rendering a
                blank number. */}
            {Object.values(metrics.models ?? {}).find((m) => m.trained)?.testRows?.toLocaleString() ?? "—"} test legs per model ·
            regenerate with <code>cd backend/ml &amp;&amp; python evaluate.py</code>
          </p>
        </div>
      )}
    </div>
  );
}
