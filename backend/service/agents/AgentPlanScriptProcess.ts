import { spawn } from "node:child_process";
import path from "node:path";
import { Writable } from "node:stream";

import { captureOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { sshConfigOverlayArguments } from "@/backend/agents/cli/CliSshConfigOverlay";

import { AgentPlanScriptCapture } from "./AgentPlanScriptCapture";
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
        ...sshConfigOverlay,
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
        env: scriptEnvironment({
          directory: request.resources,
          interpreter: request.program,
          instanceId: request.record.instanceId,
        }),
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
  const timer = setTimeout(
    () => capture.interrupt("timeout"),
    request.timeoutSeconds * 1000,
  );
  try {
    if (!child.pid) throw new Error("Script supervisor was not started");
    const namespace = await captureOwnedNamespace(child.pid);
    record = { ...record, namespace };
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
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
  let isConfirmed = false;
  try {
    if (!capture.isExited) child.kill("SIGTERM");
    const escalation = setTimeout(() => {
      if (!capture.isExited) child.kill("SIGKILL");
    }, 2000);
    try {
      isConfirmed =
        (await capture.confirmClosed()) && record.namespace !== undefined;
    } finally {
      clearTimeout(escalation);
    }
  } catch {
    isConfirmed = false;
  } finally {
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  return capture.result(record, isConfirmed);
}
