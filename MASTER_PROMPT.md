# RoadPilot AI Dispatch Advisor — Master Build Prompt (v2)

> **Grounding note:** This prompt was rewritten after directly parsing the actual uploaded files —
> `Hackathon_Project_Brief.pdf` (6 pages, "City Dispatch Workflow & Fleet Automation") and
> `Hackathon_Data.xlsx` (5 sheets: Tlorder, Dispatch, Driver, Trucks, Trailers). An earlier draft of
> this spec contained content that did not actually exist in the uploaded PDF — that content has been
> discarded. Everything below is grounded either in the real brief text or in the real column
> headers/sample rows of the dataset. Assumptions that go beyond the source documents are flagged
> **[ASSUMPTION]** so the team can confirm or override them.

---

## 1. Role & Objective

You are a Principal Software Architect, Senior Product Designer, AI/ML Engineer, Data Scientist,
TMS Expert, and Logistics Operations Consultant. Build a hackathon-ready SaaS platform:

**RoadPilot AI Dispatch Advisor**

Objective: eliminate manual dispatcher overhead, automate Canadian HOS compliance, recover unbilled
detention revenue, reduce empty miles, and give dispatchers AI-driven recommendations — for a
**Southern Ontario regional/city dispatch operation**, not a long-haul cross-border network.

Architecture:

```
Dispatch Data (TruckMate-style export)
  → Feature Engineering
  → XGBoost Risk Engine
  → SHAP Explainability
  → Claude AI Recommendation Engine
  → Dispatcher Action
```

Comparable in polish to Samsara, Motive, Uber Freight, FourKites — but scoped to what a small/mid
regional carrier dispatch desk actually needs (per the brief's cost breakdown of the 5 fragmented
tools they currently pay for).

---

## 2. Ground Truth From the Hackathon Brief

- **Problem:** dispatchers juggle ~5 disconnected systems daily (load boards ~$800/mo/device, ELD
  ~$600/yr/truck, TMS ~$50/mo/user, quoting tools, maintenance/accounting). Constant context-switching
  costs 1–3 missed load quotes/day ($1,000–$7,000 each) → an estimated **$15,000–$50,000+/month** in
  lost revenue per dispatch desk. Lead with this number in the pitch — it's the strongest Industry
  Impact evidence available and it's sourced directly from the brief, not invented.
- **Region:** Southern Ontario City Dispatch. Terminal hubs: **London, ON** and **Milton, ON**.
  Coverage boundary: North Barrie · East Peterborough & Pickering · West London · South Niagara Falls.
  Runs are FTL and LTL along the 400-series corridor (Hwy 401, 403, 400).
- **Required components:**
  1. Web dispatcher dashboard with mapping + satellite toggle (Google Maps/Mapbox/Leaflet all
     acceptable — brief does not mandate one).
  2. Track & Trace: historical breadcrumbs, distance/odometer tracking, speed telematics.
  3. **Geofence + automated detention billing** — this is called out as a "Critical Requirement."
     Crossing a facility geofence must timestamp arrival and departure in the database; billing
     auto-calculates after the 2-hour free FTL threshold.
  4. Deadhead/empty-mile reduction via proximity-based return-load matching (example given: pairing a
     Milton→London delivery with a London→Kitchener return).
  5. Automated HOS + axle-weight pre-dispatch compliance audits.
  6. A **separate simulation engine** — an independent service simulating live truck movement,
     telemetry (coords/speed/odometer/HOS), and events (401 slowdowns, dock waits, duty shifts).
  7. Driver interface (mobile app or responsive web) for load acceptance and duty logs.
  8. Edge-case discovery is an explicit **bonus scoring area**: what happens when a driver runs out
     of HOS mid-queue at a dock? Unexpected highway closures? Finding these is worth real points.
- **Canadian HOS rules to implement exactly:** 13-hour driving limit, 14-hour on-duty limit, 16-hour
  elapsed window, 10-hour daily off-duty (incl. 8 consecutive core rest hours), Cycle 1 (70h/7 days)
  or Cycle 2 (120h/14 days).
- **Judging areas stated in the brief (7, unweighted in the PDF text):** workflow speed & financial
  value; geofencing & detention precision; problem discovery & innovation; mapping & track-and-trace
  depth; HOS & regulatory logic; simulation engine realism; UI/UX & usability.

  **[ASSUMPTION]** Earlier project notes referenced a different 5-criteria weighted rubric (Industry
  Impact 25%, Innovation 20%, Technical Execution 20%, Use of Provided Data & APIs 15%, Presentation
  15%) and five named provider APIs (Samsara, Motive, DAT, Loadlink, TruckMate). None of that appears
  in this PDF. Treat both rubrics as potentially valid (e.g. one might be from an organizer email or
  slide deck) and build so that **either** scoring lens is satisfied: strong real-data integration
  covers "Use of Provided Data & APIs," and the 7 PDF criteria are covered structurally below. Confirm
  with organizers which rubric is authoritative before finalizing the pitch deck.

---

## 3. Ground Truth From the Dataset (`Hackathon_Data.xlsx`)

This is a real TruckMate-schema export — not synthetic. Use it directly; only synthesize where the
brief explicitly allows (e.g., ML training labels).

| Sheet | Rows | Cols | Key fields |
|---|---|---|---|
| `Tlorder` | 4,031 | 33 | `ORIGCITY/ORIGPROV`, `DESTCITY/DESTPROV`, `DISTANCE`, `LOAD_TYPE`, `WEIGHT_LBS`, `PALLETS`, `TEMPERATURE`, `SERVICE_LEVEL`, `ACTUAL_PICKUP`, `ACTUAL_DELIVERY` |
| `Dispatch` | 10,479 | 57 | `LS_LEG_DIST`, `ORIG_ZONE_DESC/DEST_ZONE_DESC`, `LS_PLANNED_DEPARTURE`, `LS_SCHEDULED_ARRIVAL`, **`LS_DET_PICK_ARRIVE` / `LS_DET_DELV_ARRIVE`** (real dock arrival/departure timestamps — this *is* the detention data source), `REMAINING_HOURS`, `HOS_VIOLATION_AT`, `LS_DANGEROUS_GOODS`, `LS_TEMP_CONTROLLED` |
| `Driver` | 169 | 50 | `DRIVER_ID`, `REMAINING_HOURS_CAN_7/8/14` (Canadian cycle hours — matches the brief's HOS rules directly), `CURRENT_DUTY`, `STATUS` (e.g. `AVAIL`, `VACATION`), `POSLAT/POSLONG`, `LAST_SAT_LOC` (human-readable location like "0.21M W of MILTON, ON") |
| `Trucks` | 131 | 1 | `TRUCK_NUMBER` only — join to Dispatch/Driver by trip/assignment, not by attributes |
| `Trailers` | 425 | 6 | `TRAILER_NUMBER`, `TRAILER_TYPE`, `CAPACITY_LBS`, `LENGTH_FT`, `INSIDE_HEIGHT_FT`, `WIDTH_IN` |

**Confirmed real intra-Southern-Ontario activity:** 2,109 orders with both origin and destination in
Ontario; 911 of those are between named boundary/hub cities (Milton, London, Mississauga, Brampton,
Whitby, Oshawa, etc.), e.g. `MISSISSAUGA → MILTON` (13.8–26.1 mi legs), `MISSISSAUGA → BRAMPTON`. This
is real evidence the region-scoped scenario is directly supported by the data — no need to fabricate
a Toronto→Chicago cross-border story.

**Confirmed real detention example** (use as a demo anchor, verify exact numbers at build time since
they come from a live export and may shift): Trip `618819`, driver leg `WHITBY, ON → MILTON, ON`,
dock dwell ≈ 23.75 hours against the 2-hour free threshold — a clean, real, dramatic detention-billing
story.

**Confirmed real low-HOS example:** Driver `114`, based near **London, ON**, `REMAINING_HOURS_CAN_7`
≈ 0.27 hours while `STATUS = AVAIL` — i.e., essentially out of legal driving hours. This is a strong,
real basis for the HOS-violation-risk demo narrative (better than a synthetic "2.1 hours remaining"
example).

---

## 4. Tech Stack

**Frontend:** React, TypeScript, Vite, TailwindCSS, shadcn/ui, TanStack Query, Zustand, Recharts,
Framer Motion, Leaflet or Mapbox GL (Leaflet is free/no-key and already proven in the prior prototype;
switch to Mapbox GL only if the org has a key and wants vector-tile styling + a satellite toggle).

**Backend:** Node.js, Express, TypeScript.

**Machine Learning:** Python, XGBoost, SHAP — trained on features derived from `Tlorder` + `Dispatch`
+ `Driver` (Section 5). Serve via a small FastAPI/Flask sidecar the Node backend calls, or export to
ONNX and run in-process — pick whichever is faster to stand up in the time remaining.

**AI Layer:** Anthropic Claude API for the Recommendation Engine (Section 8) — this remains the
clearest differentiator versus Samsara/Motive/FourKites, none of which have an LLM reasoning layer.

**Database:** SQLite (file-based, zero ops overhead for a hackathon demo).

**Deployment:** Docker + Docker Compose (frontend, backend, ML sidecar, sqlite volume).

**Simulation Engine:** a genuinely separate Node or Python process (per brief requirement #6) that
writes synthetic live telemetry into the same SQLite DB the dashboard reads from — do not fake this by
just running a `setInterval` inside the frontend; the brief explicitly scores it as its own component.

---

## 5. Data Ingestion & Feature Engineering

`/scripts/import-excel.ts` — parse the 5 real sheets above into:
```
/data/orders.json     (from Tlorder)
/data/dispatch.json   (from Dispatch)
/data/drivers.json    (from Driver)
/data/trucks.json     (from Trucks)
/data/trailers.json   (from Trailers)
```
Generate matching TypeScript interfaces, a SQLite schema, and seed scripts. Preserve the real column
names as the canonical field names (don't invent parallel field names) so the dataset stays traceable
to source.

`/backend/ml/feature-engineering.py` — build these features from the real columns:

- **Driver:** `REMAINING_HOURS_CAN_7/8/14` (HOS buffer), `CURRENT_DUTY`, `POSLAT/POSLONG` → distance
  to pickup, `STATUS`.
- **Load:** `DISTANCE`/`LS_LEG_DIST`, `WEIGHT_LBS`, `PALLETS`, `TEMPERATURE`, `LOAD_TYPE`.
- **Operational:** historical delay rate (`ACTUAL_DELIVERY` vs `LS_SCHEDULED_ARRIVAL`/`DELIVER_BY`),
  detention history per `NAME`/customer zone (derived from `LS_DET_PICK_ARRIVE`/`LS_DET_DELV_ARRIVE`
  deltas), empty-mile ratio (legs where `LS_MT_LOADED = 'E'` vs `'L'` — this field already exists in
  `Dispatch` and directly encodes empty/loaded status, no need to infer it).
- **Derived:** estimated drive hours (`DISTANCE` / avg speed), HOS buffer (`REMAINING_HOURS` minus
  estimated drive hours), capacity utilization (`WEIGHT_LBS`/`Trailers.CAPACITY_LBS`), route
  complexity (`LS_NUM_LEGS`, `EXTRA_STOPS`).

---

## 6. XGBoost Risk Engine

`/backend/ml/risk-engine.py`. Predict four sub-scores and one weighted composite:

```
overallRiskScore = 0.30·hosRisk + 0.30·delayRisk + 0.20·detentionRisk + 0.20·emptyMileRisk
```

Return:
```json
{ "riskScore": 0-100, "hosRisk": 0-100, "delayRisk": 0-100, "detentionRisk": 0-100, "emptyMileRisk": 0-100 }
```

Outcome labels are not present in the export (no explicit "was late"/"got HOS violation" flag beyond
`HOS_VIOLATION_AT` timestamps) — derive real labels where possible (e.g., `ACTUAL_DELIVERY >
DELIVER_BY` = actual delay; `HOS_VIOLATION_AT` present and before trip end = actual violation;
detention hours computed directly from the two real timestamp columns). Only fall back to synthetic
labels for sub-scores where no real signal exists, and say so plainly in the model card / README.

---

## 7. SHAP Explainability Engine

`/backend/ml/explainability.py`. Top-5 contributing factors per prediction with natural-language
output, e.g.:

> "Driver 114 has only 0.27 hours remaining under the Canadian 7-day cycle while the estimated leg
> from London, ON requires roughly 1.4 hours of driving. This is the dominant contributor to the HOS
> violation risk score."

Ground every example sentence generator in real field names (`REMAINING_HOURS_CAN_7`, `LS_LEG_DIST`,
etc.) so the explanations are auditable against the SQLite tables, not just plausible-sounding text.

---

## 8. Claude AI Recommendation Engine

`/backend/ai/recommendation-service.ts`. Input: risk scores + SHAP output + driver/route/load record.
Prompt Claude to return strict JSON:

```json
{
  "summary": "",
  "risks": [],
  "recommendations": [],
  "expectedImpact": {
    "riskReduction": "",
    "detentionSavings": "",
    "delayReduction": ""
  }
}
```

Also generate: root cause analysis, an alternative dispatch plan (reassign driver/trailer/route), and
a business impact estimate. Tie the dollar figures back to the brief's stated $1,000–$7,000-per-load
and $15k–$50k/month numbers so the ROI story is internally consistent across the whole demo.

---

## 9. Remaining Modules (unchanged in spirit, retargeted to real data/region)

- **Smart Load Matching:** best driver/trailer/route by distance-to-pickup, remaining HOS, trailer
  compatibility (`Trailers.TRAILER_TYPE`/`CAPACITY_LBS` vs `Tlorder.LOAD_TYPE`/`WEIGHT_LBS`), empty-mile
  reduction (pair with the brief's own Milton→London / London→Kitchener example), profitability.
- **What-if Simulation:** reassign driver / change pickup time / split route / change trailer →
  recompute risk/ETA/profitability, show before→after (e.g. Risk Score 82 → 24).
- **Detention Billing:** `LS_DET_PICK_ARRIVE`/`LS_DET_DELV_ARRIVE` → dock duration → first 2h free,
  `Detention Fee = hours over threshold × rate`. Surface pending vs. recovered revenue and a top
  detention customers table. This is the brief's "Critical Requirement" — give it the most polish.
- **HOS Compliance Engine:** implement the four Canadian limits and both cycle options exactly as
  listed in Section 2, using `REMAINING_HOURS_CAN_7/8/14` directly rather than re-deriving them.
- **Edge Case Discovery Engine:** driver about to run out of HOS while queued at a dock, unexpected
  delay (401 corridor), high-risk/high-detention customer, empty return trip, weight overload. This
  is explicitly a bonus-scored area in the brief — don't treat it as an afterthought.
- **Geofence + Simulation Engine:** independent service simulating truck movement along real Southern
  Ontario routes (London/Milton hub-and-spoke to Barrie/Peterborough/Pickering/Niagara Falls),
  triggering geofence events that write real timestamps to SQLite.

---

## 10. Web App Pages (1–8) + Driver Mobile App

Keep the original 8-page structure (Executive Command Center → Fleet Map → Risk Intelligence →
Explainable AI → AI Recommendation → What-if Simulation → Detention Billing → HOS Compliance), plus a
responsive Driver App (load acceptance, dispatch details, route map, duty status, HOS tracking,
arrival/departure confirmation, push notifications) — but re-skin every map, address, and demo record
to Southern Ontario cities and the real dataset's driver/trip IDs instead of placeholder data.

UI/UX: dark mode, glassmorphism, Framer Motion, skeleton loaders — carry over the visual language
already validated in the earlier single-file prototype rather than restyling from scratch.

---

## 11. Demo Mode — Grounded Flow

Replace the generic demo script with one anchored in real records so a judge can be told "this is not
a mock, this came out of your own export":

1. **Executive Command Center** — active loads/drivers pulled from real `Tlorder`/`Driver` counts.
2. **Live Fleet Map** — select **Trip 618819** (Whitby → Milton leg).
3. **XGBoost Risk Prediction** — surface its real detention dwell (~23.75h) driving `detentionRisk`
   up, plus **Driver 114**'s real 0.27h remaining HOS driving `hosRisk` up → composite risk in the
   80s.
4. **SHAP Explainability** — top factors: remaining HOS, dock dwell hours, distance, customer
   detention history.
5. **Claude AI Recommendation** — root cause + reassignment suggestion (swap in an `AVAIL` driver
   with adequate `REMAINING_HOURS_CAN_7` located near Milton).
6. **What-if Simulation** — reassign to the suggested driver, watch risk score drop.
7. **Detention Billing Recovery** — show the real dock-time delta convert into a dollar figure at a
   chosen hourly rate.
8. **Edge Case Discovery** — flag Driver 114 as a live HOS-exhaustion edge case surfaced automatically,
   not scripted.
9. **Executive ROI Dashboard** — tie back to the brief's $15k–$50k/month opportunity framing.

Story arc: **Predict → Explain → Recommend → Act → Save Money**, told with real trip/driver IDs from
the export at every step.

---

## 12. Execution Priorities (read before writing code)

Full-stack + ML + mobile + Docker is a large build. Sequence it so a partial build still demos well:

1. **MVP first:** the single Section-11 flow, fully real, fully working end-to-end
   (data → risk score → SHAP → Claude recommendation → detention $ → UI), even before the rest of the
   8 pages exist. A judge sees one flawless, data-grounded story before anything else.
2. **Then breadth:** layer in the remaining pages/modules in the order the judging criteria weight
   them highest (detention precision and HOS logic before, e.g., the mobile app polish).
3. **Backup video:** record a screen capture of the working MVP flow early, before adding riskier
   features, as insurance against live-demo failure.
4. **Keep the provider-adapter pattern** from the earlier prototype (`Providers` namespace with
   swappable mock/live functions) for anything that might later connect to a real Samsara/Motive/
   DAT/Loadlink/TruckMate feed — even though this PDF doesn't name those APIs, the dataset's own
   schema strongly resembles a TruckMate export, so a "TruckMate adapter" is a legitimate, defensible
   claim for the "Use of Provided Data & APIs" criterion if that rubric turns out to apply.

---

## 13. Deliverables

1. Complete folder structure 2. SQLite schema 3. Backend APIs 4. React frontend 5. Driver mobile app
6. XGBoost training pipeline 7. SHAP explainability engine 8. Claude recommendation engine
9. Demo dataset (derived from the real xlsx, not invented) 10. Docker setup 11. README
12. Deployment guide 13. Seed scripts 14. Sample API responses 15. Architecture diagram

The end result should look like a real, commercializable Southern Ontario city-dispatch SaaS platform
— not a generic freight demo retrofitted with a Canadian flag.
