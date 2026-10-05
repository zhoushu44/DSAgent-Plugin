@echo off
rem ===========================================================================
rem  DSAgent Portable - Launcher (double-click entry)
rem
rem  IMPORTANT: keep this file PURE ASCII with CRLF line endings.
rem  cmd.exe parses .cmd using the system ANSI code page (GBK on Chinese
rem  Windows). UTF-8 Chinese comments get mis-decoded, and the garbled text is
rem  then executed as commands, producing errors such as:
rem      '...' is not recognized as an internal or external command
rem  All Chinese user-facing text is printed by launch.ps1 instead.
rem
rem  The real logic lives in launch.ps1.
rem ===========================================================================

setlocal
rem Switch the console to UTF-8 so the Chinese output printed by launch.ps1
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
  echo  PowerShell not found. Windows 10/11 is required.
  echo.
  pause
  exit /b 1
)

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" %*

if errorlevel 1 (
  echo.
  echo  Startup failed. See the log above.
  pause
)

endlocal
