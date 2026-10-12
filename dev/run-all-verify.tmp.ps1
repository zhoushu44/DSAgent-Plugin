param()
$tests = @('verify-skill-governance.mjs','verify-patch-layer.mjs','verify-wiki.mjs','verify-wiki-textpath.mjs','verify-wiki-blockscalar.mjs','verify-pitfalls.mjs','verify-host-integration.mjs','verify-real-triggers.mjs','check-esm-purity.mjs','verify-esm-loadable.mjs','verify-commit-tree.mjs')
$root = 'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin'
$procs = @()
foreach ($t in $tests) {
  $out = Join-Path $env:TEMP "out_$t.log"
  $err = Join-Path $env:TEMP "err_$t.log"
  $procs += Start-Process -FilePath 'node' -ArgumentList "dev/$t" -WorkingDirectory $root -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
}
foreach ($p in $procs) { Wait-Process -Id $p.Id }
Write-Output '==== ALL DONE ===='
foreach ($t in $tests) {
  $out = Join-Path $env:TEMP "out_$t.log"
  $err = Join-Path $env:TEMP "err_$t.log"
  Write-Output "===== $t ====="
  if (Test-Path $out) { Get-Content $out -Tail 10 }
  if ((Test-Path $err) -and ((Get-Item $err).Length -gt 0)) { Write-Output '-- STDERR --'; Get-Content $err -Tail 10 }
}
