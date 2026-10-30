#Requires -Version 5.1
<#
  Add or refresh one DeepSeek login using the dedicated Chrome-for-Testing
  profile flow (scripts/deepseek_chrome_auth.js). Same mechanism as the main
  auth, per account: a persisted profile per account keeps its session alive,
  so the captured token can be re-captured fresh any time instead of going
  stale like a static cookie export.

  Usage:
    pwsh -File add-account.ps1 -Name akun2            # new login (log in inside the opened window)
    pwsh -File add-account.ps1 -Name akun2 -Refresh   # re-capture from the still-logged-in profile
    pwsh -File add-account.ps1 -Name akun2 -Restart   # also deepseek-local restart afterwards

  The auth window is a normal Chrome window: log in with the account's own
  email (must differ from every other account), send one short prompt, then
  press Enter in the terminal to capture.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name,
    [string]$OutPath = '',
    [switch]$Restart
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

if (-not ($Name -match '^[A-Za-z0-9._-]+$')) { throw "Name may only contain letters, digits, . _ - (got '$Name')" }
if (-not $OutPath) { $OutPath = Join-Path $repo "accounts\$Name.json" }
$profileDir = Join-Path $repo ".chrome-profiles\$Name"
New-Item (Split-Path -Parent $OutPath) -ItemType Directory -Force | Out-Null
New-Item $profileDir -ItemType Directory -Force | Out-Null

# One DevTools port per account so two auth windows can run side by side:
# 9334 is the main account's default, then 9334 + trailing digits of the name.
$port = 9334
if ($Name -match '(\d+)\s*$') { $port += [int]$Matches[1] }

$env:DEEPSEEK_CHROME_PROFILE     = $profileDir
$env:DEEPSEEK_CHROME_PORT        = "$port"
$env:DEEPSEEK_AUTH_PATH          = $OutPath
# Keep the profile so a later -Refresh reads the still-logged-in session.
$env:DEEPSEEK_KEEP_CHROME_PROFILE = '1'
if ($Refresh) { $env:DEEPSEEK_REUSE_CHROME = '1' }

Push-Location $repo
try {
    npm run deepseek:auth
    if ($LASTEXITCODE -ne 0) { throw "deepseek:auth exited with $LASTEXITCODE (capture failed?" }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host "[auth] captured -> $OutPath" -ForegroundColor Green
if (Test-Path $OutPath) {
    $env:CAPTURED_AUTH_FILE = $OutPath
    node -e "const c = require(process.env.CAPTURED_AUTH_FILE); console.log('token:', c.token ? c.token.length + ' chars' : 'MISSING', '| cookie entries:', (c.cookie || '').split(';').filter(Boolean).length)"
}
if ($Restart) { deepseek-local restart }
else { Write-Host 'aktifkan: deepseek-local restart' }
