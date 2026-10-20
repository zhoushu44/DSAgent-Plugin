# 确认 DSH Desktop 的真实可执行入口：
# - lnk 指向 D:\Program Files\DSH Desktop\DSH Desktop.exe（不存在）
# - 但存在 C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe（Electron 应用）
# 检查 Roaming\dsh-desktop 是否由 DeepSeek Harness 使用（userData 目录名是否 dsh-desktop）
# 读 harness.log 尾部看上次启动记录
Write-Output '=== harness.log tail ==='
Get-Content 'C:\Users\Administrator\AppData\Roaming\dsh-desktop\logs\harness.log' -Tail 40
