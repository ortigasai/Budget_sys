#requires -RunAsAdministrator
<#
.SYNOPSIS
    Deploys the Budgeting System (frontend + Node API + FastAPI service) to a
    Windows Server behind IIS, with the two backend services run under NSSM.

.DESCRIPTION
    See ../iis_deployment.md for the full guide, including what to edit in
    backend/.env and backend-py/.env BEFORE running this script.

    What this script does, in order:
      1. Verifies it is running elevated, on Windows, with Node/Python present.
      2. Installs (if missing) the IIS role, the URL Rewrite module, the
         Application Request Routing (ARR) module, and NSSM.
      3. Copies the source tree from -SourcePath to -DeployPath.
      4. Validates backend/.env and backend-py/.env (fails fast on an
         unedited placeholder JWT_SECRET or a JWT_SECRET mismatch).
      5. Builds the frontend (vite build) and the Node backend (tsc).
      6. Creates/refreshes the backend-py Python virtualenv and installs
         requirements.txt.
      7. Runs database migrations: `prisma migrate deploy` then
         `alembic upgrade head`.
      8. Registers/refreshes two NSSM services (Node API, FastAPI service),
         both bound to 127.0.0.1 only - not reachable except through IIS.
      9. Creates the IIS app pool + site on -Port, with a generated
         web.config that reverse-proxies /api and /api2 (and /uploads) to
         the two backend services and falls back to index.html for
         React Router's client-side routes.
     10. Adds Windows Firewall rules: outbound for node.exe/python.exe and
         for the configured Postgres port, plus one inbound rule on -Port
         (required for the site to be reachable at all - see the guide's
         security note before running this on a box with public exposure).
     11. Starts everything and runs a health check against the public port.

    Safe to re-run: every step is idempotent (existing services/sites/pools
    are stopped and reconfigured rather than erroring out), so use this same
    script for future redeploys after a `git pull` into -SourcePath.

.PARAMETER SourcePath
    Path to the already-copied/cloned project folder on this server (the
    folder that contains backend/, backend-py/, frontend/). Defaults to the
    parent of this script's own location, i.e. running it in place from a
    checkout works with no arguments.

.PARAMETER DeployPath
    Where the app actually runs from. Defaults to C:\BudgetingSystem. The
    script robocopies SourcePath here (excluding node_modules/venv/.git) so
    the running copy is never the same folder you `git pull` into.

.PARAMETER Port
    The public-facing IIS site port. Defaults to 9090 per this project's
    convention.

.PARAMETER SiteName / AppPoolName
    IIS object names. Defaults to "BudgetingSystem" / "BudgetingSystemPool".

.PARAMETER NodeApiPort / PyApiPort
    Internal loopback-only ports for the two backend services. Must match
    PORT in backend/.env and the --port passed to uvicorn (defaults 4000 /
    8010, matching the rest of this project).

.PARAMETER PostgresPort
    Used only to scope the outbound firewall rule. Defaults to 5432.

.PARAMETER SkipPrereqs
    Skip installing IIS/URL Rewrite/ARR/NSSM (use once they're confirmed
    already installed, to speed up repeat runs).

.PARAMETER SkipMigrations
    Skip the `prisma migrate deploy` / `alembic upgrade head` steps (use
    when you've already migrated, or want to run them manually first).

.EXAMPLE
    .\Deploy-IIS.ps1
    Run from an elevated PowerShell prompt, from inside a checkout of this
    repo (deploy\Deploy-IIS.ps1), after editing backend\.env and
    backend-py\.env per iis_deployment.md.

.EXAMPLE
    .\Deploy-IIS.ps1 -SourcePath D:\src\budgeting-system -DeployPath D:\apps\budgeting-system -Port 9090
#>
[CmdletBinding()]
param(
    [string]$SourcePath,
    [string]$DeployPath = "C:\BudgetingSystem",
    [int]$Port = 9090,
    [string]$SiteName = "BudgetingSystem",
    [string]$AppPoolName = "BudgetingSystemPool",
    [int]$NodeApiPort = 4000,
    [int]$PyApiPort = 8010,
    [int]$PostgresPort = 5432,
    [switch]$SkipPrereqs,
    [switch]$SkipMigrations
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest is much faster without the progress UI

# $PSScriptRoot isn't reliably populated yet while a param() block's default
# values are being evaluated (only once the script body itself starts
# running) - so -SourcePath's default is computed here instead of inline in
# param() above, where it was intermittently resolving to an empty string
# and crashing Split-Path.
if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    $SourcePath = Split-Path -Parent $PSScriptRoot
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-Success {
    param([string]$What)
    if ($LASTEXITCODE -ne 0) {
        throw "$What failed with exit code $LASTEXITCODE."
    }
}

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
Write-Step "Preflight checks"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "Run this script from an elevated (Administrator) PowerShell prompt."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "node.exe not found on PATH. Install Node.js LTS first (https://nodejs.org)." }
$nodeExe = $node.Source

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw "python.exe not found on PATH. Install Python 3.11+ first (https://python.org)." }

Write-Host "  Node.js: $((& $nodeExe --version))"
Write-Host "  Python:  $((& $python.Source --version))"
Write-Host "  Source:  $SourcePath"
Write-Host "  Deploy:  $DeployPath"

if (-not (Test-Path (Join-Path $SourcePath "backend\.env"))) {
    throw "backend\.env not found under $SourcePath. Copy backend\.env.example to backend\.env and fill it in first - see iis_deployment.md."
}
if (-not (Test-Path (Join-Path $SourcePath "backend-py\.env"))) {
    throw "backend-py\.env not found under $SourcePath. Copy backend-py\.env.example to backend-py\.env and fill it in first - see iis_deployment.md."
}

# ---------------------------------------------------------------------------
# 2. Prerequisites: IIS, URL Rewrite, ARR, NSSM
# ---------------------------------------------------------------------------
if (-not $SkipPrereqs) {
    Write-Step "Installing IIS role and management tools"
    $iisFeatures = @(
        "Web-Server", "Web-Common-Http", "Web-Static-Content", "Web-Default-Doc",
        "Web-Dir-Browsing", "Web-Http-Errors", "Web-Http-Redirect", "Web-Http-Logging",
        "Web-Stat-Compression", "Web-Filtering", "Web-Mgmt-Console", "Web-Scripting-Tools"
    )
    Install-WindowsFeature -Name $iisFeatures | Out-Null

    $tempDir = Join-Path $env:TEMP "budgeting-system-deploy"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

    Import-Module WebAdministration -ErrorAction SilentlyContinue

    # --- URL Rewrite module (needed for the reverse-proxy / SPA rules) ---
    $urlRewriteInstalled = Test-Path "$env:SystemRoot\System32\inetsrv\rewrite.dll"
    if (-not $urlRewriteInstalled) {
        Write-Step "Installing IIS URL Rewrite module"
        $rewriteMsi = Join-Path $tempDir "rewrite_amd64_en-US.msi"
        Invoke-WebRequest -Uri "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi" -OutFile $rewriteMsi
        Start-Process msiexec.exe -ArgumentList "/i `"$rewriteMsi`" /quiet /norestart" -Wait
    } else {
        Write-Host "  URL Rewrite already installed."
    }

    # --- Application Request Routing (proxy engine URL Rewrite hands off to) ---
    $arrInstalled = Test-Path "$env:ProgramFiles\IIS\Application Request Routing"
    if (-not $arrInstalled) {
        Write-Step "Installing Application Request Routing (ARR)"
        $arrMsi = Join-Path $tempDir "requestRouter_amd64.msi"
        Invoke-WebRequest -Uri "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi" -OutFile $arrMsi
        Start-Process msiexec.exe -ArgumentList "/i `"$arrMsi`" /quiet /norestart" -Wait
    } else {
        Write-Host "  ARR already installed."
    }

    Write-Step "Enabling ARR proxy"
    # Equivalent of checking "Enable proxy" under IIS Manager > server node >
    # Application Request Routing Cache > Server Proxy Settings.
    Set-WebConfigurationProperty -pspath "MACHINE/WEBROOT/APPHOST" -filter "system.webServer/proxy" -name "enabled" -value "True"

    # --- NSSM ---
    $script:nssmExe = (Get-Command nssm -ErrorAction SilentlyContinue).Source
    if (-not $script:nssmExe) {
        $chocoInstalled = Get-Command choco -ErrorAction SilentlyContinue
        if ($chocoInstalled) {
            Write-Step "Installing NSSM via Chocolatey"
            choco install nssm -y | Out-Null
            $script:nssmExe = (Get-Command nssm -ErrorAction SilentlyContinue).Source
        }
    }
    if (-not $script:nssmExe) {
        Write-Step "Downloading NSSM"
        $nssmZip = Join-Path $tempDir "nssm.zip"
        $nssmDir = "C:\ProgramData\nssm"
        Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $nssmZip
        Expand-Archive -Path $nssmZip -DestinationPath $tempDir -Force
        New-Item -ItemType Directory -Force -Path $nssmDir | Out-Null
        Copy-Item (Join-Path $tempDir "nssm-2.24\win64\nssm.exe") $nssmDir -Force
        $script:nssmExe = Join-Path $nssmDir "nssm.exe"
        # Persist on PATH for future sessions/re-runs with -SkipPrereqs.
        $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
        if ($machinePath -notlike "*$nssmDir*") {
            [Environment]::SetEnvironmentVariable("Path", "$machinePath;$nssmDir", "Machine")
        }
    }
    Write-Host "  NSSM: $script:nssmExe"
} else {
    Write-Step "Skipping prerequisite install (-SkipPrereqs)"
    $script:nssmExe = (Get-Command nssm -ErrorAction SilentlyContinue).Source
    if (-not $script:nssmExe) { throw "nssm.exe not found on PATH and -SkipPrereqs was passed - install it first or drop -SkipPrereqs." }
}

# ---------------------------------------------------------------------------
# 3. Copy source -> deploy path
# ---------------------------------------------------------------------------
Write-Step "Copying $SourcePath -> $DeployPath"
New-Item -ItemType Directory -Force -Path $DeployPath | Out-Null
robocopy $SourcePath $DeployPath /MIR /XD node_modules venv .git dist "__pycache__" /XF "*.log" /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit code $LASTEXITCODE) copying source to deploy path." }

$backendPath = Join-Path $DeployPath "backend"
$backendPyPath = Join-Path $DeployPath "backend-py"
$frontendPath = Join-Path $DeployPath "frontend"
# This repo is an npm workspaces monorepo - one node_modules and one
# package-lock.json at $DeployPath, not one per workspace - so `npm ci`
# below runs once at $DeployPath, not inside backend/frontend individually
# (neither has its own lockfile). `prisma` therefore also lives at
# $DeployPath\node_modules\prisma, not backend\node_modules\prisma; its JS
# entry point is called directly with `node` rather than via `npx prisma`,
# which resolves to the extensionless POSIX shim in node_modules\.bin and
# fails with "sed/dirname/uname: command not found" in this environment.
$prismaCli = Join-Path $DeployPath "node_modules\prisma\build\index.js"

# ---------------------------------------------------------------------------
# 4. Validate .env files
# ---------------------------------------------------------------------------
Write-Step "Validating environment files"

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

$nodeEnvPath = Join-Path $backendPath ".env"
$pyEnvPath = Join-Path $backendPyPath ".env"
$nodeEnv = Read-DotEnv $nodeEnvPath
$pyEnv = Read-DotEnv $pyEnvPath

if (-not $nodeEnv.ContainsKey("JWT_SECRET") -or $nodeEnv.JWT_SECRET -eq "replace-with-a-random-secret" -or [string]::IsNullOrWhiteSpace($nodeEnv.JWT_SECRET)) {
    throw "backend\.env: JWT_SECRET is missing or still the placeholder value. Generate a real secret before deploying (see iis_deployment.md)."
}
if ($nodeEnv.JWT_SECRET -ne $pyEnv.JWT_SECRET) {
    throw "JWT_SECRET differs between backend\.env and backend-py\.env - they must match exactly (both services verify the same tokens)."
}
if (-not $nodeEnv.ContainsKey("DATABASE_URL") -or [string]::IsNullOrWhiteSpace($nodeEnv.DATABASE_URL)) {
    throw "backend\.env: DATABASE_URL is not set."
}
if (-not $pyEnv.ContainsKey("DATABASE_URL") -or [string]::IsNullOrWhiteSpace($pyEnv.DATABASE_URL)) {
    throw "backend-py\.env: DATABASE_URL is not set."
}
Write-Host "  JWT_SECRET matches on both services, DATABASE_URL present on both. OK."

# ---------------------------------------------------------------------------
# 5. Install dependencies once (workspaces root), then build each app
# ---------------------------------------------------------------------------
Write-Step "Installing dependencies (npm workspaces root)"
Push-Location $DeployPath
npm ci; Assert-Success "npm ci"
Pop-Location

Write-Step "Building frontend"
Push-Location $frontendPath
npm run build; Assert-Success "npm run build (frontend)"
Pop-Location

Write-Step "Building Node API"
Push-Location $backendPath
node $prismaCli generate; Assert-Success "prisma generate"
npm run build; Assert-Success "npm run build (backend)"
Pop-Location

# ---------------------------------------------------------------------------
# 6. Python virtualenv
# ---------------------------------------------------------------------------
Write-Step "Setting up backend-py virtualenv"
Push-Location $backendPyPath
if (-not (Test-Path "venv")) {
    & $python.Source -m venv venv; Assert-Success "python -m venv"
}
& ".\venv\Scripts\python.exe" -m pip install --upgrade pip | Out-Null
& ".\venv\Scripts\pip.exe" install -r requirements.txt; Assert-Success "pip install -r requirements.txt"
Pop-Location

# ---------------------------------------------------------------------------
# 7. Migrations
# ---------------------------------------------------------------------------
if (-not $SkipMigrations) {
    Write-Step "Running Prisma migrations"
    Push-Location $backendPath
    node $prismaCli migrate deploy; Assert-Success "prisma migrate deploy"
    Pop-Location

    Write-Step "Running Alembic migrations"
    Push-Location $backendPyPath
    & ".\venv\Scripts\alembic.exe" upgrade head; Assert-Success "alembic upgrade head"
    Pop-Location
} else {
    Write-Step "Skipping migrations (-SkipMigrations)"
}

# ---------------------------------------------------------------------------
# 8. NSSM services
# ---------------------------------------------------------------------------
Write-Step "Registering Windows services with NSSM"

function Install-NssmService {
    param(
        [string]$Name,
        [string]$Exe,
        # Named $ServiceArgs, not $Args: PowerShell has a reserved automatic
        # variable called $args (case-insensitive, so this includes $Args)
        # that holds a function's unbound positional parameters. Declaring a
        # normal parameter with that exact name shadows it unreliably - it
        # looked fine (no error, no warning), but the value silently never
        # made it into $Args inside the function body, so every `nssm set
        # ... AppParameters $Args` call below was setting AppParameters to
        # nothing. That's what caused python.exe to launch with zero
        # arguments and drop into an interactive REPL instead of running
        # uvicorn - confirmed via `nssm get BudgetingSystemPyApi
        # AppParameters` coming back empty on the actual deployed service.
        [string]$ServiceArgs,
        [string]$WorkingDir
    )
    # nssm.exe writes to stderr for perfectly normal cases (e.g. "Can't open
    # service!" from `status` on a service that doesn't exist yet - the
    # expected case on a fresh install). With $ErrorActionPreference = "Stop"
    # set globally, any stderr line from a native command becomes a
    # terminating error regardless of redirection (a documented Windows
    # PowerShell 5.1 quirk) - so every nssm call in this function runs under
    # a locally-scoped, non-terminating policy instead.
    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $script:nssmExe status $Name *> $null
        $serviceExists = ($LASTEXITCODE -eq 0)
        if ($serviceExists) {
            Write-Host "  $Name already registered - stopping to reconfigure."
            & $script:nssmExe stop $Name *> $null
            & $script:nssmExe remove $Name confirm *> $null
            # Windows' Service Control Manager can briefly hold a service
            # name as "marked for delete" right after `remove` - give it a
            # moment before recreating the same name, or `install` below can
            # fail (silently, since its exit code isn't currently surfaced
            # to the user - see the explicit check added below).
            Start-Sleep -Seconds 2
        }
        # Install with just the program (no args here) then set
        # AppParameters as its own step. Passing a multi-word args string
        # straight to `install` goes through PowerShell's native-command
        # argument passing *twice* effectively (once into nssm.exe's own
        # argv, then nssm re-quotes it again when building AppParameters),
        # which double-quotes it - the child process then receives the
        # whole thing as one argv token instead of separate words, and e.g.
        # `-m uvicorn app.main:app ...` fails to parse as `-m` at all.
        # `nssm set ... AppParameters` stores the value as a raw string
        # appended verbatim after the program path, which Python's own
        # command-line splitting handles correctly.
        & $script:nssmExe install $Name $Exe *> $null
        if ($LASTEXITCODE -ne 0) { throw "nssm install $Name failed (exit $LASTEXITCODE) - is a service by that name stuck mid-removal? Check with Get-Service $Name." }
        & $script:nssmExe set $Name AppParameters $ServiceArgs *> $null
        if ($LASTEXITCODE -ne 0) { throw "nssm set $Name AppParameters failed (exit $LASTEXITCODE)." }
        $storedArgs = & $script:nssmExe get $Name AppParameters
        if ($storedArgs -ne $ServiceArgs) { throw "nssm set $Name AppParameters didn't take - expected '$ServiceArgs', got '$storedArgs'." }
        & $script:nssmExe set $Name AppDirectory $WorkingDir *> $null
        $logDir = Join-Path $WorkingDir "logs"
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        & $script:nssmExe set $Name AppStdout (Join-Path $logDir "stdout.log") *> $null
        & $script:nssmExe set $Name AppStderr (Join-Path $logDir "stderr.log") *> $null
        & $script:nssmExe set $Name AppRotateFiles 1 *> $null
        & $script:nssmExe set $Name AppRotateBytes 10485760 *> $null
        & $script:nssmExe set $Name Start SERVICE_AUTO_START *> $null
    } finally {
        $ErrorActionPreference = $previousEap
    }
    Write-Host "  $Name -> $Exe $ServiceArgs (cwd: $WorkingDir)"
}

# Node API - HOST=127.0.0.1 in backend\.env keeps this off every interface
# except loopback; IIS is the only thing allowed to reach it (see firewall
# step below - there is no inbound rule for $NodeApiPort).
Install-NssmService -Name "BudgetingSystemApi" -Exe $nodeExe -ServiceArgs "dist\index.js" -WorkingDir $backendPath

# FastAPI service, bound to loopback the same way via uvicorn's --host.
$venvPython = Join-Path $backendPyPath "venv\Scripts\python.exe"
Install-NssmService -Name "BudgetingSystemPyApi" -Exe $venvPython -ServiceArgs "-m uvicorn app.main:app --host 127.0.0.1 --port $PyApiPort" -WorkingDir $backendPyPath

# Same stderr-becomes-terminating-error guard as inside Install-NssmService.
$previousEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    & $script:nssmExe start BudgetingSystemApi *> $null
    & $script:nssmExe start BudgetingSystemPyApi *> $null
    Start-Sleep -Seconds 2
    $apiStatus = & $script:nssmExe status BudgetingSystemApi
    $pyApiStatus = & $script:nssmExe status BudgetingSystemPyApi
} finally {
    $ErrorActionPreference = $previousEap
}
Write-Host "  BudgetingSystemApi:   $apiStatus"
Write-Host "  BudgetingSystemPyApi: $pyApiStatus"

# ---------------------------------------------------------------------------
# 9. IIS site + reverse proxy
# ---------------------------------------------------------------------------
Write-Step "Configuring IIS site on port $Port"
Import-Module WebAdministration

$distPath = Join-Path $frontendPath "dist"
if (-not (Test-Path $distPath)) { throw "Frontend build output not found at $distPath." }

$webConfig = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ReverseProxy-Api2" stopProcessing="true">
          <match url="^api2/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:$PyApiPort/{R:1}" />
        </rule>
        <rule name="ReverseProxy-Api" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:$NodeApiPort/api/{R:1}" />
        </rule>
        <rule name="ReverseProxy-Uploads" stopProcessing="true">
          <match url="^uploads/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:$NodeApiPort/uploads/{R:1}" />
        </rule>
        <rule name="SPA-Fallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
    <httpErrors existingResponse="PassThrough" />
    <staticContent>
      <remove fileExtension=".json" />
      <mimeMap fileExtension=".json" mimeType="application/json" />
    </staticContent>
  </system.webServer>
</configuration>
"@
Set-Content -Path (Join-Path $distPath "web.config") -Value $webConfig -Encoding UTF8

if (Test-Path "IIS:\AppPools\$AppPoolName") {
    Write-Host "  App pool $AppPoolName already exists - reusing it."
} else {
    New-WebAppPool -Name $AppPoolName | Out-Null
}
Set-ItemProperty "IIS:\AppPools\$AppPoolName" -Name managedRuntimeVersion -Value ""
Set-ItemProperty "IIS:\AppPools\$AppPoolName" -Name processModel.identityType -Value "ApplicationPoolIdentity"

if (Test-Path "IIS:\Sites\$SiteName") {
    Write-Host "  Site $SiteName already exists - updating its binding and physical path."
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $distPath
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name applicationPool -Value $AppPoolName
    $bindings = @(Get-WebBinding -Name $SiteName)
    $hasPortBinding = @($bindings | Where-Object { $_.bindingInformation -like "*:$($Port):*" }).Count -gt 0
    if (-not $hasPortBinding) {
        Get-WebBinding -Name $SiteName | Remove-WebBinding
        New-WebBinding -Name $SiteName -Protocol http -Port $Port
    }
} else {
    New-Website -Name $SiteName -Port $Port -PhysicalPath $distPath -ApplicationPool $AppPoolName | Out-Null
}
Start-Website -Name $SiteName -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# 10. Firewall
# ---------------------------------------------------------------------------
Write-Step "Configuring Windows Firewall"

# Outbound - the two services need to reach Postgres (and Node/npm/PyPI if
# you redeploy from this box). Requested explicitly; most Windows Server
# outbound policies default to allow-all, so these are a defense-in-depth
# no-op unless outbound is locked down here.
$outboundRules = @(
    @{ Name = "BudgetingSystem-Outbound-Node"; Program = $nodeExe },
    @{ Name = "BudgetingSystem-Outbound-Python"; Program = $venvPython }
)
foreach ($rule in $outboundRules) {
    if (-not (Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $rule.Name -Direction Outbound -Action Allow -Program $rule.Program -Protocol TCP | Out-Null
        Write-Host "  Added outbound rule: $($rule.Name)"
    } else {
        Write-Host "  Outbound rule already exists: $($rule.Name)"
    }
}
if (-not (Get-NetFirewallRule -DisplayName "BudgetingSystem-Outbound-Postgres" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "BudgetingSystem-Outbound-Postgres" -Direction Outbound -Action Allow -Protocol TCP -RemotePort $PostgresPort | Out-Null
    Write-Host "  Added outbound rule: BudgetingSystem-Outbound-Postgres (TCP $PostgresPort)"
}

# Inbound - required for anyone else to reach the site at all. Not part of
# the literal "outbound firewall" ask, but the site is unreachable without
# it, so it's included; scope this further (e.g. -RemoteAddress) yourself if
# this server is not meant to be reachable from the whole network.
if (-not (Get-NetFirewallRule -DisplayName "BudgetingSystem-Inbound-$Port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "BudgetingSystem-Inbound-$Port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
    Write-Host "  Added inbound rule: BudgetingSystem-Inbound-$Port (TCP $Port)"
} else {
    Write-Host "  Inbound rule already exists for port $Port."
}

# ---------------------------------------------------------------------------
# 11. Health check
# ---------------------------------------------------------------------------
Write-Step "Health check"
Start-Sleep -Seconds 2
try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$PyApiPort/health" -UseBasicParsing -TimeoutSec 10
    Write-Host "  backend-py /health -> $($health.StatusCode)"
} catch {
    Write-Warning "  backend-py health check failed: $_"
}
try {
    $site = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 10
    Write-Host "  IIS site / -> $($site.StatusCode)"
} catch {
    Write-Warning "  IIS site check failed: $_"
}

$hostname = [System.Net.Dns]::GetHostName()
Write-Host ""
Write-Host "Deployment complete." -ForegroundColor Green
Write-Host "  Local:   http://localhost:$Port"
Write-Host "  Network: http://${hostname}:$Port  (and http://<this-server-IP>:$Port)"
Write-Host "See iis_deployment.md for how to manage the services and troubleshoot."
