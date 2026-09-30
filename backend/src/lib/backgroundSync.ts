import { prisma } from "../prisma";

// Node-side counterpart to backend-py/app/services/sap_sync_service.py's
// background-job pattern - a "Sync from SAP"/"Run Manpower Budget" click
// used to await the real broker pull inline on the request (see git history
// for historicalActualsService.ts/manpowerService.ts), which could sit past
// the frontend's own request timeout on a big pull, exactly like the
// timeout Python's own sync used to hit before it was moved to a background
// thread. This does the same thing for Node: the route starts the sync here
// and returns immediately (202); the frontend polls GET .../status instead.
//
// Status is persisted to SapSyncStatus (one row per `moduleName`), not just
// held in memory - survives a service restart, visible to every user, not
// just whoever's browser happened to be polling.
//
// `running`, not the DB row, is the in-process concurrency guard for a
// single module - checking it is synchronous (Node's single-threaded event
// loop makes a Set check-then-add here atomic, no race like there'd be
// awaiting a DB read first). Separate from SapSyncLock below, which guards
// against *different* jobs (including Python's own) running at once.
const running = new Set<string>();

export function isSyncRunningInProcess(moduleName: string): boolean {
  return running.has(moduleName);
}

// Does the actual sync + status bookkeeping - shared by startBackgroundSync
// (fire-and-forget, for a manual click) and runScheduledSync (awaited, for
// the automatic scheduler) below, so both update SapSyncStatus identically.
async function runSyncNow<T>(moduleName: string, fn: () => Promise<T>): Promise<void> {
  console.log(`[sap-sync:${moduleName}] starting.`);
  try {
    await prisma.sapSyncStatus.upsert({
      where: { module: moduleName },
      update: { status: "running", startedAt: new Date(), finishedAt: null, error: null },
      create: { module: moduleName, status: "running", startedAt: new Date() },
    });
    const result = await fn();
    const now = new Date();
    await prisma.sapSyncStatus.update({
      where: { module: moduleName },
      data: { status: "success", finishedAt: now, lastSuccessAt: now, resultJson: result as any, error: null },
    });
    console.log(`[sap-sync:${moduleName}] succeeded.`, result);
  } catch (err: any) {
    console.error(`[sap-sync:${moduleName}] failed:`, err);
    await prisma.sapSyncStatus
      .update({
        where: { module: moduleName },
        data: { status: "error", finishedAt: new Date(), error: err?.message ?? String(err) },
      })
      .catch((updateErr) => console.error(`[sap-sync:${moduleName}] couldn't even persist the failure:`, updateErr));
  }
}

// Returns false (and starts nothing) if `moduleName` is already running.
// Used by the manual "Sync Now"/"Run Manpower Budget" routes only - a
// deliberate, occasional user action gets to run right away rather than
// queuing behind SapSyncLock (that lock is about keeping the *automatic*
// scheduler from hammering the broker with everything at once, not about
// limiting a one-off click).
export function startBackgroundSync<T>(moduleName: string, fn: () => Promise<T>): boolean {
  if (running.has(moduleName)) {
    console.log(`[sap-sync:${moduleName}] skipped - already running.`);
    return false;
  }
  running.add(moduleName);
  void runSyncNow(moduleName, fn).finally(() => running.delete(moduleName));
  return true;
}

export async function getSyncStatus(moduleName: string) {
  return prisma.sapSyncStatus.findUnique({ where: { module: moduleName } });
}

// ---------------------------------------------------------------------------
// SapSyncLock - a single global mutex (one row, id "global") so the three
// scheduled sync jobs (Node's "historicalActuals"/"manpower", Python's
// combined "sap" job) never run at once against the shared SAP broker, even
// though they're spread across two separate processes/languages. A losing
// job waits its turn (bounded - see runScheduledSync below) rather than
// giving up outright, so it isn't starved if it keeps losing the race at
// every fixed 10-minute mark.
// ---------------------------------------------------------------------------

const LOCK_ID = "global";
// A held-but-never-released lock (its owner crashed mid-sync) would
// otherwise block every future sync forever - treat one older than this as
// abandoned and let anyone reclaim it. Comfortably longer than any real
// sync's own duration (each is minutes, not this).
const LOCK_STALE_MS = 20 * 60 * 1000;
const LOCK_POLL_MS = 15 * 1000;

async function tryAcquireGlobalLock(moduleName: string): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - LOCK_STALE_MS);
  const claimed = await prisma.sapSyncLock.updateMany({
    where: { id: LOCK_ID, OR: [{ heldBy: null }, { heldAt: { lt: staleCutoff } }] },
    data: { heldBy: moduleName, heldAt: new Date() },
  });
  return claimed.count > 0;
}

async function releaseGlobalLock(moduleName: string): Promise<void> {
  await prisma.sapSyncLock.updateMany({ where: { id: LOCK_ID, heldBy: moduleName }, data: { heldBy: null, heldAt: null } });
}

// For the automatic scheduler only (see index.ts) - waits up to `maxWaitMs`
// for the shared lock (polling every LOCK_POLL_MS), runs the sync once
// acquired, then releases it. Gives up (skips this tick, no error) if it
// never gets a turn within `maxWaitMs` - the next scheduled tick tries
// again, rather than this blocking indefinitely.
export async function runScheduledSync<T>(moduleName: string, fn: () => Promise<T>, maxWaitMs = 5 * 60 * 1000): Promise<void> {
  if (running.has(moduleName)) {
    console.log(`[sap-sync:${moduleName}] scheduled tick skipped - already running (e.g. a manual click in flight).`);
    return;
  }
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    if (await tryAcquireGlobalLock(moduleName)) {
      running.add(moduleName);
      try {
        await runSyncNow(moduleName, fn);
      } finally {
        running.delete(moduleName);
        await releaseGlobalLock(moduleName);
      }
      return;
    }
    if (Date.now() >= deadline) {
      console.log(`[sap-sync:${moduleName}] scheduled tick skipped - couldn't get the shared SAP sync lock within ${maxWaitMs}ms (something else was running the whole time).`);
      return;
    }
    console.log(`[sap-sync:${moduleName}] scheduled tick waiting for the shared SAP sync lock...`);
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
}
