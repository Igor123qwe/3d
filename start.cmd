@echo off
rem  Apartment planner: update and run.
rem  Double-click this file. All messages come from tools/start.mjs.
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode
where git >nul 2>nul
if errorlevel 1 goto nogit

if exist "tools\start.mjs" goto run
if exist "3d\tools\start.mjs" goto sub
echo Downloading the project from GitHub...
git clone https://github.com/Igor123qwe/3d.git "3d"
if errorlevel 1 goto fail
:sub
cd /d "%~dp0"
cd "3d"

:run
node "tools\start.mjs" %*
if errorlevel 1 goto fail
goto end

:nonode
echo Node.js 20 or newer is required. Install it from https://nodejs.org
goto fail

:nogit
echo Git is required. Install it from https://git-scm.com/download/win
goto fail

:fail
echo.
pause
exit /b 1

:end
