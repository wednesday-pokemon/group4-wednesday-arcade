@echo off
rem Serves the already-built dist\ folder with Vite's static preview server (no rebuild).
rem   serve-dist.cmd        -> http://localhost:4173 on THIS laptop only (recommended: one server per laptop)
rem   serve-dist.cmd lan    -> also on the LAN (http://<this-laptop-ip>:4173) for the other laptops
rem Keep this window open while the game is in use. Ctrl+C stops the server.
setlocal
cd /d "%~dp0..\.."
if not exist "dist\index.html" (
  echo dist\index.html not found. Build first:  npm run build
  pause
  exit /b 1
)
if not exist "node_modules\vite" (
  echo node_modules missing. Run once:  npm ci
  pause
  exit /b 1
)
set "HOSTFLAG="
if /i "%~1"=="lan" set "HOSTFLAG=--host"
echo Serving %CD%\dist on port 4173 %HOSTFLAG%
call npx vite preview --port 4173 --strictPort %HOSTFLAG%
pause
