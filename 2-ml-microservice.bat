@echo off
cd /d "%~dp0backend\ml"

echo.
echo === RoadPilot - Step 2: ML microservice (http://localhost:8000) ===
echo Leave this window open while using the app. Press Ctrl+C to stop.
echo.

python -m uvicorn service:app --port 8000

echo.
echo ML microservice stopped.
pause
