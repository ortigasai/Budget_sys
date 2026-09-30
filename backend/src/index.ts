import "dotenv/config";
import { createApp } from "./app";
import { getFiscalCycle } from "./lib/fiscalCycle";
import { runScheduledSync } from "./lib/backgroundSync";
import { syncHistoricalActualsFromSap } from "./services/historicalActualsService";
import { runManpowerRecompute } from "./services/manpowerService";

const port = Number(process.env.PORT ?? 4000);
// Optional - unset (default "0.0.0.0") preserves today's behavior. The IIS
// deployment (see /iis_deployment.md) sets HOST=127.0.0.1 so this service is
// only reachable through the IIS reverse proxy, not directly from outside.
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp();

app.listen(port, host, () => {
  console.log(`Budgeting System API listening on http://${host}:${port}`);
});

// Runs GAE/DOE Forecast's and Manpower's own SAP pulls automatically every
// 10 minutes, same as backend-py's own SAP sync scheduler (main.py) - an
// immediate first run, then every SCHEDULED_SYNC_INTERVAL_MS after. Both
// "Sync Now"/"Run Manpower Budget" buttons still work too, for an on-demand
// refresh - see lib/backgroundSync.ts.
//
// The two jobs here run one at a time, in sequence (awaited, not fired
// together) - and each also waits its turn against backend-py's own
// scheduled sync via the shared SapSyncLock (runScheduledSync), so the SAP
// broker only ever sees one of these three jobs (this pair, plus Python's)
// running at once instead of all of them hitting it simultaneously.
const SCHEDULED_SYNC_INTERVAL_MS = 10 * 60 * 1000;

async function runScheduledSyncs() {
  const { targetCalendarYear } = await getFiscalCycle();
  await runScheduledSync("historicalActuals", syncHistoricalActualsFromSap);
  await runScheduledSync("manpower", () => runManpowerRecompute(targetCalendarYear));
}

runScheduledSyncs().catch((err) => console.error("[sap-sync] scheduled tick failed:", err));
setInterval(() => {
  runScheduledSyncs().catch((err) => console.error("[sap-sync] scheduled tick failed:", err));
}, SCHEDULED_SYNC_INTERVAL_MS);
