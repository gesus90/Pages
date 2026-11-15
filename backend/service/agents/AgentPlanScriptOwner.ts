import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import {
  planScriptRunSchema,
  readPlanScriptRun,
} from "@/backend/agents/AgentPlanScriptRunInput";
import { localManagerEnvironment } from "@/backend/agents/local/LocalSessionOwnership";
import {
  readLocalRecord,
  writeLocalRecord,
} from "@/backend/agents/local/LocalSessionFiles";
import { controlOwnedNamespace } from "@/backend/agents/cli/CliNamespaceControl";
import { logCaughtError } from "@/backend/logging/Logger";

import { executeScriptProcess } from "./AgentPlanScriptProcess";
import {
  removeScriptResources,
  scriptRuntimeDirectory,
} from "./AgentPlanScriptResources";
import { planPauseGate } from "./AgentPlanPauseGate";

import type { ScriptProcessRequest } from "./AgentPlanScriptProcess";
import type { PlanTemporaryScope } from "@/backend/agents/PlanRunTemporaryDirectory";
import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";

const runFile = promisify(execFile);
const launchSchema = z.object({
  runId: z.string(),
  record: planScriptRunSchema,
  program: z.string(),
  resources: z.string(),
  sharedEnvironment: z.string(),
  input: z.string(),
  timeoutSeconds: z.number(),
  environment: z.record(z.string(), z.string()).optional(),
});

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
    properties.has("ActiveState=inactive")
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

/** Starts an independent owner or follows its saved capture without replaying the script. */
export async function executeOwnedScript(
  request: ScriptProcessRequest & { readonly runId: string },
): Promise<AgentPlanScriptRun> {
  const scope = request.record.temporaryScope;
  if (!(await readOwnedScript(request.record.instanceId, scope))) {
    request.signal.throwIfAborted();
    request.claimStart();
    await writeLocalRecord(
      path.join(request.resources, "launch.json"),
      launchSchema.parse(request),
    );
    await writeLocalRecord(
      path.join(request.resources, "progress.json"),
      request.record,
    );

    const entrypoint = fileURLToPath(
      new URL(
        import.meta.env?.PROD
          ? "../../plan-script.mjs"
          : "../../../plan-script.mjs",
        import.meta.url,
      ),
    );
    await runFile(
      "/usr/bin/systemd-run",
      [
        "--user",
        "--quiet",
        "--collect",
        "--service-type=exec",
        "--expand-environment=no",
        `--unit=${scriptUnit(request.record.instanceId)}`,
        "-p",
        "KillMode=control-group",
        "-p",
        "TimeoutStopSec=5s",
        "-p",
        "UMask=0077",
        "--working-directory",
        path.dirname(entrypoint),
        "--",
        process.execPath,
        entrypoint,
        request.resources,
        import.meta.env?.PROD ? "production" : "source",
      ],
      {
        env: {
          ...localManagerEnvironment(),
          PATH: process.env.PATH ?? "/usr/bin:/bin",
        },
        timeout: 2000,
      },
    );
  }
  for (;;) {
    if (request.signal.aborted)
      await controlOwnedScript(request.record.instanceId, "stop", scope);
    const record = await readOwnedScript(request.record.instanceId, scope);
    if (!record) throw new Error("Script capture unavailable");
    await request.save(record);
    if (record.endedAt) return record;
    // A stopped attempt whose owner died before the spawn would otherwise be followed forever.
    if (request.signal.aborted && record.processId === null) {
      const settled = await settleUnstartedScript(record);
      if (settled.closeout !== "pending") return settled;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}

async function readScriptControl(directory: string): Promise<unknown> {
  try {
    return await readLocalRecord(path.join(directory, "control.json"));
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { action: "resume" };
    throw error;
  }
}

/** Independent script owner: keeps bounded output and the process alive while Pages restarts. */
export async function startPlanScriptOwner(directory: string): Promise<void> {
  const launch = launchSchema.parse(
    await readLocalRecord(path.join(directory, "launch.json")),
  );
  if (
    scriptRuntimeDirectory(
      launch.record.instanceId,
      launch.record.temporaryScope,
    ) !== directory
  )
    throw new Error("Script directory mismatch");
  let record = launch.record;
  const controller = new AbortController();
  let isChecking = false;
  let action = "resume";
  const timer = setInterval(() => {
    if (isChecking) return;
    isChecking = true;
    void (async (): Promise<void> => {
      const control = await readScriptControl(directory);
      if (
        !control ||
        typeof control !== "object" ||
        !("action" in control) ||
        control.action === action
      )
        return;
      if (control.action === "stop") {
        controller.abort();
        if (record.namespace)
          await controlOwnedNamespace(record.namespace, "stop");
      } else if (control.action === "pause" || control.action === "resume") {
        if (control.action === "pause") planPauseGate(launch.runId).pause();
        else planPauseGate(launch.runId).resume();
        if (record.namespace)
          await controlOwnedNamespace(record.namespace, control.action);
      }
      if (typeof control.action === "string") action = control.action;
    })()
      .catch((error: unknown) => logCaughtError("AgentPlanScriptOwner", error))
      .finally(() => {
        isChecking = false;
      });
  }, 100);
  try {
    const control = await readScriptControl(directory);
    if (
      typeof control === "object" &&
      control !== null &&
      "action" in control &&
      control.action === "pause"
    )
      planPauseGate(launch.runId).pause();
    await planPauseGate(launch.runId).wait(controller.signal);
    record = await executeScriptProcess({
      ...launch,
      signal: controller.signal,
      claimStart: () => undefined,
      save: async (next) => {
        record = next;
        await writeLocalRecord(path.join(directory, "progress.json"), next);
      },
    });
    await writeLocalRecord(path.join(directory, "progress.json"), record);
  } finally {
    clearInterval(timer);
  }
}
