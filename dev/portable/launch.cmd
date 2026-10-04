@echo off
chcp 65001 >nul
setlocal

rem ===========================================================================
rem  DSAgent 绿色版 —— 双击入口
rem
rem  实际启动逻辑在 launch.ps1。这里只负责：
rem    1. 切到本文件所在目录（保证相对路径正确）
rem    2. 找到可用的 PowerShell
rem    3. 用 -ExecutionPolicy Bypass 绕过脚本执行策略限制
rem       （对方电脑通常不允许运行未签名脚本，这是必须的）
rem ===========================================================================

cd /d "%~dp0"

set "PS="
where pwsh >nul 2>nul && set "PS=pwsh"
if not defined PS (
  where powershell >nul 2>nul && set "PS=powershell"
)

if not defined PS (
  echo.
  echo  未找到 PowerShell，无法启动。
  echo  请确保系统为 Windows 10/11。
  echo.
  pause
  exit /b 1
)

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" %*

if errorlevel 1 (
  echo.
  echo  启动过程出现问题，请查看上方日志。
  pause
)

endlocal
