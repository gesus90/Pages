import { spawn } from "node:child_process";
import path from "node:path";

import { readSpawnScope } from "@/backend/agents/cli/CliProcessScan";

import { AgentPlanScriptCapture } from "./AgentPlanScriptCapture";
import { closeScriptProcesses } from "./AgentPlanScriptProcessGroup";
import { scriptEnvironment } from "./AgentPlanScriptResources";

import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";

/** One authorized attempt; source and JSON input are always separate transports. */
export interface ScriptProcessRequest {
  readonly record: AgentPlanScriptRun;
  readonly program: string;
  readonly resources: string;
  readonly input: string;
  readonly timeoutSeconds: number;
  readonly signal: AbortSignal;
  readonly claimStart: () => void;
  readonly save: (record: AgentPlanScriptRun) => Promise<void>;
}

/** Spawns one interpreter without a shell, closes stdin once, and waits for confirmed process cleanup. */
export async function executeScriptProcess(
  request: ScriptProcessRequest,
): Promise<AgentPlanScriptRun> {
  const scope = await readSpawnScope();
  request.signal.throwIfAborted();
  request.claimStart();
  const previousMask = process.umask(0o077);
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(
      request.program,
      [path.join(request.resources, "script.cjs")],
      {
        cwd: request.record.directory,
        shell: false,
        detached: true,
        env: scriptEnvironment({
          directory: request.resources,
          interpreter: request.program,
          instanceId: request.record.instanceId,
        }),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } finally {
    process.umask(previousMask);
  }
  return await collectProcess(request, { child, scope });
}

async function collectProcess(
  request: ScriptProcessRequest,
  processContext: {
    readonly child: ReturnType<typeof spawn>;
    readonly scope: Awaited<ReturnType<typeof readSpawnScope>>;
  },
): Promise<AgentPlanScriptRun> {
  const { child, scope } = processContext;
  const capture = new AgentPlanScriptCapture(child);
  const record = { ...request.record, processId: child.pid ?? null };
  const abort = (): void => capture.interrupt("cancelled");
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(
    () => capture.interrupt("timeout"),
    request.timeoutSeconds * 1000,
  );
  try {
    await request.save(record);
    child.stdin?.end(request.input, "utf8");
    await capture.wait();
  } catch {
    capture.interrupt("io");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
  let isConfirmed = false;
  try {
    const areProcessesClosed = await closeScriptProcesses({
      processId: child.pid,
      instanceId: record.instanceId,
      scope,
    });
    isConfirmed = (await capture.confirmClosed()) && areProcessesClosed;
  } catch {
    isConfirmed = false;
  } finally {
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  return capture.result(record, isConfirmed);
}
