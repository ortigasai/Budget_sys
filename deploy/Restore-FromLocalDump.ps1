<#
.SYNOPSIS
    Makes the server's data identical to a dev machine's: replaces the
    server database with a pg_dump file and the upload folders with a zip.
    Run ON THE SERVER, in an Administrator PowerShell.

.DESCRIPTION
    Uses the server's own PostgreSQL tools and the connection already in
    backend\.env (DATABASE_URL), so no remote Postgres access or extra
    password is needed. Steps:
      1. Stops BudgetingSystemApi and BudgetingSystemPyApi.
      2. Backs up the current server database (pg_dump -Fc) and both upload
         folders into -BackupDir - this is your way back.
      3. Drops and recreates the database, then restores -DumpFile into it
         (everything: tables, data, migration history).
      4. If -UploadsZip is given: replaces backend\uploads and
         backend-py\uploads with the zip's backend\uploads and
         backend-py\uploads folders.
    The services stay stopped. Afterwards run Deploy-IIS.ps1 -SkipPrereqs,
    which deploys the code and starts them again.

    Make the dump on the dev machine with:
      pg_dump -d <local DATABASE_URL> -Fc --no-owner --no-acl -f budgeting-local.dump

.PARAMETER DumpFile
    The .dump file copied from the dev machine.

.PARAMETER UploadsZip
    Optional zip with backend\uploads and backend-py\uploads folders.

.PARAMETER PgBin
    PostgreSQL bin folder on the server. Defaults to PostgreSQL 18's.

.PARAMETER Force
    Skip the "type REPLACE to continue" confirmation.

.PARAMETER CheckOnly
    Only check the files, tools and connection and show what would happen -
    nothing is stopped, backed up or changed.

.EXAMPLE
    cd C:\BudgetingSystem\deploy
    .\Restore-FromLocalDump.ps1 -DumpFile C:\Temp\budgeting-local-20261104-1422.dump -UploadsZip C:\Temp\budgeting-uploads-20261104-1422.zip
    .\Deploy-IIS.ps1 -SkipPrereqs
#>
param(
    [Parameter(Mandatory)][string]$DumpFile,
    [string]$UploadsZip,
    [string]$DeployPath = "C:\BudgetingSystem",
    [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin",
    [string]$BackupDir = "C:\BudgetingSystem-backups",
    [switch]$Force,
    [switch]$CheckOnly
)
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }

# SQL goes through a temp file: Windows PowerShell 5.1 strips embedded double
# quotes from native-exe arguments, which would break "User" etc.
function Invoke-Sql($database, $sql) {
    $file = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($file, $sql)
        & (Join-Path $PgBin "psql.exe") -d $database -At -v ON_ERROR_STOP=1 -f $file | ForEach-Object { Write-Host "  $_" }
        return $LASTEXITCODE
    } finally {
        Remove-Item $file -Force -ErrorAction SilentlyContinue
    }
}

function Read-EnvFile($path) {
    $values = @{}
    if (-not (Test-Path $path)) { return $values }
    foreach ($line in Get-Content $path) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $values[$matches[1].ToUpper()] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $values
}

function Resolve-UploadDir($appDir, $value) {
    if ([string]::IsNullOrWhiteSpace($value)) { $value = "./uploads" }
    if ([IO.Path]::IsPathRooted($value)) { return $value }
    return [IO.Path]::GetFullPath((Join-Path $appDir $value))
}

# ---- Checks --------------------------------------------------------------
$DumpFile = (Resolve-Path $DumpFile).Path
if ($UploadsZip) { $UploadsZip = (Resolve-Path $UploadsZip).Path }
foreach ($tool in @("pg_dump.exe", "pg_restore.exe", "psql.exe")) {
    if (-not (Test-Path (Join-Path $PgBin $tool))) { throw "$tool not found in $PgBin - pass -PgBin with this server's PostgreSQL bin folder." }
}
$backendDir = Join-Path $DeployPath "backend"
$backendPyDir = Join-Path $DeployPath "backend-py"
$nodeEnv = Read-EnvFile (Join-Path $backendDir ".env")
$pyEnv = Read-EnvFile (Join-Path $backendPyDir ".env")
if (-not $nodeEnv.ContainsKey("DATABASE_URL")) { throw "DATABASE_URL not found in $backendDir\.env." }

# postgresql://user:password@host:port/dbname?schema=public
$uri = [Uri]($nodeEnv.DATABASE_URL -replace '^postgres(ql)?(\+\w+)?://', 'http://')
$userInfo = $uri.UserInfo.Split(':', 2)
$env:PGUSER = [Uri]::UnescapeDataString($userInfo[0])
$env:PGPASSWORD = if ($userInfo.Count -gt 1) { [Uri]::UnescapeDataString($userInfo[1]) } else { "" }
$env:PGHOST = $uri.Host
$env:PGPORT = if ($uri.Port -gt 0) { "$($uri.Port)" } else { "5432" }
$dbName = $uri.AbsolutePath.Trim('/')
if (-not $dbName) { throw "Couldn't read the database name from DATABASE_URL." }

$nodeUploads = Resolve-UploadDir $backendDir $nodeEnv.UPLOAD_DIR
$pyUploads = Resolve-UploadDir $backendPyDir $pyEnv.UPLOAD_DIR

Write-Host "Database:        $dbName on $($env:PGHOST):$($env:PGPORT) as $($env:PGUSER)"
Write-Host "Restore from:    $DumpFile"
Write-Host "Uploads zip:     $(if ($UploadsZip) { $UploadsZip } else { '(none - upload folders left as they are)' })"
Write-Host "Upload folders:  $nodeUploads"
Write-Host "                 $pyUploads"
Write-Host "Backups go to:   $BackupDir"

$summarySql = @'
select 'users: ' || count(*) from "User";
select 'catalog items: ' || count(*) from "ExpenseLineItem";
select 'budget requests: ' || count(*) from "BudgetRequest";
select 'latest migration: ' || migration_name from _prisma_migrations order by finished_at desc nulls last limit 1;
'@

if ($CheckOnly) {
    Write-Step "Current data in $dbName (check only - nothing will be changed)"
    if ((Invoke-Sql $dbName $summarySql) -ne 0) { throw "Couldn't connect to $dbName with backend\.env's DATABASE_URL." }
    Write-Step "Dump file contents"
    $tables = (& (Join-Path $PgBin "pg_restore.exe") -l $DumpFile | Select-String "TABLE DATA").Count
    if ($LASTEXITCODE -ne 0) { throw "pg_restore can't read $DumpFile." }
    Write-Host "  $tables tables of data."
    exit 0
}

Write-Host ""
Write-Host "This REPLACES all data in '$dbName' with the dump file." -ForegroundColor Yellow
if (-not $Force) {
    $answer = Read-Host "Type REPLACE to continue"
    if ($answer -ne "REPLACE") { Write-Host "Cancelled - nothing changed."; exit 1 }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmm"
New-Item -ItemType Directory -Force $BackupDir | Out-Null

# ---- 1. Stop services ----------------------------------------------------
Write-Step "Stopping BudgetingSystemApi and BudgetingSystemPyApi"
foreach ($svc in @("BudgetingSystemApi", "BudgetingSystemPyApi")) {
    if (Get-Service $svc -ErrorAction SilentlyContinue) { Stop-Service $svc -Force; Write-Host "  $svc stopped." }
}

# ---- 2. Back up the server ----------------------------------------------
$dbBackup = Join-Path $BackupDir "server-db-before-restore-$stamp.dump"
Write-Step "Backing up the server database to $dbBackup"
& (Join-Path $PgBin "pg_dump.exe") -d $dbName -Fc -f $dbBackup
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed - nothing was changed. (Services are stopped; start them with Start-Service.)" }

foreach ($dir in @($nodeUploads, $pyUploads)) {
    if ((Test-Path $dir) -and (Get-ChildItem $dir -Force | Select-Object -First 1)) {
        $name = if ($dir -eq $pyUploads) { "backend-py" } else { "backend" }
        $zip = Join-Path $BackupDir "server-uploads-$name-before-restore-$stamp.zip"
        Compress-Archive -Path (Join-Path $dir "*") -DestinationPath $zip -Force
        Write-Host "  $dir -> $zip"
    }
}

# ---- 3. Replace the database --------------------------------------------
Write-Step "Recreating database $dbName"
$recreateSql = "DROP DATABASE IF EXISTS `"$dbName`" WITH (FORCE);`nCREATE DATABASE `"$dbName`";`n"
if ((Invoke-Sql "postgres" $recreateSql) -ne 0) { throw "Couldn't recreate the database. Your backup is $dbBackup." }

Write-Step "Restoring $DumpFile"
& (Join-Path $PgBin "pg_restore.exe") -d $dbName --no-owner --no-acl --single-transaction --exit-on-error $DumpFile
if ($LASTEXITCODE -ne 0) {
    throw "pg_restore failed (exit $LASTEXITCODE) - the database is empty now. Put the old data back with: & `"$PgBin\pg_restore.exe`" -d $dbName --no-owner --no-acl `"$dbBackup`""
}

# ---- 4. Replace the upload folders --------------------------------------
if ($UploadsZip) {
    Write-Step "Replacing upload folders from $UploadsZip"
    $stage = Join-Path $env:TEMP "budgeting-uploads-restore-$stamp"
    Expand-Archive -Path $UploadsZip -DestinationPath $stage -Force
    foreach ($pair in @(@("backend\uploads", $nodeUploads), @("backend-py\uploads", $pyUploads))) {
        $from = Join-Path $stage $pair[0]
        if (-not (Test-Path $from)) { Write-Host "  (zip has no $($pair[0]) - left as is)"; continue }
        if (Test-Path $pair[1]) { Remove-Item (Join-Path $pair[1] "*") -Recurse -Force }
        New-Item -ItemType Directory -Force $pair[1] | Out-Null
        Copy-Item (Join-Path $from "*") $pair[1] -Recurse -Force
        Write-Host "  $($pair[0]) -> $($pair[1]) ($((Get-ChildItem $pair[1] -File -Recurse).Count) files)"
    }
    Remove-Item $stage -Recurse -Force
}

# ---- Summary -------------------------------------------------------------
Write-Step "Done"
Invoke-Sql $dbName $summarySql | Out-Null
Write-Host ""
Write-Host "Services are still stopped. Next: .\Deploy-IIS.ps1 -SkipPrereqs (deploys the code and starts them)."
Write-Host "Backup of the old server data: $dbBackup"
