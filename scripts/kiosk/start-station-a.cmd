@echo off
rem Laptop 2 = Station A. Double-click to open the game kiosk (Alt+F4 exits).
rem Extra options are passed through, e.g.:  start-station-a.cmd -Live   or   -BaseUrl https://raven.example.org
rem Default URL: %RAVEN_BASE_URL% or http://localhost:4173  (start scripts\kiosk\serve-dist.cmd first).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-kiosk.ps1" -Role station_a %*
if errorlevel 1 pause
