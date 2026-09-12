"""
RoadPilot AI Dispatch Advisor — Feature Engineering
Builds the leg-level feature table the risk engine trains/predicts on, joining
Dispatch legs to Tlorder (load attrs), Driver (HOS), and Trailers (capacity).

All features are derived from real columns in the hackathon dataset:
  Dispatch:  LS_LEG_DIST, LS_MT_LOADED, LS_DET_PICK_ARRIVE, LS_DET_DELV_ARRIVE,
             LS_SCHEDULED_ARRIVAL, DELIVER_BY, REMAINING_HOURS, LS_NUM_LEGS, EXTRA_STOPS,
             ORIG_ZONE_DESC, DEST_ZONE_DESC, NAME (driver), TRIP_NUMBER
  Tlorder:   ACTUAL_PICKUP, ACTUAL_DELIVERY, WEIGHT_LBS, PALLETS, TEMPERATURE, LOAD_TYPE
  Driver:    REMAINING_HOURS_CAN_7/8/14, CURRENT_DUTY, STATUS
"""
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

DB_PATH = str(Path(__file__).resolve().parent.parent.parent / "data" / "roadpilot.sqlite")
DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
AVG_SPEED_KMH = 80.0  # rough regional highway average for estimated-drive-hours


def load_tables(db_path: str = DB_PATH) -> dict[str, pd.DataFrame]:
    conn = sqlite3.connect(db_path)
    tables = {}
    for name in ["dispatch", "tlorder", "driver", "trailers"]:
        tables[name] = pd.read_sql(f"SELECT * FROM {name}", conn)
    conn.close()
    return tables


def _to_dt(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce")


def build_features(tables: dict[str, pd.DataFrame] | None = None) -> pd.DataFrame:
    t = tables or load_tables()
    disp = t["dispatch"].copy()
    driver = t["driver"].copy()

    # ---- Detention: real dock arrival/departure timestamps ----
    arr = _to_dt(disp["LS_DET_PICK_ARRIVE"])
    dep = _to_dt(disp["LS_DET_DELV_ARRIVE"])
    dwell_hours = (dep - arr).dt.total_seconds() / 3600
    # clip out data artifacts (negative or absurd multi-week values) so the feature is usable
    disp["dock_dwell_hours"] = dwell_hours.clip(lower=0, upper=72)
    disp["detention_hours"] = (disp["dock_dwell_hours"] - 2).clip(lower=0)

    # ---- Delay: scheduled vs actual arrival window ----
    sched = _to_dt(disp["LS_SCHEDULED_ARRIVAL"])
    deliver_by = _to_dt(disp["DELIVER_BY"])
    # a leg is "late" if it's flagged HOS_VIOLATION_AT or scheduled arrival trails deliver_by
    disp["schedule_slack_hours"] = (deliver_by - sched).dt.total_seconds() / 3600

    # ---- Empty mile: LS_MT_LOADED is 'L' (loaded) or 'E' (empty) in the real data ----
    disp["is_empty_leg"] = (disp["LS_MT_LOADED"] == "E").astype(int)

    # ---- HOS ----
    disp["remaining_hours"] = pd.to_numeric(disp["REMAINING_HOURS"], errors="coerce")
    disp["est_drive_hours"] = pd.to_numeric(disp["LS_LEG_DIST"], errors="coerce") / AVG_SPEED_KMH
    # Buffer uses the Canadian 7-day cycle field (REMAINING_HOURS_CAN_7), not the raw per-trip
    # REMAINING_HOURS column: that field is clustered almost entirely between 60-70h in this export
    # (see README caveat) and barely varies, so a label built from it gives the model almost no real
    # HOS signal to learn from. CAN_7 is also the actual regulatory quantity the brief cares about.

    # ---- Route complexity ----
    disp["route_complexity"] = pd.to_numeric(disp["LS_NUM_LEGS"], errors="coerce").fillna(1) + \
        disp["EXTRA_STOPS"].notna().astype(int)

    # ---- Join driver HOS cycle context by name (dataset does not have a clean driver_id FK on Dispatch) ----
    driver_small = driver[["FIRST_NAME", "REMAINING_HOURS_CAN_7", "REMAINING_HOURS_CAN_8",
                            "REMAINING_HOURS_CAN_14", "STATUS", "CURRENT_DUTY"]].rename(
        columns={"FIRST_NAME": "NAME"}
    )
    merged = disp.merge(driver_small, on="NAME", how="left", suffixes=("", "_driver"))

    # Buffer computed here (after the driver merge) using the real Canadian 7-day cycle field,
    # not the raw per-trip REMAINING_HOURS column: that field is clustered almost entirely between
    # 60-70h in this export and barely varies, so a label built from it gives the model almost no
    # real HOS signal to learn from. CAN_7 is also the actual regulatory quantity the brief cares
    # about, and it's information genuinely available at dispatch time (not a leak).
    merged["hos_buffer_hours"] = merged["REMAINING_HOURS_CAN_7"] - merged["est_drive_hours"]

    # ---- Customer detention history (mean dwell per destination zone, proxy for "customer") ----
    hist = merged.groupby("DEST_ZONE_DESC")["dock_dwell_hours"].transform("mean")
    merged["customer_detention_history"] = hist

    feature_cols = [
        "TRIP_NUMBER", "NAME", "ORIG_ZONE_DESC", "DEST_ZONE_DESC", "LS_LEG_DIST",
        "dock_dwell_hours", "detention_hours", "schedule_slack_hours", "is_empty_leg",
        "remaining_hours", "REMAINING_HOURS_CAN_7", "REMAINING_HOURS_CAN_14",
        "est_drive_hours", "hos_buffer_hours", "route_complexity",
        "customer_detention_history", "STATUS", "CURRENT_DUTY",
    ]
    # Deterministic row order. load_tables() issues `SELECT * FROM <table>` with no ORDER BY, and
    # SQLite makes no ordering guarantee, so the row order coming out of here could differ between
    # runs. That changed what train_test_split() saw positionally, which changed the trained models,
    # which is why re-running the pipeline used to produce different scores for the same TRIP_NUMBER
    # (the reproducibility bug documented in the README). LS_LEG_ID is the dispatch table's own
    # per-leg identifier, so sorting on it pins the order to the data rather than to SQLite's whim.
    merged = merged.sort_values("LS_LEG_ID", kind="mergesort").reset_index(drop=True)

    result = merged[feature_cols].copy()
    result = result.rename(columns={"NAME": "DRIVER_NAME", "LS_LEG_DIST": "distance_km"})
    return result


if __name__ == "__main__":
    df = build_features()
    print(f"Built feature table: {len(df)} rows, {len(df.columns)} columns")
    print(df.describe(include="all").T[["count", "mean"]].head(12))
    df.to_parquet(DATA_DIR / "features.parquet", index=False)
    print(f"Saved -> {DATA_DIR / 'features.parquet'}")
