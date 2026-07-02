@echo off
rem Type-check and build the single-file bundle to dist\index.html.
cd /d "%~dp0"
set "PATH=%~dp0.tools\node;%PATH%"
call "%~dp0.tools\node\npm.cmd" run build
