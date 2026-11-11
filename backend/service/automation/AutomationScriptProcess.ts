import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Writable } from "node:stream";

import { logCaughtError } from "@/backend/logging/Logger";
import { AgentPlanScriptCapture } from "@/backend/service/agents/AgentPlanScriptCapture";
import {
  createScriptResources,
  removeScriptResources,
  scriptEnvironment,
} from "@/backend/service/agents/AgentPlanScriptResources";

import type { ChildProcess } from "node:child_process";
import type {
  AgentPlanScriptFailure,
  AgentPlanScriptRun,
} from "@/definition/AgentPlanScript";

/** How long a process group may take to end after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 2000;
/** How long the streams may stay open after the script ended. */
const CLOSE_GRACE_MS = 1000;

/**
 * Variables a script may need to hand work to the user's service manager,
 * such as `systemd-run --user`; Pages passes them only when it has them.
 */
const SESSION_VARIABLES = ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"];

/** One script run of an automation. */
export interface AutomationScriptRequest {
  readonly userId: string;
  readonly program: string;
  readonly directory: string;
  readonly interpreterProfileId: string;
  readonly content: string;
  /** The JSON the script reads on stdin. */
  readonly input: string;
  readonly timeoutSeconds: number;
  readonly signal: AbortSignal;
}

/** How a script run ended. */
export interface AutomationScriptResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly failure: AgentPlanScriptFailure | null;
  readonly stdout: string | null;
  readonly stderr: string;
}

function sessionEnvironment(): Record<string, string> {
  return Object.fromEntries(
    SESSION_VARIABLES.flatMap((name) => {
      const value = process.env[name];
      return value ? [[name, value]] : [];
    }),
  );
}

/** Signals a whole process group; a group that already ended is fine. */
function signalGroup(processId: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-processId, signal);
    return true;
  } catch {
    return false;
  }
}

function isGroupAlive(processId: number): boolean {
  return signalGroup(processId, 0);
}

async function endGroup(processId: number): Promise<void> {
  if (!signalGroup(processId, "SIGTERM")) return;
  const deadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < deadline && isGroupAlive(processId))
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (isGroupAlive(processId)) signalGroup(processId, "SIGKILL");
}

async function waitClosed(capture: AgentPlanScriptCapture): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      capture.confirmClosed(),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), CLOSE_GRACE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function launch(
  request: AutomationScriptRequest,
  resources: { readonly directory: string; readonly instanceId: string },
): ChildProcess {
  const previousMask = process.umask(0o077);
  try {
    return spawn(
      "/bin/sh",
      [
        "-c",
        'IFS= read -r launch <&3 && [ "$launch" = go ] || exit 125; exec 3<&-; exec "$@"',
        "pages-automation-script",
        request.program,
        path.join(resources.directory, "script.cjs"),
      ],
      {
        cwd: request.directory,
        shell: false,
        // Its own process group: at the end only this group is ended.
        detached: true,
        env: {
          ...scriptEnvironment({
            directory: resources.directory,
            interpreter: request.program,
            instanceId: resources.instanceId,
          }),
          ...sessionEnvironment(),
        },
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
  } finally {
    process.umask(previousMask);
  }
}

async function collect(
  request: AutomationScriptRequest,
  child: ChildProcess,
): Promise<AutomationScriptResult> {
  const capture = new AgentPlanScriptCapture(child);
  child.stdio[3]?.on("error", () => capture.interrupt("io"));
  const abort = (): void => capture.interrupt("cancelled");
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(
    () => capture.interrupt("timeout"),
    request.timeoutSeconds * 1000,
  );
  try {
    const release = child.stdio[3];
    if (!child.pid || !(release instanceof Writable))
      throw new Error("Script launch unavailable");
    release.end("go\n");
    child.stdin?.end(request.input, "utf8");
    await capture.wait();
  } catch {
    capture.interrupt("io");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
  // The script's own group ends here, at its normal end as on a stop or a
  // timeout. Sessions it started deliberately in a group of their own, such
  // as `tmux new-session -d` or `systemd-run --user`, keep running.
  if (child.pid) await endGroup(child.pid);
  const isClosed = await waitClosed(capture);
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.stdio[3]?.destroy();
  const record = capture.result(placeholderRecord(request), true);
  return {
    exitCode: record.exitCode,
    signal: record.signal,
    failure:
      record.failure ?? (capture.isExited || isClosed ? null : "cleanup"),
    stdout: record.stdout,
    stderr: record.stderr,
  };
}

/** The capture reports into a record of the plan scripts; only its result fields are used. */
function placeholderRecord(
  request: AutomationScriptRequest,
): AgentPlanScriptRun {
  return {
    attemptId: "",
    instanceId: "",
    interpreterProfileId: request.interpreterProfileId,
    directory: request.directory,
    userId: request.userId,
    uid: process.getuid?.() ?? 0,
    gid: process.getgid?.() ?? 0,
    processId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    signal: null,
    failure: null,
    closeout: "pending",
    stdout: null,
    stderr: "",
  };
}

/**
 * Runs the script of an automation (PAGE-297).
 *
 * @param request - The interpreter, the workspace, the content, the stdin
 * JSON and the time limit, all already authorized.
 * @returns Exit code, bounded output and the failure, if any.
 *
 * @remarks
 * The same building blocks as the scripts of plans: a private resource
 * directory, the allowlisted environment, a release gate before the program
 * starts, stdin closed once, and the same strict output limits. Unlike a
 * plan step, the script runs in its own process group instead of its own
 * PID namespace, so a process it detaches into a new session survives the
 * end of the script. The run ends when the script itself ends; its exit code
 * and output count, not those of a detached process.
 */
export async function executeAutomationScript(
  request: AutomationScriptRequest,
): Promise<AutomationScriptResult> {
  request.signal.throwIfAborted();
  const instanceId = randomUUID();
  const directory = await createScriptResources(instanceId, request.content);
  try {
    return await collect(request, launch(request, { directory, instanceId }));
  } finally {
    await removeScriptResources(instanceId).catch((error: unknown) => {
      logCaughtError("AutomationScriptProcess", error);
    });
  }
}
