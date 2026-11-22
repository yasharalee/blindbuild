@echo off
rem blindbuild launcher for this project (works even when PowerShell scripts are blocked).
rem Usage: .devteam\bb.cmd ^<start^|stop^|halt^|status^|run-once^|verify-rules^>
setlocal
set "record=%USERPROFILE%\.devteam\plugin-root.txt"
if not exist "%record%" set "record=%~dp0plugin-root.txt"
if not exist "%record%" (echo blindbuild: plugin location unknown. Run init again. 1>&2 & exit /b 1)
set /p root=<"%record%"
pushd "%~dp0.."
node "%root%\scripts\cli.mjs" %*
set "code=%errorlevel%"
popd
exit /b %code%
