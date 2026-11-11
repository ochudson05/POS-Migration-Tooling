@echo off
rem Double-click to open the Menu Hauler data viewer (http://127.0.0.1:8790). Close this window to stop it.
cd /d "%~dp0"
if not exist node_modules\wrangler (
  echo First run: installing Wrangler...
  call npm install --no-fund --no-audit || goto :fail
)
node node_modules\wrangler\bin\wrangler.js whoami | findstr /i /c:"You are logged in" >nul
if errorlevel 1 (
  echo Sign in to Cloudflare in the browser window that opens...
  node node_modules\wrangler\bin\wrangler.js login || goto :fail
)
start "" http://127.0.0.1:8790
node server.js
goto :eof
:fail
echo Something went wrong - see the message above.
pause
