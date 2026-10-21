import { spawn } from "node:child_process";

import { logCaughtError } from "@/backend/logging/Logger";

import type { ChildProcess } from "node:child_process";

/** One run of an OpenSSH tool, without a shell and with a minimal environment. */
export interface SshProcessRequest {
  readonly file: string;
  readonly arguments: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
  /** Stops the process after this time; `null` lets it run until it is stopped. */
  readonly timeoutMs: number | null;
}

/** What a finished OpenSSH tool left behind; the output stays on the server. */
export interface SshProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly isTimedOut: boolean;
  /** The tool could not be started, for example because it is not installed. */
  readonly isUnavailable: boolean;
}

const MAXIMUM_OUTPUT = 64 * 1024;
const STOP_GRACE_MILLISECONDS = 2_000;

function appendBounded(current: string, chunk: Buffer): string {
  if (current.length >= MAXIMUM_OUTPUT) return current;
  return (current + chunk.toString("utf8")).slice(0, MAXIMUM_OUTPUT);
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    // The tool runs in its own process group, so its helpers end with it.
    process.kill(-child.pid, signal);
  } catch (error: unknown) {
    logCaughtError("SshProcess", error);
  }
}

/**
 * A running OpenSSH tool in its own session without a terminal.
 *
 * @remarks
 * Without a controlling terminal OpenSSH asks the configured askpass helper
 * for a password or passphrase, never the terminal Pages was started from.
 */
export class SshChildProcess {
  public readonly exited: Promise<SshProcessResult>;
  private readonly child: ChildProcess | null;
  private isTimedOut = false;

  public constructor(request: SshProcessRequest) {
    let child: ChildProcess | null = null;
    try {
      child = spawn(request.file, request.arguments, {
        shell: false,
        detached: true,
        env: request.environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error: unknown) {
      logCaughtError("SshProcess", error);
    }
    this.child = child;
    this.exited = child
      ? this.watch(child, request.timeoutMs)
      : Promise.resolve({
          exitCode: null,
          stdout: "",
          stderr: "",
          isTimedOut: false,
          isUnavailable: true,
        });
  }

  /** Ends the tool and its helpers; a stubborn process is killed after a grace period. */
  public stop(): void {
    const child = this.child;
    if (!child) return;
    signalGroup(child, "SIGTERM");
    const timer = setTimeout(
      () => signalGroup(child, "SIGKILL"),
      STOP_GRACE_MILLISECONDS,
    );
    timer.unref();
    void this.exited.then(() => clearTimeout(timer));
  }

  private async watch(
    child: ChildProcess,
    timeoutMs: number | null,
  ): Promise<SshProcessResult> {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    const timer =
      timeoutMs === null
        ? null
        : setTimeout(() => {
            this.isTimedOut = true;
            signalGroup(child, "SIGKILL");
          }, timeoutMs);
    return new Promise((resolve) => {
      let isUnavailable = false;
      child.once("error", (error: Error) => {
        logCaughtError("SshProcess", error);
        isUnavailable = child.pid === undefined;
        if (isUnavailable)
          resolve({
            exitCode: null,
            stdout,
            stderr,
            isTimedOut: false,
            isUnavailable,
          });
      });
      child.once("close", (exitCode: number | null) => {
        if (timer) clearTimeout(timer);
        resolve({
          exitCode,
          stdout,
          stderr,
          isTimedOut: this.isTimedOut,
          isUnavailable,
        });
      });
    });
  }
}

/**
 * Runs an OpenSSH tool to its end.
 *
 * @param request - Tool, arguments, environment and time limit.
 * @returns Exit code and bounded output.
 */
export async function runSshProcess(
  request: SshProcessRequest,
): Promise<SshProcessResult> {
  return new SshChildProcess(request).exited;
}
