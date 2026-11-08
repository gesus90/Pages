import { lstat, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { withoutReadScope } from "@/backend/database/ReadScope";
import {
  PLAN_RUN_PURGE_PREFIX,
  purgeEarlierPlanRuns,
} from "@/backend/database/repositories/agent/AgentPlanRunPurge";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { PlanRunPurgeDatabase } from "@/backend/database/repositories/agent/AgentPlanRunPurge";

/** How long an attempt that left work behind waits before the next one. */
const DEFAULT_RETRY_DELAY_MS = 60_000;
const BATCH_SIZE = 64;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PLAN_RUN_PURGE = new RegExp(`^${PLAN_RUN_PURGE_PREFIX}(${UUID})$`, "u");
const PLAN_SESSIONS = new RegExp(`^plan-sessions/(${UUID})/$`, "u");
const LOCAL_SESSIONS = /^local-sessions\/([a-f0-9-]{36})\/$/u;
const JOURNAL_RECORD = /^\d{16}\.json$/u;

const PENDING_ENTRIES = `
  SELECT storage_name
  FROM agent_payload_garbage
  WHERE storage_name NOT LIKE 'agent-payloads/%'
      AND storage_name > $after
  ORDER BY storage_name
  LIMIT ${BATCH_SIZE};
`;

/** The database the collector reads and deletes with, and whose transactions a purge opens. */
export type GarbageDatabase = DatabaseTransaction & PlanRunPurgeDatabase;

/** Whether an entry was carried out, or has to wait for a later attempt. */
type EntryOutcome = "done" | "deferred";

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function realDirectory(directory: string): Promise<boolean> {
  try {
    return (await lstat(directory)).isDirectory();
  } catch (error: unknown) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function journalPayload(text: string): string | null {
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch (error: unknown) {
    // A torn record names no file that was ever acknowledged.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  return typeof record === "object" &&
    record !== null &&
    "payload" in record &&
    typeof record.payload === "string"
    ? record.payload
    : null;
}

/**
 * Carries out the slow deletion intents of `agent_payload_garbage` in the background.
 *
 * @remarks
 * The purge of earlier plan runs and the removal of transcript homes and
 * local session journals can take seconds, so no commit waits for them. An
 * entry leaves the table only after its work is done; a failure or a run
 * that has not settled keeps it, and the next attempt after the retry delay
 * or the next start of Pages repeats it.
 */
export class AgentDeferredGarbage {
  private readonly directory: string;
  private readonly removePayload: (reference: string) => Promise<void>;
  private readonly retryDelayMs: number;
  private readonly queue = new SerialQueue();
  private isScheduled = false;
  private isClosed = false;
  private retryAt = 0;

  public constructor(input: {
    readonly directory: string;
    readonly removePayload: (reference: string) => Promise<void>;
    readonly retryDelayMs?: number;
  }) {
    this.directory = input.directory;
    this.removePayload = input.removePayload;
    this.retryDelayMs = input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  /** Starts one collection unless one is waiting or the last one asked to wait; never throws. */
  public schedule(database: GarbageDatabase): void {
    if (this.isClosed || this.isScheduled || Date.now() < this.retryAt) return;
    this.isScheduled = true;
    // The commit that asks for a collection belongs to a request or a call;
    // the collection outlives both and must not join their transaction.
    void withoutReadScope(() =>
      withBackgroundDatabaseWork("agent_payload_garbage", () =>
        this.queue.run(async () => {
          this.isScheduled = false;
          if (this.isClosed) return;
          const hasLeftovers = await this.collect(database);
          this.retryAt = hasLeftovers ? Date.now() + this.retryDelayMs : 0;
        }),
      ),
    );
  }

  /** Resolves once every scheduled collection finished. */
  public async idle(): Promise<void> {
    await this.queue.idle();
  }

  /** Accepts no new collection and waits for the running one before the database closes. */
  public async close(): Promise<void> {
    this.isClosed = true;
    await this.queue.idle();
  }

  private async collect(database: GarbageDatabase): Promise<boolean> {
    let hasLeftovers = false;
    try {
      let after = "";
      let rows = await database.query(PENDING_ENTRIES, { after });
      while (rows.length > 0) {
        const names = rows
          .map(([storageName]) => storageName)
          .filter((name): name is string => typeof name === "string");
        if (await this.collectBatch(database, names)) hasLeftovers = true;
        after = names.at(-1) ?? "\uffff";
        rows = await database.query(PENDING_ENTRIES, { after });
      }
    } catch (error: unknown) {
      logCaughtError("AgentDeferredGarbage", error);
      return true;
    }
    return hasLeftovers;
  }

  /** Carries out every entry of a batch; one that fails or waits does not stop the others. */
  private async collectBatch(
    database: GarbageDatabase,
    names: readonly string[],
  ): Promise<boolean> {
    let hasLeftovers = false;
    for (const name of names)
      if ((await this.collectEntry(database, name)) === "deferred")
        hasLeftovers = true;
    return hasLeftovers;
  }

  private async collectEntry(
    database: GarbageDatabase,
    storageName: string,
  ): Promise<EntryOutcome> {
    try {
      const outcome = await this.carryOut(database, storageName);
      if (outcome === "done")
        await database.execute(
          "DELETE FROM agent_payload_garbage WHERE storage_name = $storage_name;",
          { storage_name: storageName },
        );
      return outcome;
    } catch (error: unknown) {
      logEvent({
        level: "warn",
        event: "agent.payload_garbage.retained",
        component: "AgentDeferredGarbage",
        message:
          "A deletion failed; it stays queued and is tried again later or at the next start.",
        metadata: { kind: storageName.slice(0, storageName.indexOf("/")) },
        error,
      });
      return "deferred";
    }
  }

  private async carryOut(
    database: GarbageDatabase,
    storageName: string,
  ): Promise<EntryOutcome> {
    const purge = PLAN_RUN_PURGE.exec(storageName);
    if (purge) return this.purgeRuns(database, purge[1]);
    const sessions = PLAN_SESSIONS.exec(storageName);
    if (sessions) {
      await this.removePlanSessions(sessions[1]);
      return "done";
    }
    const local = LOCAL_SESSIONS.exec(storageName);
    if (local) {
      await this.removeLocalSession(local[1]);
      return "done";
    }
    // An entry of a newer Pages version stays for the version that knows it.
    return "done";
  }

  private async purgeRuns(
    database: GarbageDatabase,
    keptRunId: string,
  ): Promise<EntryOutcome> {
    const isComplete = await purgeEarlierPlanRuns(database, keptRunId);
    if (!isComplete)
      logEvent({
        level: "info",
        event: "agent.plan.run_purge.deferred",
        component: "AgentDeferredGarbage",
        message:
          "An earlier run of the plan has not settled; its data is removed by a later attempt.",
        metadata: { runId: keptRunId },
      });
    return isComplete ? "done" : "deferred";
  }

  /** Removes `agents/<connection>/plan-sessions/<run>` of every connection, HOME and cache included. */
  private async removePlanSessions(runId: string): Promise<void> {
    const agents = path.join(this.directory, "agents");
    if (!(await realDirectory(agents))) return;
    for (const connection of await readdir(agents, { withFileTypes: true })) {
      if (!connection.isDirectory()) continue;
      const sessions = path.join(agents, connection.name, "plan-sessions");
      // A linked folder is never followed; only the run entry itself goes.
      if (!(await realDirectory(sessions))) continue;
      await rm(path.join(sessions, runId), { recursive: true, force: true });
    }
  }

  /** Removes the payload files a local session journal names, then the journal itself. */
  private async removeLocalSession(instanceId: string): Promise<void> {
    const root = path.join(this.directory, "local-sessions");
    const directory = path.join(root, instanceId);
    if (!(await realDirectory(root)) || !(await realDirectory(directory)))
      return;
    const journal = path.join(directory, "journal");
    if (await realDirectory(journal))
      for (const name of await readdir(journal)) {
        if (!JOURNAL_RECORD.test(name)) continue;
        const payload = journalPayload(
          await readFile(path.join(journal, name), "utf8"),
        );
        if (payload !== null) await this.removePayload(payload);
      }
    await rm(directory, { recursive: true, force: true });
  }
}
