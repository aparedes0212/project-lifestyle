@echo off
setlocal

:: move to repository root so relative paths resolve even if script is run from elsewhere
cd /d "%~dp0"

:: start backend inside Python virtual env
start "Lifestyle backend" cmd /k "cd /d "%~dp0" && call "C:\Users\AlexParedes\OneDrive - JBrennon Construction, Inc\Coding\.venv\Scripts\activate" && python manage.py runserver 8100"

:: make sure frontend deps are installed before starting dev server
set "FRONT_DIR=%~dp0frontend\frontend_lifestyle"
if not exist "%FRONT_DIR%\node_modules" (
    echo Installing frontend dependencies...
    pushd "%FRONT_DIR%"
    npm install
    popd
)

:: start frontend
start "Lifestyle frontend" cmd /k "cd /d "%FRONT_DIR%" && npm run dev"

endlocal
