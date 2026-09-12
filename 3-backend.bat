@echo off
cd /d "%~dp0backend"

echo.
echo === RoadPilot - Step 3: Backend (http://localhost:8787) ===
echo.

if not exist ".env" (
  echo No .env found - creating one from .env.example.
  copy .env.example .env >nul
  echo.
  echo IMPORTANT: opening .env in Notepad so you can add your real ANTHROPIC_API_KEY
  echo ^(and optionally ML_SERVICE_URL^). Save and close Notepad to continue.
  notepad .env
)

if not exist "node_modules" (
  echo Installing backend dependencies...
  call npm install
  if errorlevel 1 goto :error
)

echo.
echo Starting backend. Leave this window open while using the app. Press Ctrl+C to stop.
echo.
call npm run dev

echo.
echo Backend stopped.
pause
exit /b 0

:error
echo.
echo npm install failed - see the error message above.
pause
exit /b 1
