Get-Process | Where-Object { $_.ProcessName -match 'dsh' } | Select-Object Id, ProcessName, MainWindowTitle | Format-List
'--- electron ---'
Get-Process electron -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, MainWindowTitle | Format-List
'--- port 9230 / 4173 ---'
(Get-NetTCPConnection -LocalPort 9230 -ErrorAction SilentlyContinue | Select-Object -First 3 OwningProcess, State) | Format-Table
(Get-NetTCPConnection -LocalPort 4173 -ErrorAction SilentlyContinue | Select-Object -First 3 OwningProcess, State) | Format-Table
