@echo off
rem ===========================================================================
rem  DSAgent Portable - Updater (double-click entry)
rem
rem  IMPORTANT: keep this file PURE ASCII with CRLF line endings.
rem  cmd.exe parses .cmd using the system ANSI code page (GBK on Chinese
rem  Windows). UTF-8 Chinese comments get mis-decoded and then executed as
rem  commands. All Chinese user-facing text is printed by update.ps1 instead.
rem
rem  The real logic lives in update.ps1. Your data/ folder is never touched.
rem ===========================================================================

setlocal
rem Switch the console to UTF-8 so the Chinese output printed by update.ps1
rem renders correctly. This is a pure-ASCII command, so it is safe here.
chcp 65001 >nul

cd /d "%~dp0"

set "PS="
where pwsh >nul 2>nul && set "PS=pwsh"
if not defined PS (
  where powershell >nul 2>nul && set "PS=powershell"
)

if not defined PS (
  echo.
  echo  PowerShell not found. Cannot update.
  echo.
  pause
  exit /b 1
)

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" %*

echo.
pause
endlocal
