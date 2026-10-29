#Requires -Version 5.1
<#
  Stops only the processes this launcher started (PID files first), then anything
  still holding 9655/20128. Never kills unrelated node.exe processes.
#>
[CmdletBinding()]
param(
    [int[]]$Ports = @(9655, 20128)
)

$ErrorActionPreference = 'Stop'
$runDir = Join-Path $PSScriptRoot 'run'

foreach ($name in 'proxy', 'router') {
    $pidFile = Join-Path $runDir "$name.pid"
    if (-not (Test-Path $pidFile)) { continue }
    $procId = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($procId -match '^\d+$') {
        try {
            Stop-Process -Id ([int]$procId) -Force -ErrorAction Stop
            Write-Host "[$name] stopped pid $procId"
        } catch { Write-Host "[$name] pid $procId already gone" }
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

# 9router's cli.js is a supervisor: it respawns its HTTP child (and a --tray copy
# respawns detached), so killing only the child looks like "9router won't start".
# Kill supervisors first (shallowest first), then descendants, and repeat until
# nothing matches - a respawn between two passes is caught by the next one.
# The pattern covers both installs: the global one under node_modules\9router and
# the local build under 9router-source\cli\app (which the launcher prefers).
$patterns = 'node_modules[\\/]9router[\\/](cli\.js|app[\\/]custom-server\.js)|9router-source[\\/]cli[\\/]app[\\/]custom-server\.js|FreeDeepseekAPI[\\/](server\.js|scripts[\\/]start\.js)'

for ($pass = 1; $pass -le 4; $pass++) {
    $victims = @(Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $patterns -and $_.ProcessId -ne $PID } |
        Select-Object ProcessId, ParentProcessId, @{n = 'Depth'; e = { 0 } })

    if ($victims.Count -eq 0) { break }

    foreach ($v in $victims) {
        $depth = 0
        $parent = $v.ParentProcessId
        while (($victims.ProcessId -contains $parent) -and $depth -lt 10) {
            $depth++
            $parent = ($victims | Where-Object ProcessId -eq $parent).ParentProcessId
        }
        $v.Depth = $depth
    }

    foreach ($v in ($victims | Sort-Object Depth)) {
        try {
            Stop-Process -Id $v.ProcessId -Force -ErrorAction Stop
            Write-Host "[stop] pid $($v.ProcessId) (pass $pass)"
        } catch { }
    }
    Start-Sleep -Milliseconds 800
}

foreach ($port in $Ports) {
    $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $owners) {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId").CommandLine
        Write-Host "[port $port] still held by pid $procId (not ours): $cmd"
    }
}

Write-Host '[stop] done'
exit 0
