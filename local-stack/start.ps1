#Requires -Version 5.1
<#
  Starts FreeDeepseekAPI (9655) and 9router (20128) as hidden background processes,
  waits until both answer over HTTP, and records their PIDs.
  Non-interactive by design: no TUI account menu, no 9router tray/update supervisor,
  so nothing here depends on conda or a PowerShell profile.
#>
[CmdletBinding()]
param(
    [int]$ProxyPort = 9655,
    [int]$RouterPort = 20128,
    [switch]$Patch
)

$ErrorActionPreference = 'Stop'

# The proxy lives one level up from this script (local-stack/ is a subfolder of
# the proxy repo), so the layout works wherever the repo is cloned. Override with
# $env:FREEDEEPSEEK_DIR when the proxy is installed elsewhere.
$proxyDir = $env:FREEDEEPSEEK_DIR
if (-not $proxyDir) { $proxyDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
# 9router resolution order:
#   1. $env:NINEROUTER_APP       - explicit override, always wins
#   2. 9router-source/cli/app    - a build made from the checkout in this repo
#   3. global npm install        - `npm i -g 9router`
# The local build wins over the global one so editing 9router-source/ and
# rebuilding actually takes effect. Anyone who cloned the repo without building
# 9router still falls through to the global install and works.
$routerApp = $env:NINEROUTER_APP
if (-not $routerApp) {
    $localBuild = Join-Path $proxyDir '9router-source\cli\app'
    if (Test-Path (Join-Path $localBuild 'custom-server.js')) {
        $routerApp = $localBuild
    } else {
        $routerApp = Join-Path $env:APPDATA 'npm\node_modules\9router\app'
    }
}
$runDir    = Join-Path $PSScriptRoot 'run'
$logDir    = Join-Path $PSScriptRoot 'logs'
$node      = (Get-Command node.exe -ErrorAction Stop).Source

if (-not (Test-Path (Join-Path $proxyDir 'server.js'))) {
    throw "Proxy server.js not found in $proxyDir. Set `$env:FREEDEEPSEEK_DIR to the proxy folder."
}

New-Item -ItemType Directory -Path $runDir, $logDir -Force | Out-Null

# Local tuning lives in settings.local.ps1 (git-ignored). Loading it here means
# the values apply to the proxy process this script spawns, so they survive
# reboots without the user re-exporting anything. A broken file must not stop
# the stack from starting: warn and continue with defaults.
$settingsFile = Join-Path $PSScriptRoot 'settings.local.ps1'
if (Test-Path $settingsFile) {
    try {
        . $settingsFile
    } catch {
        Write-Host "[warn  ] $settingsFile failed to load: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "[warn  ] continuing with built-in defaults" -ForegroundColor Yellow
    }
}

function Test-Port([int]$Port) {
    # Fast probe: TcpClient with a short timeout, unlike Test-NetConnection which
    # can stall for seconds per call and made the launcher look hung.
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $task.Wait(400)) { return $false }
        return $client.Connected
    } catch { return $false } finally { $client.Dispose() }
}

function Wait-Http([string]$Url, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 700
    }
    return $false
}

if ($Patch) { & (Join-Path $PSScriptRoot 'patch-deepseek.ps1') | Out-Host }

# --- FreeDeepseekAPI -------------------------------------------------------
$proxyPidFile = Join-Path $runDir 'proxy.pid'
if (Test-Port $ProxyPort) {
    Write-Host "[proxy ] already listening on $ProxyPort"
} else {
    $env:PORT = "$ProxyPort"
    $env:SKIP_ACCOUNT_MENU = '1'   # skip the TUI account menu entirely
    $env:NON_INTERACTIVE = '1'
    $p = Start-Process -FilePath $node -ArgumentList @('server.js') -WorkingDirectory $proxyDir `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir 'proxy.out.log') `
        -RedirectStandardError  (Join-Path $logDir 'proxy.err.log')
    Set-Content -LiteralPath $proxyPidFile -Value $p.Id
    Write-Host "[proxy ] started pid $($p.Id) on $ProxyPort"
}

# --- 9router ---------------------------------------------------------------
# custom-server.js is the bundled Next standalone server: starting it directly
# bypasses cli.js, which is the piece that spawns a --tray supervisor, checks for
# updates and re-spawns on exit (the cause of "9router won't stay up").
$routerPidFile = Join-Path $runDir 'router.pid'
if (Test-Port $RouterPort) {
    Write-Host "[router] already listening on $RouterPort"
} else {
    if (-not (Test-Path $routerApp)) { throw "9router app dir not found: $routerApp" }
    $env:PORT = "$RouterPort"
    $env:HOSTNAME = '127.0.0.1'
    $env:NODE_ENV = 'production'
    $p = Start-Process -FilePath $node `
        -ArgumentList @('--dns-result-order=ipv4first', '--max-old-space-size=6144', (Join-Path $routerApp 'custom-server.js')) `
        -WorkingDirectory $routerApp -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir 'router.out.log') `
        -RedirectStandardError  (Join-Path $logDir 'router.err.log')
    Set-Content -LiteralPath $routerPidFile -Value $p.Id
    Write-Host "[router] started pid $($p.Id) on $RouterPort"
}

# --- health gates ----------------------------------------------------------
$proxyOk  = Wait-Http "http://127.0.0.1:$ProxyPort/health" 60
$routerOk = Wait-Http "http://127.0.0.1:$RouterPort/" 90

Write-Host ''
Write-Host ("[proxy ] {0}  http://127.0.0.1:{1}/dashboard" -f $(if ($proxyOk) { 'OK  ' } else { 'FAIL' }), $ProxyPort)
Write-Host ("[router] {0}  http://127.0.0.1:{1}" -f $(if ($routerOk) { 'OK  ' } else { 'FAIL' }), $RouterPort)

if (-not $proxyOk)  { Write-Host "[proxy ] see $(Join-Path $logDir 'proxy.err.log')" }
if (-not $routerOk) { Write-Host "[router] see $(Join-Path $logDir 'router.err.log')" }

if (-not $proxyOk -or -not $routerOk) { exit 1 }
exit 0
