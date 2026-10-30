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

# When every login is cooling down (e.g. right after a rate-limit burst), the
# completion check below is doomed no matter what. Wait once for the shortest
# cooldown (capped, so a misconfigured 10-minute lock does not hang the script),
# then proceed; the completion step reports the real state if it still fails.
function Wait-ForCooldown {
    try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:$ProxyPort/health" -TimeoutSec 10 } catch { return }
    $cooling = @($h.accounts | Where-Object { $_.ready -eq $false -and $_.has_credentials -eq $true })
    if ($cooling.Count -lt $h.accounts.Count) { return }
    $waitS = [Math]::Min(90, ($cooling | Measure-Object -Property cooldown_remaining_sec -Minimum).Minimum + 2)
    Write-Host ("[wait] all {0} account(s) cooling down; waiting {1}s..." -f $h.accounts.Count, $waitS)
    Start-Sleep -Seconds $waitS
}

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

Wait-ForCooldown

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
