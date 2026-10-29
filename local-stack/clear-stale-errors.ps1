#Requires -Version 5.1
<#
  Clears the stale 401 "Incorrect API key" that 9router recorded for the DeepSeek
  connection before the local proxy was wired up. The proxy accepts any key, so the
  old error and the model lock it set are just leftovers that block the model picker.
  Run with 9router stopped, then start it again.
#>
[CmdletBinding()]
param(
    [string]$DbPath = "$env:APPDATA\9router\db\data.sqlite",
    [string]$ConnectionId = 'deepseek-local-connection'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $DbPath)) { throw "DB not found: $DbPath" }

$listening = Get-NetTCPConnection -LocalPort 20128 -State Listen -ErrorAction SilentlyContinue
if ($listening) { throw '9router is running on 20128. Run stop.ps1 first so the DB write is not overwritten by its cache.' }

$sqliteDir = "$env:APPDATA\9router\runtime\node_modules\better-sqlite3"
if (-not (Test-Path $sqliteDir)) { throw "better-sqlite3 not found at $sqliteDir" }

$backup = "$DbPath.backup-before-cleanup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $DbPath -Destination $backup -Force
Write-Host "[db] backup: $backup"

$env:NR_DB = $DbPath
$env:NR_SQLITE = $sqliteDir
$env:NR_CONN = $ConnectionId

$script = @'
const Database = require(process.env.NR_SQLITE);
const db = new Database(process.env.NR_DB);

const row = db.prepare("SELECT id, data FROM providerConnections WHERE id = ?").get(process.env.NR_CONN);
if (!row) { console.log("[db] connection not found:", process.env.NR_CONN); process.exit(1); }

const data = JSON.parse(row.data || "{}");
const dropped = [];
for (const key of Object.keys(data)) {
  if (key === "lastError" || key === "lastErrorAt" || key === "errorCode" || key === "backoffLevel") {
    delete data[key];
    dropped.push(key);
  } else if (key.startsWith("modelLock_")) {
    delete data[key];
    dropped.push(key);
  }
}
data.testStatus = "active";

db.prepare("UPDATE providerConnections SET data = ?, isActive = 1, updatedAt = ? WHERE id = ?")
  .run(JSON.stringify(data), new Date().toISOString(), row.id);

console.log("[db] cleared:", dropped.join(", ") || "(nothing)");
console.log("[db] provider:", JSON.parse(row.data).provider ?? "(unchanged)");
'@

$script | & (Get-Command node.exe).Source -
if ($LASTEXITCODE -ne 0) { throw 'DB cleanup failed' }
Write-Host '[db] done'
