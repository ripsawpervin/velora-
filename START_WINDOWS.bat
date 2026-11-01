@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24.x first, then reopen this launcher.
  pause
  exit /b 1
)
node -e "if(process.versions.node.split('.')[0]!=='24'){console.error('Please use Node.js 24.x for this project.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist node_modules\express (
  call npm ci
  if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection.
    pause
    exit /b 1
  )
)
echo Open http://localhost:3000 after the server starts.
call npm start
pause
