import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";

/**
 * Releases an unadoptable owner whose unit and process are provably gone.
 *
 * @param entry - The stored owner that discovery could not prove alive.
 * @param settle - Proves the end, stops leftover worker units and records the release.
 * @returns Whether the owner ended and is released; `false` keeps it uncertain.
 *
 * @remarks
 * A reboot or a killed unit ends an owner without Pages. Nothing of such an
 * owner can still write, so it is not uncertain and its run may go on. Every
 * doubt, including a failed read or a still running worker, keeps it uncertain.
 */
export async function releaseEndedOwner(
  entry: LocalSessionEntry,
  settle: (entry: LocalSessionEntry) => Promise<boolean>,
): Promise<boolean> {
  try {
    if (!(await settle(entry))) return false;
  } catch (error: unknown) {
    logCaughtError("LocalSessions", error);
    return false;
  }
  logEvent({
    level: "info",
    event: "agent.local_owner.ended",
    component: "LocalSessions",
    message:
      "Local native owner ended outside Pages; its reservations are released",
    metadata: { instanceId: entry.instanceId, runId: entry.runId },
  });
  return true;
}
