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
import { scriptRuntimeDirectory } from "./AgentPlanScriptResources";
import { planPauseGate } from "./AgentPlanPauseGate";

import type { ScriptProcessRequest } from "./AgentPlanScriptProcess";
import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";

const runFile = promisify(execFile);
const launchSchema = z.object({
  runId: z.string(),
  record: planScriptRunSchema,
  program: z.string(),
  resources: z.string(),
  input: z.string(),
  timeoutSeconds: z.number(),
  environment: z.record(z.string(), z.string()).optional(),
});

/** Reads the durable capture of the same script, also after the plan service restarted. */
export async function readOwnedScript(
  instanceId: string,
): Promise<AgentPlanScriptRun | null> {
  const directory = scriptRuntimeDirectory(instanceId);
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

/** Persists reversible intent independently of any Pages process or stream. */
export async function controlOwnedScript(
  instanceId: string,
  action: "pause" | "resume" | "stop",
): Promise<void> {
  const directory = scriptRuntimeDirectory(instanceId);
  await writeLocalRecord(path.join(directory, "control.json"), { action });
}

/** Starts an independent owner or follows its saved capture without replaying the script. */
export async function executeOwnedScript(
  request: ScriptProcessRequest & { readonly runId: string },
): Promise<AgentPlanScriptRun> {
  if (!(await readOwnedScript(request.record.instanceId))) {
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
        `--unit=pages-script-${request.record.instanceId}.service`,
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
      await controlOwnedScript(request.record.instanceId, "stop");
    const record = await readOwnedScript(request.record.instanceId);
    if (!record) throw new Error("Script capture unavailable");
    await request.save(record);
    if (record.endedAt) return record;

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
  if (scriptRuntimeDirectory(launch.record.instanceId) !== directory)
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
