# Batch fetch all e-commerce software download links from ysepan API
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$apiUrl = "https://c6.ysepan.com/api/wj/wjdq"

# All e-commerce related item IDs (bh values only)
$bhList = @(
    1939888, 1976337, 1994192, 1996492, 1983069, 1996503, 1979500,
    1938087, 1988541, 1989489, 1989488, 1995966, 1996622, 1938093,
    1992076, 1996618, 1994273, 1993946, 1938079, 1938083, 1994036, 1993944,
    1987020, 1938084, 1938076, 1993844, 1996491, 1995965, 1940913,
    1993857, 1992691, 1996624, 1938075, 1996621, 1996505,
    1976332, 1938077, 1980416, 1981377,
    1996619, 1993781, 1987154, 1938095, 1986514,
    1986513, 1993849, 1996632, 1980650, 1996474, 1945612,
    1993843, 1938091, 1979519, 1979518, 1992958, 1992961, 1979504, 1979503,
    1996617, 1945616, 1985307, 1989487,
    1979502, 1992959, 1996483,
    1938260, 1993087,
    1946294, 1986515, 1992962, 1986516, 1938267, 1986557, 1983994,
    1996479, 1995970, 1993845, 1997047,
    1990552,
    1984761, 1995905, 1996472, 1986554, 1992960,
    1996613, 1986566, 1996623, 1993833, 1994106, 1995949, 1996501,
    1992957, 1989212, 1995956, 1995958, 1995957, 1994224, 1996504,
    1990548, 1938270, 1996488, 1996495,
    1996384, 1996500, 1996484, 1996493, 1990549, 1996480, 1952989, 1993829, 1993779,
    1993846, 1993780, 1963771, 1976331, 1982414, 1980649, 1993837, 1996486, 1996615,
    1988208, 1986558, 1979530, 1996773, 1996626,
    1996614, 1993854, 1993850, 1992311, 1979501, 1996385,
    1995964, 1993855, 1976335, 1956126, 1996620,
    1980456, 1990547, 1995968,
    1981378, 1996502, 1995913, 1993830, 1996485, 1993842, 1996425,
    1995963, 1996627, 1989857, 1996496, 1982415, 1996499, 1986552,
    1996633, 1992696, 1986560, 1993783, 1995916, 1964540, 1986555,
    1986556, 1993839, 1993852, 1991092, 1993836, 1993851, 1995955,
    1995954, 1996497, 1996498, 1938088, 1993856, 1996008,
    1996080, 1996489, 1996772, 1996625, 1993777, 1993835, 1997049,
    1976330, 1993841, 1995967, 1996792,
    1988239, 1996494, 1996183, 1993838,
    1995952, 1995953, 1995950, 1995948, 1995951, 1995947, 1995904,
    1993834, 1995946, 1979529, 1995969, 1995915, 1995962,
    1995962, 1993853, 1995973, 1995959,
    1995961, 1993848, 1996481, 1995914, 1995912, 1995911, 1996490,
    1995910, 1996487, 1996482, 1995909, 1995908, 1994184, 1994186
)

$exportDir = "e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\downloads"
if (!(Test-Path $exportDir)) { New-Item -ItemType Directory -Path $exportDir -Force | Out-Null }

$allResults = @()
$directFiles = @()

Write-Host "Processing $($bhList.Count) items..."

for ($i = 0; $i -lt $bhList.Count; $i++) {
    $bh = $bhList[$i]
    $body = '{"mlbh":' + $bh + ',"kqmm":"","wjbh":0,"ip1":""}'
    
    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Method Post -Body $body -ContentType "application/json" -TimeoutSec 15
        $files = $response.lb
        $itemLinks = @()
        
        if ($files) {
            foreach ($f in $files) {
                $url = [string]$f.wjm
                $title = [string]$f.bt
                $itemLinks += "$title|||$url"
                
                if ($url -match '\.(zip|exe|rar|7z|msi|crx)(\?|$)') {
                    $directFiles += "$bh|||$title|||$url"
                }
            }
        }
        
        $allResults += "$bh|||" + ($itemLinks -join '###')
        $linkCount = if ($itemLinks) { $itemLinks.Count } else { 0 }
        Write-Host "[$($i+1)/$($bhList.Count)] bh=$bh links=$linkCount"
    } catch {
        Write-Host "[$($i+1)/$($bhList.Count)] bh=$bh ERROR: $($_.Exception.Message)"
        $allResults += "$bh|||ERROR"
    }
    
    Start-Sleep -Milliseconds 150
}

# Save all results
$allResults | Out-File -FilePath "$exportDir\all_links.txt" -Encoding UTF8

# Save direct file downloads
if ($directFiles.Count -gt 0) {
    $directFiles | Out-File -FilePath "$exportDir\direct_downloads.txt" -Encoding UTF8
    Write-Host "`nDirect file downloads: $($directFiles.Count)"
    $directFiles | ForEach-Object { Write-Host $_ }
}

Write-Host "`nResults saved to $exportDir\all_links.txt"
Write-Host "Total items: $($bhList.Count)"
