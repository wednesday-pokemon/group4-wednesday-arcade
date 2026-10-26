@echo off
rem Laptop 1 = spectator / operator dashboard (fullscreen app window; F11 leaves fullscreen).
rem Without -Live: mystery LOCAL DEMO board (/?mode=dashboard&demo=1). With -Live: /?mode=dashboard.
rem Default URL: %RAVEN_BASE_URL% or http://localhost:4173  (start scripts\kiosk\serve-dist.cmd first).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-kiosk.ps1" -Role dashboard %*
if errorlevel 1 pause
