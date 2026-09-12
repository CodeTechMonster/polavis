@echo off
setlocal

REM === Step 1: ETL + ML pipeline ===
REM Update the path below if your Excel dataset lives somewhere else.
set "EXCEL_PATH=C:\Project\TestData\1788655393951_Hackathon_Data.xlsx"

cd /d "%~dp0"

echo.
echo === RoadPilot - Step 1: ETL + ML pipeline ===
echo.

echo [1/3] Installing Python dependencies...
pip install -r backend\requirements.txt
if errorlevel 1 goto :error

echo.
echo [2/3] Importing Excel data: %EXCEL_PATH%
python scripts\import_excel.py "%EXCEL_PATH%" --outdir data
if errorlevel 1 goto :error

echo.
echo [3/3] Precomputing ML features and SHAP explanations...
pushd backend\ml
python precompute.py
if errorlevel 1 (
  popd
  goto :error
)
popd

echo.
echo Done. You can now run 2-ml-microservice.bat, 3-backend.bat, and 4-frontend.bat
echo (each in its own window), and optionally 5-simulation-engine.bat.
pause
exit /b 0

:error
echo.
echo A step above failed - see the error message for details.
pause
exit /b 1
