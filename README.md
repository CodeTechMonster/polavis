# RoadPilot AI Dispatch Advisor

A working (not mocked) implementation of the Predict → Explain → Recommend → Act pipeline for a
Southern Ontario city-dispatch operation, built directly on the real hackathon dataset.

Every number in this build is computed from `Hackathon_Data.xlsx` — nothing is synthetic except
where explicitly noted in `backend/ml/risk_engine.py`.

## Quick Start

**Already set up? Double-click `START-ALL.bat`.** It launches all four services in their own
windows and opens the dashboard, with no install or `.env` step. It checks the prerequisites first
(data files, `node_modules`, `.env`) and refuses to start if any are missing, rather than opening
four windows that each fail separately. `STOP-ALL.bat` closes them again.

For a **first-time setup**, use the numbered files below instead. Copy/paste the block, or
double-click the matching `.bat` in the project root (`1-etl-ml-pipeline.bat`,
`2-ml-microservice.bat`, `3-backend.bat`, `4-frontend.bat`, `5-simulation-engine.bat`) to run each
step without opening a terminal. Steps 2-5 each need their own window running at the same time.

```bash
# 1. ETL + ML pipeline
pip install -r backend/requirements.txt
python scripts/import_excel.py "C:\Project\TestData\1788655393951_Hackathon_Data.xlsx" --outdir data
cd backend/ml 
python precompute.py 
python evaluate.py          # optional: writes data/model_metrics.json (held-out AUC/precision/recall)
cd ../..

# 2. ML microservice (new terminal)
cd backend/ml
python -m uvicorn service:app --port 8000

# 3. Backend (new terminal)
cd backend
npm install
cp .env.example .env   # add your real ANTHROPIC_API_KEY; optionally set ML_SERVICE_URL
npm run dev             # http://localhost:8787

# 4. Frontend (new terminal)
cd frontend
npm install
npm run dev             # http://localhost:5173, proxies /api to :8787

# 5. Simulation engine (new terminal, optional but needed for the fleet map / detention panel)
cd backend
npx tsx simulation/engine.ts
```

**Note on the commands above**: `python` and `python -m uvicorn` (rather than `python3` and a bare
`uvicorn`) are what actually worked on Windows during real testing of this project — `python3` isn't
always on `PATH` on Windows, and invoking `uvicorn` as a bare command depends on your Scripts folder
being on `PATH`, while `python -m uvicorn` works as long as `python` itself resolves. On Mac/Linux,
`python3` and a bare `uvicorn` typically still work fine if that's your existing setup. Swap
`"C:\Project\TestData\1788655393951_Hackathon_Data.xlsx"` for wherever your actual Excel file lives
(the `.bat` file has the same path and needs the same edit).

## What's implemented right now (Phase 1 — MVP, per the master prompt's execution priorities)

- `scripts/import_excel.py` — real ETL: Excel → `data/roadpilot.sqlite` + `data/*.json` (4,031 orders,
  10,479 dispatch legs, 169 drivers, 131 trucks, 425 trailers — verified row counts on import)
- `backend/ml/feature_engineering.py` — joins Dispatch + Driver + Tlorder into an 18-column feature
  table (HOS buffer, dock dwell hours, empty-mile flag, route complexity, etc.)
- `backend/ml/risk_engine.py` — 4 XGBoost classifiers (HOS / delay / detention / empty-mile) trained
  on labels derived from real timestamps and HOS fields, combined into the weighted `riskScore`
- `backend/ml/explainability.py` — SHAP TreeExplainer producing top-5 factors + a plain-language
  sentence per leg
- `backend/ai/recommendation-service.ts` — real Claude API call (verified reaching
  `api.anthropic.com`; returns a 401 until you add your key, which is the expected/correct failure
  mode in this environment)
- `backend/src/server.ts` — Express API serving all of the above (`/api/summary`, `/api/risk/top`,
  `/api/risk/:tripNumber`, `/api/drivers/available`, `/api/recommend/:tripNumber`)
- `frontend/` — React + TypeScript + Vite + Tailwind v4 dashboard (Executive KPIs + risk list + SHAP
  panel + "Get Claude AI recommendation" button), builds clean with `npm run build`

**Verified end-to-end on this machine:** ETL → features → XGBoost → SHAP → Express API → React UI,
using Trip 618819 (Whitby → Milton, ~23.75h real dock dwell) as the running example. Its
`detentionRisk` score comes out ~90-97/100 from the trained model, which matches the real dwell time
— the model is picking up a genuine signal, not a scripted number.

## Phase 2 — implemented and verified

- `backend/simulation/geofences.ts` — 13 real Southern Ontario city geofences (lat/lon + radius)
- `backend/simulation/engine.ts` — **genuinely separate process** (brief requirement #6). Picks real
  dispatch legs, interpolates GPS between real origin/destination geofences, decrements a simulated
  HOS counter, and on arrival/departure writes real geofence events with the **actual historical dock
  dwell hours** (from `LS_DET_PICK_ARRIVE`/`LS_DET_DELV_ARRIVE`) and computed detention fee (first 2h
  free, then $75 CAD/h — **[ASSUMPTION]**: rate not stated in the brief, adjust in `engine.ts`).
  Verified output: e.g. a leg with 12.8h real dwell → correctly billed $806 CAD; a 2.0h leg → $0
  (still inside the free window).
- `/api/live/positions`, `/api/detention/summary` — served from the `live_telemetry` /
  `geofence_events` tables the simulator writes to. Verified realistic speeds (~80 km/h) after fixing
  an initial unit-conversion bug in the speed calc.
- `frontend/src/FleetMap.tsx` — live Leaflet map, driver markers colored by status
  (driving/dwelling), **satellite/street toggle** using Esri World Imagery vs OpenStreetMap (both
  free, no API key needed) — satisfies the brief's "Satellite View toggle" requirement.
- `frontend/src/DetentionBilling.tsx` — live recovered-revenue panel reading `/api/detention/summary`.
- `/api/edge-cases` — real edge cases pulled from the data: drivers already over their 7-day HOS
  cycle limit (`REMAINING_HOURS_CAN_7 < 0`, split from "about to exhaust" as a separate severity),
  chronic high-detention destination zones, likely empty-return legs.
- `/api/match/:tripNumber` — smart load matching: ranks available drivers by real haversine distance
  to the pickup geofence. **Bug found and fixed during testing**: `Driver.POSLAT`/`POSLONG` are
  encoded as `DDDMMSS` + hemisphere letter (e.g. `"0433201N"` = 43°32′01″N), not decimal degrees — a
  naive numeric read silently produced `null` distances. `parseDmsCoord()` in `server.ts` fixes this;
  verified against known Whitby/Milton coordinates.

## Phase 3 — implemented and verified

- **What-if reassignment** (`POST /api/whatif/:tripNumber`, `WhatIfPanel.tsx`) — heuristic re-score
  using the candidate driver's real `REMAINING_HOURS_CAN_7` vs. the trip's real distance, plus a
  small pickup-detour delay penalty from real haversine distance. Explicitly labeled a heuristic, not
  a live XGBoost re-inference (that would need an always-on ML microservice — flagged as future work
  rather than faked).
- **Driver mobile interface** (`DriverApp.tsx`, served at `?view=driver`) — real assignment lookup,
  duty status (persisted to a new `driver_status` table), load accept / arrival / departure buttons
  that write real timestamped events to `load_events`.
- **Edge cases + load matching wired into the dashboard UI** (`EdgeCases.tsx`, driver picker in
  `WhatIfPanel.tsx`) — previously backend-only in Phase 2.
- **HOS risk model compliance guardrail**: testing surfaced that the trained `hosRisk` classifier
  scored `0` for a driver already at `REMAINING_HOURS_CAN_7 = 0.27` (a real hard legal-limit case),
  because `hos_buffer_hours` was excluded from its training features to avoid label leakage and the
  model under-weighted `REMAINING_HOURS_CAN_7` instead. Added a rule-based floor in
  `risk_engine.py::score()`: `CAN_7 < 0` → 99, `CAN_7 < 3` → at least 90, regardless of model output.
  This is a legitimate production pattern (ML score + compliance guardrail for hard legal limits), not
  a workaround — and it's a good talking point for "Problem Discovery" scoring.
- **Two additional real bugs found and fixed while wiring this phase**: (1) `Dispatch.TRIP_NUMBER`
  is not unique — one trip can have multiple relay legs assigned to *different* drivers, so looking
  up risk/SHAP by trip number alone silently returned the wrong driver's leg. `/api/risk/:tripNumber`
  now accepts an optional `?driver=` to disambiguate. (2) `driver_status`/`load_events` tables needed
  adding to the shared schema migration.

## What's not built yet (Phase 4 candidates)

- shadcn/ui, Zustand, TanStack Query, Framer Motion (current UI is plain Tailwind + `fetch`+`useState`)
- A live ML microservice so what-if can trigger a real XGBoost/SHAP re-inference instead of the
  current heuristic
- Docker Compose is scaffolded but not smoke-tested — no Docker daemon in this sandbox
- Push notifications are simulated as an in-app banner (real push would need a service worker +
  backend push provider, out of scope for a hackathon demo)

## Phase 4 — implemented and verified

- **Real ML microservice** (`backend/ml/service.py`, FastAPI on `:8000`) — trains the same XGBoost
  models once at startup and serves genuine re-inference for what-if driver reassignment: swaps in
  the candidate driver's real `REMAINING_HOURS_CAN_7/14`, re-runs the trained models on the modified
  feature row, re-applies the same compliance guardrail, and returns a SHAP-derived driving factor.
- **Node backend now calls the ML service first**, with a 2s timeout, and transparently falls back
  to the Phase 3 heuristic if it's unreachable — verified both paths explicitly (ml-service running
  → `"source": "ml-service"`; ml-service killed → `"source": "heuristic-fallback"`, correct numbers
  in both cases).
- **Honest model-limitation finding**: re-running trip 621919 (Driver114, CAN_7=0.27h, a long
  Kentucky→Ontario cross-border leg) through the *real* model with a healthy candidate driver
  (CAN_7=70h) still returns `hosRisk≈90` from the raw model — i.e. for this particular leg, the
  trained hosRisk classifier is dominated by distance/route-complexity features rather than the
  driver's actual remaining hours, so swapping the driver barely moves the raw model's score (the
  compliance guardrail masks this for genuinely-exhausted drivers, but doesn't fix the model's
  underlying insensitivity to HOS changes on this leg). The heuristic fallback, by contrast, is
  *directly* built from HOS buffer math, so it responds correctly (90 → 5) to the same swap. This is
  flagged here rather than hidden — a real limitation of a same-day XGBoost fit on ~10k rows with a
  leakage-safe but weaker feature set, and a legitimate "what we'd improve with more time" talking
  point for judges.
- One more bug fixed while wiring this: a numpy `float32` was leaking unconverted into a FastAPI
  JSON response (`after_overall`), causing a silent 500. Fixed by casting to Python `float` before
  serialization — worth knowing if you extend `service.py` further.

## Phase 5 — implemented and verified

- **HOS label fixed at the root cause**: the previous label used `REMAINING_HOURS` (the raw per-trip
  field), which is clustered almost entirely between 60-70h in this export and barely varies — a
  label built from it gives the model almost no real HOS signal. Re-derived `hos_buffer_hours` from
  `REMAINING_HOURS_CAN_7` instead (the actual Canadian regulatory quantity, and genuinely available
  at dispatch time). Retrained: `REMAINING_HOURS_CAN_7` is now **82% of the hosRisk model's feature
  importance** (up from being effectively ignored).
- **Found and fixed the real reason what-if looked stuck at Phase 4**: it wasn't the model — a
  direct `model.predict_proba()` test on the swapped-driver row already showed 99.4% → 0.002%,
  proving the retrained model responds correctly. The bug was in `service.py`'s call to `score()`:
  that function's own compliance guardrail reads `REMAINING_HOURS_CAN_7` from the `df` argument, but
  only `X` (the feature matrix) was being updated with the candidate driver's HOS — so the guardrail
  kept re-applying the *original* driver's threshold and silently overwrote the correct low score
  back to 90+. Fixed by also updating the `df` slice passed into `score()`. Verified: Driver114
  (CAN_7=0.27h, hosRisk 99.4) reassigned to Driver56 (CAN_7=70h) now correctly returns hosRisk 0.0,
  riskScore 49.8 → 19.0, through the full Node → ML-service stack.
- This is worth calling out for judges specifically: it's a real example of a subtle "which variable
  did I actually update" bug that a naive demo would never have surfaced, found by cross-checking the
  service's output against a raw model call rather than trusting the first plausible-looking number.

## Phase 6 — implemented and verified

- **`/api/model/feature-importance` + `FeatureImportance.tsx` panel** — surfaces the real XGBoost
  feature importances per sub-model, switchable by risk type, animated bars.
- **Found and fixed a second leakage bug while building this panel**: `delayRisk`'s feature
  importances showed `schedule_slack_hours` at 99.9% — because that column *is* the exact quantity
  the `delayed` label was derived from (`schedule_slack_hours < 0`), so the model had trivially
  memorized the label instead of learning from real predictive signal. Same fix pattern as the Phase
  5 HOS issue: excluded `schedule_slack_hours` from `delayRisk`'s training features. Re-trained
  importances are now genuinely distributed (`customer_detention_history` 20.7%, `distance_km`
  17.4%, `route_complexity` 16.0%, HOS fields ~11-12% each) — a real, non-trivial model.
- **Framer Motion polish**: staggered KPI card entrance, animated feature-importance bars, animated
  risk-score transition in the what-if before/after comparison.
- Net effect: **two separate leakage bugs found and fixed across Phases 5-6** (hosRisk via
  `hos_buffer_hours`/`REMAINING_HOURS`, delayRisk via `schedule_slack_hours`) — both caught by the
  same discipline of inspecting real feature importances rather than trusting a plausible-looking
  accuracy number.
- **Leakage audit closed out**: also checked `detentionRisk` (top feature `route_complexity` at 31%)
  and `emptyMileRisk` (top feature `route_complexity` at 28%) — both well-distributed across real
  features with no single dominant/leaked one, unlike the two bugs above. All four sub-models are
  now genuinely learning from real, non-trivial signal.

## Phase 7 — implemented and verified

- **TanStack Query** (`hooks.ts`) — replaced every manual `useEffect`+`useState`+`fetch` pattern with
  typed `useQuery` hooks: automatic caching, `refetchInterval` for the live map (2s) and detention
  panel (3s) instead of hand-rolled `setInterval`/`clearInterval`, and proper `enabled:` gating for
  the risk-detail query (only fires once a trip is selected).
- **Zustand** (`store.ts`) — the selected risk row is now a small shared store instead of
  `useState` + manual prop passing between `App` and `WhatIfPanel`; removes a layer of prop drilling
  and is the natural place to add more shared dashboard state later (e.g. a global driver filter).
- Every component's fetch types are now centralized and shared (`RiskRow`, `Summary`,
  `DetentionSummary`, etc. all live in `hooks.ts`) instead of being redeclared per-component, which
  is what let the earlier `any`-typed rewrite get properly type-checked end to end.
- **shadcn/ui deliberately deferred, not just skipped**: shadcn's CLI generates components assuming
  Tailwind's `tailwind.config.js`-based theming, and this project is on Tailwind v4's CSS-first
  config (`@import "tailwindcss"` in `index.css`, no config file) — the two don't compose cleanly
  without extra shimming. Given the current custom Tailwind components are already visually
  consistent, this was judged lower-value than the Query/Zustand work for the time available. Worth
  revisiting if there's time before the actual demo.

## Phase 8 — implemented and verified

- **Code-splitting**: `App`/`DriverApp` are now `React.lazy`-loaded from `main.tsx` based on the
  `?view=` param, and `FleetMap` (the Leaflet-heavy component) is lazy-loaded inside `App`. Verified
  in the build output: the earlier single ~520KB chunk is now split into `index` (218KB, shared
  core), `App` (147KB, dispatcher dashboard), `FleetMap` (154KB, only loaded when the map renders),
  and `DriverApp` (5KB) — Vite's "chunk larger than 500KB" warning is gone, and a driver opening
  `?view=driver` now downloads a fraction of what the full dispatcher dashboard needs.
- **Real browser Notification API** in the driver view (not just the in-app banner from earlier
  phases): a permission-request button, and once granted, an actual OS-level `Notification` fires
  the first time a driver's assigned load crosses the high-risk threshold — deduplicated per trip via
  a `Set` so it doesn't re-fire on every poll. Falls back gracefully (clear "blocked" message) if the
  user denies permission, and to the in-app banner if `Notification` isn't supported at all. This is
  still not server-push (no service worker/VAPID keys — that's a real backend + infra addition, not
  a quick add), but it's a genuine, testable browser API rather than a UI-only banner.
- **Docker remains untestable in this sandbox, and that's now confirmed as a hard limit, not
  something to keep deferring**: this container has no `docker` binary at all (not just a missing
  daemon — checked with `which docker`), so `docker-compose up` cannot be smoke-tested here under any
  circumstance. The `Dockerfile`s and `docker-compose.yml` are believed correct by inspection (they
  follow standard Node/Vite patterns) but have never actually been run. **Test this yourself before
  the demo** — it's the one piece of this repo with zero real-execution evidence behind it.

## Phase 9 — implemented and verified

- **Dynamic, dispatcher-controlled route selection** replaces the old "random 10 legs at startup"
  behavior. `simulation_selection` is a new table the Node API writes to; `simulation/engine.ts` now
  polls it every 2s and adds/removes tracked legs live — no restart needed. A freshly empty DB still
  auto-seeds 10 default legs on first run so the demo works out of the box, but everything after that
  is dispatcher-controlled.
- **`SimulationControl.tsx`** — a searchable picker (by trip number, driver name, or city) next to
  the fleet map, showing real distance and real historical dwell hours per candidate leg, with
  checkboxes and an "Apply selection" button. Verified: selecting a trip makes it appear on the map
  within ~2s; deselecting removes it immediately (its `live_telemetry` row is deleted, not just
  hidden).
- **Two real bugs found while building this**:
  1. `GET /api/simulation/candidate-legs?q=618819` returned empty even though trip 618819
     definitely exists — the query pre-limited to the 2000 highest trip numbers *before* applying
     the search filter, and 7,320 of the 10,479 dispatch rows have a higher trip number than 618819,
     so it was silently excluded from the search pool. Fixed by pushing the search into the SQL
     `WHERE` clause directly instead of limit-then-filter.
  2. The geofence list only covered 13 cities, so drivers running real legs through legitimate
     Southern Ontario/GTA cities not on that list (Oakville, Burlington, Etobicoke, Scarborough,
     Vaughan, Guelph, and ~20 others found by auditing every real `ORIG/DEST_ZONE_DESC` value) were
     being marked "not simulatable" even though they're real, in-region legs. Expanded the geofence
     list from 13 to 39 cities based on that audit. (Also confirmed, while investigating, that
     Driver114 — the low-HOS edge case from Phase 5 — genuinely has zero intra-Southern-Ontario legs
     in this export; every one of their trips crosses into the US or Quebec, which is consistent
     with why they're chronically short on Canadian cycle hours. Not a bug, just a finding worth
     knowing.)
- Also fixed the literal string `"<null>"` appearing as a driver name in a few rows (a data artifact,
  not a real `NULL`) — now filtered out of the candidate-legs list and the engine's default-seed
  query.

## Phase 10 — implemented and verified

- **Removed "London-Milton corridor"** from the dashboard subtitle (now just "Southern Ontario
  city dispatch") per request — it was reading as an overly narrow claim once the simulation
  engine's geofence coverage grew to 39 cities in Phase 9.
- **Dark/light mode toggle** (`ThemeToggle.tsx`, `useThemeStore` in `store.ts`) — theme choice
  persists in `localStorage` and applies via a `.light` class on `<html>`. All neutral UI colors
  (text, surfaces, borders, page background) were migrated from hardcoded Tailwind opacity utilities
  (`text-white/50`, `bg-white/5`, etc.) to CSS custom properties defined once in `index.css` for both
  themes, rather than hand-writing `dark:`/light variants on every element.
- **App/version/team info panel** (`InfoPanel.tsx`) — a header button opens a modal showing the app
  name, version (`v1.0.0`), team name (**Polavis**), and members (Hyunsoo Hwang, Yu Jung, Chaeyoon
  Kim). Edit the constants at the top of `InfoPanel.tsx` directly if the roster changes.
- **Two real contrast bugs found and fixed while doing the CSS-variable migration**: a blanket
  find-and-replace of `text-white` → the new primary-text variable is correct for neutral surfaces,
  but it also silently hit (1) the floating satellite-toggle button on the fleet map, which sits on
  top of map tiles rather than the page background and needs to stay literally white regardless of
  theme, and (2) every solid vivid-color button (`bg-indigo-500/80`, `bg-emerald-500/80`, etc.) where
  the text needs to stay white against a saturated fill color in *both* themes, not follow the
  neutral text-color token. Both were caught by grepping the diff rather than trusting the mechanical
  replacement, and reverted to literal `text-white` where appropriate.
- **Known gap**: this was verified by code review (careful grep audits + a full `tsc`/`vite build`
  pass) rather than an actual screenshot — this sandbox has no headless browser available to render
  and capture the two themes. Visually spot-check both modes before presenting, especially the
  semantic risk colors (red/amber/emerald at low opacity) against the light background, which weren't
  re-tuned for light mode contrast.

## Phase 11 — implemented and verified

- **Fixed the "route flashes then disappears" bug**: the simulation engine previously ran a leg
  through exactly one drive→dwell→depart cycle, then auto-removed it from *both* live tracking and
  the `simulation_selection` table. For a short-distance leg (a few km) at this demo's compression
  factor, that whole cycle finished in ~10 seconds — so selecting a route from the picker made it
  appear on the map and vanish almost immediately, which is what was reported. Fixed by having a
  completed leg **loop** (swap origin/destination and drive back) instead of terminating, so a
  selected route now keeps running — visibly ping-ponging between its two cities — until the
  dispatcher explicitly deselects it. Verified over a 25s run: trip 622818 completed two full
  Whitby→Oshawa→Whitby cycles (with two separate detention-billing events logged) and never dropped
  out of the selection table on its own.

## Phase 12 — implemented and verified

- **Closed the driver-app → dispatcher-dashboard feedback gap** identified while explaining the
  architecture: `load_events` and `driver_status` were being written by the driver mobile view but
  never read by anything dispatcher-facing — a driver accepting/arriving/departing a load, or
  changing duty status, was invisible on the dashboard.
- **`GET /api/driver-activity`** and **`GET /api/driver-status/all`** — surface those two tables to
  the dispatcher side for the first time. **`DriverActivity.tsx`** — new dashboard panel showing the
  live feed (driver · trip · action · time) and current duty-status badges, polling every 4s.
- **`/api/match/:tripNumber` now respects live duty status**: a driver marked `DRIVING` or `SLEEPER`
  through the driver app is excluded from reassignment candidates even if the static Excel-imported
  `STATUS` column still says `AVAIL` — the live app state overrides the stale snapshot. Verified
  end-to-end: marked the top load-matching candidate as `DRIVING` via the driver endpoints, confirmed
  they dropped out of `/api/match` results on the next call, and confirmed their action showed up in
  `/api/driver-activity` immediately.

## Phase 13 — implemented and verified

- **Phone-to-local-web connection**: confirmed the driver view already supports this — it's a
  regular responsive web page, not a native app, so a phone on the same WiFi network can open it
  directly and every action (accept/arrive/depart, duty status) writes to the *same* SQLite database
  the dispatcher dashboard reads from. The only blocker was `vite dev` binding to `localhost` only by
  default. Fixed with `server: { host: true }` in `vite.config.ts` — verified `vite --host` now
  prints a `Network: http://<LAN-IP>:5173/` URL in addition to `localhost`.
- **To actually use it**: run `cd frontend && npm run dev` (host:true is now the default), find your
  computer's LAN IP (`ipconfig` on Windows, `ifconfig`/`ip addr` on Mac/Linux — look for the
  "Network:" line Vite prints), then open `http://<that IP>:5173/?view=driver` in the phone's
  browser on the same WiFi. No changes needed on the backend side — Express's `app.listen(PORT)`
  already binds to all interfaces by default, and the `/api` proxy in `vite.config.ts` runs
  server-side on the same machine regardless of which device is browsing, so it always reaches
  `localhost:8787` correctly.
- **Native app (Capacitor/React Native) is a separate, bigger question** from "reflects on the local
  web" — that goal is already met by the browser-based approach above. A native wrapper would mainly
  buy: an installable home-screen icon, true background push notifications (vs. the current
  `Notification` API which needs the tab open), and offline support — all optional future work, not
  required for phone↔web sync.
- **Practical gotchas to flag**: phone and computer must be on the same local network (won't work
  over cellular data or separate WiFi/VPNs); OS firewall may prompt to allow inbound connections on
  first run — allow it; this only works while the dev server is running on the computer (stopping
  `npm run dev` takes the phone's driver view down too, since there's no separate deployment yet).

## Phase 14 — implemented and verified

- **User-editable column-name mapping** (`store.ts`'s `useFeatureLabelStore`, `FeatureLabelSettings.tsx`)
  — the SHAP and feature-importance panels were showing raw dataset column names
  (`REMAINING_HOURS_CAN_7`, `distance_km`, etc.) with no way to rename them. Added a "🏷 Column
  labels" button (inside the feature-importance panel) that opens an editable list of every raw
  column currently used across all 4 risk sub-models — the list is built dynamically from the live
  `/api/model/feature-importance` response plus the built-in defaults, not hand-maintained, so a
  future new model feature shows up automatically. Overrides persist in `localStorage`
  (`roadpilot-feature-labels`) and apply immediately in both the feature-importance bars and the SHAP
  factor list on the risk-detail panel.
- **Fixed a related gap while wiring this**: the SHAP API response already included both a raw
  `feature` key and a backend-computed `friendly_name`, but the frontend's `ShapFactor` type only
  declared `friendly_name` — so a user override could never reach that panel even after the mapping
  store existed. Added `feature` to the type and switched the SHAP list to
  `getLabel(f.feature, f.friendly_name)` (user override → built-in default → backend's own
  friendly_name → raw column, in that priority order).

## Phase 15 — implemented and verified

- **Glossary added to the Info panel** (`InfoPanel.tsx`) — 17 domain/ML terms (HOS, CAN_7/14, FTL,
  LTL, detention, dock dwell, geofence, empty mile, TMS, ELD, XGBoost, SHAP, feature importance,
  label leakage, re-inference, what-if, guardrail) with plain-English definitions, scoped to how
  each term is actually used in this app rather than generic textbook wording. Modal is now
  scrollable (`max-h-[85vh] overflow-y-auto`) and wider (`max-w-lg`) to fit the added content.

## Phase 16 — implemented and verified

- **Connected the What-if candidate driver to the Claude recommendation call** — previously the two
  features were isolated: picking a candidate in `WhatIfPanel` never reached the "Get Claude AI
  recommendation" button, which always sent an empty body, so Claude's prompt permanently said "No
  pre-identified replacement driver" even after a dispatcher had already picked one. Backend
  (`/api/recommend/:tripNumber`) already accepted and forwarded `candidateDriver` — only the
  frontend link was missing.
- Added a shared `selectedCandidate` slot to `useDashboardStore` (`store.ts`); `WhatIfPanel` writes
  to it the moment a candidate is picked, `App.tsx` reads it when calling `/api/recommend`, and
  selecting a *different* trip clears it so a stale candidate from a previous leg can't leak into
  the next Claude call. A small UI hint ("Will include candidate driver X from the what-if below")
  makes the connection visible rather than silent.
- Verified end-to-end: posted a `candidateDriver` payload to `/api/recommend/618819` and confirmed
  it reaches the live `fetch()` to `api.anthropic.com` (same 401-no-API-key failure as before,
  which is expected in this sandbox and confirms the payload construction path is correct).

## What's not built yet (Phase 17 candidates)

- shadcn/ui (see Phase 7 reasoning)
- True server-push notifications (see Phase 8)
- Docker Compose — needs testing in an environment that actually has Docker
- Geofence list coverage gaps (see Phase 9)
- Light-mode contrast tuning for the semantic risk colors (see Phase 10 known gap)
- HOS on a looping leg now decrements indefinitely without ever resetting (no simulated rest break
  between cycles) — fine for a short demo, but worth capping/resetting if a route is left running for
  a long presentation

## v1.1 Enhancement Request — implemented and verified

A large batch request (12 items + an architecture question) came in as `AI Load Risk Copilot v1.1
Enhancement Request`. Status of each item:

1. **Risk Score shown as whole numbers everywhere** — `fmtRisk()` in `hooks.ts` (`Math.round`,
   display-only, underlying calculation untouched) applied across the dashboard, What-if panel,
   drill-down modals, and the driver app.
2. **Info popup on "Risk Explanation & AI Recommendation"** — new reusable `InfoTooltip.tsx`
   component; explains the +/− factor signs, what SHAP top factors mean, and the risk-level scale
   (with the scale pulling live from the same configurable thresholds used everywhere else, so the
   popup never goes stale relative to Settings).
3. **Dashboard banner drill-downs** — Total Drivers / Available Drivers / High Risk Loads banners
   are now clickable, opening `DriverListModal.tsx` / `HighRiskLoadsModal.tsx`. New endpoints
   `GET /api/drivers/all` and `GET /api/risk/high` back them.
4. **Simulation route selection redesigned** — the old checkbox-list picker (`SimulationControl.tsx`)
   is removed, replaced with a search-only lookup (trip number / driver / city) showing live status
   (risk score, location, ETA) via `GET /api/simulation/search`. **Confirmed design** (checked with
   the requester after initially flagging it): manual leg selection is gone entirely — the
   simulation engine runs fully automatically via its existing auto-seed behavior (10 random
   geofenced legs at startup, from Phase 9), and the dashboard's only simulation-facing surface is
   this read-only search. The now-unused `GET /api/simulation/candidate-legs` and
   `GET`/`POST /api/simulation/selection` endpoints, and the matching frontend hooks
   (`useCandidateLegs`, `useSimulationSelection`), were removed for cleanliness — the
   `simulation_selection` SQLite table itself stays, since `simulation/engine.ts` still reads/writes
   it directly (not through the HTTP API) for its own auto-seed/sync logic.
5. **Edge case discovery banners** — three new clickable KPI-style banners (Already Over HOS Limit,
   About to Run Out of HOS, Chronic Detention Zones) with live counts from `/api/edge-cases`'s new
   `counts` field, opening `EdgeCaseModal.tsx` for the detail list.
6. **Risk Threshold Settings screen** — `SettingsPanel.tsx` (⚙ Settings button), backed by a new
   `app_config` SQLite table and `GET/POST /api/settings/thresholds` (+ a reset-to-defaults
   endpoint). Controls HOS/Delay/Detention/Empty-mile thresholds and the Low/Medium/High/Critical
   risk-level boundaries; changes apply immediately across banners, edge-case detection, and risk
   badge colors.
7. **Map behavior** — default center changed to Milton, ON (was a generic GTA centroid); clicking a
   truck's live position now flies the map to that location at a closer zoom ("Show Nearby Area").
8. **Info popup on "Detention Billing"** — added via the same `InfoTooltip` component, explaining the
   billable-hours formula with the worked example from the spec.
9. **Team member name corrected**: "Yu Jung" → "Jung Yu" in the app's Info panel (the pitch decks
   from the earlier session still say "Yu Jung" — say the word if you want those regenerated too).
10. **Driver App fixes**:
    - Dark-mode dropdown text-invisible bug: browsers can render a `<select>`'s dropdown *list*
      with OS-native colors regardless of the select's own styling. Fixed by setting
      `colorScheme` inline (tied to the current theme) on the `<select>` and explicit
      `backgroundColor`/`color` on each `<option>`.
    - "Full driver list not showing": the dropdown was **hardcoded to 4 names**
      (`Driver30/114/89/13`) — not a data-loading bug at all. Replaced with the real list from
      `/api/drivers/all`.
    - Sorting: that same endpoint orders by `DRIVER_ID` ascending — see the real data-quality bug
      this surfaced, below.
11. **Version bumped 1.0 → 1.1** in the Info panel.
12. **Info popup on "Model Feature Importance"** — explains what feature importance means and shows
    the worked risk-calculation example from the spec.

### Real bugs found while implementing this batch

- **`/api/drivers/all` returned all-`NULL` rows at first** — not a SQLite bug (initially suspected
  one after the query reproduced identically in both `better-sqlite3` and Python's `sqlite3`).
  Actual cause: 38 of the 169 driver records have a `NULL` `DRIVER_ID`/`FIRST_NAME` (real data gaps
  in the source export), and `ORDER BY DRIVER_ID ASC` legitimately sorts `NULL`s first in SQLite —
  so a `LIMIT 3` preview showed nothing but blank rows, which looked exactly like a broken query.
  Fixed by filtering out incomplete records and pushing any remaining nulls to the end of the sort.
- **`/api/simulation/search` returned the same trip/driver pair repeated ~7 times with different
  distances** — a `(TRIP_NUMBER, NAME)` pair can have multiple dispatch rows (multi-stop relay
  legs); deduplicated to one representative row per pair.
- **The driver-app dropdown's "missing full list" was a hardcoded 4-item array**, not a fetch/data
  issue — worth knowing since it means the *previous* driver app testing in this project was only
  ever exercising 4 of the 169 real drivers.

### Technical question: GitHub + Firebase Hosting architecture

Asked whether this stack is buildable on: GitHub → GitHub Actions CI/CD → Firebase Hosting, with
Vue 3 + TypeScript + Vite + Tailwind + Leaflet/Google Maps frontend, Firebase Functions backend,
Firestore database, Firebase Auth, Claude API, and an XGBoost ML layer.

**Short answer: yes, feasible, but not a drop-in port of what's built here.** Where it maps cleanly
vs. where real re-architecture is needed:

| Piece | Maps cleanly? | Notes |
|---|---|---|
| GitHub Actions → Firebase Hosting | Yes | Standard, well-supported deploy path for the static frontend build |
| Vue 3 + TS + Vite + Tailwind | Rewrite, not port | Current frontend is React — every component would be rewritten, not migrated |
| Firebase Auth | Yes | This project currently has no auth at all; straightforward to add |
| Claude API calls | Yes | Same HTTP call as today, just issued from a Cloud Function instead of Express |
| XGBoost + SHAP (Python) | Mostly yes | Firebase 2nd-gen Functions support Python; but a model held in memory for fast repeat inference wants a function kept warm (Firebase's "min instances" setting) or it re-loads the model on every cold start — a real latency/cost tradeoff the current always-on FastAPI process doesn't have |
| **Standalone simulation engine** | **No — needs redesign** | Cloud Functions are request/event-triggered with execution time limits; they cannot run an indefinite `setInterval` ticking every 500ms the way `simulation/engine.ts` does today. Realistic options: (a) move the simulator to **Cloud Run** instead of Cloud Functions (a container that *can* run continuously, still part of the Firebase/GCP family), or (b) redesign it as a Cloud Scheduler job firing every 1–5 minutes that advances stored state in bigger jumps — coarser than today's smooth movement, but workable for a demo |
| **SQLite → Firestore** | **No — needs redesign** | Firestore is a NoSQL document store with no SQL joins and no `LIKE` pattern queries — both used heavily here (joining dispatch↔driver by name, the trip/driver/city search). This means denormalizing data at write time or standing up a separate search index, not a straight swap |

**Bottom line**: the pieces that are "call an API" (Hosting, Auth, Claude) port with no real friction.
The pieces that are "a program that keeps running and a database that gets joined and searched"
(the simulation engine, SQLite) are the two places where "same architecture on Firebase" would
actually mean a genuine redesign, not a redeploy. Worth deciding early which of those two you're
willing to redesign before committing to the migration.

## v1.1.1 — bug fix

- **What-if candidate distances didn't recalculate when switching between high-risk legs**:
  `WhatIfPanel` is a single reused component instance (not remounted) as the dispatcher clicks
  through different rows in "Highest risk legs" — its local `candidates`/`result` state had no
  reset tied to the `tripNumber` prop, so the *previous* trip's candidate list (with distances
  computed from the previous trip's pickup city) stayed on screen looking current until the
  dispatcher happened to click "What-if: reassign driver" again. Verified the backend itself was
  never the problem — `/api/match/620258` (Whitby pickup) and `/api/match/619225` (Milton pickup)
  correctly return different nearest-driver distances (5km vs 2km for their respective top
  candidates); the bug was purely stale React state. Fixed with a `useEffect` keyed on `tripNumber`
  that clears both.
- **Related gap closed while investigating**: the "High Risk Loads" drill-down modal listed loads
  but clicking one didn't actually select it on the dashboard, so there was no way to get from that
  modal into its What-if panel at all. Rows are now clickable — picking one calls the same
  `selectTrip` used by the main "Highest risk legs" list (which also clears any stale what-if
  candidate) and closes the modal.

## v1.1.2 — bug fix

- **"High Risk Loads" (and "Highest risk legs") were silently dropping legitimate entries**:
  both `/api/risk/high` and `/api/risk/top` deduplicated by `TRIP_NUMBER` alone, but a trip can have
  multiple relay legs assigned to *different* drivers, each with its own real risk score — deduping
  on trip number alone kept only the first one and discarded the rest. At the shipped default
  threshold (Medium boundary = 60) this happened not to be visible (5 legs either way, by
  coincidence for this dataset), which is exactly why it went unnoticed — but lowering the
  Medium/High boundary in Settings to 40, for example, should show 194 legs and was actually
  showing 136 (58 silently missing). Verified the fix restores the full count. Fixed by deduping on
  `TRIP_NUMBER + DRIVER_NAME` instead, matching the same fix already applied to
  `/api/simulation/search` in Phase 9.

## v1.1.3 — UI change

- **"Model feature importance" panel renamed to "Risk Score Drivers"** — clearer to a dispatcher
  than the ML-jargon original.
- **Tabs replaced with a 2×2 grid**: all four risk sub-models (HOS/Delay/Detention/Empty-mile) now
  show their top 4 features simultaneously, each in its own quadrant with a model-specific accent
  color, instead of requiring a tab click to see one model at a time.

## v1.1.4 — bug fix

- **"High Risk Loads" banner said 27, the list behind it showed 5** — the two endpoints backing them
  used different counting rules: `/api/summary`'s `highRiskLoads` counted every raw dispatch-leg row
  above threshold with **no deduplication at all**, while `/api/risk/high` (the drill-down list)
  deduped by trip+driver (the v1.1.2 fix). Verified directly against the data: 27 raw rows vs. 5
  deduped — that 27 was real dispatch-leg rows, just not "27 distinct high-risk loads." Fixed
  `/api/summary` to use the identical trip+driver dedup as `/api/risk/high`, so the banner number and
  what you see after clicking it now always match (both correctly show 5 at the default threshold).

## v1.1.5 — UI changes

- **Total risk score now shown** in the risk detail grid — a 5th box to the left of HOS, styled in
  indigo to visually separate it from the four sub-scores (it wasn't shown at all before, only the
  four components were).
- **SHAP factor values now round to whole numbers**, and use ↑/↓ arrows instead of +/− text for
  increase/decrease direction (e.g. "↑ 12" instead of "+12.3 · increases risk").
- **"Get Claude AI recommendation" moved below the What-if section** — the button, error state, and
  result now render after `WhatIfPanel` instead of before it, so the flow reads as
  inspect → try a reassignment → then ask Claude (which can include that reassignment).
- **What-if candidate list now shows each driver's real resulting score**, not just distance/HOS —
  every listed candidate gets its own `/api/whatif` call up front (same real re-inference the
  "reassign" click already used), so the list itself shows what each candidate would actually score
  before the dispatcher picks one, not only after.

## v1.1.6 — UI change

- **"Highest risk legs" now shows an explicit Low/Medium/High/Critical text badge per row**, not
  just an implicit color — following up on the "Highest risk legs" vs "High Risk Loads" discussion:
  the top-N list is "top N by score" regardless of level, so it can (and often does) include
  Medium-tier legs alongside High/Critical ones. The badge makes that visible instead of implicit in
  color alone; a small caption above the list ("Top N by score · not all shown are necessarily
  'High'") makes the distinction explicit too.
- **The "N" is now configurable** — new `topRiskLegsCount` setting (default 10, was a hardcoded 8)
  in ⚙ Settings → Dashboard, wired through `/api/settings/thresholds` the same way the other
  thresholds are. Verified: setting it to 15 makes `/api/risk/top` return 15 rows.

## v1.1.7 — UI change

- **Driver list popup (Total/Available Drivers drill-down) columns are now sortable** — clicking any
  column header (Driver #, Name, Location, Available, HOS remaining) sorts by it; clicking the same
  header again reverses direction (▲/▼ indicator shown). Implemented as clickable headers directly
  (no dropdown needed) since React made that straightforward here.

## v1.1.8 — UI change

- **Empty Mile threshold now shows a live km conversion** next to the miles input in Settings (e.g.
  "50 miles (80.5 km)") — updates as you type, using the standard 1 mile = 1.60934 km conversion.

## v1.1.9 — UI fix

- **Driver list popup: Location column was truncating to "..." regardless of modal width** — an
  equal 5-way `grid-cols-5` gave "Location" the same width as "Driver #"/"Available", even though
  real values (e.g. "0.21M ESE of MILTON, ON", up to ~26 chars) need much more room. Switched to an
  explicit column template (`64px 100px minmax(0,1fr) 80px 100px`) so Location gets the flexible
  remaining space, widened the modal (`max-w-2xl` → `max-w-3xl`), and added a native `title` tooltip
  on Location (and Name) so anything still cut off is readable on hover regardless of column width.

## v1.1.10 — bug fix

- **"Available" column sort didn't actually bring "Yes" rows to the top**: the column shows a
  Yes/No derived from `STATUS`, but sorting used the raw `STATUS` string alphabetically — and real
  status values like `ARRCONS`, `ARRSHIP`, `ASSGN` sort *before* `AVAIL` alphabetically, so several
  "No" rows landed above "Yes" rows. Verified against the real 11-status distribution in the data.
  Fixed by sorting on the same Yes(0)/No(1) mapping the column actually displays, so ascending
  (the default on first click) now correctly puts all "Yes" rows first.

## v1.1.11 — new feature

- **Trend icons on the top KPI banners** — each of Active loads / Total drivers / Available drivers
  / High risk loads now shows 📈 if the value went up, 📉 if it went down, or ➖ if unchanged since
  the last update; no icon at all on first load (nothing to compare yet). Implemented as a small
  reusable `useTrend()` hook (`Trend.tsx`) that remembers the previous value across polls.
  `useSummary()` now polls every 5s so there's actually something to compare over time.
  **Honesty note**: `activeLoads`/`totalDrivers`/`availableDrivers` come from static import-time
  counts in this dataset, so in practice they'll mostly show ➖ (stable) here — verified the feature
  itself works correctly by changing the Medium risk-level boundary in Settings and watching
  `highRiskLoads` genuinely change (5 → 194), which is exactly the kind of change these icons are
  built to reflect once real, changing data (or driver-app activity, or ongoing dispatch import) is
  behind them.

## v1.1.12 — new feature

- **"Live updates" toggle in ⚙ Settings** — a single switch now controls whether the dashboard
  actually polls the API on a timer at all. When on (the default, matching prior behavior): KPI
  banners poll every 5s, the fleet map every 2s, detention billing every 3s, and driver activity
  every 4s. When off, each of those fetches once and stops — no background polling until turned
  back on. Implemented as a small `useLiveUpdatesStore` (persisted in `localStorage`, like the theme
  and feature-label preferences) that every polling hook reads via `refetchInterval: enabled ?
  <ms> : false`, so one switch governs all of them without touching each component individually
  again in the future.

## v1.1.13 — bug fix

- **Live updates toggle showed green (on) but the knob sat on the left (looking like off)** —
  the knob's `<span>` only had a conditional `translate-x` class with no explicit base `left`
  position, so the browser's implicit starting offset for the transform wasn't guaranteed to line
  up with the track's padding. Fixed by giving the knob an explicit `left-0.5` base position and
  switching between `translate-x-0` (off) and `translate-x-5` (on) from that fixed reference point —
  the standard, unambiguous way to build this kind of toggle.

## v1.1.14 — new feature

- **`MOCK_CLAUDE` mock mode for the Claude recommendation button** — added purely as an early
  return at the top of `recommendation-service.ts::getRecommendation()`; the real API-call code
  below it is completely untouched. Set `MOCK_CLAUDE=true` in `backend/.env` to exercise the full
  button-click -> JSON -> UI flow without a real `ANTHROPIC_API_KEY`. The mock response is built
  from the same real risk/SHAP/candidate-driver inputs the live call would use (not hardcoded text),
  so different trips and different What-if candidates still produce different mock output. Added a
  `source: "mock" | "live"` field to `RecommendationOutput` so the frontend can show an honest
  amber "Mock response" notice rather than silently presenting it as real. Verified: with
  `MOCK_CLAUDE=true`, trip 618819 returns a real trip-specific mock summary and correctly reflects
  a passed-in candidate driver; with it unset, behavior is byte-for-byte identical to before (still
  hits the real Anthropic endpoint and fails with 401 without a key, exactly as it always did).

## v1.1.15 — UI change

- **Trend icons switched from emoji to `lucide-react` SVG icons** — `TrendIcon` in `Trend.tsx` now
  renders `TrendingUp`/`TrendingDown`/`Minus` (size 16, strokeWidth 2.5) instead of
  📈/📉/➖, so the icons render consistently across platforms/fonts instead of relying on emoji
  glyph availability. Colors (`emerald-400`/`red-400`/`text-muted`) and the `title` tooltip text are
  unchanged — only the glyph itself changed.

## v1.1.16 — UI change

- **Info icons added to each Edge Case Discovery item** — "Already Over HOS Legal Limit", "About to
  Run Out of HOS", and "Chronic High-Detention Zones" each now have an info icon (via the existing
  `InfoTooltip` component) explaining exactly what that item means in English: the underlying
  condition/threshold, whether it's a hard compliance violation vs. an early warning vs. a predicted
  statistical pattern, and how it differs from the similarly-named Detention Billing panel.

## v1.1.17 — bug fix

- **Detention billing revenue grew without bound the longer the simulation ran**: a selected leg
  loops indefinitely (swap origin/destination, repeat — Phase 11 behavior, so the map/telemetry
  stay alive), and every loop's `depart` re-logged a fresh `detention_fee` for the *same* real
  23.75h dwell on trip 618819. Verified before the fix: $1,631 -> $3,262 -> $4,894 across three
  loops of one leg — the same real-world incident billed three times. Fixed by deduping in
  `/api/detention/summary`: the aggregate totals (`totalDetentionFeesCAD`, `billableStops`,
  `topCustomers`) now count each trip's detention at most once (its most recent `depart` event).
  The raw `events` list used for the "Recent stops" activity feed is intentionally left un-deduped —
  showing repeated loop cycles there is expected/informative for a live feed, it's only the revenue
  *totals* that shouldn't multiply. Re-verified after the fix, same 3-loop scenario: raw events = 3,
  but `totalDetentionFeesCAD` correctly stayed at $1,631 and `billableStops` at 1.
  **Testing note**: this DB uses `journal_mode = WAL` (`schema.ts`); deleting `*.sqlite-wal` between
  a write and a read (as ad hoc verification steps in this project sometimes did) discards
  uncommitted writes and can look like data loss that isn't a real bug — don't delete the WAL file
  mid-test, only before a fresh run.

## v1.1.18 — new feature (closes a real gap)

- **Empty-mile "solution" implemented, not just detection** — `likelyEmptyReturnLegs` had existed
  in `/api/edge-cases` since Phase 5-ish but was **never rendered anywhere in the frontend**, and
  even where it existed it was only a list of at-risk legs with no next step — exactly the gap the
  brief's "Deadhead & Empty Mile Reduction: proximity-based load matching" bullet asks to close
  (its own example: pairing a Milton->London delivery with a London->Kitchener return).
  - New `GET /api/empty-mile-matches/:tripNumber` — given an empty-risk leg, finds real dispatch
    rows whose pickup geofence is within 80km of that leg's delivery point (haversine distance,
    same formula already used by `/api/match`), returns up to 5 candidates sorted by connection
    distance, each with `legDistanceKm` and a flagged-as-assumption `potentialRevenueCAD`
    ($2.50/km, same transparency treatment as the existing $75/h detention rate assumption).
  - `EdgeCases.tsx` now has a 4th section, "Likely Empty-Return Legs" (previously absent entirely),
    listing real at-risk legs; clicking one opens `EmptyMileMatchModal.tsx` showing the real
    candidate return loads for that specific leg.
  - Verified against real data: trip 622793 (North York -> Milton, flagged emptyMileRisk >= 60)
    returns 5 real candidate loads picking up in Milton, ranging 2-96km leg distance.

## v1.1.19 — new feature

- **Empty-mile return-load search radius is now configurable** — new `emptyMileMatchRadiusKm`
  setting (default 80km) in ⚙ Settings, replacing the hardcoded `80` in
  `/api/empty-mile-matches/:tripNumber`. The response now also echoes back `searchRadiusKm` so the
  modal's copy ("within Xkm") always matches whatever is actually configured, instead of a
  hardcoded "80km" string that could drift from the real filter. Verified: setting the radius to
  `-1` (impossible for any real distance to satisfy) correctly drops candidates to 0, confirming
  the setting genuinely drives the filter rather than just being cosmetic.

## v1.1.20 — new feature + settings reorganization

- **Two more hardcoded assumptions are now configurable**: `detentionRatePerHourCAD` (was a
  hardcoded `75` in `simulation/engine.ts`) and `emptyMileRevenuePerKmCAD` (was a hardcoded `2.5` in
  `server.ts`). Both live in the same `Thresholds`/Settings system as everything else.
  - `emptyMileRevenuePerKmCAD` is computed fresh on every `/api/empty-mile-matches` request, so a
    Settings change is reflected immediately. Verified: changed to 10, a 14km candidate's
    `potentialRevenueCAD` correctly became 140.
  - `detentionRatePerHourCAD` is read at the moment `simulation/engine.ts` logs a `depart` event, so
    it only affects *future* events — fees already written to `geofence_events` are historical and
    are not recalculated. Verified: changed to 200 mid-run, the next new depart event on trip 618819
    correctly logged $4,350 ((23.75-2)*200), while three earlier events from before the change kept
    their original $1,631.25 ((23.75-2)*75) — exactly the "don't retroactively re-bill" behavior
    described when this was first explained.
  - Also connected `detentionThresholdHours` (the "free hours" setting) to actual behavior — it
    existed as a Settings field since the original v1.1 batch but was never wired to anything; the
    engine used a separate hardcoded `DETENTION_FREE_HOURS = 2` constant. Both now read the same
    Settings value.
- **Settings modal reorganized into categories** — HOS / Delay / Detention / Empty Mile / Dashboard
  display / Risk level boundaries, each its own card with a colored dot (matching the accent colors
  already used in the Risk Score Drivers panel), instead of one long undifferentiated list now that
  there are 9 individual values plus 3 risk-level boundaries.
- **Save now invalidates every dependent query**, not just the ones that existed when Settings was
  first built — added `detention-summary` to the invalidation list alongside the existing
  `summary`, `edge-cases`, `risk-high`, `risk-top`, `empty-mile-matches`. The Detention Billing info
  tooltip's formula/example numbers are now also live-bound to the actual configured free-hours and
  rate instead of always showing "2h" and "$75/h" as static text regardless of what's configured.

## v1.1.21 — new feature: Analyze Route Conditions

Implements the full spec: preserves the existing XGBoost Base Risk Score unchanged, adds a
separate real-time Traffic + Weather adjustment layer on top, and a Claude recommendation scoped
to those conditions. Does not touch `risk_engine.py` or any existing model/SHAP code.

- **`backend/route-conditions/ontario511.ts`** — real integration for
  `GET https://511on.ca/api/v2/get/event?key={key}&format=json` (verified against current public
  511on.ca docs: real field names RoadwayName/EventType/IsFullClosure/Latitude/Longitude). Events
  are matched to the requested trip's corridor by sampling points along the straight line between
  its origin and destination geofences and keeping events within a configurable radius (25km,
  `[ASSUMPTION]`) of the nearest sample point — a simplification since the brief doesn't ask for a
  real routing API. `classifyTrafficSeverity()` buckets each event into major/closure/
  construction/minor/roadCondition via keyword + `IsFullClosure` matching, since the real API's own
  `Severity` field is inconsistently populated in practice (frequently `"Unknown"` in real samples).
- **`backend/route-conditions/weather.ts`** — real integration for
  `GET https://api.openweathermap.org/data/2.5/weather?lat&lon&appid&units=metric` (verified
  against current OpenWeather docs: real fields weather[0].main, visibility, wind.speed,
  rain['1h']/snow['1h']). `classifyWeatherFlags()` derives heavyRain/snow/ice/highWind/
  lowVisibility booleans from configurable-in-code thresholds (all `[ASSUMPTION]`, same treatment
  as the detention rate / empty-mile revenue rate).
- **`backend/route-conditions/scoring.ts`** — pure point-value functions. Weights were reverse-
  engineered to reproduce the brief's own worked example exactly: 1 major incident (+4) + 2
  construction zones (+2 each) = Traffic Adjustment +8; heavy rain (+3) + <1000m visibility (+2) =
  Weather Adjustment +5 — verified this generalizes correctly for any Base Risk Score, not just the
  brief's Base=74 example (tested against trip 618819's real Base=20 -> Adjusted=33 = 20+8+5).
- **`backend/ai/route-recommendation-service.ts`** — separate Claude call from the existing
  `recommendation-service.ts` (that one explains the SHAP-based Base Score; this one is scoped to
  what to do about current traffic/weather). Has the same `MOCK_CLAUDE` support as the existing
  service.
- **New endpoint** `GET /api/route-conditions/:tripNumber` orchestrates all of the above.
- **`MOCK_ROUTE_CONDITIONS=true`** (or simply not setting `ONTARIO511_API_KEY`/
  `OPENWEATHERMAP_API_KEY`, which auto-falls-back to mock) returns realistic synthetic conditions
  personalized with the trip's real origin/destination names, via `route-conditions/mock.ts` —
  needed because this sandbox can't reach `511on.ca` or `api.openweathermap.org` (not on the
  network allowlist) to test the live integration directly.
  **Note the two mock flags are independent**: `MOCK_ROUTE_CONDITIONS` only fakes traffic/weather;
  `MOCK_CLAUDE` only fakes the recommendation call. Verified: with neither key set and
  `MOCK_CLAUDE` unset, traffic/weather correctly fall back to mock but the recommendation step
  correctly attempts (and fails with a real 401 on) the live Anthropic endpoint — set both flags
  together to exercise the fully-mocked path end to end.
- **Frontend**: new `RouteConditionsPanel.tsx`, added below `WhatIfPanel` in the risk detail
  section. "Analyze Route Conditions" button; results show Risk Impact (Base/Traffic/Weather/
  Adjusted), Traffic Conditions, Weather Conditions, a "Route Condition Factors" list kept visually
  separate from the existing "Top SHAP factors" list (per the brief's explainability-separation
  requirement), and the AI recommendation. Same stale-state reset on trip switch as `WhatIfPanel`
  (Phase/v1.1.5 lesson applied proactively here rather than needing to be reported as a bug again).
- **Real API integration is unverified against live traffic/weather data** (only the mock path was
  tested end-to-end in this environment) — get free keys at
  https://511on.ca/developers/doc and https://openweathermap.org/api and verify against real data
  before relying on this in production.

## v1.1.22 — new feature: PDF Reports

- **Per-trip PDF report** — `POST /api/report/trip/:tripNumber`, "Download PDF Report" button below
  Route Conditions in the risk detail panel. Always includes the Base Risk Score and Top SHAP
  Factors (looked up server-side); the What-if and Route Conditions sections are only included if
  the dispatcher actually ran them for that trip — omitted entirely otherwise, not shown as
  "not run" placeholders, per explicit direction. The frontend tracks the latest What-if/Route
  Conditions result per trip in the shared dashboard store (`lastWhatIf`/`lastRouteConditions`,
  cleared on trip switch same as `selectedCandidate`) and sends whichever exist along with the
  report request.
- **Fleet-wide summary PDF report** — `GET /api/report/summary`, "Download Fleet Summary" button in
  the header. Gathers KPIs, the full High Risk Loads list, Edge Case Discovery counts, and
  Detention Billing totals fresh at request time from the same live data every dashboard panel
  reads.
- Built with `pdfkit` (Node-native, no headless browser needed) in a new `backend/reports/`
  module, using a print-friendly light theme rather than the app's dark UI colors.
- **Two real pdfkit bugs found and fixed via visual QA** (rendered every generated PDF to images
  and looked at them, not just checked they returned 200):
  1. Positioned `.text(str, x, y)` calls move pdfkit's internal cursor to wherever that text ended,
     not back to the left margin (unlike flowing `.text(str)` calls). The first version of
     `kvRow()` read `doc.x` as its anchor each time, so every row after the first drifted further
     right across the page instead of stacking vertically. Fixed by always anchoring to an explicit
     `PAGE_MARGIN` constant and manually resetting `doc.x`/`doc.y` after positioned calls.
  2. pdfkit auto-paginates based on the document's margins even for explicitly-positioned text, so
     drawing the footer inside the bottom margin zone (as any footer must) was silently pushing a
     blank extra page onto the end of every report. Fixed by temporarily zeroing
     `doc.page.margins.bottom` while drawing the footer. Verified: all three report variants
     (bare trip report, trip report with What-if + Route Conditions, fleet summary) now generate
     as exactly 1 page each (`pdfinfo` confirmed).

## v1.1.23 — UI change

- **Clicking a leg in the "High Risk Loads" banner list now scrolls to the risk detail section** —
  previously the modal just selected the trip and closed, leaving the dispatcher looking at the KPI
  banner area with no visual indication that anything happened below the fold. Added
  `id="risk-detail-section"` to the "Risk explanation & AI recommendation" card and a
  `scrollIntoView({ behavior: "smooth", block: "start" })` call in `HighRiskLoadsModal`'s pick
  handler, deferred one tick (`setTimeout(..., 50)`) so it targets the section after the modal has
  unmounted and the newly-selected trip has rendered, not the stale pre-selection layout.

## v1.1.24 — bug fix (Ontario 511 doesn't require an API key)

- **Corrected a wrong assumption about the Ontario 511 API**: the original Route Conditions
  implementation assumed a `key=` query parameter (modeled after sibling 511 platforms in other
  regions), gated behind an `ONTARIO511_API_KEY` env var. Verified directly against the live docs
  at https://511on.ca/help/endpoint/event — its URI Parameters table lists only optional
  `format`/`lang`, no key at all. `fetchOntario511Events()` no longer takes or sends an API key;
  `ONTARIO511_API_KEY` removed from `.env.example` entirely.
- **`EventType` corrected to the real fixed 3-value enum** (`roadwork` | `closures` |
  `accidentsAndIncidents`, confirmed from the same docs page's response schema and sample) —
  previously used free-text guesses like `"incident"`/`"closure"` that don't actually appear in
  real API responses. `classifyTrafficSeverity()` now switches on the real enum first, using
  `Description` keywords only to distinguish severity *within* a bucket (e.g. "major" vs "minor"
  within `accidentsAndIncidents`), not to guess the bucket itself. Updated `mock.ts` to emit the
  real enum values too.
- **Traffic and weather now mock independently** instead of one combined flag: since Ontario 511
  needs no key at all, real traffic data is now fetched whenever `MOCK_ROUTE_CONDITIONS` isn't
  forced on — regardless of whether `OPENWEATHERMAP_API_KEY` is configured. Weather still falls
  back to mock on its own if that key is missing. The response now includes `dataSourceDetail:
  {traffic, weather}` so the UI can show which half is real; `RouteConditionsPanel.tsx`'s notice
  reflects this. Verified: with `MOCK_ROUTE_CONDITIONS=true` the full mocked flow still reproduces
  the brief's exact worked example (Traffic +8, Weather +5); with no env vars set at all, the
  endpoint now genuinely attempts the real (keyless) 511 call rather than silently mocking it —
  confirmed it fails with a real network error in this sandbox (511on.ca isn't on the network
  allowlist here) rather than never being attempted, which is the correct behavior to verify from
  code review even though the live call itself couldn't be exercised end-to-end in this
  environment.

## v1.1.25 — bug fix

- **Real error details were being silently discarded on every failed API call, not just Route
  Conditions** — `getJson()` (used by nearly every data hook in the app) only ever threw
  `Error("<url> -> <status>")` on a non-2xx response, ignoring whatever `error`/`detail` JSON the
  backend actually sent back. Reported symptom: a real `MOCK_ROUTE_CONDITIONS`-off, real-key
  attempt at `/api/route-conditions/:tripNumber` surfaced only "-> 502" with a stale hint
  mentioning `ONTARIO511_API_KEY` (which Phase v1.1.24 already established isn't a real thing) —
  the actual underlying exception (e.g. an OpenWeather 401) was never visible anywhere. Fixed:
  `getJson()` now parses the failed response's JSON body and surfaces its `detail`/`error` field;
  `RouteConditionsPanel.tsx`'s error hint updated to no longer reference the removed
  `ONTARIO511_API_KEY`.
  **Likely root cause of the reported case**: OpenWeather API keys generally take 10 minutes to 2
  hours after signup before they actually authenticate — a brand-new key correctly formatted still
  returns 401 until then. Verified the request itself is correct against OpenWeather's current
  public docs (endpoint, required `lat`/`lon`/`appid` params, `units=metric`, and the
  `weather[0].main`/`visibility`/`wind.speed`/`rain['1h']` response fields all match).

## v1.1.26 — bug fix

- **Diagnosed with the reporter**: a direct browser call to
  `https://api.openweathermap.org/data/2.5/weather?q=Toronto&appid=<key>` returned a valid 200
  response with the same key that was failing with 401 through this app — meaning the key itself
  was valid and active, but something was getting lost between `.env` and the actual outgoing
  request. The most common cause of exactly this symptom is a stray trailing newline or space
  picked up when copying a key into `.env` from a terminal or certain editors — `dotenv` preserves
  it verbatim, so `"abc123\n"` gets sent as the `appid` and OpenWeather correctly rejects it.
  Fixed defensively: `process.env.OPENWEATHERMAP_API_KEY` is now `.trim()`-ed once in
  `server.ts` before being used for the "do we have a real key" check and passed to
  `fetchWeather()`, eliminating this whole class of copy-paste issue regardless of which specific
  editor or terminal introduced the stray whitespace.

## v1.1.27 — hardening (not a bug this time)

- **Applied the same defensive `.trim()` fix to `ANTHROPIC_API_KEY`** in both
  `recommendation-service.ts` and `route-recommendation-service.ts`, for the same reason it was
  applied to `OPENWEATHERMAP_API_KEY` in v1.1.26 — cheap insurance against the same copy-paste
  whitespace class of bug, wherever an API key is read from `.env`.
- **Confirmed with the reporter this specific case wasn't that bug**: the `Claude API error 401:
  API key is invalid` seen after Route Conditions' traffic+weather succeeded was because
  `ANTHROPIC_API_KEY` genuinely wasn't set yet, not a whitespace issue — expected behavior, not a
  defect. Two ways forward documented for this case: set `MOCK_CLAUDE=true` to exercise the full
  flow without a real key (traffic/weather stay real, only the recommendation text is mocked), or
  add a real key from console.anthropic.com. This also confirms the v1.1.25/26 fixes worked
  end-to-end: real Ontario 511 traffic + real OpenWeather data now flow all the way through to the
  point of calling Claude, which is as far as this app's own code is responsible for.

## v1.1.28 — UI change

- **Route Conditions results were overwhelming with real data** — a real Ontario 511 call on a
  busy HWY 401 corridor returned 45 separate events, all rendered as a flat list under both
  "Traffic Conditions" and "Route Condition Factors" at once (confirmed by the reporter's actual
  output). Fixed: both sections now show a compact summary by default —
  Traffic Conditions shows per-tier count badges (Major/Closures/Construction/etc., using the
  `trafficConditions.breakdown` the backend already computed) with a "Show details (N)" toggle to
  reveal the full list; Route Condition Factors shows a count with the same toggle pattern. Both
  collapse again automatically when a different trip is selected or "Analyze" is re-run.
- **"Analyze Route Conditions" now always makes a fresh API call on click** instead of only firing
  once and then quietly serving a cached result on subsequent clicks — `useRouteConditions()` is
  now a manual-only query (`enabled: false`, `staleTime`/`gcTime: 0`) triggered explicitly via
  `refetch()` in the button handler, since real traffic/weather conditions change over time and a
  stale cached analysis could show conditions that no longer apply.

## v1.1.29 — bug fix

- **Literal `"<null>"` strings were leaking into the UI** — confirmed against the real data: 2
  drivers (Driver60, Driver129) genuinely have the literal string `"<null>"` as `LAST_SAT_LOC` in
  the source export (not an actual SQL NULL, which the existing `?? "—"` fallbacks already
  handled). Screenshotted by the reporter in both the Driver List modal and the Edge Case
  Discovery "Already Over HOS Legal Limit" list. Fixed with a new shared `cleanLoc()` helper in
  `hooks.ts` (treats `null`/`undefined`/`"<null>"`/whitespace-only as the same "—" case) applied
  everywhere `LAST_SAT_LOC` is rendered: `DriverListModal.tsx`, `EdgeCaseModal.tsx`, and both
  driver lists in `EdgeCases.tsx`. Also fixed `DriverListModal`'s Location column *sort* to treat
  `"<null>"` the same as a real null (previously it sorted alphabetically by the literal string,
  landing these two rows in an arbitrary position among real location names instead of consistently
  with other missing values). This is a display-layer fix only — the raw `"<null>"` value is left
  untouched in the database and API responses, exactly like the existing `NAME != '<null>'` SQL
  filters elsewhere in this codebase leave the underlying dispatch data untouched too.

## v1.1.30 — new feature + UI change

- **"Get AI recommendation" now factors in Route Conditions when available** — previously the main
  "Risk Explanation & AI Recommendation" panel's Claude call only ever saw the Base Risk Score +
  SHAP + optional What-if candidate, completely ignoring a Route Conditions analysis run for the
  same trip. `getRecommendation()` now takes an optional `routeConditions` parameter; the system
  prompt tells Claude the base score is XGBoost-derived and route conditions (if present) are
  real-time and separate from it, and the user prompt includes the actual Traffic/Weather
  Adjustment values and factors when available. Verified in `MOCK_CLAUDE` mode: with route
  conditions provided, the mock summary correctly appends "Real-time route conditions add +8
  traffic and +5 weather, adjusting the score to 33 (Major collision on HWY 401 Westbound near
  WHITBY, ON)" and a route-conditions-derived risk item and recommendation both appear; with none
  provided, output is byte-for-byte the same as before this change. `App.tsx` now sends
  `routeConditions: lastRouteConditions` alongside `candidateDriver` on every call, and the "Will
  include:" hint above the button lists both when present.
- **Button renamed** "Get Claude AI recommendation" → **"Get AI recommendation"** (loading state
  "Asking Claude…" → "Asking AI…"); a related hint string in `WhatIfPanel.tsx` ("...if you ask
  Claude for a recommendation") updated to match for consistency.
- **Re-confirmed** (not new — shipped in v1.1.22, re-verified here): the PDF trip report already
  includes the Route Conditions section whenever `lastRouteConditions` is set in the dashboard
  store, exactly the same data now also feeding the AI recommendation above.

## v1.1.31 — new feature (real gap found via user question)

- **What-if candidates now show a real schedule-conflict warning** — the driver-matching logic
  (distance, HOS, live duty status) never checked whether a candidate already has *another* trip
  whose real pickup/delivery window overlaps the leg being reassigned. Confirmed with real data on
  trip 618819: **4 of the top 5 candidates by distance were already double-booked** — only the
  closest one (Driver56) was genuinely free. `/api/match/:tripNumber` now looks up the target
  trip's real `PICKUP_BY`/`DELIVER_BY` window (order-level fields, consistent across all legs of
  that trip) and, for each candidate, checks the `dispatch` table for any other trip assigned to
  that driver whose window overlaps it (standard interval-overlap test: `start < targetEnd &&
  end > targetStart`). Each candidate now carries `scheduleConflict: {tripNumber, pickupBy,
  deliverBy} | null`. `WhatIfPanel.tsx` shows a "⚠ Double-booked" badge plus the conflicting
  trip's window inline in the candidate list, and repeats the warning in the before/after result
  if the dispatcher picks a conflicted candidate anyway (their call to make, but not silently).
  **Known limitation, stated plainly**: this dataset's leg-level scheduling fields
  (`LS_LEG_STAT`, `LS_PLANNED_DEPARTURE`) turned out to be uniformly `"FINISHED"`/midnight-only
  and useless for this purpose — the check instead uses the order-level `PICKUP_BY`/`DELIVER_BY`
  fields, which do carry real time-of-day granularity.

## v1.1.32 — bug fix (real user confusion, screenshot-reported)

- **"Return-load candidates" modal was implying the wrong thing is being recommended** —
  screenshotted: each candidate showed "Trip 622773 · Driver59", which reads as "reassign this to
  Driver59" or "this involves Driver59." In reality the feature recommends **loads (trips)**, not
  drivers — the driver name shown was just whoever that load happened to be historically dispatched
  to in the raw data, entirely irrelevant to whether the *current* driver (e.g. Driver123) could
  pick it up on the way back. Fixed: removed the driver name from each candidate row entirely;
  modal title now reads "Return-load candidates for {driver}" and the intro sentence explicitly
  states "These are real loads — not other drivers." Backend field renamed
  `driverName` → `originalDriverName` on each candidate (still returned for internal/debug
  reference, no longer implies relevance to the recommendation) to make the distinction
  unambiguous in the API too, not just the UI.

## v1.1.33 — new feature

- **"Highest risk legs" list now shows departure/ETA dates** — added `pickupBy`/`deliverBy` to
  both `/api/risk/top` and `/api/risk/high`, via the same "(trip, driver) -> value, built once at
  startup" map pattern already used for `distanceKm` (real order-level `PICKUP_BY`/`DELIVER_BY`
  fields, consistent across every leg row of a trip). Displayed as "Depart {date} · ETA {date}"
  under the route line in `App.tsx`. New shared `fmtSchedule()` helper in `hooks.ts` — since some
  legs in this dataset only carry a date (time defaults to midnight) while others have real
  hour:minute precision, it only shows the time portion when it isn't exactly midnight, so a
  date-only row doesn't misleadingly display "12:00 AM" as if that were a real recorded time.

## v1.1.34 — UI change

- **Selected trip in "Highest risk legs" was hard to spot** — the only visual difference was a 1px
  border color change (`--border` → `--border-strong`), easy to miss especially scrolling through a
  long list. Now the selected row gets an indigo background tint, indigo border, a subtle ring, and
  a small indigo dot next to the trip number — matching the indigo highlight already used for the
  "Adjusted" score box in the Route Conditions panel, for visual consistency with how this app
  marks "the thing that's currently active" elsewhere.

## v1.1.35 — new feature (closes a reviewed gap)

- **"Active loads" KPI banner is now clickable, opening a new "All Legs" browsable/searchable
  modal** — filled the gap identified on review: none of the three existing leg-related lists
  ("Highest risk legs" = top N only, "High Risk Loads" = above-threshold only, "Find a load" =
  live-tracking search capped at 25 results) let a dispatcher browse or search the full dataset by
  risk. The driver side already had this pattern (Total/Available Drivers → `DriverListModal`,
  sortable, full list); legs had no equivalent.
  - New `GET /api/legs/all?q=&sortKey=&sortDir=&limit=` — server-side search + sort, since the
    4,335 deduped (trip, driver) pairs (out of 10,479 raw rows) is too many to ship to the client
    and sort there the way the 169-driver list does. Built on a new `allLegsDeduped` precomputed
    array (same dedup + distance/schedule join used elsewhere, done once at startup); risk `level`
    computed per-request from current Settings thresholds, not baked into the precompute, so it
    stays live if thresholds change.
  - **Found and fixed the same `"<null>"` data-quality bug in a new place while building this**:
    349 legs have the literal string `"<null>"` as `DRIVER_NAME` (not real SQL null) — sorting by
    driver name put them first every time regardless of direction ('<' sorts before real letters).
    Fixed by treating `"<null>"`/empty as "missing" and always sorting missing values to the end,
    independent of `sortDir` — verified: ascending now correctly starts at "Driver1", descending at
    "Driver99", instead of both starting with `<null>`.
  - New `AllLegsModal.tsx`: sortable column headers (same click/click-again/▲▼ pattern as
    `DriverListModal`), search box, click a row to select that trip + scroll to the risk detail
    section (same pattern as `HighRiskLoadsModal`), and an honest "Showing top 100 of 4,335 — refine
    your search" note when the result set is capped.

## v1.1.36 — rename

- **Tool renamed "RoadStar AI Dispatch Advisor" → "RoadPilot AI Dispatch Advisor"** throughout the
  entire codebase, not just user-facing text: app header, browser Info panel, driver app header and
  notifications, PDF report titles/footers and downloaded filenames (`RoadPilot_Trip_*.pdf`,
  `RoadPilot_Fleet_Summary_*.pdf`), Claude system prompts ("You are RoadPilot's AI Dispatch
  Copilot"), FastAPI ML service title, every doc-header comment across the Python/TypeScript
  source, `MASTER_PROMPT.md`, and this README. Also renamed the things that aren't really
  "branding" but were still named after the old tool name: the SQLite database file itself
  (`data/roadstar.sqlite` → `data/roadpilot.sqlite`, updated in all 4 places that open it), the
  three `localStorage` keys (`roadstar-theme`/`roadstar-feature-labels`/`roadstar-live-updates` →
  `roadpilot-*`, meaning any previously-saved theme/label/live-updates preference in a browser will
  reset to default once — a one-time, low-stakes reset for an app this early-stage), and the
  backend's npm package name (`roadstar-backend` → `roadpilot-backend`, `package-lock.json`
  regenerated to match). Verified end-to-end against the renamed database: server starts
  ("RoadPilot backend listening..."), all endpoints return 200, and a generated PDF report's
  filename/title/footer all read "RoadPilot" correctly.

## v1.1.37 — bug fix + new features (user-reported confusion, root cause found)

- **"Top SHAP Factors" always explained detentionRisk, regardless of which sub-model actually
  drove the leg's risk** — root cause: `precompute.py` unconditionally called
  `explain_detention()` for every trip. This produced genuinely confusing output on real trips,
  e.g. a leg dominated by HOS violation still only ever showed detentionRisk's factors ("Schedule
  slack ↑ 131" reads oddly for a leg whose real problem was hours-of-service). Fixed:
  `explainability.py`'s `explain_detention()` generalized into `explain_risk(state, trip_number,
  model_name)`, callable for any of the 4 sub-models; `precompute.py` now picks whichever of
  hosRisk/delayRisk/detentionRisk/emptyMileRisk is that trip's actual highest sub-score and
  explains that one. Also added a `guardrail_applied` flag: when hosRisk is dominant *because* the
  hard compliance guardrail forced it (CAN_7 < 3h), the SHAP factors shown are still the underlying
  model's own reasoning, not the real reason for the score — now stated explicitly rather than
  silently presented as if SHAP explained it. Verified against real data: of the top-20 highest-risk
  legs, 20 are now correctly explained via hosRisk (mostly guardrail-forced) and 1 via
  detentionRisk — previously all 21 showed detentionRisk regardless.
  **Known scope limit, unchanged by this fix**: explanations are still only precomputed for the
  top-20 highest-risk legs + the demo trip (21 total out of 4,335), same as before — a leg reached
  via the new All Legs search/browse (v1.1.35) outside that set still has no SHAP explanation
  available.
- **Info icon added next to "Top SHAP Factors"** explaining exactly how to read the numbers (the
  value is the leg's real raw feature value, not a SHAP score; the arrow is that specific model's
  contribution direction, not the raw value's direction), which model is being shown for the
  current leg, and the guardrail caveat when it applies. The older shared panel-level tooltip's
  "Top SHAP Factors" blurb was trimmed to point here instead of duplicating/contradicting it.
- **New 4-axis risk radar chart** (`RiskRadarChart.tsx`, via `recharts`, already a project
  dependency) between the sub-score grid and Top SHAP Factors — HOS/Delay/Detention/Empty-Mile on
  the four axes, red/orange warning fill (`#f87171` @ 35% opacity, `#dc2626` stroke) so a
  larger/redder shape reads as more dangerous, "Total Risk: {score}" overlaid in the center, and a
  hover tooltip showing each axis's exact score (the always-visible exact numbers stay in the
  existing KPI grid above it, so precision isn't lost to the visual). Adds `recharts` to the bundle
  (~330KB before gzip) — noted, not addressed, since code-splitting it was out of scope here.

## v2.0.0 — feature removal + dashboard visibility settings

- **Removed: "Open driver app view"**. The separate `?view=driver` mobile page (`DriverApp.tsx`)
  and its header link are gone. The backend routes that only ever existed to serve that page
  (`/api/driver/:name/assignment`, `/status`, `/event`, `/events`) were removed too. The
  `driver_status` table and the `LEFT JOIN driver_status` used by the What-if candidate query are
  left in place (harmless no-op now — with nothing left to write duty status, every driver simply
  reads as available, which is the correct behavior for a build with no driver-facing app).
- **Removed: "Driver app activity"**. The dispatcher-dashboard feed of driver-app events/duty
  status (`DriverActivity.tsx`) is gone, along with its two backend routes (`/api/driver-activity`,
  `/api/driver-status/all`), since the only thing that ever populated them was the now-removed
  driver app.
- **New: Detention Billing panel visibility setting** (`Settings → Detention → "Show Detention
  Billing panel"`), **hidden by default**. `showDetentionBilling` was added to the persisted
  `Thresholds` config (SQLite `app_config`, same mechanism as every other threshold), defaulting to
  `false`. When hidden, the panel that used to sit next to Edge Cases is skipped and Edge Cases
  takes the full row instead of half; toggling it back on restores the original 2-column layout.
  This only hides the panel — detention math, billing, and the simulation engine are unaffected.
- **New: Quick Start section** at the top of this README with the exact copy-pasteable 5-step
  setup block, plus five double-clickable `.bat` files in the project root
  (`1-etl-ml-pipeline.bat` … `5-simulation-engine.bat`) that run the same commands without a
  terminal. The old "Running it locally" section further down was collapsed into a pointer to
  Quick Start to avoid two copies of the same instructions drifting out of sync.
- Version bumped to **2.0.0** across `frontend/package.json`, `backend/package.json`, and the
  in-app Info panel / header tagline.

## v2.0.1 — bug fix (user-reported, screenshot confirmed)

- **"Highest risk legs" showed a wrong/misleading distance for multi-stop trips** — e.g. Trip
  620258 showed "3km" for a WHITBY → OSHAWA leg. Root cause: a single (`TRIP_NUMBER`, `DRIVER_NAME`)
  pair can have several real dispatch rows for relay/multi-stop sub-legs with genuinely different
  distances (Trip 620258 alone shuttles back and forth 9 times, alternating between 2.6km and 0km
  per sub-leg) — but the deduped risk-score row shown in the UI carries no leg-level id, so there
  was no way to know which sub-leg's distance was "the" answer. The previous code silently used
  "first row wins," which is why an arbitrary (and here, misleading) number appeared. **Fixed**:
  the (trip, driver) → distance lookup now only keeps a value when every dispatch row for that
  pair agrees on the same distance; when they disagree, the pair is left out of the lookup and
  `distanceKm` comes back `null`, so the UI's existing `!= null` check simply omits the "· Xkm"
  text instead of showing an unreliable number. Applies consistently to "Highest risk legs", the
  All Legs modal, and the High Risk Loads modal, since all three read from the same lookup.
  Verified against the reported trips: 620258 (ambiguous: 0km/3km) now shows no distance; 620046,
  619905, and 619730 (each a single consistent 3km across their rows) are unaffected and still
  show "· 3km" correctly.

## v2.0.2 — UI change (follow-up to v2.0.1, user feedback)

- **Leg distance ("· Xkm") removed from the UI entirely** — "Highest risk legs", the All Legs
  modal, and the "Find a load" simulation search all previously showed a per-leg distance derived
  from `dispatch.LS_LEG_DIST`. v2.0.1 hid it only when a trip/driver pair's sub-legs disagreed on
  the distance; feedback was that even a "resolved" single value is still a source of confusion,
  since it's an arbitrary sub-leg pick with no guarantee it represents the whole trip. Simplified:
  the distance text and the All Legs modal's "Distance" sort column are removed everywhere in this
  family of views, full stop — no partial/conditional display. The backend's `distanceByTripDriver`
  lookup and the `distanceKm` field on `/api/risk/top`, `/api/legs/all`, and
  `/api/simulation/search` are left in place (unused by the UI now, harmless), in case a future,
  properly leg-scoped distance source replaces this.
  **Not affected**: the What-if panel's "Xkm away" for candidate drivers, which is a live haversine
  distance from a driver's real GPS position to the pickup geofence — a different, reliable
  calculation, not the ambiguous per-leg `LS_LEG_DIST` lookup this change removes.

## v2.0.3 — UI change + investigated user question ("HOS shows 99 for everything")

- **Button order in the Risk explanation & AI recommendation panel**: "Download PDF Report" moved
  from between "Analyze Route Conditions" and "Get AI recommendation" to the very bottom of the
  panel, after the AI recommendation result. New order: Analyze Route Conditions → Get AI
  recommendation (+ its result, if any) → Download PDF Report. Purely a layout change — the report
  still includes the latest What-if/Route Conditions results exactly as before.
- **Investigated: "HOS shows 99 for every trip in 'Highest risk legs'"** — not a bug, but a real
  finding worth documenting. Of 169 drivers, exactly 3 (`Driver13`: -43.75h, `Driver41`: -42.62h,
  `Driver60`: -59.7h remaining on their Canadian 7-day cycle) are already over their legal HOS
  limit. `risk_engine.py`'s compliance guardrail (`REMAINING_HOURS_CAN_7 < 0 → hosRisk = 99.0`,
  intentional — a driver already breaking the law shouldn't have hosRisk softened by whatever the
  ML model happens to predict) forces every trip belonging to those 3 drivers to hosRisk 99,
  regardless of the individual trip. Those 3 drivers alone have 49 + 64 + 6 = 119 distinct trips in
  the dataset, and because a 99 hosRisk score (0.30 weight) plus often-elevated detention/delay
  scores pushes nearly all of their trips into "highest risk" territory, they end up dominating the
  Top-20 by risk score entirely (12 + 5 + 3 = 20/20 in the current data) — which is why every row
  visible in "Highest risk legs" currently shows HOS 99. The underlying number is correct; the
  *symptom* (a top-risk list that shows one signal for every row and drowns out other risk types
  like detention-only or empty-mile-only legs) is a real UX gap, not a data error. No code changed
  for this — logged here pending a decision on whether/how to address it (see README discussion).

## v2.0.4 — new feature (resolves the v2.0.3 finding)

- **Chronic HOS-violation drivers separated out of "Highest risk legs" into the existing "Already
  Over HOS Limit" edge-case banner/modal**, as decided after the v2.0.3 investigation.
  - `/api/risk/top` now excludes any trip whose driver has `REMAINING_HOURS_CAN_7 < 0` by default
    (the same 3 drivers — `Driver13`, `Driver41`, `Driver60` — identified in v2.0.3), so the panel
    shows a varied cross-section of risk types instead of the same always-hosRisk-99 drivers
    repeated. An `?includeHosViolations=true` query param restores the old unfiltered ranking if
    ever needed (nothing in the app uses it today). Scope note: this only excludes drivers already
    *over* the legal limit — the separate "About to Run Out of HOS" bucket (drivers between 0-3h
    remaining) is untouched and can still appear in "Highest risk legs," since that wasn't part of
    what was reported.
  - `/api/edge-cases`'s `driversAlreadyInHosViolation` now carries each driver's own deduped,
    highest-risk-first `trips` list (not just the driver-level HOS number as before) — the exact
    trips removed from "Highest risk legs" moved here instead of disappearing.
  - **"Already Over HOS Limit" modal** (`EdgeCaseModal.tsx`) is now expandable: click a driver to
    reveal their trip list inline, click a trip to select it and jump straight to the risk-detail
    section — the same select-and-scroll pattern the All Legs modal uses. A short explanatory line
    at the top of the modal states why these trips live here instead of in the main risk list.
  - "Highest risk legs" panel gained a one-line caption pointing to the banner, so the exclusion
    isn't silent.

## v2.0.5 — UI change (supersedes v2.0.4's exclusion approach)

- **"Highest risk legs" now shows two lists side by side instead of excluding chronic-violation
  drivers**: "HOS = 99" and "HOS ≠ 99", each independently sorted by risk score and capped at the
  existing "rows to show" setting. This replaces v2.0.4's approach of hiding chronic-violation
  drivers' trips entirely — both risk types stay visible in the same panel, just no longer mixed
  into one ranking where HOS 99 legs drowned out everything else.
  - `/api/risk/top`'s response shape changed from a flat array to `{ hos99, other }`, split by
    whether `Math.round(hosRisk) === 99` — the same rounding the UI's `fmtRisk()` already uses, so
    the split matches exactly what a dispatcher sees on screen (e.g. a leg whose hosRisk rounds to
    100 correctly lands in the "≠ 99" list, since it displays as "100," not "99"). The
    `?includeHosViolations=true` escape hatch from v2.0.4 no longer applies to this endpoint (both
    groups are always returned now) and was removed.
  - `driversAlreadyInHosViolation`'s embedded `trips` in `/api/edge-cases` (added in v2.0.4) is left
    in place — the "Already Over HOS Limit" banner/modal drill-down is still useful for a
    compliance-focused view of just those 3 chronic-violation drivers, even though their trips are
    no longer hidden from "Highest risk legs."
  - Row rendering for both lists shares one function (`renderLegRow`) instead of duplicating the
    leg-card JSX, so future changes to how a leg row looks only need to happen in one place.

## v2.0.6 — bug fix + UI change (user-reported, screenshot confirmed)

- **Split threshold corrected: raw `hosRisk >= 99`, not `Math.round(hosRisk) === 99`.** v2.0.5's
  rounding meant a leg at 99.9 (which *displays* as "100") fell into the "≠99" list instead of the
  severe-HOS list, missing the actual intent of the split — grouping all maxed-out/guardrail-forced
  HOS legs together regardless of exactly where they round to. `/api/risk/top` now filters on the
  raw value; the two lists are relabeled "HOS ≥ 99" and "HOS < 99" to match.
- **"Top SHAP Factors" was rendering as an empty, unexplained blank** for legs outside the
  historically-precomputed set (`data/explanations.json` only covers the top-20-by-score-at-time-
  of-training + one demo trip — confirmed via the reported trip, 620641/Driver114, riskScore 50.2,
  which was never in that set). Now shows an explicit message — "No SHAP explanation was
  precomputed for this leg…" — instead of nothing, so it reads as an intentional data-coverage
  limit rather than a broken panel. `backend/ml/precompute.py` was also updated so a *future*
  regeneration of `explanations.json` covers the union of both new split lists (top-30 per list by
  `hosRisk >= 99` / `< 99`, well above the default 10-row Settings value) instead of one flat
  top-20 — this does not change what's shipped today, only what a future pipeline run produces.
  **While testing this**, an attempted regeneration surfaced a real ML-pipeline reproducibility bug
  (see "Known data caveats" below) — the shipped `data/*.json` were restored to their original,
  previously-verified values rather than risk shipping numbers that don't match this project's own
  history.
- **Layout: radar chart moved to the right, "Top SHAP Factors" list to the left**, side by side
  (previously stacked, chart above the list). No functional change, purely visual.

## v2.0.7 — correction to v2.0.6 (the "SHAP factors can't be loaded" claim was wrong)

- **Correction**: v2.0.6 said legs outside `data/explanations.json`'s precomputed set simply have no
  SHAP explanation available. That was incomplete — `/api/risk/:tripNumber` already had a live
  fallback (precomputed → live ML microservice `/explain/{tripNumber}` → null) that this project
  had built earlier but which wasn't being surfaced correctly to the user. Verified directly: with
  the ML microservice running, `GET /explain/620641?driver=Driver114` (the exact trip from the
  screenshot) correctly returns a live SHAP explanation (guardrail-forced hosRisk, correctly
  attributing it to `REMAINING_HOURS_CAN_7 = 0.27`) — so it genuinely can be loaded, on demand, for
  any trip.
  - Frontend now shows a "live re-inference" badge next to "Top SHAP Factors" when the explanation
    came from the live path (vs. the instant precomputed one), and the info tooltip explains the
    two-tier lookup.
  - The "not available" fallback message was corrected to explain the real cause — the ML
    microservice (`2-ml-microservice.bat`, port 8000) not running or not responding in time — and
    to say try reselecting the leg once it's up, instead of implying the explanation is
    permanently uncomputable for that leg.

## v2.0.8 — new feature (extends v2.0.0's Detention Billing hide toggle to every section)

- **Settings → "Dashboard sections"**: every major dashboard section now has its own show/hide
  toggle, the same pattern v2.0.0 introduced for the Detention Billing panel (which moved into this
  new category alongside the rest, still defaulting to hidden). All others default to visible.
  - KPI banner (Active loads / Total drivers / Available drivers / High risk loads)
  - Edge case banners (Already Over HOS Limit / About to Run Out of HOS / Chronic Detention Zones)
  - Fleet Map
  - Simulation control (Analyze Route Conditions / Find a load)
  - Highest risk legs
  - Risk explanation & AI recommendation
  - Detention Billing panel (existing, relocated here)
  - Edge case discovery (the detailed HOS/detention/empty-mile write-up panel)
  - Feature importance
  - These only hide the section's UI — none of them stop the underlying data from being
    fetched/polled, so toggling one back on shows current data immediately, not stale data.
  - Two-column sections (Fleet Map+Simulation, Highest risk legs+Risk explanation, Detention
    Billing+Edge case discovery) collapse to a single full-width column when only one side is
    visible, instead of leaving a half-empty row.
  - Extracted a shared `ToggleRow` component so Live Updates and all 9 section toggles use the same
    switch UI instead of each hand-rolling one.

## v2.0.9 — new feature

- **Selecting a trip anywhere now draws that leg's route on the existing Fleet Map** — origin and
  destination markers (green/red) connected by a dashed line, with the map auto-flying to fit both.
  Reuses the Fleet Map already on the dashboard (per the request) rather than adding a second map
  view, and works from every trip-selection entry point since they all write to the same global
  `selected` state: "Highest risk legs," the All Legs modal, High Risk Loads modal, and the
  "Already Over HOS Limit" edge-case modal's drill-down.
  - New endpoint `GET /api/legs/:tripNumber/route` resolves `ORIG_ZONE_DESC`/`DEST_ZONE_DESC` to
    coordinates using the same city geofence lookup (`findGeofence`) Route Conditions, Empty Mile
    Matching, and the simulation engine already rely on — so it has the same known-cities
    limitation (Southern Ontario + a few frequently-appearing outside cities; see
    `backend/simulation/geofences.ts`). A leg whose origin or destination isn't in that list shows
    "No mappable route" on the map instead of silently drawing nothing or a wrong line.
  - A "📍 View this leg's route on the Fleet Map ↑" link was added to the Risk Explanation card so
    the map update (which happens above, in the Fleet Map section) isn't easy to miss below the
    fold; it's disabled with an explanatory label if the Fleet Map section has been hidden via the
    v2.0.8 section-visibility settings.
  - Live truck position markers (existing feature) and the selected leg's route now render
    together on the same map without conflicting.

## v2.0.10 — bug fix + UI change (user-reported, screenshot confirmed)

- **Split/display rounding mismatch fixed.** v2.0.9 split on the raw `hosRisk` value (`>= 99` /
  `< 99`) to correctly handle a leg at 99.9 (displays as "100," still counted as severe). That
  introduced the opposite edge case at the *lower* boundary: a leg with raw hosRisk 98.6–98.99
  rounds to "99" for display (`fmtRisk` uses `Math.round`) but failed the raw `>= 99` check, so it
  showed "HOS: 99" while sitting in the list labeled "< 99." Confirmed against real data: 4 legs
  (e.g. Trip 621243/Driver114 at 98.9) had exactly this mismatch. **Fixed** by splitting on
  `Math.round(hosRisk) >= 99` instead of the raw value — this handles both boundaries correctly
  (98.9 rounds to 99 → counted as severe; 99.9 rounds to 100 → still `>= 99`, also counted as
  severe), so the displayed number and the list it appears in can never disagree.
- **Layout: the two lists are now side-by-side columns** ("HOS ≥ 99" left, "HOS < 99" right)
  instead of stacked vertically, per the request. Leg rows in this two-column layout use a new
  compact variant (`renderLegRow(row, true)`) — smaller padding, one truncated route line, no
  depart/ETA line, no level-name badge — so a full trip card still fits in half the column width.
  The original full-detail row (used everywhere else: All Legs modal, edge-case modal drill-downs)
  is unchanged.

## v2.0.11 — bug fix (geofence coverage, user-reported)

- **Selecting a "HOS < 99" leg often showed "No mappable route" on the Fleet Map** — not actually a
  bug in the selection/routing code (which works identically for both lists), but a coverage gap:
  `backend/simulation/geofences.ts`'s city list skews Southern-Ontario-local, and the top-risk legs
  in the "HOS < 99" list are disproportionately long-haul US/cross-border destinations. Verified:
  the actual top-10 "HOS < 99" legs resolved a route for only 3/10 before this fix (Springfield MO,
  Groveport OH, Donna TX, Kenosha WI, San Marcos CA, Orlando FL, and Elliot Lake ON were all
  missing from the geofence list). Added 22 real, frequently-recurring `ORIG_ZONE_DESC`/
  `DEST_ZONE_DESC` cities with real coordinates — a mix of wider Ontario/Ottawa-area towns
  (Campbellville, Bancroft, Carleton Place, Stittsville, Nepean, Parry Sound, Elliot Lake, East
  Gwillimbury, Gatineau QC) and the recurring US long-haul destinations above plus Phoenix AZ,
  Morris IL, Richmond IN, Scottsville KY, Fairburn GA, Moreno Valley CA, and Whittier CA. Re-checked
  against the current data: both the "HOS ≥ 99" and "HOS < 99" top-10 lists now resolve a route for
  10/10 legs. Route Conditions, Empty Mile Matching, and the simulation engine benefit from the same
  wider coverage automatically, since they all share this one geofence list.

## v2.1.0 — model switch to Claude Opus 5 + package audit

- **AI recommendation features now call Claude Opus 5** (`claude-opus-5`) instead of the previously
  hardcoded `claude-sonnet-4-6`. Opus is the better fit here because a dispatch recommendation is a
  multi-factor operational judgement (HOS law + schedule slack + detention history + who else is
  actually available), where the quality of the tradeoff reasoning matters more than latency —
  this is a button the dispatcher presses deliberately, not a per-keystroke call.
- **New `backend/ai/model-config.ts` — one source of truth for the model.** The model string was
  duplicated across `ai/recommendation-service.ts` and `ai/route-recommendation-service.ts`, so
  changing models meant editing two files and they could silently drift apart. Both now import
  `anthropicModel()` from the shared module.
- **`ANTHROPIC_MODEL` env override added** (documented in `.env.example`). Leave it unset for the
  Opus 5 default; set it to fall back to a faster/cheaper model for demos without touching code
  (e.g. `ANTHROPIC_MODEL=claude-sonnet-5`). Blank or whitespace-only values fall back to the
  default rather than sending an empty model string.
- **Fixed: dashboard header version was stale.** The header hardcoded `v2.0` while the Info panel
  showed the real patch version — the two had been drifting apart since v2.0.0. `VERSION` is now
  exported from `InfoPanel.tsx` and used in both places, so a single edit updates both.
- Audit notes (checked, no change needed): no `TODO`/`FIXME` left in `backend/src`, `backend/ai`,
  or `frontend/src`; the frontend already enforces `noUnusedLocals`/`noUnusedParameters` and passes
  clean; no stale model references remain in code or docs; the `driver_status` `LEFT JOIN`s and
  `SimulationControl`'s `distanceKm` field are intentional leftovers documented in v2.0.0/v2.0.2
  (the API still returns `distanceKm`, only the UI display was removed) and were left as-is.

### Verification performed for this release

Because `better-sqlite3` needs a native build that this environment's network policy blocks, the
full server could not be booted here. The changed code was instead exercised directly:

- `anthropicModel()` unit-checked across 4 cases (unset / valid override / whitespace-only / empty)
  — all resolve as intended.
- Both AI services called with a stubbed `fetch` to capture the real request body: both confirmed
  to put `claude-opus-5` on the wire.
- `MOCK_CLAUDE=true` path re-checked with a `fetch` stub that throws if called — confirmed it still
  short-circuits before any network call and returns `source: "mock"`.
- `tsc --noEmit` (backend) and `tsc -b` + `vite build` (frontend) both clean.

## v2.1.1 — bug fix (regression from the v2.1.0 model switch, user-reported)

- **Fixed: `/api/route-conditions/:trip` failed with "Unterminated string in JSON at position 499".**
  Direct fallout from the v2.1.0 Opus 5 switch. The two AI services' token budgets (700 for route
  conditions, 1000 for risk recommendation) were tuned against `claude-sonnet-4-6`; Opus 5 writes
  longer, more detailed recommendations, so the reply hit `max_tokens` and was cut off mid-string.
  `JSON.parse()` then failed on the truncated text and surfaced a raw parser message that pointed
  at nothing useful — the suggested fix in the UI ("set MOCK_ROUTE_CONDITIONS=true") was also a red
  herring, since the traffic/weather fetch had actually succeeded and it was the *Claude* call that
  broke.
  - Token budgets raised and moved into `ai/model-config.ts` alongside the model string:
    `MAX_TOKENS_ROUTE_CONDITIONS = 1500`, `MAX_TOKENS_RECOMMENDATION = 2000` — set well above the
    observed output length rather than just barely adequate, so a future model that writes longer
    doesn't reintroduce this.
  - New `parseClaudeJson()` helper, used by both services, replaces the bare `JSON.parse()`. It
    checks the API's `stop_reason` first: on `"max_tokens"` it raises a "reply was cut off, raise
    the token budget" error naming the exact file to edit, instead of a misleading JSON syntax
    error. For genuinely malformed (non-truncated) output it reports the length and a 300-char
    preview of what actually came back, so the cause is visible from the error alone.
  - Both services now share one parse path, so this class of failure can't be fixed in one and
    left broken in the other — which is how the two different token budgets drifted in the first
    place.

### Verification performed for this release

Same constraint as v2.1.0 (`better-sqlite3` native build is blocked by this environment's network
policy, so the full server can't boot here). The changed code was exercised directly with a stubbed
`fetch`:

- **Reproduced the reported bug** by returning a reply cut off mid-string with
  `stop_reason: "max_tokens"` — confirmed it now raises the explicit token-budget error rather than
  a JSON syntax error.
- Non-JSON prose reply → reports the parse failure with a preview of the received text.
- Happy path → parses correctly and returns `source: "live"`.
- Confirmed on the wire: route conditions sends `max_tokens: 1500`, risk recommendation sends
  `max_tokens: 2000`, both with `model: claude-opus-5`.
- `tsc --noEmit` (backend) and `tsc -b` + `vite build` (frontend) clean.

## v2.1.2 — PDF report: radar chart added, Route Condition Factors removed

- **Removed the "Route Condition Factors" detail list** from the trip PDF report. The Route
  Conditions Analysis section keeps its numbers (Base / Traffic Adjustment / Weather Adjustment /
  Adjusted Risk Score) and the AI Recommendation; only the raw factor bullet list is gone.
  `routeConditionFactors` stays on `TripReportInput` and is still returned by the API — same
  approach taken with `distanceKm` in v2.0.2, where the display was dropped but the data contract
  was left intact.
- **Added a 4-axis radar ("방사형") chart** to the trip PDF, directly under the sub-risk breakdown.
  It mirrors the app's `RiskRadarChart` so the PDF and dashboard read the same way — HOS top, Delay
  right, Detention bottom, Empty Mile left, combined score in the centre, with grid rings at
  25/50/75/100 and each axis labelled with its own value.
  - Drawn as **vectors via pdfkit primitives**, not an embedded chart image — no headless browser
    or image-rendering dependency to add, and it stays sharp at any print resolution.
  - Follows the cursor-management rule already documented at the top of `pdfStyle.ts`: every
    `.text()` call here is explicitly positioned, so `doc.x`/`doc.y` are re-anchored by hand
    afterwards rather than trusted.
  - Values are clamped to 0-100 so a guardrail-forced hosRisk of 99/100 can't overshoot the ring.

### Verification performed for this release

The PDF was generated and **visually inspected** (rendered to image and looked at), not just
typechecked — which caught three things that would otherwise have shipped:

- The centre score was drawn on top of the translucent red polygon and was hard to read. Fixed by
  laying an opaque backing disc down first.
- The chart at its original size pushed the report onto a **second page** carrying only three
  bullets. Reduced the default size to 150pt so a full report with What-If + Route Conditions fits
  on one page again.
- The chart was left-anchored, which looked visibly off-balance against the full-width sections
  around it. Now centred on the page.

Also checked: an all-zero risk profile (degenerate polygon collapsing to the centre point) with no
What-If or Route Conditions sections renders cleanly on one page with no crash and no stray blank
page — the pdfkit footer/pagination pitfalls noted in `pdfStyle.ts` still hold.

## v2.1.3 — bug fix: stop Opus 5 replies from overrunning the token budget at all

v2.1.1 raised the token ceilings and made the truncation failure *legible*; it did not stop it
happening. Opus 5 still overran 1500 tokens on `/api/route-conditions` in the field, because the
prompts only asked for "concise" output without stating any actual limit. Three layers now, so the
failure both stops happening and stops being fatal when it does:

- **The prompts now state hard output caps** — a `HARD LENGTH LIMITS` block giving a character
  budget per field and a max item count per array (`summary` 400 chars, list items 160 chars each,
  max 5 items, plan 400, impact values 120). These live in `OUTPUT_LIMITS` in `ai/model-config.ts`
  next to the token budgets, so the two can't be changed independently by accident. This is the
  actual fix: the model now targets a bounded reply instead of writing until it's cut off.
- **Token budgets raised to ~3x the capped output** (`MAX_TOKENS_ROUTE_CONDITIONS` 1500 → 2500,
  `MAX_TOKENS_RECOMMENDATION` 2000 → 3000) — headroom, not a ceiling the model is expected to hit.
- **Truncated replies are now salvaged instead of thrown away.** `salvageTruncatedJson()` walks the
  reply recording every position where the JSON structure was settled along with the bracket stack
  at that point, then tries those cut points newest-first until one closes and parses. A reply cut
  off inside `recommendedActions` therefore still returns the summary plus the actions that did
  complete. `parseClaudeJson()` gates this on `requiredFields`, so a partial recovery missing the
  fields the UI needs still raises the clear error rather than returning something half-empty. The
  recovery is logged with `console.warn` so it's visible in the server log rather than silent.
  - Backtracking is used rather than one clever cut point because the failure shapes vary
    (mid-string, mid-key, trailing comma, truncated nested object) and a single-rule first
    implementation got several of them wrong when tested.

### Verification performed for this release

`salvageTruncatedJson()` tested against 8 truncation shapes — mid-string, mid-array after N
complete items, immediately after a complete item, dangling key with no value, trailing comma,
truncated nested object, escaped quotes inside a truncated string, and cut-before-anything-usable.
All either recover correctly or return nothing recoverable; none produce invalid JSON.

End-to-end through both services with a stubbed `fetch`:

- A truncated route-conditions reply that previously failed the whole request now returns
  `{summary, recommendedActions:[2 complete items]}` and logs the recovery warning.
- A reply truncated before any usable field still raises the explicit token-budget error.
- Untruncated replies parse exactly as before (no behaviour change on the happy path).
- Confirmed on the wire: route conditions `max_tokens: 2500`, risk recommendation `max_tokens: 3000`,
  both `model: claude-opus-5`, and the system prompt contains the `HARD LENGTH LIMITS` block.

## v2.1.4 — UI: icons on section titles

Every panel heading, modal title, KPI card and edge-case banner now carries an icon matching what
it actually shows. `lucide-react` was already a dependency (used only by the KPI trend arrows), so
this adds no new package.

- **Dashboard panels** — Highest risk legs (`TriangleAlert`, amber), Risk explanation & AI
  recommendation (`Sparkles`, indigo), Edge case discovery (`ScanSearch`, teal), Find a load
  (`PackageSearch`, sky), Risk Score Drivers (`BarChart3`, violet), Detention billing (`Receipt`,
  amber).
- **KPI cards** — Active loads (`Package`), Total drivers (`Users`), Available drivers
  (`UserCheck`, green), High risk loads (`TriangleAlert`, red).
- **Edge-case banners and the modals they open use the same icon** — Already Over HOS Limit
  (`ShieldAlert`, red), About to Run Out of HOS (`Clock`, amber), Chronic Detention Zones
  (`MapPin`, orange) — so a banner and the drill-down it opens read as the same thing rather than
  two unrelated screens.
- **Modals** — All Legs (`List`), High Risk Loads (`TriangleAlert`), Total/Available Drivers
  (`Users` / `UserCheck`, switching with the mode the modal is in), Return-load candidates
  (`Truck`).
- **Route Conditions sub-headings** — Risk Impact (`Gauge`), Traffic Conditions (`TrafficCone`),
  Weather Conditions (`CloudRain`), AI Recommendation (`Sparkles`, matching the AI icon used on the
  parent panel).

Consistency rules applied throughout: icon colour matches the semantic colour already on that
element (red for violations, amber for warnings, green for available), `size={17}` for panel
headings / `18` for modal titles / `13` for small uppercase labels, `shrink-0` so a long heading
never squashes the icon, and `aria-hidden="true"` on every one since each icon sits next to text
that already says the same thing — screen readers shouldn't announce it twice.

### Verification performed for this release

- `tsc -b` and `vite build` clean.
- Checked every `.tsx` for duplicate or misplaced `lucide-react` imports after the batch edit —
  all 12 files have exactly one, all at the top of the import block.
- Bundle impact measured rather than assumed: the App chunk went 548.98 kB → 556.71 kB
  (162.58 kB gzip, +2.3 kB), confirming the named imports tree-shake instead of pulling the whole
  icon set.

## v2.1.5 — held-out model evaluation (closes a real gap)

The project had **no model performance numbers at all**. `_train_one()` was creating a 20% test
split with `train_test_split(...)` and then discarding `X_test`/`y_test` — the model was fit on the
training half and the held-out half was never scored. "How well does the model actually perform?"
had no answer anywhere in the codebase.

- **`_train_one()` now evaluates on the split it was already making** and returns
  `(model, metrics)`: ROC-AUC, accuracy, precision, recall, F1, confusion matrix, train/test row
  counts, and the positive base rate of the test split. `train_all()` returns these under a new
  `metrics` key (additive — existing consumers reading `state["models"]` are unaffected).
- **New `backend/ml/evaluate.py`** writes `data/model_metrics.json` and prints a summary table.
  Deliberately kept separate from `precompute.py`: it writes **only** the metrics file and never
  touches `risk_scores.json` / `explanations.json` / `feature_importances.json`, because
  re-running the full precompute would silently replace the shipped, verified scores with
  different numbers (see the reproducibility caveat below).
- **New `GET /api/model/metrics`**, loaded defensively — a checkout that hasn't run `evaluate.py`
  still boots, logs a hint at startup, and the UI simply hides the panel rather than erroring.
- **New "Held-out model performance" table** in the Risk Score Drivers panel, with base rate shown
  alongside the scores and a tooltip explaining why accuracy is misleading on a rare label.

### The numbers, and what they actually say

| model | ROC-AUC | precision | recall | F1 | base rate |
|---|---|---|---|---|---|
| hosRisk | **1.000 ⚠** | 0.988 | 0.988 | 0.988 | 3.8% |
| delayRisk | 0.942 | 0.733 | 0.400 | 0.518 | 2.6% |
| detentionRisk | 0.877 | 0.826 | 0.787 | 0.806 | 55.0% |
| emptyMileRisk | 0.901 | 0.830 | 0.627 | 0.714 | 35.5% |

- **hosRisk's perfect AUC is a defect, not a result — and the metrics are what exposed it.** Its
  label is `hos_buffer_hours < 0`, and `hos_buffer_hours = REMAINING_HOURS_CAN_7 −
  est_drive_hours` (`feature_engineering.py:83`). Training drops the derived `hos_buffer_hours`
  column but **keeps both operands**, so the model only has to learn one subtraction to reconstruct
  the label exactly. Dropping the derived column is cosmetic here; the leakage the drop was meant
  to prevent is still present. The UI flags any AUC ≥ 0.999 in amber with an explanation rather
  than displaying it as a strength. **Not fixed in this release** — the fix is a modelling decision
  (drop one operand, or drop the hosRisk model and treat HOS purely as the compliance guardrail it
  already effectively is) and shouldn't be made silently.
- **delayRisk ranks well but catches less than half of real delays** at the default 0.5 threshold
  (AUC 0.942, recall 0.400). On a 2.6% base rate that is a threshold-tuning problem, not a broken
  model — the ordering is good, the cutoff is too conservative.
- **detentionRisk is the most honest of the four**: a near-balanced 55% base rate, so its 0.877 AUC
  and 0.806 F1 are earned rather than inflated by class imbalance.

### Verification performed for this release

- `tsc --noEmit` (backend) and `tsc -b` + `vite build` (frontend) clean.
- **Confirmed `evaluate.py` does not disturb the shipped data**: `risk_scores.json` md5 checked
  before and after every run — unchanged each time.
- Ran `evaluate.py` twice consecutively; all four AUCs were byte-identical, so the metrics table is
  stable rather than shifting each time it is regenerated. (This does not resolve the broader
  pipeline reproducibility caveat below, which concerned full precompute output.)
- Metrics loader exercised both ways in isolation: file present → parsed with all four models; file
  absent → returns null so the server still boots and the panel hides itself.

## v2.1.6 — hosRisk is now a rule, not a model (and the reproducibility bug is fixed)

Acting on what v2.1.5's metrics exposed: hosRisk's perfect held-out ROC-AUC of 1.000 was leakage,
not skill. **The hosRisk XGBoost model has been removed entirely** and replaced with a deterministic
compliance rule. The ensemble is now 3 trained models + 1 rule.

**Why removal rather than dropping a feature.** The alternative fix was to also drop
`est_drive_hours` so the label stops being reconstructible. But Hours of Service is not a
probabilistic outcome to begin with — it is a legal threshold. A driver either has the cycle hours
for this leg or does not, and expressing that as a model confidence was the wrong tool regardless of
leakage. The old code already conceded this: it wrapped the model output in a hard
`can7 < 0 → 99 / can7 < 3 → max(hos, 90)` guardrail, so the rule was effectively in charge for every
case that mattered while the model supplied noise everywhere else.

- **`hos_risk_rule()` in `risk_engine.py`** — `CAN_7 < 0 → 99` (already over the legal cycle: a
  compliance fact, not an estimate); otherwise a linear scale on the buffer the leg would leave
  behind, saturating at 24h, clamped to 5–95. A buffer under 3h lands above 87 on its own, so the
  old bolted-on `max(hos, 90)` guardrail is no longer a patch — that behaviour now falls out of the
  rule. Missing `CAN_7` is treated as safe: absent data is not evidence of a violation.
- **`explain_risk()` rejects `hosRisk`** with a message saying why, and `precompute.py` picks the
  dominant model to explain from the three *trained* models only — otherwise a leg whose top score
  was hosRisk would have ended up with no explanation at all.
- **UI** — the Risk Score Drivers panel shows hosRisk as `rule-based` with an explanation instead of
  an empty importances card, and its metrics row reads "deterministic rule — nothing to score".

### The reproducibility bug is fixed as part of this

Regenerating the scores was unavoidable here, which forced the long-standing caveat to be dealt
with. Root cause: `load_tables()` issues `SELECT * FROM <table>` with **no `ORDER BY`**, and SQLite
guarantees no row order. That changed what `train_test_split()` saw positionally, which changed the
trained models, which is why re-running the pipeline produced different scores for the same
`TRIP_NUMBER`. `build_features()` now sorts on `LS_LEG_ID` (the dispatch table's own per-leg
identifier) before returning, pinning row order to the data instead of to SQLite's discretion.

**Verified**: `precompute.py` run twice back to back — `risk_scores.json`, `explanations.json` and
`feature_importances.json` were byte-identical (md5) across both runs. The "not fully reproducible"
warning in Known data caveats no longer applies and has been updated.

### What changed in the numbers

| | before (model) | after (rule) |
|---|---|---|
| mean hosRisk | 4.1 | 14.1 |
| legs at hosRisk 99 | 149 | **119** |
| riskScore ≥ 40 | 194 | 283 |
| riskScore ≥ 70 | 1 | 3 |

The 119 figure is the meaningful one: it is now **exactly** the legs belonging to the three drivers
with a negative CAN_7 balance. The old model was additionally scattering ~99s onto 30 other legs
that were not actually in violation, so the "already over the legal limit" population is now
precisely defined rather than approximately. The score distribution also decompressed slightly
(more legs above 40, three above 70 instead of one), since hosRisk now contributes a graded signal
rather than sitting near zero for almost everything.

Held-out metrics for the three remaining models, on the now-deterministic split:

| model | ROC-AUC | precision | recall | F1 | base rate |
|---|---|---|---|---|---|
| delayRisk | 0.939 | 0.828 | 0.436 | 0.571 | 2.6% |
| detentionRisk | 0.885 | 0.841 | 0.803 | 0.822 | 55.0% |
| emptyMileRisk | 0.882 | 0.793 | 0.581 | 0.671 | 35.5% |

No model now posts a suspiciously perfect score, and every one of them is predicting something it
cannot simply reconstruct from its own inputs.

### Verification performed for this release

- `hos_risk_rule()` checked across 7 cases (already over cycle, 0.27h remaining, 2h/3h/12h/24h+
  buffers, missing CAN_7) and confirmed monotonic in buffer across a 0–30h sweep.
- `precompute.py` run twice; all three output files md5-identical.
- `tsc --noEmit` (backend) and `tsc -b` + `vite build` (frontend) clean.

**Note for the presentation deck**: slide 5 (four models) and slide 6 (leakage prevention) describe
the old four-model design and are now out of date — the honest and stronger framing is "three
learned models plus one legal rule, because HOS is law, not probability."

## v2.1.7 — removed two settings that did nothing

Asking "what is delayRisk's threshold?" turned up a Settings control wired to nothing. Auditing the
rest of the settings for real consumers found a second one.

- **`delayThresholdHours`** (shown as "Delay threshold: 1 hour") — defined in `settings.ts`,
  editable in Settings, read by **no backend, ML or simulation code**. delayRisk's label is
  `schedule_slack_hours < 0` with no tolerance band, so changing this control had no effect on
  anything. Removed, along with its now-empty "Delay" settings category.
- **`emptyMileThresholdMiles`** ("Empty mile threshold: 50 miles") — same situation, found by
  checking every threshold key for consumers outside `settings.ts` / `SettingsPanel.tsx` /
  `hooks.ts`. Removed. The Empty Mile category keeps its two controls that *are* wired up
  (`emptyMileMatchRadiusKm`, `emptyMileRevenuePerKmCAD`).
- The `MILES_TO_KM` constant in `SettingsPanel.tsx` became unused with that field and was removed.

**Stale saved settings heal themselves.** `getThresholds()` previously did
`{ ...DEFAULT_THRESHOLDS, ...JSON.parse(row.value) }`, so an install whose `app_config` row was
saved before this release would keep resurrecting the two removed keys into the API response
forever. It now accepts only keys that still exist in `DEFAULT_THRESHOLDS`, so an old row is
cleaned on the next read instead of needing a manual DB edit.

Audit result for the remaining threshold settings — all have real consumers:
`hosCriticalRemainingHours`, `detentionThresholdHours`, `detentionRatePerHourCAD`,
`emptyMileMatchRadiusKm`, `emptyMileRevenuePerKmCAD`, `topRiskLegsCount`.

### For reference: where delayRisk's thresholds actually live

Worth stating plainly, since "the delay threshold" could mean three different things:

1. **Label cutoff — `schedule_slack_hours < 0`**, exactly zero, no tolerance. One second late counts
   the same as five hours late. This is what makes the positive base rate 2.6%.
2. **Metric cutoff — `proba >= 0.5`**, hardcoded in `_train_one`. Affects only the
   precision/recall/F1 columns in the metrics table; it does **not** touch the delayRisk score the
   dashboard displays. This is why delayRisk reads AUC 0.939 (ranks well) but recall 0.436 (0.5 is
   conservative for a 2.6% base rate).
3. **Display — no threshold at all.** delayRisk is shown as the continuous `predict_proba × 100`.
   The Low/Medium/High bands (30/60/80) apply to the combined `riskScore`, not to individual
   sub-scores.

### Verification performed for this release

- Confirmed zero remaining references to either removed key across `.ts`, `.tsx` and `.py`.
- Stale-key filtering exercised directly against a simulated legacy config row: both removed keys
  dropped, genuinely-saved values (`hosCriticalRemainingHours: 4`, `topRiskLegsCount: 15`,
  `showFleetMap: false`) preserved, untouched keys still falling back to defaults, final key count
  matching `DEFAULT_THRESHOLDS` exactly.
- `tsc --noEmit` (backend) and `tsc -b` + `vite build` (frontend) clean.

## v2.1.8 — operating thresholds tuned instead of left at 0.5

v2.1.5 reported precision/recall at a hardcoded `proba >= 0.5`. That default is arbitrary and badly
suited to a rare label: delayRisk was catching **under half** of real delays (recall 0.436) despite
ranking them well (AUC 0.939). Each model now gets its own cutoff, swept for best F1.

**Chosen on the training split only.** Picking the threshold on the test split would be tuning on
the very data used to report the result — a subtler version of the leakage that got hosRisk removed
in v2.1.6. The cost of that discipline was measured rather than assumed: the train-chosen cutoffs
land within 0.01–0.14 of the test-optimal ones and give up at most 0.018 F1 against the (unusable)
oracle choice. Honesty here is nearly free.

| model | cutoff | precision | recall | F1 | F1 @0.5 | base rate |
|---|---|---|---|---|---|---|
| delayRisk | **0.20** | 0.655 | 0.655 | **0.655** | 0.571 | 2.6% |
| detentionRisk | **0.40** | 0.777 | 0.878 | **0.824** | 0.822 | 55.0% |
| emptyMileRisk | **0.41** | 0.703 | 0.780 | **0.740** | 0.671 | 35.5% |

- **delayRisk gains the most**: recall 0.436 → 0.655, half again as many real delays caught, at a
  precision cost that is acceptable when the alternative is missing them entirely.
- **detentionRisk barely moves** (F1 0.822 → 0.824) — its base rate is already near-balanced at 55%,
  so 0.5 was close to right for it. Reported anyway rather than special-cased.
- **emptyMileRisk** gains a solid 0.07 F1 (recall 0.581 → 0.780).

`atDefaultThreshold` is stored alongside every model and shown as the "F1 @0.5" column, so the
improvement stays checkable rather than being quietly swapped in. The metrics table also gains a
"Cutoff" column, and the tooltip explains where the number comes from.

**This changes reporting only — not a single score.** `risk_scores.json` md5-verified unchanged
across the work: the dashboard shows `predict_proba × 100` as a continuous 0–100 value and never
applies a classification cutoff. The threshold governs the precision/recall/F1 columns and nothing
else.

### Verification performed for this release

- Full threshold sweep (0.05–0.95) run per model before implementing, comparing the train-chosen
  cutoff against the test-optimal one to confirm the gap was small enough that train-side selection
  was not leaving meaningful performance on the table.
- `evaluate.py` run twice: all three chosen thresholds and all F1 values identical, so the cutoffs
  are stable rather than drifting each regeneration.
- `risk_scores.json`, `explanations.json`, `feature_importances.json` md5-checked after every run —
  unchanged throughout.
- `tsc --noEmit` (backend) and `tsc -b` + `vite build` (frontend) clean.

## v2.1.9 — bug fix: blank figure in the metrics panel footer

- The "N test legs per model" line under the held-out performance table read
  `metrics.models.hosRisk.testRows`. v2.1.6 removed hosRisk from `models` when it became a
  deterministic rule, so that lookup returned undefined and the line rendered as
  "&nbsp;test legs per model" with the number missing. It now reads `testRows` from the first
  *trained* model instead of a hardcoded name, so removing or renaming a model can't blank it again.
  Confirmed: renders "2,096 test legs per model".
- Found by serving `model_metrics.json` through a copy of the real Express handler and checking
  every field the panel reads against the actual response, rather than assuming the panel was fine
  because it compiled.

## v2.1.10 — What-if sub-risk radar (and two crashes it uncovered)

Asked for: a radar on the What-if result so the combined score is understandable. Building it meant
calling the What-if path, which turned out to be **completely broken**.

### Two bugs found first — both regressions from v2.1.6

- **`/whatif` crashed with `KeyError: 'hosRisk'`.** `service.py` still did
  `shap.TreeExplainer(models["hosRisk"])` to explain the HOS change, but v2.1.6 removed that model
  when hosRisk became a rule. **The entire What-if feature was dead** — it would have failed live on
  stage. The driving factor now comes from whichever *trained* sub-model moved most in the
  reassignment, which is the part SHAP can actually speak to.
- **The candidate's HOS buffer never reached the rule.** `hos_risk_rule()` reads
  `hos_buffer_hours` from `df`, but `service.py` set it only on `after_row` (which is `X`), so the
  rule kept computing the *original* driver's buffer. Symptom: reassigning to a driver with 70h of
  cycle left still returned hosRisk 95, because the leg's previous driver was 43h over. This is the
  same `df`-vs-`X` trap already documented one line above for `REMAINING_HOURS_CAN_7`; the new
  field needed the same treatment. Fixed — the same reassignment now correctly returns hosRisk 5,
  and the total drops 55.1 → 14.9 instead of 55.1 → 41.9.
- The stale `_apply_hos_guardrail()` helper was also removed: `score()` applies the rule itself, so
  re-applying the old `can7 < 3 → max(hos, 90)` clamp on top could override the rule's own output
  and disagree with the main risk engine for the same driver.

### The feature

`WhatIfRadarChart` overlays the current driver's sub-risk profile (dashed, grey) with the
candidate's (solid, indigo), plus a per-axis contribution table underneath.

The reason it helps: the combined score is a **weighted average**, so a reassignment can move the
total only a little while completely changing which risk drives it — and, as discussed separately,
a leg can be legally un-runnable on HOS (99) and still land mid-range overall. The radar shows the
shape change; the table shows the arithmetic that turns it into one number:

| axis | weight | before → after | contribution |
|---|---|---|---|
| HOS | ×0.3 | 99 → 5 | −28.2 |
| Delay | ×0.3 | 4.1 → 1.4 | −0.8 |
| Detention | ×0.2 | 90.3 → 10.9 | −15.9 |
| Empty Mile | ×0.2 | 30.6 → 53.9 | **+4.7** |
| **Total** | | 55.1 → 14.9 | **−40.2** |

Note the empty-mile axis moving the *wrong* way while everything else improves — exactly the kind
of trade-off a single number hides. The tooltip states each axis's weight and what its change
contributed.

### Verification performed for this release

- `/whatif` exercised end to end against a real over-limit driver (Driver13, CAN_7 −43.75h)
  reassigned to a real candidate (Driver6, CAN_7 70h): confirmed it now returns without error and
  that hosRisk drops to the rule's floor as it should.
- Per-axis contributions cross-checked against the engine: the four contributions sum to −40.2,
  matching the actual total delta of −40.2 exactly, so the table cannot drift from the real score.
- `tsc --noEmit` (backend) and `tsc -b` + `vite build` (frontend) clean.

## v2.1.11 — code-freeze audit

Systematic sweep for anything else left behind by the v2.1.6 hosRisk removal, since all three bugs
found in v2.1.9/v2.1.10 shared that single root cause.

- **`/explain` returned an error instead of an explanation for 198 legs (4.6%).** It picked the
  dominant sub-risk to explain from all four scores including hosRisk, which `explain_risk()`
  rejects because a rule has no SHAP attribution. hosRisk is frequently the highest score now that
  the rule emits a graded signal, so this silently hit **every over-the-legal-limit leg** — the
  exact ones a dispatcher most wants explained. `precompute.py` had already been given this fix;
  `service.py` had not. Now fixed in both.
- **Stale UI copy corrected**: the Edge Cases panel still told the reader that CAN_7 &lt; 0 "forces
  hosRisk to 99 regardless of what the model predicts". There is no model to override any more.
- **Dead UI removed**: two blocks keyed on `explanation.guardrail_applied`, which
  `explainability.py` now always sets to `false`, so they could never render.

### Sweep results (what was checked, not just what was fixed)

- Every `models[...]` lookup in Python — no stale keys remain.
- Every `hosRisk` reference across Python, TS and TSX — all either correct or explanatory comments.
- ML service exercised in bulk rather than on one example: `/explain` across **250 legs** and
  `/whatif` across **40 legs**, both now zero failures; `/health` OK.

## v2.2.0 — sensitivity explorer ("try it yourself")

A panel on the risk-detail card that lets a dispatcher (or a judge) move a real leg's inputs and
watch the model re-score live, with the per-axis contribution to the combined score shown as it
changes.

**Built as overrides to an existing leg, not a blank entry form** — deliberately. `score()` reads
the HOS rule's inputs from `df` and the models' inputs from `X`; hand-building a full 9-feature row
means keeping those two in sync manually, which is precisely what broke `/whatif` twice
(v2.1.10). Starting from a real row means every field the user does not touch is already correct
and consistent in both structures. Same reasoning, much smaller blast radius.

- New `POST /rescore` on the ML service and `POST /api/rescore/:tripNumber` on the Node backend.
- Currently exposed: 7-day cycle hours and trip distance. `est_drive_hours` and `hos_buffer_hours`
  are derived from those, and CAN_14 / schedule slack / route complexity are accepted by the API
  but not yet surfaced in the UI.
- **No heuristic fallback, on purpose.** If the ML service is down the panel says so rather than
  drawing a fabricated curve — an invented sensitivity line would undermine the exact claim the
  feature exists to support.
- Slider input is debounced and stale responses are discarded, so dragging can't leave an
  out-of-order result on screen.

### Verification performed for this release

The safety property is a round trip: **sending no overrides must reproduce the leg's stored score
exactly.** Any `df`/`X` inconsistency shows up here immediately.

- The first implementation **failed this test on 216 of 300 legs** (stored hosRisk 5, recomputed
  95). Cause: it recomputed `est_drive_hours`/`hos_buffer_hours` unconditionally from `X`, which is
  median-filled, and wrote the result into `df`, which keeps the original NaNs — fabricating a
  buffer where the pipeline had none. Fixed by only writing HOS fields when an override actually
  changes them.
- After the fix: **445 legs, zero mismatches.**
- Independently confirmed the engine itself was never at fault: single-row `score()` reproduces the
  stored values on 429/429 sampled legs.
- Override behaviour checked for sense and monotonicity: sweeping CAN_7 from 70h down to −5h moves
  hosRisk 5 → 99 monotonically (verified across a 0–40h sweep), and distance sweeps move
  empty-mile risk in the expected direction.
- Exact Node→ML request body (including `null` for untouched fields) exercised against the real
  endpoint; every field the UI reads confirmed present in the response.

## v2.2.1 — radar charts in both PDF reports

- **Trip PDF**: when a What-if candidate has been selected, the report now includes a before/after
  radar overlaying the current driver's sub-risk profile (dashed grey) with the candidate's (solid).
  Each axis is labelled with both values (`99 -> 5`), and a caption states that the combined score
  is a weighted average — so a reader who only has the PDF can see why the total can improve while
  one axis gets worse.
- **Fleet summary PDF**: new "Fleet Risk Profile" section overlaying the mean sub-risk across all
  legs against the mean across high-risk legs only. This answers a question the KPI numbers can't:
  *which* risk types actually separate the high-risk legs from everything else. On current data
  it's stark — HOS 14 -> 99 and Delay 2 -> 73, while Empty Mile goes the other way (34 -> 7).
- New `radarCompare()` in `pdfStyle.ts` draws any number of series on shared axes. Kept separate
  from the existing `radarChart()` because that one also renders the large centred total-score
  overlay, which only makes sense for a single leg.
- `WhatIfReportData` in the frontend store now carries full sub-score snapshots rather than just
  `riskScore`; a combined score can't be decomposed back into four axes. The report's input type
  keeps the sub-scores optional, so a client sending only `riskScore` still produces a valid
  report — just without the radar.
- Fleet averages are deduped by (trip, driver) like every other aggregate in `server.ts`, so relay
  sub-legs aren't counted repeatedly.

### Verification performed for this release

Both PDFs generated from the real `risk_scores.json` and **visually inspected**, which caught two
issues that compiled fine:

- The `->` arrow between axis values was written as `\u2192`, which pdfkit's built-in
  WinAnsi-encoded Helvetica cannot render — it came out as garbage characters. Switched to ASCII
  `->`, matching the rest of the report.
- The bottom axis label collided with the legend beneath it; legend offset increased.

Also confirmed the trip report still fits on one page with the second radar added, and that the
fleet radar renders with real computed averages rather than placeholder values.

## v2.2.2 — bug fix: relay sub-legs were being counted as separate legs

Three aggregates counted raw `risk_scores.json` rows instead of deduping by (trip, driver) the way
every other aggregate in `server.ts` already did. A single trip can carry many relay sub-legs — the
WHITBY↔OSHAWA shuttles run up to **20 sub-legs under one TRIP_NUMBER** — so those three inflated
their numbers by whatever the sub-leg count happened to be.

- **Chronic detention zones** (both the `/api/edge-cases` panel and the fleet summary PDF). Oshawa
  reported **1,312 high-detention legs against 104 real trips**, a 12.6× overcount. Worse than the
  size of the number, **the ranking was wrong**: Oshawa appeared to be by far the worst zone when
  it is actually third.

  | zone | before | after |
  |---|---|---|
  | MILTON, ON | 333 | **247** (1st) |
  | WHITBY, ON | 582 | **246** (2nd) |
  | OSHAWA, ON | **1,312** | **104** (3rd) |

- **Empty-leg candidates** listed 10 rows containing only 7 distinct trips — the same trip appeared
  up to three times, once unassigned and once with a driver, reading as separate opportunities.
  Now one row per trip, preferring the row that names a real driver over the export's literal
  `"<null>"`.

- Added a module-level `dedupedRiskScores` next to `riskScores` so this cannot drift again: the
  deduping rule is defined once instead of being re-implemented inline at each call site, which is
  how these three got missed.

### Verification performed for this release

- Recomputed all three aggregates against the real `risk_scores.json`: chronic zones now 129 zones
  with the corrected ranking above, and the empty-leg list returns 10 distinct trips out of 10 rows.
- `tsc --noEmit` (backend) and `tsc -b` + `vite build` (frontend) clean.
- Shipped data files unchanged — this is a read-side counting fix, not a pipeline change.

## v2.2.3 — SPUR AI as a switchable alternative provider

`Settings → AI provider → "Use SPUR AI"`. **Off by default**; when on, both AI
features (risk recommendation and route-conditions analysis) go to SPUR AI instead of Claude.

- **New `backend/ai/llm-client.ts`** holds the provider difference in one place. The two wire
  formats are not interchangeable:

  | | Anthropic | SPUR AI |
  |---|---|---|
  | endpoint | `POST /v1/messages` | `POST /v1/chat/completions` |
  | auth | `x-api-key` + `anthropic-version` | `Authorization: Bearer` |
  | system prompt | top-level `system` field | a message with `role: "system"` |
  | reply text | `content[].text` | `choices[0].message.content` |
  | cut off | `stop_reason === "max_tokens"` | `finish_reason === "length"` |

  Both are normalised to one shape including a boolean `truncated`, because the truncation-recovery
  logic added in v2.1.3 depends on knowing that and the two providers signal it differently.

- **Config**: `SPUR_API_KEY` in `backend/.env` (documented in `.env.example`), with optional
  `SPUR_BASE_URL` and `SPUR_MODEL` overrides defaulting to `https://ai.spuric.com/v1` and
  `spur-chat`.

- **The toggle fails loudly, not silently.** Switching it on with no `SPUR_API_KEY` raises an
  explicit error naming the missing variable rather than quietly falling back to Anthropic — a
  toggle that appears to do nothing is worse than one that reports why.

- **The UI names the provider that actually answered** ("Answered by SPUR AI · spur-chat") under
  each live recommendation. With a switch that swaps models, whether it really switched should be
  answerable from the screen rather than taken on trust.

- `parseClaudeJson()` now takes a boolean `truncated` instead of an Anthropic-specific
  `stop_reason` string, and its error text no longer says "Claude" for what may be a SPUR reply.

### Verification performed for this release

Exercised against a stubbed `fetch`, since these are live paid endpoints:

- **SPUR request shape matched byte for byte against the documented curl**: URL
  `https://ai.spuric.com/v1/chat/completions`, header `Authorization: Bearer sk-spur-...`, body
  `{"model":"spur-chat","messages":[{"role":"system",...},{"role":"user",...}]}`.
- `finish_reason: "length"` correctly maps to `truncated: true`, so a cut-off SPUR reply gets the
  same salvage treatment as a cut-off Anthropic one.
- Toggle on with no key → explicit error, no Anthropic fallback.
- Toggle off → still `api.anthropic.com/v1/messages`, provider reported as `anthropic`.
- Both services checked end to end: with the flag on, risk recommendation *and* route conditions
  both hit SPUR; with it off, both hit Anthropic.
- `DEFAULT_THRESHOLDS.useSpurAi === false` asserted directly.
- `tsc --noEmit` (backend) and `tsc -b` + `vite build` (frontend) clean.

**Not verified**: no real call has been made to SPUR AI — there is no key in this environment. The
request is built to the documented spec, but the first real call should be tried before relying on
it in a demo.

## v2.2.4 — bug fix: the Route Conditions error hint pointed at the wrong flag

`/api/route-conditions/:trip` does two independent things — fetch traffic/weather, then ask a model
what to do about it — and each has its own mock flag. The panel printed
*"set MOCK_ROUTE_CONDITIONS=true"* for **every** failure, so an authentication failure on the AI
call sent the reader off to mock out the data feed while the real problem was an invalid API key.

This was noted as a red herring back in v2.1.1 but never actually fixed in the UI. It surfaced
again on a live `Claude API error 401: API key is invalid`.

- The hint is now chosen from what failed. An AI-side message (api key, authentication, 401,
  claude, anthropic, spur, max_tokens) points at `ANTHROPIC_API_KEY` / `MOCK_CLAUDE` and notes that
  `.env` is only read at backend startup — so editing the key without restarting looks like the key
  is still wrong. It also mentions the SPUR AI toggle as an alternative.
- Anything else still points at `MOCK_ROUTE_CONDITIONS`, which is what that flag actually controls
  (`server.ts:443`: Ontario 511 and OpenWeather only).
- The error message and the hint are now separate lines, so the hint doesn't read as part of the
  provider's own error text.

### Verification performed for this release

Hint selection checked against six real message shapes: a Claude 401, a max-tokens truncation, a
missing `SPUR_API_KEY`, an Ontario 511 503, an OpenWeather miss, and a plain "trip not found" —
each routed to the correct flag.

`tsc -b` + `vite build` clean.

## Running it locally

See **Quick Start** at the top of this README — same commands, plus double-clickable `.bat` files.

## Known data caveats

- `Dispatch.LS_DET_PICK_ARRIVE`/`LS_DET_DELV_ARRIVE` occasionally produce implausible dwell times
  (600+ hours) for a small number of rows — these look like data-entry gaps in the source export
  (e.g. a truck re-appearing after a weekend), not real detentions. `feature_engineering.py` clips
  dwell hours to a 0–72h band before using them as a model feature; unclipped values are still
  visible in the raw SQLite table if you want to inspect them.
- The dataset has no clean `driver_id` foreign key on `Dispatch` — legs are joined to `Driver` by
  first name (`NAME` ↔ `FIRST_NAME`), which is workable here (169 unique drivers, no collisions
  observed) but should be hardened before production use.
- **ML pipeline reproducibility — fixed in v2.1.6.** Re-running `precompute.py` used to produce
  different `hosRisk`/`riskScore` values for the same `TRIP_NUMBER`, despite `train_test_split` and
  `XGBClassifier` both being seeded. Root cause was not the seeds: `load_tables()` issues
  `SELECT * FROM <table>` with no `ORDER BY`, and SQLite guarantees no row order, so the rows
  reaching `train_test_split()` differed between runs and produced different models.
  `build_features()` now sorts on `LS_LEG_ID` before returning. Verified by running `precompute.py`
  twice and confirming all three output files are md5-identical. Regenerating the pipeline is now
  safe.
