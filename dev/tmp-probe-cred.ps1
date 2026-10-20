$ErrorActionPreference='Stop'
# 读凭证库里 3b422bc 的 Cookie，直接访问 mms 后台接口验证有效性（不开浏览器、不扫码）
$enc = Get-Content 'C:\Users\Administrator\.dsh\dsagent-accounts.json' -Raw
# 凭证是 aes-256-gcm 加密的，先看下文件结构是否明文可解析
Write-Output ("file len: {0}" -f $enc.Length)
Write-Output ("head: {0}" -f $enc.Substring(0, [Math]::Min(120, $enc.Length)))
