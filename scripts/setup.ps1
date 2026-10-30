#Requires -Version 5.1
<#
  One-shot setup for a fresh clone on Windows. Idempotent - safe to re-run.

    1. check Node.js >= 18
    2. create local-stack\settings.local.ps1 from the example if missing
    3. install the deepseek-local shim
    4. warn if 9router is missing (the proxy works without it)
    5. print the next steps

  It does NOT sign in to DeepSeek: that needs a human in a browser window.
#>
[CmdletBinding()]
param([switch]$SkipShim)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fail = 0

function Step([string]$Name, [scriptblock]$Body) {
    try { $r = & $Body; Write-Host ("[ ok ] {0}{1}" -f $Name, $(if ($r) { ": $r" } else { '' })) }
    catch { Write-Host ("[FAIL] {0}: {1}" -f $Name, $_.Exception.Message) -ForegroundColor Red; $script:fail++ }
}

Write-Host ''
Write-Host 'FreeDeepseekAPI setup' -ForegroundColor Cyan
Write-Host "repo: $repo"
Write-Host ''

Step 'node version' {
    $node = Get-Command node -ErrorAction Stop
    $major = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
    if ($major -lt 18) { throw "Node $major found, need 18+" }
    "v$major ($($node.Source))"
}

Step 'settings.local.ps1' {
    $target = Join-Path $repo 'local-stack\settings.local.ps1'
    if (Test-Path $target) { return 'already present' }
    Copy-Item (Join-Path $repo 'local-stack\settings.local.example.ps1') $target
    'created from example'
}

if (-not $SkipShim) {
    Step 'deepseek-local shim' { & (Join-Path $PSScriptRoot 'install-shim.ps1') | Out-Host }
}

Step '9router (optional)' {
    $candidates = @(
        (Join-Path $repo '9router-source\cli\app'),
        (Join-Path $env:APPDATA 'npm\node_modules\9router\app')
    )
    $found = $candidates | Where-Object { Test-Path (Join-Path $_ 'custom-server.js') } | Select-Object -First 1
    if ($found) { return $found }
    Write-Host '         no 9router build found - the proxy still runs on its own.' -ForegroundColor Yellow
    Write-Host '         for the full chain: npm i -g 9router' -ForegroundColor DarkGray
    return $null
}

Write-Host ''
if ($fail -gt 0) { Write-Host "[setup] $fail step(s) failed" -ForegroundColor Red; exit 1 }

Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. npm run auth                 sign in to DeepSeek (opens Chrome)'
Write-Host '  2. deepseek-local start         start proxy (+ 9router if installed)'
Write-Host '  3. deepseek-local verify        prove the chain reaches DeepSeek'
Write-Host ''
Write-Host 'Proxy-only users can skip the shim and run: npm start' -ForegroundColor DarkGray
Write-Host ''
exit 0
