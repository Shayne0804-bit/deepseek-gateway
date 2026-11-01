@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js est introuvable.
  echo   Installez Node.js 24 ou superieur depuis https://nodejs.org/ puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist "data" mkdir "data"

node server.js

echo.
echo   La passerelle s'est arretee.
pause
