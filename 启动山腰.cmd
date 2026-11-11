@echo off
setlocal
cd /d "%~dp0"

set "NPM_CMD="
if exist "%ProgramFiles%\nodejs\npm.cmd" (
  set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"
)
if not defined NPM_CMD (
  where npm.cmd >nul 2>nul
  if not errorlevel 1 set "NPM_CMD=npm.cmd"
)
if not defined NPM_CMD (
  echo Node.js 20 or newer is required.
  pause
  exit /b 1
)

if not exist "node_modules\vite\package.json" (
  echo Installing project dependencies...
  call "%NPM_CMD%" install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting the Shanyao-Daigang digital town...
call "%NPM_CMD%" run start

if errorlevel 1 (
  echo.
  echo Startup failed. Review the messages above.
  pause
)
endlocal
