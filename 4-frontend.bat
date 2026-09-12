@echo off
cd /d "%~dp0frontend"

echo.
echo === RoadPilot - Step 4: Frontend (http://localhost:5173) ===
echo.

if not exist "node_modules" (
  echo Installing frontend dependencies...
  call npm install
  if errorlevel 1 goto :error
)

echo.
echo Starting frontend. Leave this window open while using the app. Press Ctrl+C to stop.
echo /api requests are proxied to the backend on :8787.
echo.
call npm run dev

echo.
echo Frontend stopped.
pause
exit /b 0

:error
echo.
echo npm install failed - see the error message above.
pause
exit /b 1
