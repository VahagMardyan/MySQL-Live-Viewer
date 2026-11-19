@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Run from the project folder, even when started by double-click or from elsewhere.
cd /d "%~dp0"
title MySQL Live Viewer

rem ---- make sure .env exists ----
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo Created .env from .env.example. Fill in your MySQL settings, save, then run start.bat again.
        start "" notepad ".env"
    ) else (
        echo .env not found. Create it first, see README.md.
    )
    pause
    exit /b 1
)

rem ---- read the current DB_NAME ----
set "DB="
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="DB_NAME" set "DB=%%B"
)
if not defined DB set "DB=(not set)"

echo Starting MySQL Live Viewer...
echo.
echo Current database: %DB%
choice /c YN /n /m "Do you want to open another database? [Y/N] "
rem choice sets errorlevel 1 for Y and 2 for N, and accepts y/Y and n/N.
if errorlevel 2 goto run

:ask
set "NEWDB="
set /p "NEWDB=New database name: "
if not defined NEWDB goto ask

rem ---- write the new name into .env ----
rem PowerShell checks the name and replaces only the DB_NAME line, keeping every other line.
rem It reads and writes UTF-8 without a BOM, so passwords with non-English letters stay intact.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$n = $env:NEWDB; if ($n -notmatch '^[A-Za-z0-9_$-]{1,64}$') { exit 2 }; $p = (Resolve-Path -LiteralPath '.env').Path; $found = $false; $out = foreach ($l in [IO.File]::ReadAllLines($p)) { if ($l -match '^\s*DB_NAME\s*=') { $found = $true; 'DB_NAME=' + $n } else { $l } }; if (-not $found) { $out = @($out) + ('DB_NAME=' + $n) }; [IO.File]::WriteAllLines($p, [string[]]$out)"
if errorlevel 2 (
    echo Use only letters, digits, _ $ or - ^(up to 64 characters^).
    goto ask
)
if errorlevel 1 (
    echo Could not update .env.
    pause
    exit /b 1
)
echo Saved: DB_NAME=%NEWDB%

:run
echo.
rem npm is a .cmd file, so it needs "call" or this script would stop after it.
call npm start
rem Keep the window open if the server failed to start (e.g. wrong database name).
if errorlevel 1 pause
