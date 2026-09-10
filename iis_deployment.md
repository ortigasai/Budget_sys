# IIS Deployment Guide

Deploys the Budgeting System to a Windows Server behind IIS, with the two
backend services (Node/Express and FastAPI) run as Windows services via
[NSSM](https://nssm.cc). The public-facing port is **9090**.

The automation script for all of this is [`deploy/Deploy-IIS.ps1`](deploy/Deploy-IIS.ps1).
This document explains what it does, what you must edit before running it,
and how to operate the deployment afterward.

## Architecture

```
                         ┌─────────────────────────────────────────┐
 Browser (any user) ───► │  IIS site "BudgetingSystem", port 9090   │
                         │  physical path: frontend/dist            │
                         │  (static files + URL Rewrite/ARR proxy)  │
                         └───────────────┬───────────┬─────────────┘
                                          │           │
                          /api, /uploads  │           │  /api2
                                          ▼           ▼
                         ┌──────────────────┐   ┌──────────────────────┐
                         │ NSSM service:     │   │ NSSM service:         │
                         │ BudgetingSystemApi│   │ BudgetingSystemPyApi  │
                         │ node dist/index.js│   │ uvicorn app.main:app  │
                         │ 127.0.0.1:4000    │   │ 127.0.0.1:8010        │
                         └─────────┬─────────┘   └──────────┬────────────┘
                                   │                          │
                                   └───────────┬──────────────┘
                                                ▼
                                     PostgreSQL (DATABASE_URL)
```

Only IIS's port (9090) is opened to the network. Both backend services bind
to `127.0.0.1` only, so they are unreachable except through the IIS reverse
proxy — matching how the frontend already talks to them in dev (Vite's
`/api` → Node, `/api2` → FastAPI proxy in `frontend/vite.config.ts`), just
with IIS + URL Rewrite/ARR standing in for Vite's dev proxy.

## Prerequisites

Install these on the target Windows Server **before** running the script:

- Windows Server 2016 or newer, with an account that has Administrator rights.
- [Node.js](https://nodejs.org) LTS (20.x or newer) — `node` and `npm` on `PATH`.
- [Python](https://www.python.org/downloads/windows/) 3.11+ — `python` on `PATH`.
- A reachable PostgreSQL instance (on this server or elsewhere) for
  `DATABASE_URL`. This script does **not** install PostgreSQL — set that up
  separately first.
- Network access from this server to `download.microsoft.com` and
  `nssm.cc` (or Chocolatey, if already installed) to fetch the IIS URL
  Rewrite module, Application Request Routing, and NSSM. If this server has
  no internet access, install those three manually first and re-run with
  `-SkipPrereqs`.

The script itself installs: the IIS role and management tools, the IIS URL
Rewrite module, Application Request Routing (ARR), and NSSM — all skipped
automatically if already present, or explicitly with `-SkipPrereqs`.

## Database first: migrating from your laptop against the server's PostgreSQL

You don't have to run migrations on the server itself. Prisma and Alembic
just read a `DATABASE_URL` and connect wherever it points — if the server's
Postgres port is reachable from your machine, [`deploy/Migrate-RemoteDb.ps1`](deploy/Migrate-RemoteDb.ps1)
runs both migration sets (`prisma migrate deploy`, `alembic upgrade head`)
from right here, against the server's database, without touching your local
`.env` files (your local dev keeps pointing at your local Postgres).

```powershell
cd deploy
.\Migrate-RemoteDb.ps1 -DbHost 192.168.0.215 -DbPort 5432 -DbName budgeting_system -DbUser postgres
```

It checks the connection is actually reachable first (with a specific error
pointing at whichever prerequisite below is missing), then prompts for the
password interactively — the password is never written to a file, never
printed, and never leaves this one PowerShell session.

**Want to skip typing the password every time?** Copy
[`deploy/.env.server.example`](deploy/.env.server.example) to
`deploy/.env.server` and fill in the real password there once —
`Migrate-RemoteDb.ps1` picks it up automatically and stops prompting
entirely, so `.\Migrate-RemoteDb.ps1` with no arguments just runs. That file
is git-ignored, but it's a real password sitting in a plaintext file on this
laptop's disk from then on — only do this if that tradeoff (convenience vs.
a secret at rest) is fine for this machine.

### Server-side prerequisites (do these on 192.168.0.215 first)

A default PostgreSQL install only accepts connections from `localhost` and
only has the default `postgres` database — both need to change before a
remote migration can succeed:

1. **Create the database**, if `budgeting_system` doesn't already exist
   there. Connected as a superuser (`psql -U postgres`):
   ```sql
   CREATE DATABASE budgeting_system;
   ```
2. **Let Postgres listen on the network**, not just loopback. In
   `postgresql.conf` (find it with `SHOW config_file;` from `psql`):
   ```
   listen_addresses = '*'
   ```
   (`'*'` is simplest for a LAN-only server like this one; scope it to the
   specific interface IP instead if you'd rather be precise.)
3. **Allow this laptop's IP to authenticate**, in `pg_hba.conf` (same
   folder as `postgresql.conf`), add a line before any more restrictive
   `host` lines already there:
   ```
   host    budgeting_system    postgres    192.168.0.0/24    scram-sha-256
   ```
   (Scope `192.168.0.0/24` down to this laptop's single IP with a `/32` if
   you'd rather not open it to the whole subnet. `scram-sha-256` is
   Postgres 16's default password method — use `md5` instead if the
   server's an older Postgres version that still defaults to it.)
4. **Restart or reload Postgres** for both config changes to take effect —
   `pg_ctl reload` (or restart the Windows service if Postgres runs as
   one: `Restart-Service postgresql-x64-<version>`).
5. **Windows Firewall on that server**: an inbound rule allowing TCP 5432
   from this laptop/subnet:
   ```powershell
   New-NetFirewallRule -DisplayName "Postgres-Inbound-LAN" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5432 -RemoteAddress 192.168.0.0/24
   ```

Once all five are done, `Migrate-RemoteDb.ps1`'s connectivity check should
pass and it'll take you straight to the password prompt.

If you've already migrated this way, pass `-SkipMigrations` to
`Deploy-IIS.ps1` later so it doesn't redundantly try the same migrations
again from the server itself (harmless either way — both `prisma migrate
deploy` and `alembic upgrade head` are no-ops once the schema is current —
but there's no reason to run it twice).

## Before you run the script: editing the `.env` files

Copy the two example files and edit them **before** running
`Deploy-IIS.ps1` — the script validates several of these and will refuse to
run if they're missing or left at placeholder values.

### `backend/.env` (copy from `backend/.env.example`)

| Variable       | What to set it to |
|----------------|--------------------|
| `DATABASE_URL` | Your production Postgres connection string, e.g. `postgresql://postgres:yourpassword@192.168.0.215:5432/budgeting_system?schema=public` — same host/port/db/user as the [database section](#database-first-migrating-from-your-laptop-against-the-servers-postgresql) above. If Postgres runs on this same IIS server instead of a separate DB box, `localhost` is fine here. |
| `PORT`         | Leave at `4000` unless you also change `-NodeApiPort` when running the script. |
| `HOST`         | **Add this line: `HOST=127.0.0.1`.** Not in the example file — it's what keeps this service off every network interface except loopback, so it's only reachable through the IIS reverse proxy. Without it the service listens on all interfaces (fine in dev, not what you want here since there's no inbound firewall rule opening port 4000). |
| `UPLOAD_DIR`   | Leave as `./uploads`, or point it at a dedicated data folder if you want uploads to survive outside the deploy folder (see [Redeploying](#redeploying--updating) below). |
| `JWT_SECRET`   | **Must be changed from the example placeholder.** Generate a real random value, e.g. in PowerShell: `[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))`. The script hard-fails if this is still `replace-with-a-random-secret`. |

### `backend-py/.env` (copy from `backend-py/.env.example`)

| Variable       | What to set it to |
|----------------|--------------------|
| `DATABASE_URL` | The **same database** as `backend/.env`, but with the `postgresql+psycopg://` scheme prefix (SQLAlchemy/psycopg's format) instead of plain `postgresql://` — e.g. `postgresql+psycopg://user:pass@dbhost:5432/budgeting_system`. |
| `PORT`         | Informational only — the FastAPI service actually binds via the `--port` argument the deploy script passes to `uvicorn` (`-PyApiPort`, default `8010`). Keep this in sync if you change `-PyApiPort`, but changing only this value does nothing on its own. |
| `JWT_SECRET`   | **Must exactly match `backend/.env`'s `JWT_SECRET`.** Both services verify tokens signed with this same secret — the script hard-fails if they differ. |

There's no `HOST` setting needed here — `-host 127.0.0.1` is passed directly
to `uvicorn` by the deploy script itself.

### A security note on the login system

Every account in this app currently logs in with a real email address and
**one shared password** (the project's dev-mode convention). That's fine on
a laptop no one else can reach, but once this is on a network port other
people can hit, anyone who knows (or guesses) that shared password and any
listed employee email can log in and see this budgeting data. Consider
changing this — requiring each user to set their own password, or at least
rotating the shared one to something not written down in this repo's dev
docs — **before** pointing a wide network at this deployment. This is a
judgment call for whoever owns this data, not something the deploy script
touches.

## Running the script

From an **elevated** PowerShell prompt on the target server, with the repo
already copied or `git clone`d somewhere on that server:

```powershell
cd "C:\path\to\Budgeting System\deploy"
.\Deploy-IIS.ps1
```

That uses every default: reads the source from one level up (i.e. the repo
you're standing in), deploys a running copy to `C:\BudgetingSystem`, and
serves it on port `9090`.

To customize:

```powershell
.\Deploy-IIS.ps1 `
  -SourcePath "D:\src\budgeting-system" `
  -DeployPath "D:\apps\budgeting-system" `
  -Port 9090 `
  -NodeApiPort 4000 `
  -PyApiPort 8010 `
  -PostgresPort 5432
```

Run `Get-Help .\Deploy-IIS.ps1 -Full` for the complete parameter reference —
every parameter is documented in the script's own comment-based help.

The script is idempotent: re-running it (e.g. after a `git pull` into
`-SourcePath`) rebuilds, re-migrates, and reconfigures everything in place
rather than erroring out on "already exists".

### What the script does, step by step

1. Confirms it's running elevated and that `node`/`python` are on `PATH`.
2. Installs IIS + management tools, the URL Rewrite module, ARR (and
   enables ARR's proxy setting), and NSSM — skipped if already present, or
   entirely with `-SkipPrereqs`.
3. Copies `-SourcePath` → `-DeployPath` via `robocopy /MIR` (excluding
   `node_modules`, `venv`, `.git`, `dist`, `__pycache__`).
4. Validates `backend/.env` and `backend-py/.env` (JWT secret set and
   matching, DATABASE_URL present) — stops here with a clear error if not.
5. `npm ci && npm run build` for the frontend (→ `frontend/dist`) and the
   backend (→ `backend/dist`), plus `prisma generate`.
6. Creates/refreshes `backend-py/venv` and installs `requirements.txt`.
7. Runs `prisma migrate deploy` then `alembic upgrade head` against
   `DATABASE_URL` (skip with `-SkipMigrations`).
8. Registers two NSSM services (stopping/removing and re-registering if
   they already exist): `BudgetingSystemApi` (`node dist/index.js`) and
   `BudgetingSystemPyApi` (`uvicorn app.main:app --host 127.0.0.1`), both
   with rotating stdout/stderr logs under each service's `logs/` folder.
9. Creates the IIS app pool and site (`http://*:9090`), writing a
   `web.config` into `frontend/dist` with URL Rewrite rules that reverse-
   proxy `/api/*` and `/uploads/*` to the Node service and `/api2/*` to the
   FastAPI service, plus a catch-all fallback to `index.html` so React
   Router's client-side routes work on a hard refresh/direct link.
10. Adds Windows Firewall rules: **outbound** allow rules for `node.exe`,
    the venv's `python.exe`, and TCP traffic to `-PostgresPort` (the
    explicit ask); plus one **inbound** allow rule on `-Port`, since without
    it nothing outside this machine can reach the site at all.
11. Starts both services and the IIS site, then hits
    `http://127.0.0.1:<PyApiPort>/health` and `http://localhost:<Port>/` to
    confirm both came up.

## Verifying the deployment

```powershell
# Services
nssm status BudgetingSystemApi
nssm status BudgetingSystemPyApi

# IIS site
Get-Website -Name BudgetingSystem

# From this machine
Invoke-WebRequest http://localhost:9090/ -UseBasicParsing
Invoke-WebRequest http://localhost:9090/api2/health -UseBasicParsing   # -> {"ok":true}

# From another machine on the network
# http://<this-server's-hostname-or-IP>:9090
```

Open `http://<server>:9090` in a browser and log in — the same login screen
as local dev.

## Managing the services

```powershell
nssm restart BudgetingSystemApi
nssm restart BudgetingSystemPyApi
nssm stop BudgetingSystemApi
nssm start BudgetingSystemApi

# Logs (rotated automatically past 10 MB)
Get-Content "C:\BudgetingSystem\backend\logs\stdout.log" -Tail 50 -Wait
Get-Content "C:\BudgetingSystem\backend-py\logs\stderr.log" -Tail 50 -Wait
```

To remove a service entirely: `nssm remove BudgetingSystemApi confirm`.

## Managing the IIS site

```powershell
Import-Module WebAdministration
Stop-Website -Name BudgetingSystem
Start-Website -Name BudgetingSystem
Restart-WebAppPool -Name BudgetingSystemPool
```

The generated reverse-proxy config lives at
`<DeployPath>\frontend\dist\web.config` — it's regenerated by the script on
every run, so hand-edit it only for one-off debugging, not permanent changes
(put permanent changes in the script instead).

## Redeploying / updating

1. `git pull` (or otherwise update) the checkout at `-SourcePath`.
2. Re-run `.\Deploy-IIS.ps1` with the same parameters you used the first
   time. It rebuilds both apps, re-runs any new migrations, and restarts
   both services and the site.

Because `-DeployPath` is wiped and re-mirrored from `-SourcePath` on every
run (`robocopy /MIR`), don't store anything you want to keep — uploaded
attachments included — directly under `-DeployPath`. If you need uploads to
survive a redeploy, point `UPLOAD_DIR` in `backend/.env` at a path outside
`-DeployPath` (e.g. `D:\budgeting-system-data\uploads`) before the first
run.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Script stops at "JWT_SECRET is missing or still the placeholder value" | Edit `backend/.env` / `backend-py/.env` per the table above, then re-run. |
| Script stops at "JWT_SECRET differs between..." | Copy the exact same value into both `.env` files. |
| IIS site loads but shows a blank page / 502-style errors on API calls | Check `nssm status` for both services; check `logs\stderr.log` under each service's folder in `-DeployPath`. Common cause: `DATABASE_URL` unreachable from this server. |
| `502.3 Bad Gateway` at the IIS level specifically | ARR's proxy setting isn't enabled, or the URL Rewrite/ARR modules didn't install — re-run with `-SkipPrereqs` removed, or check `Test-Path "$env:SystemRoot\System32\inetsrv\rewrite.dll"` and `Test-Path "$env:ProgramFiles\IIS\Application Request Routing"`. |
| Site works locally on the server (`localhost:9090`) but not from another machine | The inbound firewall rule wasn't created, or a network-level firewall / NSG in front of this server is separately blocking port 9090 — that's outside this script's control. |
| A client-side route (e.g. `/transfers/12`) 404s on a hard refresh but works when navigated to from inside the app | The SPA fallback rule in `web.config` isn't taking effect — confirm URL Rewrite is installed and the `web.config` in `frontend/dist` matches what's in the script. |
| Redeploy wiped uploaded attachments | `UPLOAD_DIR` was pointing inside `-DeployPath`, which gets wiped by `robocopy /MIR` on every run — see [Redeploying](#redeploying--updating) above. |
| Migrations fail with an auth/connection error | `DATABASE_URL` (and `DATABASE_URL` in `backend-py/.env`, in its `postgresql+psycopg://` form) is wrong, or Postgres isn't reachable from this server — test with `psql`, or `Test-NetConnection <dbhost> -Port 5432`. |

## Uninstalling

```powershell
nssm stop BudgetingSystemApi
nssm remove BudgetingSystemApi confirm
nssm stop BudgetingSystemPyApi
nssm remove BudgetingSystemPyApi confirm

Import-Module WebAdministration
Remove-Website -Name BudgetingSystem
Remove-WebAppPool -Name BudgetingSystemPool

Remove-NetFirewallRule -DisplayName "BudgetingSystem-Inbound-9090"
Remove-NetFirewallRule -DisplayName "BudgetingSystem-Outbound-Node"
Remove-NetFirewallRule -DisplayName "BudgetingSystem-Outbound-Python"
Remove-NetFirewallRule -DisplayName "BudgetingSystem-Outbound-Postgres"

Remove-Item -Recurse -Force "C:\BudgetingSystem"
```

(This leaves the database, IIS role, URL Rewrite/ARR modules, and NSSM
itself in place, since those aren't specific to this app.)

## Notes / things this guide deliberately leaves out

- **HTTPS/TLS** — the site is created as plain `http://` on port 9090, per
  what was asked for. If this needs to be reachable outside a trusted
  network, put a TLS certificate on the IIS binding (or terminate TLS at a
  load balancer/reverse proxy in front of this server) before relying on it
  for anything sensitive.
- **PostgreSQL installation/hardening** — not covered; this guide assumes a
  reachable instance already exists.
- **Backups** — not covered; back up the Postgres database on whatever
  schedule fits, same as any other production database.
