@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer first.
  pause
  exit /b 1
)
echo Open http://localhost:4173 in your browser.
echo Keep this window open while using Shuazi.
node --env-file-if-exists=.env server.mjs
pause
