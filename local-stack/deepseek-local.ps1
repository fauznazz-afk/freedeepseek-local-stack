#Requires -Version 5.1
<#
  deepseek-local - one command for the whole local stack.

    deepseek-local            start proxy + 9router (and report status)
    deepseek-local start      same thing
    deepseek-local stop       stop both
    deepseek-local restart    stop, then start
    deepseek-local status     is it up? which 9router build is serving?
    deepseek-local verify     prove the full chain (client -> 9router -> proxy -> DeepSeek)

  Starting an already-running stack is a no-op, so calling it twice is safe.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'off', 'restart', 'status', 'verify', 'help')]
    [string]$Command = 'start',

    [switch]$Help
)

$ErrorActionPreference = 'Stop'

if ($Help) { $Command = 'help' }

$stackDir = $PSScriptRoot
$statusScript = Join-Path $stackDir 'status.ps1'
$startScript  = Join-Path $stackDir 'start.ps1'
$stopScript   = Join-Path $stackDir 'stop.ps1'
$verifyScript = Join-Path $stackDir 'verify.ps1'

function Show-Usage {
    Write-Host ''
    Write-Host '  deepseek-local - run the local DeepSeek stack (proxy 9655 + 9router 20128)'
    Write-Host ''
    Write-Host '    deepseek-local            start everything'
    Write-Host '    deepseek-local off        stop everything (alias: stop)'
    Write-Host '    deepseek-local restart    stop, wait for the ports to free, then start'
    Write-Host '    deepseek-local status     is it up, and which 9router build is serving'
    Write-Host '    deepseek-local verify     prove the whole chain end to end'
    Write-Host ''
}

function Wait-PortsFree([int[]]$Ports, [int]$Seconds) {
    # restart used to sleep a fixed 3s and then start, which raced: a socket in
    # TIME_WAIT still answers the probe, so start.ps1 reported "already
    # listening" and skipped launching, leaving the old (dead) state in place.
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        $busy = @($Ports | Where-Object {
                Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue
            })
        if ($busy.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

foreach ($required in @($statusScript, $startScript, $stopScript, $verifyScript)) {
    if (-not (Test-Path $required)) {
        Write-Host "  Broken install: missing $required" -ForegroundColor Red
        Write-Host '  Re-clone the repo, or re-create the shim in ~\.local\bin.' -ForegroundColor Yellow
        exit 1
    }
}

switch ($Command) {
    'help' {
        Show-Usage
        exit 0
    }
    'status' {
        & $statusScript
        exit $LASTEXITCODE
    }
    'stop' {
        & $stopScript
        exit $LASTEXITCODE
    }
    'off' {
        & $stopScript
        exit $LASTEXITCODE
    }
    'verify' {
        & $verifyScript
        exit $LASTEXITCODE
    }
    'restart' {
        & $stopScript
        if (-not (Wait-PortsFree -Ports @(9655, 20128) -Seconds 20)) {
            Write-Host ''
            Write-Host '  Ports still busy after 20s - something outside this launcher holds them.' -ForegroundColor Red
            Write-Host '  Run:  deepseek-local status   then check the owning process.' -ForegroundColor Yellow
            Write-Host ''
            exit 1
        }
        & $startScript
        $startExit = $LASTEXITCODE
        & $statusScript
        if ($startExit -ne 0) { exit $startExit }
        exit $LASTEXITCODE
    }
    'start' {
        & $startScript
        $startExit = $LASTEXITCODE
        # start.ps1 already prints OK/FAIL per service. Follow with a one-glance
        # summary so the user does not have to remember the port numbers.
        & $statusScript
        if ($startExit -ne 0) { exit $startExit }
        exit $LASTEXITCODE
    }
}
