@echo off
setlocal

rem ---- fixed to always use non-desktop paths ----
set "PROJDIR=C:\Users\2cona\OneDrive\Lifestyle Tracking v2\project_lifestyle"
set "FRONTENDDIR=C:\Users\2cona\OneDrive\Lifestyle Tracking v2\project_lifestyle\frontend\frontend_lifestyle"
set "VENV_PYTHON=%PROJDIR%\.venv\Scripts\python.exe"

rem ---- custom ports ----
set "BACKEND_PORT=8100"
set "FRONTEND_PORT=5200"

echo Computer Name: %COMPUTERNAME%
echo Using project dir: "%PROJDIR%"
echo Using frontend dir: "%FRONTENDDIR%"
echo Using backend python: "%VENV_PYTHON%"
echo Backend Port: %BACKEND_PORT%
echo Frontend Port: %FRONTEND_PORT%

rem ---- go to backend and run Django server (new window) ----
cd /d "%PROJDIR%" || (
    echo Failed to change directory to "%PROJDIR%".
    pause
    exit /b 1
)
if not exist "%VENV_PYTHON%" (
    echo Missing virtual environment python at "%VENV_PYTHON%".
    pause
    exit /b 1
)
start "Django Backend" cmd /k ""%VENV_PYTHON%" manage.py runserver 0.0.0.0:%BACKEND_PORT%"

rem ---- go to frontend (same window) ----
cd /d "%FRONTENDDIR%" || (
    echo Failed to change directory to frontend.
    pause
    exit /b 1
)

rem ---- launch browser and run frontend dev (new window) ----
start "" http://localhost:%FRONTEND_PORT%/
start "Vite Frontend" cmd /k "npm run dev -- --host --port %FRONTEND_PORT%"

pause
endlocal
