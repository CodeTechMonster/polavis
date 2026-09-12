"""
RoadPilot AI Dispatch Advisor — Data Ingestion
Converts the raw hackathon Excel workbook (Tlorder, Dispatch, Driver, Trucks, Trailers)
into (a) flat JSON files for the frontend/backend and (b) a SQLite database that the
ML pipeline and the Express API both read from.

Usage: python3 scripts/import_excel.py <path_to_xlsx> [--outdir data]
"""
import argparse
import json
import sqlite3
import sys
from pathlib import Path

import pandas as pd


SHEETS = ["Tlorder", "Dispatch", "Driver", "Trucks", "Trailers"]


def _json_safe(df: pd.DataFrame) -> list[dict]:
    """Convert a dataframe to JSON-serializable records (Timestamps -> ISO strings, NaN -> None)."""
    out = df.copy()
    for col in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[col]):
            out[col] = out[col].dt.strftime("%Y-%m-%dT%H:%M:%S")
    out = out.where(pd.notnull(out), None)
    return out.to_dict(orient="records")


def import_workbook(xlsx_path: str, outdir: str) -> dict:
    outdir_p = Path(outdir)
    outdir_p.mkdir(parents=True, exist_ok=True)
    db_path = outdir_p / "roadpilot.sqlite"
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(db_path)
    summary = {}

    for sheet in SHEETS:
        df = pd.read_excel(xlsx_path, sheet_name=sheet)
        # Normalize column names: keep original names (traceability), just strip whitespace
        df.columns = [str(c).strip() for c in df.columns]

        # Write JSON
        records = _json_safe(df)
        json_path = outdir_p / f"{sheet.lower()}.json"
        with open(json_path, "w") as f:
            json.dump(records, f, default=str)

        # Write SQLite table (stringify datetimes for portability; sqlite3 has no native datetime type)
        sql_df = df.copy()
        for col in sql_df.columns:
            if pd.api.types.is_datetime64_any_dtype(sql_df[col]):
                sql_df[col] = sql_df[col].dt.strftime("%Y-%m-%d %H:%M:%S")
        sql_df.to_sql(sheet.lower(), conn, if_exists="replace", index=False)

        summary[sheet] = {"rows": len(df), "cols": len(df.columns), "json": str(json_path)}
        print(f"[import] {sheet}: {len(df)} rows -> {json_path.name} + sqlite table '{sheet.lower()}'")

    conn.commit()
    conn.close()
    print(f"[import] SQLite database written to {db_path}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("xlsx_path")
    parser.add_argument("--outdir", default="data")
    args = parser.parse_args()
    result = import_workbook(args.xlsx_path, args.outdir)
    print(json.dumps(result, indent=2))
