<#
.SYNOPSIS
    Runs the Prisma and Alembic migrations from this machine against a
    remote PostgreSQL server.

.DESCRIPTION
    This does NOT touch backend/.env or backend-py/.env - it builds the two
    DATABASE_URL connection strings for this run only (via $env:DATABASE_URL,
    which both Prisma and pydantic-settings prefer over whatever is in
    .env), then runs:
        backend:     node (repo root's node_modules\prisma\build\index.js) migrate deploy
        backend-py:  venv\Scripts\alembic.exe upgrade head
    against that remote database. Your local dev .env files - and therefore
    your local Postgres - are left exactly as they are.

    Where the password comes from (checked in this order):
      1. deploy\.env.server, if it exists - copy deploy\.env.server.example
         to deploy\.env.server and fill in SERVER_DATABASE_HOST/PORT/NAME/
         USER/PASSWORD there once (the password typed exactly as-is, no
         manual encoding needed even if it contains @ : / ? # etc. - this
         script percent-encodes it the same way either path works), and
         every future run of this script picks it up with no prompt. That
         file is git-ignored (see .gitignore), but it IS a real password
         sitting in a plaintext file on this laptop's disk - only do this if
         you're fine with that tradeoff for convenience, on a machine only
         you (or people who should have this password) can get to.
      2. Otherwise, an interactive prompt (-DbHost/-DbPort/-DbName/-DbUser
         below build the connection, only the password is asked for) - not
         saved anywhere, typed fresh each run.

    Before either path can succeed, the target Postgres server needs to
    actually accept a remote connection from this machine, and the target
    database needs to exist. See the "Server-side prerequisites" section in
    iis_deployment.md - short version:
      1. postgresql.conf: listen_addresses includes this server's LAN IP (or '*').
      2. pg_hba.conf: a `host` line allowing this laptop's IP/subnet to
         connect to -DbName as -DbUser with password auth, then reload
         Postgres.
      3. Windows Firewall on that server: an inbound rule allowing TCP
         -DbPort from this laptop (or the LAN).
      4. The database itself exists - CREATE DATABASE budgeting_system; if
         this is a fresh Postgres install with only the default `postgres`
         database.
    This script's connectivity check (step 1 below) will tell you plainly
    which of these is still missing if it can't get through.

.PARAMETER DbHost
    Server hostname or IP. Defaults to 192.168.0.215. Ignored (overridden by
    SERVER_DATABASE_HOST) if deploy\.env.server exists.

.PARAMETER DbPort
    Defaults to 5432. Ignored if deploy\.env.server exists.

.PARAMETER DbName
    Defaults to budgeting_system - the same name your local dev database
    already uses. Ignored if deploy\.env.server exists.

.PARAMETER DbUser
    Defaults to postgres. Ignored if deploy\.env.server exists.

.PARAMETER SkipPrisma / SkipAlembic
    Run only one side, e.g. while iterating on one service's migrations.

.EXAMPLE
    .\Migrate-RemoteDb.ps1
    If deploy\.env.server exists, migrates both services' schemas against
    it with no prompt. Otherwise prompts for the password and migrates
    against 192.168.0.215:5432/budgeting_system as postgres.
#>
[CmdletBinding()]
param(
    [string]$DbHost = "192.168.0.215",
    [int]$DbPort = 5432,
    [string]$DbName = "budgeting_system",
    [string]$DbUser = "postgres",
    [switch]$SkipPrisma,
    [switch]$SkipAlembic
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $repoRoot "backend"
$backendPyPath = Join-Path $repoRoot "backend-py"
$envServerPath = Join-Path $PSScriptRoot ".env.server"
# This repo is an npm workspaces monorepo (one node_modules, hoisted to
# $repoRoot) - `prisma` therefore lives at $repoRoot\node_modules\prisma,
# not backend\node_modules\prisma. We call its JS entry point directly with
# `node` instead of `npx prisma`: on this machine `npx` resolves to the
# extensionless POSIX shim in node_modules\.bin\prisma (not the .cmd one),
# which fails with "sed/dirname/uname: command not found" - the same shape
# of issue seen earlier with `npx vite`. Calling node directly sidesteps
# that resolution entirely.
$prismaCli = Join-Path $repoRoot "node_modules\prisma\build\index.js"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Read-DotEnv {
    param([string]$Path)
    $map = @{}
    Get-Content $Path | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$') {
            $map[$matches[1]] = $matches[2]
        }
    }
    return $map
}

$usingEnvFile = Test-Path $envServerPath
$plainPassword = $null
if ($usingEnvFile) {
    Write-Step "Using deploy\.env.server (no password prompt)"
    $serverEnv = Read-DotEnv $envServerPath
    $required = @("SERVER_DATABASE_HOST", "SERVER_DATABASE_PORT", "SERVER_DATABASE_NAME", "SERVER_DATABASE_USER", "SERVER_DATABASE_PASSWORD")
    $missing = $required | Where-Object { -not $serverEnv.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($serverEnv[$_]) }
    if ($missing.Count -gt 0) {
        throw "deploy\.env.server is missing: $($missing -join ', ') - see deploy\.env.server.example for the expected format."
    }
    if ($serverEnv.SERVER_DATABASE_PASSWORD -eq "REPLACE_WITH_REAL_PASSWORD") {
        throw "deploy\.env.server still has the placeholder password - edit it and put the real one in."
    }
    $DbHost = $serverEnv.SERVER_DATABASE_HOST
    $DbPort = [int]$serverEnv.SERVER_DATABASE_PORT
    $DbName = $serverEnv.SERVER_DATABASE_NAME
    $DbUser = $serverEnv.SERVER_DATABASE_USER
    # Typed verbatim in the file - not percent-encoded by hand, so an @ / : /
    # etc. in the password Just Works the same way the interactive prompt
    # below handles it (both paths funnel through the same encoding step).
    $plainPassword = $serverEnv.SERVER_DATABASE_PASSWORD
}

# ---------------------------------------------------------------------------
# 1. Connectivity check - fail with a clear, specific message before we ever
#    touch a password (prompt or file), rather than a cryptic Prisma/Alembic
#    timeout.
# ---------------------------------------------------------------------------
Write-Step "Checking $DbHost`:$DbPort is reachable from this machine"
$tcp = Test-NetConnection -ComputerName $DbHost -Port $DbPort -WarningAction SilentlyContinue
if (-not $tcp.TcpTestSucceeded) {
    throw @"
Could not open a TCP connection to $DbHost`:$DbPort from this machine.

Most likely one of:
  - Postgres on that server isn't listening on its network interface yet
    (postgresql.conf: listen_addresses should include this server's LAN IP, or '*').
  - No Windows Firewall inbound rule on that server allows TCP $DbPort from here.
  - $DbHost / $DbPort is wrong, or that server is off / unreachable on the network.

See the "Server-side prerequisites" section in iis_deployment.md, fix the
one that applies, then re-run this script.
"@
}
Write-Host "  Reachable."

# ---------------------------------------------------------------------------
# 2. Password - only if deploy\.env.server wasn't found above. Prompted,
#    never written to disk, never echoed.
# ---------------------------------------------------------------------------
if (-not $usingEnvFile) {
    $securePassword = Read-Host "Postgres password for $DbUser@$DbHost" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

# Build both connection strings the same way regardless of where the
# password came from - percent-encoded so a password containing @ : / ? # %
# etc. doesn't get misread as part of the host/path.
$encodedPassword = [Uri]::EscapeDataString($plainPassword)
$prismaUrl = "postgresql://${DbUser}:${encodedPassword}@${DbHost}:${DbPort}/${DbName}?schema=public"
$alembicUrl = "postgresql+psycopg://${DbUser}:${encodedPassword}@${DbHost}:${DbPort}/${DbName}"

# ---------------------------------------------------------------------------
# 3. Prisma migrate deploy
# ---------------------------------------------------------------------------
if (-not $SkipPrisma) {
    Write-Step "Running prisma migrate deploy against $DbHost/$DbName"
    Push-Location $backendPath
    try {
        $env:DATABASE_URL = $prismaUrl
        node $prismaCli migrate deploy
        if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed with exit code $LASTEXITCODE." }
    } finally {
        Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
        Pop-Location
    }
} else {
    Write-Step "Skipping Prisma (-SkipPrisma)"
}

# ---------------------------------------------------------------------------
# 4. Alembic upgrade head
# ---------------------------------------------------------------------------
if (-not $SkipAlembic) {
    Write-Step "Running alembic upgrade head against $DbHost/$DbName"
    Push-Location $backendPyPath
    try {
        $env:DATABASE_URL = $alembicUrl
        if (-not (Test-Path ".\venv\Scripts\alembic.exe")) {
            throw "backend-py\venv not found - run `python -m venv venv` and `pip install -r requirements.txt` in backend-py\ first (or run Deploy-IIS.ps1's prerequisite steps)."
        }
        & ".\venv\Scripts\alembic.exe" upgrade head
        if ($LASTEXITCODE -ne 0) { throw "alembic upgrade head failed with exit code $LASTEXITCODE." }
    } finally {
        Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
        Pop-Location
    }
} else {
    Write-Step "Skipping Alembic (-SkipAlembic)"
}

# Best-effort scrub of the plaintext password from memory.
$plainPassword = $null
[System.GC]::Collect()

Write-Host ""
Write-Host "Remote migration complete: $DbHost`:$DbPort/$DbName is on the latest schema." -ForegroundColor Green
Write-Host "Your local backend\.env / backend-py\.env were not modified - local dev still points at your local Postgres."
