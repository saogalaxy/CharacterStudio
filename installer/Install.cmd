@echo off
setlocal
cd /d "%~dp0"
title Character Studio Setup
echo.
echo Character Studio Setup
echo ----------------------
echo This copies the app onto this PC and creates Start Menu / desktop shortcuts.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-CharacterStudio.ps1" %*
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo Install failed with code %ERR%.
  pause
  exit /b %ERR%
)
echo Launch Character Studio from the desktop or Start Menu.
pause
endlocal
