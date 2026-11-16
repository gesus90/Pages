import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { readPlanScriptRun } from "@/backend/agents/AgentPlanScriptRunInput";
import { localManagerEnvironment } from "@/backend/agents/local/LocalSessionOwnership";
import {
  readLocalRecord,
  writeLocalRecord,
} from "@/backend/agents/local/LocalSessionFiles";

import {
  removeScriptResources,
  scriptRuntimeDirectory,
} from "./AgentPlanScriptResources";

import type { ScriptProcessRequest } from "./AgentPlanScriptProcess";
import type { PlanTemporaryScope } from "@/backend/agents/PlanRunTemporaryDirectory";
import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";

const runFile = promisify(execFile);

/** Reads the durable capture of the same script, also after the plan service restarted. */
export async function readOwnedScript(
  instanceId: string,
  scope?: PlanTemporaryScope,
): Promise<AgentPlanScriptRun | null> {
  const directory = scriptRuntimeDirectory(instanceId, scope);
  try {
    if ((await readFile(path.join(directory, "owner"), "utf8")) !== instanceId)
      throw new Error("Script owner mismatch");
    return readPlanScriptRun(
      await readLocalRecord(path.join(directory, "progress.json")),
    );
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

function scriptUnit(instanceId: string): string {
  return `pages-script-${instanceId}.service`;
}

async function hasOwnerMarker(
  instanceId: string,
  scope?: PlanTemporaryScope,
): Promise<boolean> {
  const directory = scriptRuntimeDirectory(instanceId, scope);
  try {
    return (
      (await readFile(path.join(directory, "owner"), "utf8")) === instanceId
    );
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** Persists reversible intent independently of any Pages process or stream; an attempt without resources owns nothing to control. */
export async function controlOwnedScript(
  instanceId: string,
  action: "pause" | "resume" | "stop",
  scope?: PlanTemporaryScope,
): Promise<void> {
  if (!(await hasOwnerMarker(instanceId, scope))) return;
  const directory = scriptRuntimeDirectory(instanceId, scope);
  await writeLocalRecord(path.join(directory, "control.json"), { action });
}

/** Whether the transient owner unit of a script is still loaded and not inactive. */
async function hasActiveScriptUnit(instanceId: string): Promise<boolean> {
  const shown = await runFile(
    "/usr/bin/systemctl",
    [
      "--user",
      "show",
      scriptUnit(instanceId),
      "--property=LoadState,ActiveState",
    ],
    { env: localManagerEnvironment(), timeout: 10_000 },
  );
  const properties = new Set(shown.stdout.trim().split("\n"));
  return !(
    properties.has("LoadState=not-found") ||
    properties.has("ActiveState=inactive") ||
    properties.has("ActiveState=failed")
  );
}

/**
 * Settles a stopped attempt that never got a script process.
 *
 * @remarks
 * Without a process and without a live owner unit nothing of the attempt can
 * still run, so removing its private resources confirms the closeout. A saved
 * capture that already ended is adopted as it is; an attempt with a process or
 * a live owner keeps its record for the owner to settle.
 *
 * @param record - The saved script record of the attempt.
 * @param failure - Why the attempt ended when it has no failure yet.
 * @returns The confirmed or failed record, or `record` while it stays pending.
 */
export async function settleUnstartedScript(
  record: AgentPlanScriptRun,
  failure: "cancelled" | "interrupted" = "cancelled",
): Promise<AgentPlanScriptRun> {
  if (record.runnerOwned || record.runnerJob) return record;
  if (record.closeout !== "pending" || record.processId !== null) return record;
  const capture = await readOwnedScript(
    record.instanceId,
    record.temporaryScope,
  );
  if (capture?.endedAt) return capture;
  if (
    capture?.processId ||
    (capture && (await hasActiveScriptUnit(record.instanceId)))
  )
    return record;
  const endedAt = new Date().toISOString();
  try {
    await removeScriptResources(record.instanceId, record.temporaryScope);
    return {
      ...record,
      endedAt,
      failure: record.failure ?? failure,
      closeout: "confirmed",
    };
  } catch {
    return { ...record, endedAt, failure: "cleanup", closeout: "failed" };
  }
}

/** Follows a saved legacy owner without replaying or starting its script. */
export async function executeOwnedScript(
  request: ScriptProcessRequest & { readonly runId: string },
): Promise<AgentPlanScriptRun> {
  const scope = request.record.temporaryScope;
  if (!(await readOwnedScript(request.record.instanceId, scope)))
    throw new Error("Legacy script capture unavailable");
  for (;;) {
    if (request.signal.aborted)
      await controlOwnedScript(request.record.instanceId, "stop", scope);
    const record = await readOwnedScript(request.record.instanceId, scope);
    if (!record) throw new Error("Script capture unavailable");
    await request.save(record);
    if (record.endedAt) return record;
    if (!(await hasActiveScriptUnit(record.instanceId))) {
      const settled = await settleUnstartedScript(record, "interrupted");
      if (settled.closeout !== "pending") return settled;
      return {
        ...record,
        closeout: "failed",
        failure: "interrupted",
        endedAt: new Date().toISOString(),
      };
    }
    // A stopped attempt whose owner died before the spawn would otherwise be followed forever.
    if (request.signal.aborted && record.processId === null) {
      const settled = await settleUnstartedScript(record);
      if (settled.closeout !== "pending") return settled;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}
