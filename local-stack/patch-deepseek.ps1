#Requires -Version 5.1
<#
  Re-points the installed 9router build at the local FreeDeepseekAPI proxy.
  Safe to run repeatedly: files already patched are skipped, originals are backed up once.
  Run this again after every `npm i -g 9router@latest`.
#>
[CmdletBinding()]
param(
    [string]$ProxyBase = 'http://127.0.0.1:9655',
    [string]$AppDir = "$env:APPDATA\npm\node_modules\9router\app"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $AppDir)) { throw "9router app dir not found: $AppDir (is 9router installed globally?)" }

$buildDir = Join-Path $AppDir '.next-cli-build\server'
if (-not (Test-Path $buildDir)) { throw "9router build dir not found: $buildDir" }

# Longest path first: DeepSeek's native paths do not match the proxy's /v1 layout.
$map = [ordered]@{
    'https://api.deepseek.com/anthropic/v1/messages' = "$ProxyBase/v1/messages"
    'https://api.deepseek.com/chat/completions'      = "$ProxyBase/v1/chat/completions"
    'https://api.deepseek.com/user/balance'          = "$ProxyBase/v1/user/balance"
    'https://api.deepseek.com/models'                = "$ProxyBase/v1/models"
    'https://api.deepseek.com'                       = "$ProxyBase/v1"
}

$backupRoot = Join-Path $env:APPDATA '9router\patch-backup'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$changed = 0
$skipped = 0

Get-ChildItem -LiteralPath $buildDir -Recurse -File -Filter *.js | ForEach-Object {
    $file = $_
    $text = Get-Content -LiteralPath $file.FullName -Raw
    if ($text -notmatch 'api\.deepseek\.com') { $skipped++; return }

    $updated = $text
    foreach ($from in $map.Keys) { $updated = $updated.Replace($from, $map[$from]) }

    if ($updated -eq $text) { $skipped++; return }

    $backup = Join-Path $backupRoot $stamp
    $rel = $file.FullName.Substring($AppDir.Length).TrimStart('\')
    $dest = Join-Path $backup $rel
    New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $dest -Force

    # No BOM, UTF-8, and keep the file exactly as Next expects (single-line chunks).
    [System.IO.File]::WriteAllText($file.FullName, $updated, (New-Object System.Text.UTF8Encoding($false)))
    $changed++
    Write-Host "[patched] $rel"
}

Write-Host "[patch] files changed: $changed, already clean: $skipped"
if ($changed -eq 0) { Write-Host '[patch] nothing to do - 9router already points at the local proxy.' }
else { Write-Host "[patch] backups in $backupRoot\$stamp" }
