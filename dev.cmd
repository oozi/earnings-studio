@echo off
rem Start the BXCI Earnings Studio dev server (uses the portable Node in .tools).
cd /d "%~dp0"
set "PATH=%~dp0.tools\node;%PATH%"
call "%~dp0.tools\node\npm.cmd" run dev
