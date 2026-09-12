@echo off
cd /d "%~dp0backend"

echo.
echo === RoadPilot - Step 5: Simulation engine (optional) ===
echo Needed for the live fleet map and detention panel. Leave this window open.
echo Press Ctrl+C to stop.
echo.

npx tsx simulation\engine.ts

echo.
echo Simulation engine stopped.
pause
