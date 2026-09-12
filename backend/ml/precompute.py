"""Precompute risk scores + SHAP explanations for the top-risk legs and the demo trip,
so the Node backend can serve them as static JSON without a live Python process."""
import json
import pandas as pd

from risk_engine import train_all, score, MODEL_FEATURES
from explainability import explain_risk
from feature_engineering import DATA_DIR

DEMO_TRIP = 618819
SUB_RISK_COLS = ["hosRisk", "delayRisk", "detentionRisk", "emptyMileRisk"]
# hosRisk is excluded: it is a deterministic rule with no SHAP attribution, so picking it as the
# "dominant model to explain" would leave the leg with no explanation at all. The explanation
# instead describes the highest-scoring model-driven risk, which is the part SHAP can speak to.
EXPLAINABLE_COLS = ["delayRisk", "detentionRisk", "emptyMileRisk"]
# Matches the Node backend's /api/risk/top split exactly (frontend v2.0.5): legs with hosRisk >= 99
# go in the "HOS ≥ 99" list, everything else in "HOS < 99". Both lists are independently sorted by
# riskScore and shown up to the user's "rows to show" Settings value (default 10, but
# user-configurable) — TOP_N_PER_LIST is set well above the default so normal Settings changes
# don't silently lose SHAP coverage for legs that scroll into view.
HOS_SEVERE_THRESHOLD = 99
TOP_N_PER_LIST = 30

if __name__ == "__main__":
    state = train_all()
    scored = score(state)

    deduped = scored.drop_duplicates("TRIP_NUMBER")
    hos_severe = deduped[deduped["hosRisk"] >= HOS_SEVERE_THRESHOLD].sort_values("riskScore", ascending=False).head(TOP_N_PER_LIST)
    hos_other = deduped[deduped["hosRisk"] < HOS_SEVERE_THRESHOLD].sort_values("riskScore", ascending=False).head(TOP_N_PER_LIST)
    trip_numbers = set(hos_severe["TRIP_NUMBER"].tolist()) | set(hos_other["TRIP_NUMBER"].tolist()) | {DEMO_TRIP}

    # Explain whichever sub-model is actually the dominant driver of each trip's overall score,
    # instead of always explaining detentionRisk regardless of what's really going on (found via a
    # real example: a leg whose real problem was HOS was showing detentionRisk's SHAP reasoning,
    # which had nothing to do with why that leg was actually risky).
    scored_by_trip = scored.drop_duplicates("TRIP_NUMBER").set_index("TRIP_NUMBER")

    explanations = {}
    for tn in trip_numbers:
        try:
            row = scored_by_trip.loc[tn]
            dominant_model = row[EXPLAINABLE_COLS].astype(float).idxmax()
            explanations[str(tn)] = explain_risk(state, int(tn), dominant_model)
        except Exception as e:
            explanations[str(tn)] = {"error": str(e)}

    scored.to_json(DATA_DIR / "risk_scores.json", orient="records")
    with open(DATA_DIR / "explanations.json", "w") as f:
        json.dump(explanations, f, indent=2)

    # Real feature importances per trained sub-model. hosRisk has no entry here: it is a
    # deterministic rule, so it has no learned feature weights to report.
    feature_cols_map = {
        "delayRisk": [c for c in MODEL_FEATURES if c != "schedule_slack_hours"],
        "detentionRisk": [c for c in MODEL_FEATURES if c != "customer_detention_history"],
        "emptyMileRisk": MODEL_FEATURES,
    }
    importances = {}
    for name, cols in feature_cols_map.items():
        model = state["models"][name]
        if model is None:
            importances[name] = []
            continue
        importances[name] = [
            {"feature": c, "importance": round(float(imp), 4)}
            for c, imp in sorted(zip(cols, model.feature_importances_), key=lambda x: -x[1])
        ]
    with open(DATA_DIR / "feature_importances.json", "w") as f:
        json.dump(importances, f, indent=2)

    print(f"Wrote {DATA_DIR / 'risk_scores.json'} ({len(scored)} legs), "
          f"{DATA_DIR / 'explanations.json'} ({len(explanations)} trips), "
          f"{DATA_DIR / 'feature_importances.json'}")
