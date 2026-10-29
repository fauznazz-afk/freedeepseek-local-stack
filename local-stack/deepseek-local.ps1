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
    [ValidateSet('start', 'stop', 'restart', 'status', 'verify', 'help')]
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
    Write-Host '    deepseek-local stop       stop everything'
    Write-Host '    deepseek-local restart    stop, then start'
    Write-Host '    deepseek-local status     is it up, and which 9router build is serving'
    Write-Host '    deepseek-local verify     prove the whole chain end to end'
    Write-Host ''
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
    'verify' {
        & $verifyScript
        exit $LASTEXITCODE
    }
    'restart' {
        & $stopScript
        Start-Sleep -Seconds 3
        & $startScript
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
