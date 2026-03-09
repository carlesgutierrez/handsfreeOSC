@echo off
SETLOCAL EnableDelayedExpansion

echo --------------------------------------------------
echo HandsfreeOSC - Wekinator Bridge Launcher
echo --------------------------------------------------

cd /d "%~dp0"

:: Check if venv exists
if not exist "venv" (
    echo [1/3] Creating virtual environment...
    python -m venv venv
    if !errorlevel! neq 0 (
        echo ERROR: Python not found or failed to create venv.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Virtual environment already exists.
)

:: Install/Update requirements
echo [2/3] Checking dependencies...
.\venv\Scripts\python -m pip install --upgrade pip >nul
.\venv\Scripts\pip install -r requirements.txt >nul

:: Run the application
echo [3/3] Launching Bridge GUI...
echo (Check the graphical window that just opened)
echo.
.\venv\Scripts\python main.py

if !errorlevel! neq 0 (
    echo Application exited with error code !errorlevel!
    pause
)

ENDLOCAL
