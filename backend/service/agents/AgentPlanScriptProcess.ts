import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";

import { CliPausableDeadline } from "@/backend/agents/cli/CliPausableDeadline";

import { prepareSharedAgentEnvironment } from "@/backend/agents/cli/AgentSharedEnvironment";
import { planTemporaryMountDirectory } from "@/backend/agents/PlanRunTemporaryDirectory";
import { captureOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { sshConfigOverlayArguments } from "@/backend/agents/cli/CliSshConfigOverlay";

import { registerScriptPause, isScriptRunPaused } from "./AgentPlanScriptPause";
import { AgentPlanScriptCapture } from "./AgentPlanScriptCapture";
import { scriptEnvironment } from "./AgentPlanScriptResources";

import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";

/** One authorized attempt; source and JSON input are always separate transports. */
export interface ScriptProcessRequest {
  readonly runId?: string;
  readonly stepId?: string;
  readonly record: AgentPlanScriptRun;
  readonly program: string;
  readonly resources: string;
  readonly sharedEnvironment: string;
  readonly input: string;
  readonly timeoutSeconds: number;
  /** Additions of Pages' own Git closeout; scripts of a plan get none. */
  readonly environment?: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly claimStart: () => void;
  readonly save: (record: AgentPlanScriptRun) => Promise<void>;
}

interface RunningScript {
  readonly runId: string;
  readonly stepId: string;
  readonly child: ReturnType<typeof spawn>;
  readonly capture: AgentPlanScriptCapture;
  remainingMs: number;
  startedAt: number;
  timer?: NodeJS.Timeout;
  isPaused: boolean;
  pausedPids: Set<number>;
}

const runningScripts = new Set<RunningScript>();

function armTimeout(script: RunningScript): void {
  script.startedAt = Date.now();
  script.timer = setTimeout(
    () => script.capture.interrupt("timeout"),
    script.remainingMs,
  );
}

function childrenOf(pid: number): number[] {
  try {
    return readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")
      .trim()
      .split(/\s+/u)
      .map(Number)
      .filter((child) => Number.isSafeInteger(child) && child > 0);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
}

function descendantPids(root: number): Set<number> {
  const found = new Set<number>();
  const pending = [root];
  while (pending.length > 0) {
    const pid = pending.pop();
    if (pid === undefined || found.has(pid)) continue;
    found.add(pid);
    pending.push(...childrenOf(pid));
  }
  return found;
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return;
    throw error;
  }
}

function suspendScript(script: RunningScript): void {
  const root = script.child.pid;
  if (!root || script.capture.isExited) return;
  for (let pass = 0; pass < 3; pass += 1) {
    const before = script.pausedPids.size;
    for (const pid of descendantPids(root)) {
      if (script.pausedPids.has(pid)) continue;
      signalPid(pid, "SIGSTOP");
      script.pausedPids.add(pid);
    }
    if (script.pausedPids.size === before) break;
  }
}

function resumeScript(script: RunningScript): void {
  for (const pid of [...script.pausedPids].reverse()) signalPid(pid, "SIGCONT");
  script.pausedPids.clear();
}

/** Stops every active script of a run at its process-group boundary. */
export function suspendPlanScripts(runId: string): Set<string> {
  const suspended = new Set<string>();
  for (const script of runningScripts) {
    if (script.runId !== runId || script.isPaused || script.capture.isExited)
      continue;
    suspendScript(script);
    script.isPaused = true;
    script.remainingMs = Math.max(
      0,
      script.remainingMs - (Date.now() - script.startedAt),
    );
    clearTimeout(script.timer);
    suspended.add(script.stepId);
  }
  return suspended;
}

/** Continues scripts in the same process group and restores their remaining timeout. */
export function resumePlanScripts(runId: string): void {
  for (const script of runningScripts) {
    if (script.runId !== runId || !script.isPaused) continue;
    resumeScript(script);
    script.isPaused = false;
    armTimeout(script);
  }
}

/** Spawns one interpreter without a shell, closes stdin once, and waits for confirmed process cleanup. */
export async function executeScriptProcess(
  request: ScriptProcessRequest,
): Promise<AgentPlanScriptRun> {
  request.signal.throwIfAborted();
  await prepareSharedAgentEnvironment(request.sharedEnvironment);
  request.signal.throwIfAborted();
  request.claimStart();
  const sshConfigOverlay = await sshConfigOverlayArguments(
    path.join(request.resources, "ssh_config.d"),
  );
  const previousMask = process.umask(0o077);
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(
      "/usr/bin/bwrap",
      [
        "--die-with-parent",
        "--unshare-pid",
        "--new-session",
        "--bind",
        "/",
        "/",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--bind",
        request.record.temporaryScope
          ? planTemporaryMountDirectory(request.record.temporaryScope)
          : request.resources,
        "/tmp",
        ...sshConfigOverlay,
        "--bind",
        request.sharedEnvironment,
        request.sharedEnvironment,
        "--chdir",
        request.record.directory,
        "--",
        "/bin/sh",
        "-c",
        'IFS= read -r launch <&3 && [ "$launch" = go ] || exit 125; exec "$@"',
        "pages-script-launch",
        request.program,
        path.join(request.resources, "script.cjs"),
      ],
      {
        cwd: request.record.directory,
        shell: false,
        detached: true,
        env: {
          ...scriptEnvironment({
            directory: request.resources,
            interpreter: request.program,
            instanceId: request.record.instanceId,
            sharedEnvironment: request.sharedEnvironment,
            temporaryDirectory: "/tmp",
          }),
          ...request.environment,
        },
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
  } finally {
    process.umask(previousMask);
  }
  return await collectProcess(request, child);
}

async function collectProcess(
  request: ScriptProcessRequest,
  child: ReturnType<typeof spawn>,
): Promise<AgentPlanScriptRun> {
  const capture = new AgentPlanScriptCapture(child);
  child.stdio[3]?.on("error", () => capture.interrupt("io"));
  let record = { ...request.record, processId: child.pid ?? null };
  const abort = (): void => capture.interrupt("cancelled");
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  let unregisterPause: (() => void) | undefined;
  const deadline = new CliPausableDeadline(request.timeoutSeconds * 1000, () =>
    capture.interrupt("timeout"),
  );
  try {
    if (!child.pid) throw new Error("Script supervisor was not started");
    const namespace = await captureOwnedNamespace(child.pid);
    record = { ...record, namespace };
    if (request.runId)
      unregisterPause = await registerScriptPause({
        runId: request.runId,
        namespace,
        deadline,
      });
    await request.save(record);
    const release = child.stdio[3];
    if (!(release instanceof Writable))
      throw new Error("Script release unavailable");
    release.end("go\n");
    child.stdin?.end(request.input, "utf8");
    await capture.wait();
  } catch {
    capture.interrupt("io");
  } finally {
    deadline.close();
    unregisterPause?.();
    request.signal.removeEventListener("abort", abort);
  }
  const isConfirmed = await confirmScriptCloseout(
    request,
    capture,
    child,
    record.namespace !== undefined,
  );
  return capture.result(record, isConfirmed);
}

async function confirmScriptCloseout(
  request: ScriptProcessRequest,
  capture: AgentPlanScriptCapture,
  child: ReturnType<typeof spawn>,
  hasNamespace: boolean,
): Promise<boolean> {
  try {
    if (!capture.isExited)
      child.kill(
        request.runId && isScriptRunPaused(request.runId)
          ? "SIGKILL"
          : "SIGTERM",
      );
    const escalation = setTimeout(() => {
      if (!capture.isExited) child.kill("SIGKILL");
    }, 2000);
    try {
      return (await capture.confirmClosed()) && hasNamespace;
    } finally {
      clearTimeout(escalation);
    }
  } catch {
    return false;
  } finally {
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
}
