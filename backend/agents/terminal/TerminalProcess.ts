import { EventEmitter } from "node:events";
import { readdir, readFile } from "node:fs/promises";

import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { createCliEnvironment } from "@/backend/agents/cli/CliEnvironment";

import type { IPty } from "@lydell/node-pty";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  CliSessionRequest,
  CliWorkerUnitHandle,
  CliWorkerUnitResult,
} from "@/backend/agents/cli/CliContracts";
import type { CliSessionExit } from "@/backend/agents/cli/CliSessionProcess";

const TERMINATION_GRACE_MS = 5_000;

/** What the environment of a terminal CLI changes against a CLI that writes into a pipe. */
export const TERMINAL_ENVIRONMENT = {
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  // An empty value means colors are allowed (no-color.org).
  NO_COLOR: "",
} as const;

/** What a terminal process reports and how it is ended. */
export interface TerminalProcessCallbacks {
  readonly columns: number;
  readonly rows: number;
  readonly signal: AbortSignal;
  /** Receives the raw output; the caller redacts it before anything keeps it. */
  readonly onData: (chunk: string) => void;
}

function unitErrorCode(result: CliWorkerUnitResult): AgentErrorCode | null {
  if (result === "oom-kill" || result === "resources")
    return "acp_worker_limit";
  return result === "timeout" ? "check_timeout" : null;
}

/** The processes below `parent`, read from `/proc`; empty where it cannot be read. */
async function descendants(parent: number): Promise<readonly number[]> {
  const children = new Map<number, number[]>();
  const entries = await readdir("/proc").catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => /^\d+$/u.test(entry))
      .map(async (entry) => {
        const stat = await readFile(`/proc/${entry}/stat`, "utf8").catch(
          () => "",
        );
        // The name in parentheses may contain spaces; the parent follows its end.
        const parentId = Number(
          stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1],
        );
        if (!Number.isInteger(parentId)) return;
        children.set(parentId, [
          ...(children.get(parentId) ?? []),
          Number(entry),
        ]);
      }),
  );
  const found: number[] = [];
  const queue = [parent];
  while (queue.length > 0) {
    const next = queue.shift() ?? parent;
    for (const child of children.get(next) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/**
 * The CLI of one plan node in a pseudo terminal.
 *
 * @remarks
 * The process starts from the same isolated request as an ACP worker, with
 * bubblewrap and the limited unit around it; only its standard streams are a
 * terminal. Cancellation reaches the unit and the process group, a kill
 * follows after the grace period. Closing the input hangs the terminal up,
 * which ends a CLI the way closing its window would. When the CLI ends,
 * nothing more is written: there is no shell behind it.
 */
export class TerminalProcess {
  public readonly exited: Promise<CliSessionExit>;
  private readonly terminal: IPty;
  private readonly unit: CliWorkerUnitHandle | undefined;
  private readonly completion = new EventEmitter();
  private readonly abort: () => void;
  private readonly signal: AbortSignal;
  private escalation: ReturnType<typeof setTimeout> | null = null;
  private errorCode: AgentErrorCode | null = null;
  private hasOutput = false;
  private isFinished = false;

  private constructor(
    terminal: IPty,
    request: CliSessionRequest,
    callbacks: TerminalProcessCallbacks,
  ) {
    this.terminal = terminal;
    this.unit = request.unit;
    this.signal = callbacks.signal;
    this.exited = new Promise((resolve) => {
      this.completion.once("exit", resolve);
    });
    this.abort = () =>
      this.cancel(
        callbacks.signal.reason instanceof DOMException &&
          callbacks.signal.reason.name === "TimeoutError"
          ? "check_timeout"
          : "login_cancelled",
      );
    terminal.onData((chunk) => {
      if (!this.hasOutput) {
        this.hasOutput = true;
        // Output proves that the unit started and has read its environment file.
        this.unit?.started();
      }
      callbacks.onData(chunk);
    });
    terminal.onExit(({ exitCode, signal }) => {
      void this.finish(exitCode, signal);
    });
    callbacks.signal.addEventListener("abort", this.abort, { once: true });
    if (callbacks.signal.aborted) this.abort();
  }

  /**
   * Starts the CLI in a pseudo terminal.
   *
   * @param request - The isolated and limited request of the session.
   * @param callbacks - Geometry, stop signal and output receiver.
   * @returns The running process.
   * @throws {AgentError} `cli_not_executable` when it cannot start.
   */
  public static async start(
    request: CliSessionRequest,
    callbacks: TerminalProcessCallbacks,
  ): Promise<TerminalProcess> {
    const { spawn } = await import("@lydell/node-pty");
    // spawn is synchronous: the child inherits 0077 before another JS task can run.
    const previousMask = process.umask(0o077);
    try {
      const terminal = spawn(request.file, [...request.arguments], {
        name: TERMINAL_ENVIRONMENT.TERM,
        cols: callbacks.columns,
        rows: callbacks.rows,
        cwd: request.workingDirectory,
        env: {
          ...createCliEnvironment(
            request.home,
            request.provider,
            request.toolFile ?? request.file,
          ),
          ...request.environment,
        },
      });
      logEvent({
        level: "info",
        event: "cli.terminal.started",
        component: "TerminalProcess",
        message: "CLI terminal process started",
        metadata: { provider: request.provider },
      });
      return new TerminalProcess(terminal, request, callbacks);
    } catch (caughtError: unknown) {
      logCaughtError("TerminalProcess", caughtError);
      throw new AgentError("cli_not_executable");
    } finally {
      process.umask(previousMask);
    }
  }

  /** The process group of the session. */
  public get processId(): number | null {
    return this.terminal.pid > 0 ? this.terminal.pid : null;
  }

  /** Whether the CLI still runs. */
  public get isRunning(): boolean {
    return !this.isFinished;
  }

  /**
   * Writes input to the CLI; nothing is written once it ended.
   *
   * @param keys - Keys, a paste or the answer to a query of the CLI.
   * @returns Whether the CLI still ran.
   */
  public write(keys: string): boolean {
    if (this.isFinished) return false;
    this.terminal.write(keys);
    return true;
  }

  /**
   * Changes the geometry and tells the CLI about it.
   *
   * @remarks
   * A CLI in a limited unit or in its own session is not in the foreground
   * process group of the terminal, so the kernel's resize signal would not
   * reach it; Pages sends it to the unit and the processes below.
   */
  public resize(columns: number, rows: number): void {
    if (this.isFinished) return;
    this.terminal.resize(columns, rows);
    this.unit?.signal("SIGWINCH");
    void this.signalDescendants("SIGWINCH");
  }

  /** Hangs the terminal up; a CLI ends then on its own. */
  public endInput(): void {
    this.sendSignal("SIGHUP");
  }

  /** Terminates the whole process group, with a kill after the grace period. */
  public cancel(code: AgentErrorCode): void {
    if (this.isFinished || this.escalation !== null) return;
    logEvent({
      level: "info",
      event: "cli.terminal.cancel_requested",
      component: "TerminalProcess",
      message: "CLI terminal cancellation requested",
      metadata: { code },
    });
    this.errorCode = code;
    this.escalation = setTimeout(() => {
      this.sendSignal("SIGKILL");
    }, TERMINATION_GRACE_MS);
    this.sendSignal(code === "check_timeout" ? "SIGKILL" : "SIGTERM");
  }

  private async signalDescendants(signal: NodeJS.Signals): Promise<void> {
    const processId = this.processId;
    if (processId === null) return;
    for (const child of await descendants(processId)) {
      try {
        process.kill(child, signal);
      } catch (caughtError: unknown) {
        // A child may have ended between the scan and the signal.
        logCaughtError("TerminalProcess", caughtError);
      }
    }
  }

  private sendSignal(signal: NodeJS.Signals): void {
    this.unit?.signal(signal);
    if (this.isFinished || this.processId === null) return;
    try {
      process.kill(-this.processId, signal);
    } catch (caughtError: unknown) {
      logCaughtError("TerminalProcess", caughtError);
      // The group may already have exited; a direct signal also covers spawn races.
      try {
        this.terminal.kill(signal);
      } catch (killError: unknown) {
        logCaughtError("TerminalProcess", killError);
      }
    }
  }

  private async finish(
    code: number,
    signal: number | undefined,
  ): Promise<void> {
    if (this.isFinished) return;
    this.isFinished = true;
    if (this.escalation !== null) clearTimeout(this.escalation);
    this.signal.removeEventListener("abort", this.abort);
    logEvent({
      level: code === 0 ? "info" : "warn",
      event: "cli.terminal.exited",
      component: "TerminalProcess",
      message: "CLI terminal process exited",
      metadata: { exitCode: code, code: this.errorCode },
    });
    if (this.unit) {
      try {
        // The unit settles even when Pages ended it, so its environment file never stays.
        this.errorCode ??= unitErrorCode(await this.unit.settle());
      } catch (caughtError: unknown) {
        logCaughtError("TerminalProcess", caughtError);
        this.errorCode = "credential_cleanup_failed";
      }
    }
    const exit: CliSessionExit = {
      code,
      signal: signal ? signalName(signal) : null,
      errorCode: this.errorCode,
      stderrTail: "",
    };
    this.completion.emit("exit", exit);
  }
}

function signalName(signal: number): NodeJS.Signals | null {
  const names: Readonly<Record<number, NodeJS.Signals>> = {
    1: "SIGHUP",
    2: "SIGINT",
    9: "SIGKILL",
    15: "SIGTERM",
  };
  return names[signal] ?? null;
}
