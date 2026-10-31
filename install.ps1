#Requires -Version 5.1
<#
  One-shot installer for the full FreeDeepseekAPI stack on Windows.

  What it does, in order:
    1. check Node.js >= 18 and npm
    2. create local-stack\settings.local.ps1 from the example
    3. install the `deepseek-local` command shim
    4. install 9router globally when no 9router build is present
    5. print the steps that still need a human (the DeepSeek browser login)

  It never signs in to DeepSeek: that needs a person in a browser window.
  It is idempotent: re-running it is safe and changes nothing already present.

  Usage:
    powershell -ExecutionPolicy Bypass -File install.ps1
    .\install.ps1 -SkipRouter      proxy only, no 9router
    .\install.ps1 -SkipShim        do not write deepseek-local.cmd / touch PATH
    .\install.ps1 -Check           report state only, install nothing
#>
[CmdletBinding()]
param(
    [switch]$SkipRouter,
    [switch]$SkipShim,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '.')).Path
$fail = 0
$warn = 0

function Step([string]$Name, [scriptblock]$Body) {
    try {
        $r = & $Body
        Write-Host ("[ ok ] {0}{1}" -f $Name, $(if ($r) { ": $r" } else { '' })) -ForegroundColor Green
    } catch {
        Write-Host ("[FAIL] {0}: {1}" -f $Name, $_.Exception.Message) -ForegroundColor Red
        $script:fail++
    }
}
function Note([string]$Name, [string]$Text) {
    Write-Host ("[note] {0}: {1}" -f $Name, $Text) -ForegroundColor Yellow
    $script:warn++
}

Write-Host ''
Write-Host 'FreeDeepseekAPI installer' -ForegroundColor Cyan
Write-Host "repo: $repo"
if ($Check) { Write-Host 'mode: check only (nothing will be installed)' -ForegroundColor DarkGray }
Write-Host ''

Step 'node.js >= 18' {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw 'node not found. Install Node 18+ from https://nodejs.org (LTS), then re-run.' }
    $major = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
    if ($major -lt 18) { throw "Node $major found, need 18+. Upgrade at https://nodejs.org." }
    "v$major ($($node.Source))"
}

Step 'npm' {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) { throw 'npm not found. It ships with Node.js; reinstall Node from https://nodejs.org.' }
    (& $npm.Source --version).Trim()
}

Step 'settings.local.ps1' {
    $target = Join-Path $repo 'local-stack\settings.local.ps1'
    if (Test-Path $target) { return 'already present (left untouched)' }
    if ($Check) { return 'missing (would create from example)' }
    Copy-Item (Join-Path $repo 'local-stack\settings.local.example.ps1') $target
    'created from local-stack\settings.local.example.ps1'
}

if ($SkipShim) {
    Note 'deepseek-local shim' 'skipped by -SkipShim; run local-stack\deepseek-local.ps1 directly'
} else {
    Step 'deepseek-local command' {
        if ($Check) {
            $shim = Join-Path $env:USERPROFILE '.local\bin\deepseek-local.cmd'
            if (Test-Path $shim) { return "present: $shim" }
            return 'missing (would install)'
        }
        & (Join-Path $repo 'scripts\install-shim.ps1') | Out-Host
        'installed (open a new terminal for PATH)'
    }
}

if ($SkipRouter) {
    Note '9router' 'skipped by -SkipRouter; the proxy still runs with npm start'
} else {
    Step '9router' {
        $localBuild = Join-Path $repo '9router-source\cli\app\custom-server.js'
        $globalApp = Join-Path $env:APPDATA 'npm\node_modules\9router\app\custom-server.js'
        if (Test-Path $localBuild) { return "local build: $localBuild" }
        if (Test-Path $globalApp) { return "global install: $globalApp" }
        if ($Check) { return 'missing (would run: npm i -g 9router)' }
        $npm = (Get-Command npm -ErrorAction Stop).Source
        Push-Location $repo
        try {
            & $npm i -g 9router 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "npm i -g 9router exited $LASTEXITCODE" }
        } finally { Pop-Location }
        if (-not (Test-Path $globalApp)) { throw 'install finished but 9router\app\custom-server.js is still missing' }
        "installed: $globalApp"
    }
}

Write-Host ''
if ($fail -gt 0) {
    Write-Host "[install] $fail step(s) failed - fix the [FAIL] lines above and re-run." -ForegroundColor Red
    Write-Host ''
    exit 1
}
if ($Check) {
    Write-Host '[install] check finished. Re-run without -Check to install.' -ForegroundColor Cyan
    Write-Host ''
    exit 0
}

Write-Host '[install] install finished.' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Next steps (first run only):' -ForegroundColor Cyan
Write-Host '  1. npm run auth              sign in to DeepSeek (opens a Chrome window)'
Write-Host '  2. deepseek-local start      start proxy on 9655 (+ 9router on 20128)'
Write-Host '  3. deepseek-local verify     prove the chain reaches DeepSeek'
Write-Host ''
Write-Host 'After that: deepseek-local status | restart | off' -ForegroundColor DarkGray
if ($warn -gt 0) { Write-Host "[$warn note(s) above are informational, not errors]" -ForegroundColor DarkGray }
Write-Host ''
exit 0
