# 从 git 拉最新引擎并重启 MCP 服务
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $here
git pull --ff-only
if ($LASTEXITCODE -ne 0) { Write-Host 'git pull 失败（没配 remote 或没网），用 update.ps1 -repo <git地址> 先关联'; exit 1 }
Write-Host '已更新到最新版。请重启豆包/重启 mcp-server.cjs 生效。'
pause
