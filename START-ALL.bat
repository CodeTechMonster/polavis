@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title RoadPilot - launcher

echo.
echo ===========================================================
echo   RoadPilot AI Dispatch Advisor - start everything
echo ===========================================================
echo.
echo   This assumes setup is already done (1-etl-ml-pipeline.bat
echo   has been run, npm install completed, .env filled in).
echo   Nothing is installed or overwritten by this script.
echo.

REM ---------------------------------------------------------------
REM Preflight. Four services are about to open in four windows; if a
REM prerequisite is missing they would each fail separately and the
REM real cause would scroll past in whichever window you looked at
REM last. So everything is checked here first, and nothing launches
REM unless all of it passes.
REM ---------------------------------------------------------------
set MISSING=0

if not exist "data\roadpilot.sqlite" (
  echo   [X] data\roadpilot.sqlite not found
  echo       ^-^> run 1-etl-ml-pipeline.bat first
  set MISSING=1
)
if not exist "data\risk_scores.json" (
  echo   [X] data\risk_scores.json not found
  echo       ^-^> run 1-etl-ml-pipeline.bat first
  set MISSING=1
)
if not exist "backend\node_modules" (
  echo   [X] backend\node_modules not found
  echo       ^-^> run: cd backend ^&^& npm install
  set MISSING=1
)
if not exist "frontend\node_modules" (
  echo   [X] frontend\node_modules not found
  echo       ^-^> run: cd frontend ^&^& npm install
  set MISSING=1
)
if not exist "backend\.env" (
  echo   [X] backend\.env not found
  echo       ^-^> copy backend\.env.example to backend\.env and add your key
  set MISSING=1
)

if "%MISSING%"=="1" (
  echo.
  echo   Not starting. Fix the items above, then run this again.
  echo.
  pause
  exit /b 1
)

echo   [OK] data files, dependencies and .env all present
echo.

REM ---------------------------------------------------------------
REM A missing API key is not fatal: the app has mock paths for every
REM AI and live-API call, so the demo still runs. Worth warning about
REM rather than blocking on.
REM ---------------------------------------------------------------
REM Check the placeholder first: .env.example ships with "sk-ant-your-key-here", which would
REM satisfy a naive "starts with sk-ant" test and produce no warning at all for someone who
REM copied the file and never edited it.
findstr /C:"sk-ant-your-key-here" "backend\.env" >nul 2>&1
if not errorlevel 1 (
  echo   [!] backend\.env still has the placeholder API key.
  echo       AI recommendations will fail. Either paste a real key,
  echo       or add MOCK_CLAUDE=true to run the demo without one.
  echo.
  goto :keychecked
)
findstr /C:"ANTHROPIC_API_KEY=sk-ant" "backend\.env" >nul 2>&1
if errorlevel 1 (
  echo   [!] No ANTHROPIC_API_KEY found in backend\.env.
  echo       AI recommendations will fail unless MOCK_CLAUDE=true is set.
  echo.
)
:keychecked

echo   Opening four windows. Close any of them to stop that service.
echo.

REM ---------------------------------------------------------------
REM Order matters. The ML service trains its models on boot and takes
REM roughly 20-30 seconds before it answers; the backend calls it for
REM SHAP explanations and what-if. Starting it first means it is
REM usually ready by the time the browser is open. The frontend is
REM started last because it is the one that opens the browser.
REM ---------------------------------------------------------------
start "RoadPilot - ML service (:8000)" /D "%~dp0backend\ml" cmd /k "echo Training models, this takes ~20-30s... && python -m uvicorn service:app --port 8000"

echo   [1/4] ML service starting - waiting 20s for it to train...
timeout /t 20 /nobreak >nul

start "RoadPilot - Backend (:8787)" /D "%~dp0backend" cmd /k "npm run dev"
echo   [2/4] Backend starting...
timeout /t 5 /nobreak >nul

start "RoadPilot - Simulation engine" /D "%~dp0backend" cmd /k "npx tsx simulation\engine.ts"
echo   [3/4] Simulation engine starting...
timeout /t 3 /nobreak >nul

start "RoadPilot - Frontend (:5173)" /D "%~dp0frontend" cmd /k "npm run dev"
echo   [4/4] Frontend starting...

echo.
echo   Waiting for the dashboard to come up...
timeout /t 8 /nobreak >nul
start "" http://localhost:5173

echo.
echo ===========================================================
echo   All four services launched.
echo.
echo     Dashboard    http://localhost:5173
echo     Backend API  http://localhost:8787
echo     ML service   http://localhost:8000
echo.
echo   To stop everything, close the four RoadPilot windows
echo   (or run stop-all.bat).
echo ===========================================================
echo.
pause
