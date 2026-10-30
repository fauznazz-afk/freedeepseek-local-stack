#Requires -Version 5.1
<#
  Writes %USERPROFILE%\.local\bin\deepseek-local.cmd so the `deepseek-local`
  command works from anywhere, whatever folder this repo was cloned into.
  Idempotent: re-run after moving the repo.
#>
[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'

$stackDir = (Resolve-Path (Join-Path $PSScriptRoot '..\local-stack')).Path
$binDir = Join-Path $env:USERPROFILE '.local\bin'
$shim = Join-Path $binDir 'deepseek-local.cmd'

if ($Uninstall) {
    if (Test-Path $shim) { Remove-Item $shim -Force; Write-Host "[shim] removed $shim" }
    else { Write-Host '[shim] nothing to remove' }
    exit 0
}

if (-not (Test-Path (Join-Path $stackDir 'deepseek-local.ps1'))) {
    throw "deepseek-local.ps1 not found in $stackDir"
}

New-Item -ItemType Directory -Path $binDir -Force | Out-Null

# %~dp0 of the shim, not of this script: the shim sits in .local\bin, so the
# repo path is baked in literally instead of being derived at run time.
$lines = @(
    '@echo off',
    'setlocal',
    ('set "STACK_DIR=' + $stackDir + '"'),
    'if not exist "%STACK_DIR%\deepseek-local.ps1" (',
    '    echo deepseek-local: cannot find "%STACK_DIR%\deepseek-local.ps1"',
    '    echo Run: powershell -File <repo>\scripts\install-shim.ps1',
    '    exit /b 1',
    ')',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%STACK_DIR%\deepseek-local.ps1" %*',
    'exit /b %ERRORLEVEL%'
)
[System.IO.File]::WriteAllLines($shim, $lines, (New-Object System.Text.ASCIIEncoding))
Write-Host "[shim] wrote $shim"

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($userPath -split ';' | Where-Object { $_ })
if ($parts -notcontains $binDir) {
    [Environment]::SetEnvironmentVariable('Path', (($parts + $binDir) -join ';'), 'User')
    Write-Host "[shim] added $binDir to your user PATH (open a new terminal)"
} else {
    Write-Host '[shim] PATH already contains it'
}
