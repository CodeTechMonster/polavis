"""
Evaluates the four sub-risk XGBoost models on their held-out 20% split and writes
data/model_metrics.json.

Deliberately separate from precompute.py: this script writes ONLY model_metrics.json and never
touches risk_scores.json / explanations.json / feature_importances.json. The ML pipeline has a
known run-to-run reproducibility issue (see "Known data caveats" in the README), so re-running the
full precompute would silently replace the shipped, verified scores with different numbers.
Evaluating the pipeline and regenerating the shipped scores are therefore kept as separate actions.

Run:  cd backend/ml && python evaluate.py
"""
import json
from datetime import datetime, timezone

from risk_engine import train_all, WEIGHTS
from feature_engineering import DATA_DIR

# Column each model's label is derived from, so the report can state what is actually being
# predicted rather than leaving the reader to guess from the model name.
LABEL_DEFINITIONS = {
    "hosRisk": "hos_buffer_hours < 0  (REMAINING_HOURS_CAN_7 - est_drive_hours)",
    "delayRisk": "schedule_slack_hours < 0  (DELIVER_BY - LS_SCHEDULED_ARRIVAL)",
    "detentionRisk": "detention_hours > 0  (dock dwell beyond the 2h free window)",
    "emptyMileRisk": "LS_MT_LOADED == 'E'",
}


def main() -> None:
    state = train_all()
    metrics = state["metrics"]

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "totalLegs": int(len(state["df"])),
        "modelConfig": {
            "algorithm": "XGBClassifier",
            "nEstimators": 150,
            "maxDepth": 4,
            "learningRate": 0.08,
            "testSize": 0.2,
            "stratified": True,
            "randomState": 42,
        },
        "ensembleWeights": WEIGHTS,
        "models": {
            name: {**m, "label": LABEL_DEFINITIONS.get(name, "")}
            for name, m in metrics.items()
        },
    }

    out = DATA_DIR / "model_metrics.json"
    out.write_text(json.dumps(report, indent=2))

    print(f"Wrote {out}\n")
    header = (f"{'model':<16}{'ROC-AUC':>9}{'thresh':>8}{'Prec':>8}{'Recall':>8}{'F1':>8}"
              f"{'pos.rate':>10}{'F1@0.5':>9}")
    print(header)
    print("-" * len(header))
    for name, m in metrics.items():
        if not m.get("trained"):
            print(f"{name:<16}{'not trained -- ' + m.get('reason', ''):>50}")
            continue
        print(
            f"{name:<16}{m['rocAuc']:>9.4f}{m['operatingThreshold']:>8.2f}{m['precision']:>8.4f}"
            f"{m['recall']:>8.4f}{m['f1']:>8.4f}{m['positiveRateTest']:>10.4f}"
            f"{m['atDefaultThreshold']['f1']:>9.4f}"
        )
    print("\npos.rate = share of the test split that is actually positive (the base rate).")
    print("On a rare label, read ROC-AUC and recall rather than accuracy.")
    print("thresh  = operating cutoff, F1-tuned on the TRAINING split only.")
    print("F1@0.5  = what the arbitrary default cutoff would have scored, for comparison.")


if __name__ == "__main__":
    main()
