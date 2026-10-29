#Requires -Version 5.1
<#
  End-to-end check: proxy up, 9router up, and a real completion routed through
  9router -> FreeDeepseekAPI. Exits non-zero on the first failure.
#>
[CmdletBinding()]
param(
    [int]$ProxyPort = 9655,
    [int]$RouterPort = 20128,
    # Never commit a real key. Read it from the environment, or pass -RouterKey.
    [string]$RouterKey = $(if ($env:NINEROUTER_KEY) { $env:NINEROUTER_KEY } else { 'local' }),
    [string]$Model = 'ds/deepseek-v4-flash'
)

$ErrorActionPreference = 'Stop'
$fail = 0

function Step([string]$Name, [scriptblock]$Body) {
    try {
        $result = & $Body
        Write-Host ("[ ok ] {0}: {1}" -f $Name, $result)
    } catch {
        Write-Host ("[FAIL] {0}: {1}" -f $Name, $_.Exception.Message)
        $script:fail++
    }
}

Step 'proxy /health' {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$ProxyPort/health" -TimeoutSec 10
    "status=$($r.status) models=$($r.models.Count) accounts=$($r.accounts.Count)"
}

Step 'proxy /v1/models' {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$ProxyPort/v1/models" -TimeoutSec 10
    ($r.data.id -join ', ')
}

Step '9router root' {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$RouterPort/" -UseBasicParsing -TimeoutSec 15
    "HTTP $($r.StatusCode)"
}

Step '9router /v1/models (deepseek only)' {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$RouterPort/v1/models" -Headers @{ Authorization = "Bearer $RouterKey" } -TimeoutSec 20
    ($r.data | Where-Object { $_.id -match 'deepseek' } | Select-Object -ExpandProperty id) -join ', '
}

Step "9router -> proxy completion ($Model)" {
    $body = @{
        model      = $Model
        messages   = @(@{ role = 'user'; content = 'Reply with exactly: CHAIN_OK' })
        stream     = $false
        max_tokens = 20
    } | ConvertTo-Json -Depth 6
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$RouterPort/v1/chat/completions" -Method Post `
        -ContentType 'application/json' -Headers @{ Authorization = "Bearer $RouterKey" } `
        -Body $body -TimeoutSec 120
    "answer='$($r.choices[0].message.content.Trim())' model=$($r.model)"
}

Write-Host ''
if ($fail -gt 0) { Write-Host "[verify] $fail check(s) failed"; exit 1 }
Write-Host '[verify] all checks passed'
exit 0
