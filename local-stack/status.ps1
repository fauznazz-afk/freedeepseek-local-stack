#Requires -Version 5.1
<#
  One-glance status for the local stack: is the proxy up, is 9router up, and
  which 9router build is actually serving. Read-only - never starts or stops
  anything. Exit code is 0 only when both services answer.
#>
[CmdletBinding()]
param(
    [int]$ProxyPort = 9655,
    [int]$RouterPort = 20128
)

$ErrorActionPreference = 'Stop'

function Test-Port([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $task.Wait(400)) { return $false }
        return $client.Connected
    } catch { return $false } finally { $client.Dispose() }
}

function Get-RouterBuild {
    # Which 9router is on the port: the local build from 9router-source, or the
    # global npm install. This is the thing that silently differs between runs.
    $conn = Get-NetTCPConnection -LocalPort $RouterPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $conn) { return $null }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $proc -or -not $proc.CommandLine) { return $null }

    # The command line is not a path: pull the script argument out of it, then
    # read the version from the package.json sitting next to that script.
    $scriptPath = $null
    if ($proc.CommandLine -match '([A-Za-z]:\\[^"]*?custom-server\.js)') {
        $scriptPath = $Matches[1]
    }
    $appDir = if ($scriptPath) { Split-Path $scriptPath -Parent } else { $null }

    $version = ''
    if ($appDir) {
        $pkg = Join-Path $appDir 'package.json'
        if (Test-Path $pkg) {
            try { $version = (Get-Content $pkg -Raw | ConvertFrom-Json).version } catch { }
        }
    }

    if ($proc.CommandLine -match '9router-source') {
        return @{ Kind = 'local build'; Path = '9router-source\cli\app'; Version = $version }
    }
    if ($proc.CommandLine -match 'node_modules\\9router') {
        return @{ Kind = 'global install'; Path = '%APPDATA%\npm\node_modules\9router\app'; Version = $version }
    }
    return @{ Kind = 'unknown'; Path = $(if ($appDir) { $appDir } else { $proc.CommandLine }); Version = $version }
}

$proxyUp = Test-Port $ProxyPort
$routerUp = Test-Port $RouterPort

Write-Host ''
if ($proxyUp) {
    try {
        $h = Invoke-RestMethod "http://127.0.0.1:$ProxyPort/health" -TimeoutSec 8
        $acct = @($h.accounts).Count
        $ready = @($h.accounts | Where-Object { $_.ready }).Count
        $ttl = $h.session_reuse.ttl_minutes
        Write-Host ("  proxy    UP    port {0}  |  {1} account(s), {2} ready  |  session ttl {3}m" -f `
            $ProxyPort, $acct, $ready, $ttl) -ForegroundColor Green
    } catch {
        Write-Host ("  proxy    UP    port {0}  |  /health did not answer" -f $ProxyPort) -ForegroundColor Yellow
    }
} else {
    Write-Host ("  proxy    DOWN  port {0}" -f $ProxyPort) -ForegroundColor Red
}

if ($routerUp) {
    $b = Get-RouterBuild
    if ($b) {
        $ver = if ($b.Version) { " v$($b.Version)" } else { '' }
        Write-Host ("  9router  UP    port {0}  |  {1}{2}  ({3})" -f $RouterPort, $b.Kind, $ver, $b.Path) -ForegroundColor Green
    } else {
        Write-Host ("  9router  UP    port {0}" -f $RouterPort) -ForegroundColor Green
    }
} else {
    Write-Host ("  9router  DOWN  port {0}" -f $RouterPort) -ForegroundColor Red
}

Write-Host ''
if ($proxyUp -and $routerUp) {
    Write-Host '  Ready. Open your client and pick a DeepSeek model.' -ForegroundColor Green
    Write-Host ''
    exit 0
}

Write-Host '  Not ready. Start it with:  deepseek-local' -ForegroundColor Yellow
Write-Host ''
exit 1
