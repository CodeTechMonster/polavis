@echo off
cd /d "%~dp0"
title RoadPilot - stop

echo.
echo ===========================================================
echo   RoadPilot - stop all services
echo ===========================================================
echo.

REM Windows are titled by START-ALL.bat, so they can be closed by title.
REM This is deliberately narrower than killing every node/python process
REM on the machine: you may well have unrelated ones running.
set FOUND=0
for %%W in (
  "RoadPilot - ML service (:8000)"
  "RoadPilot - Backend (:8787)"
  "RoadPilot - Simulation engine"
  "RoadPilot - Frontend (:5173)"
) do (
  taskkill /FI "WINDOWTITLE eq %%~W" /T /F >nul 2>&1
  if not errorlevel 1 (
    echo   [stopped] %%~W
    set FOUND=1
  )
)

if "%FOUND%"=="0" (
  echo   Nothing was running under the RoadPilot window titles.
  echo.
  echo   If a service is still holding a port, find it with:
  echo     netstat -ano ^| findstr "5173 8787 8000"
  echo   then: taskkill /PID ^<pid^> /F
)

echo.
pause
