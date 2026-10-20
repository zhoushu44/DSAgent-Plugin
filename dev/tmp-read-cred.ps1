$ErrorActionPreference = 'Stop'
# 解密凭证库 aes-256-gcm 太重，先看文件里是否能读到明文 status（很多实现是整体加密）。
# 退而求其次：grep 文本里 3b422bc 附近的 status 字段
$raw = Get-Content 'C:\Users\Administrator\.dsh\dsagent-accounts.json' -Raw -ErrorAction SilentlyContinue
Write-Output ("file len: {0}" -f $raw.Length)
Write-Output ("file head[0:300]: {0}" -f $raw.Substring(0, [Math]::Min(300, $raw.Length)))
$idx = $raw.IndexOf('3b422bc')
if ($idx -ge 0) {
  $start = [Math]::Max(0, $idx - 100)
  $len = [Math]::Min(400, $raw.Length - $start)
  Write-Output ("around 3b422bc: {0}" -f $raw.Substring($start, $len))
} else {
  Write-Output '3b422bc not found in plaintext (encrypted blob)'
}
