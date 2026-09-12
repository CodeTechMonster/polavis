"""
RoadPilot AI Dispatch Advisor — ML Inference Microservice
Loads the trained XGBoost models once at startup and serves real re-inference for
what-if driver reassignment, instead of the Node backend's heuristic fallback.

Run: uvicorn service:app --port 8000 --app-dir backend/ml
"""
from typing import Optional

import numpy as np
import pandas as pd
import shap
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from risk_engine import train_all, score, MODEL_FEATURES, WEIGHTS
from feature_engineering import load_tables, AVG_SPEED_KMH
from explainability import explain_risk

app = FastAPI(title="RoadPilot ML Service")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

STATE = None
RAW_DRIVER_TABLE = None


@app.on_event("startup")
def startup():
    global STATE, RAW_DRIVER_TABLE
    STATE = train_all()
    RAW_DRIVER_TABLE = load_tables()["driver"]
    print(f"[ml-service] trained on {len(STATE['df'])} legs, ready")


class WhatIfRequest(BaseModel):
    trip_number: int
    candidate_driver_id: int
    driver_name: Optional[str] = None  # disambiguates relay legs sharing a trip number


# _apply_hos_guardrail was removed in v2.1.10. It predated hosRisk becoming a rule: score() now
# calls hos_risk_rule() itself, so re-applying the old `can7 < 3 -> max(hos, 90)` clamp on top
# could override the rule's own (already >=87.5) output with a flat 90 and disagree with the main
# risk engine for the same driver.


@app.post("/whatif")
def whatif(req: WhatIfRequest):
    df, X, models = STATE["df"], STATE["X"], STATE["models"]

    mask = df["TRIP_NUMBER"] == req.trip_number
    if req.driver_name:
        mask &= df["DRIVER_NAME"] == req.driver_name
    idx = df.index[mask]
    if len(idx) == 0:
        idx = df.index[df["TRIP_NUMBER"] == req.trip_number]
    if len(idx) == 0:
        return {"error": "trip not found"}
    row_idx = idx[0]

    driver_row = RAW_DRIVER_TABLE[RAW_DRIVER_TABLE["DRIVER_ID"] == req.candidate_driver_id]
    if len(driver_row) == 0:
        return {"error": "candidate driver not found"}
    candidate = driver_row.iloc[0]

    # --- BEFORE: real model output for the original assignment, unmodified ---
    before_row = X.loc[[row_idx]]
    before_scores = score({"models": models, "X": before_row, "df": df.loc[[row_idx]]}).iloc[0]

    # --- AFTER: swap in the candidate driver's real HOS fields, re-run the same trained models ---
    after_row = before_row.copy()
    est_drive_hours = float(after_row["est_drive_hours"].iloc[0])
    can7 = float(candidate["REMAINING_HOURS_CAN_7"]) if pd.notna(candidate["REMAINING_HOURS_CAN_7"]) else 40.0
    can14 = float(candidate["REMAINING_HOURS_CAN_14"]) if pd.notna(candidate["REMAINING_HOURS_CAN_14"]) else 60.0
    after_row["REMAINING_HOURS_CAN_7"] = can7
    after_row["REMAINING_HOURS_CAN_14"] = can14
    after_row["remaining_hours"] = can7  # best available proxy for the trip-level HOS field
    after_row["hos_buffer_hours"] = can7 - est_drive_hours

    # score()'s own compliance guardrail reads REMAINING_HOURS_CAN_7 from the `df` argument, not
    # from `X` -- so the df passed in must also reflect the candidate driver's CAN_7, or the
    # guardrail silently re-applies the ORIGINAL driver's threshold and masks the real model output.
    # (This was caught by manually replicating this exact call and finding a 99% vs 90% mismatch
    # against a direct model.predict_proba() call on the same modified row.)
    after_df = df.loc[[row_idx]].copy()
    after_df["REMAINING_HOURS_CAN_7"] = can7
    # hos_risk_rule() reads hos_buffer_hours from `df`, not from `X`, so setting it on after_row
    # alone left the rule computing the ORIGINAL driver's buffer for the candidate. Symptom: a
    # candidate with 50+ hours of cycle left still came back at hosRisk 95 because the leg's
    # previous driver was 43h over.
    after_df["hos_buffer_hours"] = can7 - est_drive_hours

    after_scores = score({"models": models, "X": after_row, "df": after_df}).iloc[0]
    after_hos = float(after_scores["hosRisk"])  # already rule-computed inside score()
    after_overall = float(
        WEIGHTS["hosRisk"] * after_hos
        + WEIGHTS["delayRisk"] * after_scores["delayRisk"]
        + WEIGHTS["detentionRisk"] * after_scores["detentionRisk"]
        + WEIGHTS["emptyMileRisk"] * after_scores["emptyMileRisk"]
    )

    # hosRisk is a rule with no model, so there is no SHAP explainer for it -- this used to read
    # models["hosRisk"] and raised KeyError once v2.1.6 removed that model, which broke the whole
    # /whatif endpoint. The driving factor now comes from whichever trained sub-model moved most in
    # this reassignment, which is the part SHAP can actually speak to.
    moved = {
        name: abs(float(after_scores[name]) - float(before_scores[name]))
        for name in ("delayRisk", "detentionRisk", "emptyMileRisk")
    }
    top_model = max(moved, key=moved.get)
    drop_col = {
        "delayRisk": "schedule_slack_hours",
        "detentionRisk": "customer_detention_history",
        "emptyMileRisk": None,
    }[top_model]
    cols = [c for c in MODEL_FEATURES if c != drop_col] if drop_col else list(MODEL_FEATURES)
    explainer = shap.TreeExplainer(models[top_model])
    shap_vals = explainer.shap_values(after_row[cols])[0]
    top_factor_idx = int(np.argmax(np.abs(shap_vals)))

    return {
        "before": {
            "driver_name": str(df.loc[row_idx, "DRIVER_NAME"]),
            "hosRisk": round(float(before_scores["hosRisk"]), 1),
            "delayRisk": round(float(before_scores["delayRisk"]), 1),
            "detentionRisk": round(float(before_scores["detentionRisk"]), 1),
            "emptyMileRisk": round(float(before_scores["emptyMileRisk"]), 1),
            "riskScore": round(float(before_scores["riskScore"]), 1),
        },
        "after": {
            "driver_name": str(candidate["FIRST_NAME"]),
            "hosRisk": round(after_hos, 1),
            "delayRisk": round(float(after_scores["delayRisk"]), 1),
            "detentionRisk": round(float(after_scores["detentionRisk"]), 1),
            "emptyMileRisk": round(float(after_scores["emptyMileRisk"]), 1),
            "riskScore": round(after_overall, 1),
        },
        "hosDrivingFactor": cols[top_factor_idx],
        "drivingModel": top_model,
        "note": "Real re-inference with the candidate driver's actual HOS fields substituted. "
                "hosRisk is recomputed by the same deterministic compliance rule the main engine uses.",
    }


class RescoreRequest(BaseModel):
    trip_number: int
    driver_name: Optional[str] = None
    # Any field left as None keeps the leg's real value. Sending all of them as None must reproduce
    # the leg's stored score exactly -- that round-trip is the safety property this endpoint is
    # tested against.
    can7: Optional[float] = None
    can14: Optional[float] = None
    distance_km: Optional[float] = None
    schedule_slack_hours: Optional[float] = None
    route_complexity: Optional[float] = None


@app.post("/rescore")
def rescore(req: RescoreRequest):
    """Re-scores a real leg with some of its inputs overridden.

    Deliberately built on the same row-copy pattern as /whatif rather than accepting a fully
    hand-built feature row: score() reads the HOS rule's inputs from `df` and the models' inputs
    from `X`, and keeping those two in sync by hand is exactly what broke /whatif twice. Starting
    from a real row means every field the caller does NOT override is already correct and
    consistent in both structures.
    """
    df, X = STATE["df"], STATE["X"]
    mask = df["TRIP_NUMBER"] == req.trip_number
    if req.driver_name:
        dm = mask & (df["DRIVER_NAME"] == req.driver_name)
        if dm.any():
            mask = dm
    if not mask.any():
        return {"error": "trip not found"}

    row_idx = df.index[mask][0]
    before = score({"models": STATE["models"], "X": X.loc[[row_idx]], "df": df.loc[[row_idx]]}).iloc[0]

    after_X = X.loc[[row_idx]].copy()
    after_df = df.loc[[row_idx]].copy()

    # Only touch what the caller actually overrode.
    #
    # Recomputing est_drive_hours / hos_buffer_hours unconditionally looks harmless but is not: `X`
    # is median-filled for missing values while `df` keeps the original (possibly NaN) ones, so
    # deriving the buffer from X and writing it into df replaces a real NaN with a fabricated
    # number and changes the HOS rule's answer. The round-trip test caught this on 216 of 300 legs
    # (stored hosRisk 5 -> recomputed 95). With no overrides the row must pass through untouched.
    touches_hos = req.can7 is not None or req.distance_km is not None

    can7 = float(after_df["REMAINING_HOURS_CAN_7"].iloc[0]) if req.can7 is None else float(req.can7)
    distance = float(after_X["distance_km"].iloc[0]) if req.distance_km is None else float(req.distance_km)
    est_drive = distance / AVG_SPEED_KMH
    buffer_hours = can7 - est_drive

    if req.distance_km is not None:
        after_X["distance_km"] = distance
        after_X["est_drive_hours"] = est_drive
    if req.can7 is not None:
        after_X["REMAINING_HOURS_CAN_7"] = can7
        after_X["remaining_hours"] = can7  # same proxy /whatif uses
    if touches_hos:
        after_X["hos_buffer_hours"] = buffer_hours
    if req.can14 is not None:
        after_X["REMAINING_HOURS_CAN_14"] = float(req.can14)
    if req.schedule_slack_hours is not None:
        after_X["schedule_slack_hours"] = float(req.schedule_slack_hours)
    if req.route_complexity is not None:
        after_X["route_complexity"] = float(req.route_complexity)

    # The HOS rule reads these two from `df`, not `X` -- the trap that broke /whatif. Written only
    # when an override actually changes them, for the reason above.
    if touches_hos:
        after_df["REMAINING_HOURS_CAN_7"] = can7
        after_df["hos_buffer_hours"] = buffer_hours

    after = score({"models": STATE["models"], "X": after_X, "df": after_df}).iloc[0]

    keys = ["hosRisk", "delayRisk", "detentionRisk", "emptyMileRisk", "riskScore"]
    return {
        "tripNumber": req.trip_number,
        "driverName": str(df.loc[row_idx, "DRIVER_NAME"]),
        "before": {k: round(float(before[k]), 1) for k in keys},
        "after": {k: round(float(after[k]), 1) for k in keys},
        "effective": {
            "can7": round(can7, 2),
            "distanceKm": round(distance, 1),
            "estDriveHours": round(est_drive, 2),
            "hosBufferHours": round(buffer_hours, 2),
            "hosRecomputed": touches_hos,
        },
        "note": "Real re-inference on the leg's own feature row with the listed inputs overridden.",
    }


@app.get("/health")
def health():
    return {"status": "ok", "legs_loaded": len(STATE["df"]) if STATE else 0}


SUB_RISK_COLS = ["hosRisk", "delayRisk", "detentionRisk", "emptyMileRisk"]
# hosRisk is excluded from "which model should we explain?" for the same reason precompute.py
# excludes it: it is a deterministic rule with no SHAP attribution, so selecting it means the leg
# gets no explanation at all. This bit 198 legs (4.6%) -- including every over-the-legal-limit leg,
# i.e. exactly the ones a dispatcher most wants explained -- because hosRisk is frequently the
# highest sub-score now that the rule produces a graded signal instead of a near-zero model output.
EXPLAINABLE_COLS = ["delayRisk", "detentionRisk", "emptyMileRisk"]


# --- Live SHAP explanation for any trip, not just the ones data/explanations.json precomputed
# offline (that static file only covers a fixed top-N snapshot from whenever precompute.py last
# ran). This service already trains and holds the same models in memory for /whatif, so it can
# explain any (trip, driver) pair on demand using the same explain_risk() logic precompute.py
# uses — the Node backend falls back to this when a trip isn't in the static cache.
@app.get("/explain/{trip_number}")
def explain(trip_number: int, driver: Optional[str] = None):
    df = STATE["df"]
    mask = df["TRIP_NUMBER"] == trip_number
    if driver:
        driver_mask = mask & (df["DRIVER_NAME"] == driver)
        if driver_mask.any():
            mask = driver_mask
    if not mask.any():
        return {"error": "trip not found"}

    row_idx = df.index[mask][0]
    scored_row = score({
        "models": STATE["models"],
        "X": STATE["X"].loc[[row_idx]],
        "df": df.loc[[row_idx]],
    }).iloc[0]
    dominant_model = scored_row[EXPLAINABLE_COLS].astype(float).idxmax()

    try:
        result = explain_risk(STATE, trip_number, dominant_model, driver_name=driver)
        result["source"] = "live"
        return result
    except Exception as e:
        return {"error": str(e)}

