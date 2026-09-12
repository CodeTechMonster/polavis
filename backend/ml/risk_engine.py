"""
RoadPilot AI Dispatch Advisor — XGBoost Risk Engine
Trains 4 sub-risk classifiers (HOS / delay / detention / empty-mile) on labels
derived from real columns in the dataset, then scores every leg.

overallRiskScore = 0.30*hosRisk + 0.30*delayRisk + 0.20*detentionRisk + 0.20*emptyMileRisk
"""
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    roc_auc_score, accuracy_score, precision_score, recall_score, f1_score,
    confusion_matrix, precision_recall_fscore_support,
)

from feature_engineering import build_features, load_tables, DATA_DIR

MODEL_FEATURES = [
    "distance_km", "schedule_slack_hours", "remaining_hours",
    "REMAINING_HOURS_CAN_7", "REMAINING_HOURS_CAN_14", "est_drive_hours",
    "hos_buffer_hours", "route_complexity", "customer_detention_history",
]

WEIGHTS = {"hosRisk": 0.30, "delayRisk": 0.30, "detentionRisk": 0.20, "emptyMileRisk": 0.20}

# hosRisk is deliberately NOT a trained model (v2.1.6).
#
# It used to be one, and it scored a perfect held-out ROC-AUC of 1.000 -- which was a defect, not a
# result. Its label was `hos_buffer_hours < 0`, and hos_buffer_hours is just
# REMAINING_HOURS_CAN_7 - est_drive_hours; training dropped the derived column but kept both
# operands, so the model only had to learn one subtraction to reproduce the label exactly. It was
# reconstructing the answer, not predicting anything.
#
# Hours of Service is also not a probabilistic outcome in the first place. It is a legal threshold:
# a driver either has the cycle hours for this leg or does not. Expressing that as a model
# confidence was the wrong tool. The rule below is deterministic, auditable, and needs no training.
HOS_SAFE_BUFFER_H = 24.0   # at/above this much slack, HOS is effectively a non-issue for this leg
HOS_FLOOR = 5.0            # never exactly 0 -- HOS always deserves some attention
HOS_CEILING = 95.0         # reserved band above this is for the hard legal breach below
HOS_ILLEGAL = 99.0         # already over the 7-day cycle: not a risk estimate, a compliance fact


def hos_risk_rule(can7: np.ndarray, buffer_hours: np.ndarray) -> np.ndarray:
    """Deterministic HOS risk on a 0-100 scale.

    - CAN_7 already negative -> 99: the driver is over the legal cycle right now.
    - Otherwise scale linearly on the buffer this leg would leave behind, saturating at
      HOS_SAFE_BUFFER_H. A buffer under ~3h lands above 87 on its own, so the old
      `max(hos, 90) when can7 < 3` guardrail is no longer a patch bolted on top of a model -- that
      behaviour now falls out of the rule itself.
    - Missing CAN_7 is treated as safe rather than risky: absent data is not evidence of a
      violation, and inventing one would put drivers on the critical list for a null field.
    """
    buf = np.where(np.isnan(buffer_hours), HOS_SAFE_BUFFER_H, buffer_hours)
    scaled = 100.0 * (1.0 - buf / HOS_SAFE_BUFFER_H)
    risk = np.clip(scaled, HOS_FLOOR, HOS_CEILING)
    return np.where(np.isnan(can7), HOS_FLOOR, np.where(can7 < 0, HOS_ILLEGAL, risk))


def make_labels(df: pd.DataFrame) -> pd.DataFrame:
    labels = pd.DataFrame(index=df.index)
    # Real-signal labels (not synthetic): derived directly from actual dataset columns.
    labels["hos_violation"] = (df["hos_buffer_hours"] < 0).astype(int)
    labels["delayed"] = (df["schedule_slack_hours"] < 0).astype(int)
    labels["had_detention"] = (df["detention_hours"] > 0).astype(int)
    labels["empty_leg"] = df["is_empty_leg"]
    return labels


def _train_one(X: pd.DataFrame, y: pd.Series):
    """Trains one sub-risk classifier and evaluates it on the held-out split.

    Returns (model, metrics). The 20% test split was always being created here but never scored --
    the model was fit on X_train and X_test/y_test were discarded, so the project had no held-out
    performance numbers at all. The metrics are computed on that same untouched split, so they are
    genuine out-of-sample numbers rather than training-set fit.
    """
    if y.nunique() < 2:
        # Degenerate label (all one class) - falls back to a constant risk downstream, and there is
        # nothing meaningful to measure.
        return None, {"trained": False, "reason": "label has only one class"}

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    model = xgb.XGBClassifier(
        n_estimators=150, max_depth=4, learning_rate=0.08,
        eval_metric="logloss", random_state=42,
    )
    model.fit(X_train, y_train)

    # Operating threshold, chosen on the TRAINING split only.
    #
    # The default 0.5 cutoff is arbitrary and badly suited to a rare label: on delayRisk (2.6%
    # positives) it caught under half of real delays despite the model ranking them well
    # (AUC 0.939, recall 0.436). Sweeping for the F1-maximising cutoff fixes that.
    #
    # It is deliberately chosen against y_train, never y_test -- picking it on the test split would
    # be tuning on the data used to report the result. Measured cost of that discipline: the
    # train-chosen thresholds land within 0.01-0.14 of the test-optimal ones and give up at most
    # 0.018 F1 versus the unusable "oracle" choice, so honesty here is nearly free.
    train_proba = model.predict_proba(X_train)[:, 1]
    grid = np.arange(0.05, 0.96, 0.01)
    train_f1 = [
        precision_recall_fscore_support(
            y_train, (train_proba >= t).astype(int), average="binary", zero_division=0
        )[2]
        for t in grid
    ]
    threshold = round(float(grid[int(np.argmax(train_f1))]), 2)

    proba = model.predict_proba(X_test)[:, 1]
    pred = (proba >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_test, pred, labels=[0, 1]).ravel()

    # Kept alongside so the improvement over the arbitrary default stays visible and checkable
    # rather than being quietly swapped in.
    default_pred = (proba >= 0.5).astype(int)

    metrics = {
        "trained": True,
        "operatingThreshold": threshold,
        "thresholdSelection": "F1-maximising on the training split; the test split is never used to choose it",
        "rocAuc": round(float(roc_auc_score(y_test, proba)), 4),
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "precision": round(float(precision_score(y_test, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_test, pred, zero_division=0)), 4),
        "atDefaultThreshold": {
            "threshold": 0.5,
            "precision": round(float(precision_score(y_test, default_pred, zero_division=0)), 4),
            "recall": round(float(recall_score(y_test, default_pred, zero_division=0)), 4),
            "f1": round(float(f1_score(y_test, default_pred, zero_division=0)), 4),
        },
        "trainRows": int(len(X_train)),
        "testRows": int(len(X_test)),
        # Base rate matters for reading the numbers: on a rare label, accuracy alone looks great
        # while the model may be predicting the majority class almost every time.
        "positiveRateTest": round(float(y_test.mean()), 4),
        "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "features": list(X.columns),
    }
    return model, metrics


def train_all(df: pd.DataFrame | None = None) -> dict:
    df = df if df is not None else build_features()
    labels = make_labels(df)
    X = df[MODEL_FEATURES].fillna(df[MODEL_FEATURES].median(numeric_only=True))

    models, metrics = {}, {}
    # hosRisk intentionally absent: it is a deterministic rule (hos_risk_rule), not a model.
    models["delayRisk"], metrics["delayRisk"] = _train_one(X.drop(columns=["schedule_slack_hours"]), labels["delayed"])
    models["detentionRisk"], metrics["detentionRisk"] = _train_one(X.drop(columns=["customer_detention_history"]), labels["had_detention"])
    models["emptyMileRisk"], metrics["emptyMileRisk"] = _train_one(X, labels["empty_leg"])
    return {"models": models, "metrics": metrics, "X": X, "df": df, "labels": labels}


def score(state: dict) -> pd.DataFrame:
    X, df, models = state["X"], state["df"], state["models"]

    def _proba(model, cols):
        if model is None:
            return np.full(len(X), 25.0)  # neutral-low default if a label had no variance
        return model.predict_proba(X[cols])[:, 1] * 100

    delay = _proba(models["delayRisk"], [c for c in MODEL_FEATURES if c != "schedule_slack_hours"])
    detention = _proba(models["detentionRisk"], [c for c in MODEL_FEATURES if c != "customer_detention_history"])
    empty = _proba(models["emptyMileRisk"], MODEL_FEATURES)

    # HOS is computed by rule, not predicted. See hos_risk_rule above for why.
    can7 = pd.to_numeric(df["REMAINING_HOURS_CAN_7"], errors="coerce").to_numpy(dtype=float)
    buffer_hours = pd.to_numeric(df["hos_buffer_hours"], errors="coerce").to_numpy(dtype=float)
    hos = hos_risk_rule(can7, buffer_hours)

    overall = (WEIGHTS["hosRisk"] * hos + WEIGHTS["delayRisk"] * delay +
               WEIGHTS["detentionRisk"] * detention + WEIGHTS["emptyMileRisk"] * empty)

    out = df[["TRIP_NUMBER", "DRIVER_NAME", "ORIG_ZONE_DESC", "DEST_ZONE_DESC"]].copy()
    out["hosRisk"] = hos.round(1)
    out["delayRisk"] = delay.round(1)
    out["detentionRisk"] = detention.round(1)
    out["emptyMileRisk"] = empty.round(1)
    out["riskScore"] = overall.round(1)
    return out


if __name__ == "__main__":
    state = train_all()
    result = score(state)
    result.to_json(DATA_DIR / "risk_scores.json", orient="records")
    print(f"Scored {len(result)} legs -> {DATA_DIR / 'risk_scores.json'}")
    print()
    print("Top 5 highest-risk legs:")
    print(result.sort_values("riskScore", ascending=False).head(5).to_string(index=False))
    print()
    demo = result[result["TRIP_NUMBER"] == 618819]
    if len(demo):
        print("Demo trip 618819:")
        print(demo.to_string(index=False))
