"""
RoadPilot AI Dispatch Advisor — SHAP Explainability Engine
Explains whichever sub-risk model (hosRisk / delayRisk / detentionRisk / emptyMileRisk) is
actually the dominant driver of a given leg's risk, producing top-5 contributing factors and a
plain-language sentence.

Previously this always explained detentionRisk regardless of which sub-score was actually driving
the leg's overall risk (found while reviewing a real example where the "Top SHAP Factors" panel
showed detentionRisk-model reasoning for a leg whose real problem was HOS). precompute.py now
picks the model to explain per trip based on which of the 4 sub-scores is highest.
"""
import numpy as np
import pandas as pd
import shap

from risk_engine import train_all, MODEL_FEATURES

FRIENDLY_NAMES = {
    "distance_km": "trip distance",
    "schedule_slack_hours": "schedule slack",
    "remaining_hours": "remaining drive hours",
    "REMAINING_HOURS_CAN_7": "7-day HOS cycle hours remaining",
    "REMAINING_HOURS_CAN_14": "14-day HOS cycle hours remaining",
    "est_drive_hours": "estimated drive time",
    "hos_buffer_hours": "HOS buffer",
    "route_complexity": "route complexity",
    "customer_detention_history": "this customer's detention history",
}

# The one feature each sub-model excludes from training (the value its own label was derived
# from — see risk_engine.py's leakage-prevention comments). emptyMileRisk excludes nothing since
# its label isn't in MODEL_FEATURES at all.
# hosRisk is absent: it is a deterministic rule, not a model, so there is nothing to attribute
# with SHAP (see risk_engine.hos_risk_rule).
EXCLUDED_FEATURE = {
    "delayRisk": "schedule_slack_hours",
    "detentionRisk": "customer_detention_history",
    "emptyMileRisk": None,
}


def explain_risk(state: dict, trip_number: int, model_name: str, top_n: int = 5, driver_name: str | None = None) -> dict:
    df, X, models = state["df"], state["X"], state["models"]
    if model_name == "hosRisk":
        raise ValueError(
            "hosRisk is computed by a deterministic compliance rule, not a model - there is no "
            "SHAP attribution for it. Explain the leg's next-highest sub-risk instead."
        )
    if model_name not in models:
        raise ValueError(f"Unknown model '{model_name}'")
    model = models[model_name]
    excluded = EXCLUDED_FEATURE[model_name]
    cols = [c for c in MODEL_FEATURES if c != excluded] if excluded else list(MODEL_FEATURES)

    # A trip can have several dispatch rows (relay/multi-stop legs, sometimes with different
    # drivers) — when the caller knows which driver's leg it means, prefer that exact row so the
    # explanation matches the specific (trip, driver) pair shown in the UI, not an arbitrary one.
    idx = df.index[df["TRIP_NUMBER"] == trip_number]
    if driver_name:
        driver_idx = df.index[(df["TRIP_NUMBER"] == trip_number) & (df["DRIVER_NAME"] == driver_name)]
        if len(driver_idx) > 0:
            idx = driver_idx
    if len(idx) == 0:
        raise ValueError(f"Trip {trip_number} not found")
    row_idx = idx[0]

    if model is None:
        return {
            "trip_number": int(trip_number), "model": model_name, "top_factors": [],
            "explanation": f"No trained model is available for {model_name} (its label had no variance in this dataset).",
        }

    explainer = shap.TreeExplainer(model)
    row = X.loc[[row_idx], cols]
    shap_values = explainer.shap_values(row)[0]

    contributions = sorted(
        zip(cols, shap_values, row.iloc[0].values), key=lambda x: -abs(x[1])
    )[:top_n]

    factors = []
    for name, val, raw in contributions:
        factors.append({
            "feature": name,
            "friendly_name": FRIENDLY_NAMES.get(name, name),
            "value": round(float(raw), 2),
            "shap_contribution": round(float(val), 3),
            "direction": "increases risk" if val > 0 else "decreases risk",
        })

    # hosRisk no longer reaches this function at all (it is rule-based and rejected above), so the
    # old "guardrail overrode the model" case can no longer occur. Kept as a constant so the field
    # stays in the API response shape the UI already reads.
    guardrail_applied = False

    top = contributions[0]
    if False:  # retained branch shape; hosRisk can no longer reach here
        sentence = ""
    else:
        sentence = (
            f"{FRIENDLY_NAMES.get(top[0], top[0])} is the largest contributor to the "
            f"{model_name} score for trip {trip_number} (value: {round(float(top[2]), 1)})."
        )

    return {
        "trip_number": int(trip_number),
        "model": model_name,
        "top_factors": factors,
        "explanation": sentence,
        "guardrail_applied": guardrail_applied,
    }


if __name__ == "__main__":
    state = train_all()
    result = explain_risk(state, trip_number=618819, model_name="detentionRisk")
    import json
    print(json.dumps(result, indent=2))
