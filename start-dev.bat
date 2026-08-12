@echo off
setlocal

cd /d "%~dp0"

echo Starting SAN11 backend and frontend...
echo Backend:  http://localhost:8787
echo Frontend: http://127.0.0.1:5174
echo Stopping old SAN11 processes on ports 8787 and 5174...

powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($port in 8787,5174) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"

start "SAN11 Backend" cmd /k "set CORS_ORIGIN=http://127.0.0.1:5174&& npm.cmd run server"
start "SAN11 Frontend" cmd /k "npm.cmd run dev -- --host 127.0.0.1 --port 5174"

echo.
echo Two command windows have been opened. Close those windows to stop the services.
echo Opening the frontend page...
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5174"
endlocal
