import { EventEmitter } from "node:events";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { CliPausableDeadline } from "./CliPausableDeadline";
import { captureOwnedNamespace } from "./CliOwnedNamespace";
import { setNamespacePaused } from "./CliNamespacePause";

import type { ChildProcess } from "node:child_process";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  CliGroupSignal,
  CliProcessResult,
  CliRunningProcess,
  CliWorkerUnitHandle,
  CliWorkerUnitResult,
} from "./CliContracts";

/**
 * The UTF-8 bytes of one line in either direction: 8 MiB = 8 × 1024 × 1024.
 * @remarks
 * One event line of a runner may be large (a file it read), never unbounded.
 * An ACP message Pages sends is one input line as well, so its prompt is
 * measured against the same limit before it is written.
 */
export const CLI_LINE_LIMIT_BYTES = 8 * 1024 * 1024;
const STDERR_TAIL_CHARACTERS = 16 * 1024;
const TERMINATION_GRACE_MS = 5_000;
const STREAM_CLOSE_GRACE_MS = 2_000;

/** How the process of a session ended. */
export interface CliSessionExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Why Pages ended the process, if it did. */
  readonly errorCode: AgentErrorCode | null;
  /** The last part of the error stream, for redacted diagnostics. */
  readonly stderrTail: string;
}

/** What a session process needs beyond its spawned child. */
export interface CliSessionCallbacks {
  readonly timeoutMs: number;
  /** Codex Stop terminates its process frame on the first signal. */
  readonly provider?: CliProviderId;
  readonly signal: AbortSignal;
  /** Receives every complete line of the standard output, in order. */
  readonly onLine: (line: string) => void | Promise<void>;
  readonly onStderr?: (tail: string) => void;
  /** The limited unit of the session; its processes are signalled through it. */
  readonly unit?: CliWorkerUnitHandle;
}

/** What the end of a unit means for the session, beyond what Pages itself decided. */
function unitErrorCode(result: CliWorkerUnitResult): AgentErrorCode | null {
  if (result === "oom-kill" || result === "resources")
    return "acp_worker_limit";
  return result === "timeout" ? "check_timeout" : null;
}

/**
 * One long-running CLI session whose events stream line by line.
 * @remarks
 * Unlike a check, a session keeps no complete copy of its output: each line
 * goes to the caller as it arrives, so a long coding session never hits an
 * output cap. Standard input stays open until Pages ends it, which lets an
 * interactive session outlive its turn. Cancellation reaches the whole
 * process group, and a kill follows when the group does not end in time.
 */
export class CliSessionProcess implements CliRunningProcess {
  public readonly completed: Promise<CliProcessResult>;
  public readonly exited: Promise<CliSessionExit>;
  private readonly child: ChildProcess;
  private readonly callbacks: CliSessionCallbacks;
  private readonly signalGroup: CliGroupSignal;
  private readonly completion = new EventEmitter();
  private readonly deadline: CliPausableDeadline;
  private isPaused = false;
  private readonly pauseChanges = new SerialQueue();
  private readonly abort: () => void;
  private escalation: ReturnType<typeof setTimeout> | null = null;
  private closing: ReturnType<typeof setTimeout> | null = null;
  private errorCode: AgentErrorCode | null = null;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;
  private pending = "";
  private reading: Promise<void> = Promise.resolve();
  private stderrTail = "";
  private isFinished = false;
  private isOverflowed = false;
  private isSuspended = false;

  public constructor(
    child: ChildProcess,
    callbacks: CliSessionCallbacks,
    signalGroup: CliGroupSignal,
  ) {
    this.child = child;
    logEvent({
      level: "info",
      event: "cli.process.started",
      component: "CliSessionProcess",
      message: "CLI session process started",
    });
    this.callbacks = callbacks;
    this.signalGroup = signalGroup;
    this.abort = () =>
      this.cancel(
        callbacks.signal.reason instanceof DOMException &&
          callbacks.signal.reason.name === "TimeoutError"
          ? "check_timeout"
          : "login_cancelled",
      );
    this.exited = new Promise((resolve) => {
      this.completion.once("exit", resolve);
    });
    this.completed = this.exited.then((exit) => ({
      exitCode: exit.code,
      stdout: "",
      stderr: exit.stderrTail,
      errorCode: exit.errorCode,
    }));
    this.deadline = new CliPausableDeadline(callbacks.timeoutMs, () =>
      this.cancel("check_timeout"),
    );
    child.once("error", (error: Error) => {
      logEvent({
        level: "error",
        event: "cli.process.failed",
        component: "CliSessionProcess",
        message: "CLI session process failed",
        error,
      });
      this.errorCode = this.errorCode ?? "cli_not_executable";
      this.finish(null, null);
    });
    // A descendant that inherited the output can keep it open after the
    // runner exited, so the exit itself ends the session after a short wait.
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      this.exitCode = code;
      this.exitSignal = signal;
      this.closing = setTimeout(
        () => this.finish(code, signal),
        STREAM_CLOSE_GRACE_MS,
      );
    });
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) =>
      this.finish(code ?? this.exitCode, signal ?? this.exitSignal),
    );
    child.stdin?.on("error", () => {
      // A runner that exits closes its input; the exit itself reports the outcome.
    });
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      this.consume(chunk);
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(
        -STDERR_TAIL_CHARACTERS,
      );
      callbacks.onStderr?.(this.stderrTail);
    });
    callbacks.signal.addEventListener("abort", this.abort, { once: true });
    if (callbacks.signal.aborted) this.abort();
  }

  /** The process group of the session; `null` when the spawn failed. */
  public get processId(): number | null {
    return this.child.pid ?? null;
  }

  /** Writes one line to an open session input; values are never retained. */
  public write(line: string): boolean {
    if (this.isFinished || !this.child.stdin?.writable) return false;
    this.child.stdin.write(`${line}\n`);
    return true;
  }

  /** Waits for the native input write callback, so the ACP writer cannot queue an unbounded pipe backlog. */
  public async writeAsync(line: string): Promise<boolean> {
    if (this.isFinished || !this.child.stdin?.writable) return false;
    const bytes = Buffer.byteLength(line);
    if (bytes > CLI_LINE_LIMIT_BYTES) {
      // The prompt is measured before it is sent; this only guards the pipe.
      logEvent({
        level: "warn",
        event: "cli.process.input_overflow",
        component: "CliSessionProcess",
        message: "CLI session input line exceeded its limit",
        metadata: {
          code: "acp_input_too_large",
          bytes,
          count: CLI_LINE_LIMIT_BYTES,
        },
      });
      this.cancel("acp_input_too_large");
      return false;
    }
    return new Promise((resolve) => {
      this.child.stdin?.write(`${line}\n`, (error: Error | null | undefined) =>
        resolve(!error),
      );
    });
  }

  /** Ends the input; an interactive session then finishes on its own. */
  public endInput(): void {
    if (this.child.stdin?.writable) this.child.stdin.end();
  }

  /** Freezes native work and its deadline while keeping the ACP pipes open. */
  public setPaused(isPaused: boolean): Promise<void> {
    return this.pauseChanges.run(() => this.changePause(isPaused));
  }

  /** Stops the process group and pauses its deadline. */
  public suspend(): boolean {
    if (this.isFinished || this.isSuspended || !this.child.pid) return false;
    if (!this.sendSignal("SIGSTOP")) return false;
    this.deadline.pause();
    this.isSuspended = true;
    return true;
  }

  /** Continues the process group and its deadline. */
  public resume(): boolean {
    if (this.isFinished || !this.isSuspended) return false;
    if (!this.sendSignal("SIGCONT")) return false;
    this.isSuspended = false;
    this.deadline.resume();
    return true;
  }

  /** Terminates the whole process group, with a kill after the grace period. */
  public cancel(code: AgentErrorCode): void {
    if (this.isFinished || this.escalation !== null) return;
    if (this.isSuspended) this.resume();
    this.deadline.close();
    logEvent({
      level: "info",
      event: "cli.process.cancel_requested",
      component: "CliSessionProcess",
      message: "CLI session cancellation requested",
      metadata: { code },
    });
    this.errorCode = code;
    this.escalation = setTimeout(() => {
      this.sendSignal("SIGKILL");
    }, TERMINATION_GRACE_MS);
    this.sendSignal(
      code === "check_timeout" ||
        this.isPaused ||
        this.callbacks.provider === "codex_cli"
        ? "SIGKILL"
        : "SIGTERM",
    );
  }

  private async changePause(isPaused: boolean): Promise<void> {
    if (
      this.isFinished ||
      this.escalation !== null ||
      this.isPaused === isPaused
    )
      return;
    if (!this.child.pid) throw new Error("Session process unavailable");
    const owner = await captureOwnedNamespace(this.child.pid);
    if (isPaused) this.deadline.pause();
    try {
      await setNamespacePaused(
        {
          ...owner,
          ...(this.callbacks.unit ? { unit: this.callbacks.unit.name } : {}),
        },
        isPaused,
      );
    } catch (error: unknown) {
      if (isPaused) this.deadline.resume();
      throw error;
    }
    this.isPaused = isPaused;
    if (!isPaused) this.deadline.resume();
  }

  private consume(chunk: string): void {
    this.child.stdout?.pause();
    this.reading = this.receive(chunk)
      .catch((error: unknown) => {
        logCaughtError("CliSessionProcess", error);
        this.cancel("plan_history_unavailable");
      })
      .finally(() => {
        if (!this.isFinished) this.child.stdout?.resume();
      });
  }

  private async receive(chunk: string): Promise<void> {
    // Output proves that the unit started and has read its environment file.
    this.callbacks.unit?.started();
    if (this.isOverflowed) return;
    this.pending += chunk;
    let newline = this.pending.indexOf("\n");
    while (newline >= 0) {
      if (
        Buffer.byteLength(this.pending.slice(0, newline)) > CLI_LINE_LIMIT_BYTES
      ) {
        this.overflow();
        return;
      }
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      await this.deliver(line);
      newline = this.pending.indexOf("\n");
    }
    if (Buffer.byteLength(this.pending) > CLI_LINE_LIMIT_BYTES) this.overflow();
  }

  /** A runaway line ends the session; neither it nor anything after it reaches the caller. */
  private overflow(): void {
    this.isOverflowed = true;
    this.pending = "";
    logEvent({
      level: "warn",
      event: "cli.process.output_overflow",
      component: "CliSessionProcess",
      message: "CLI session output line exceeded its limit",
      metadata: { code: "acp_output_overflow", count: CLI_LINE_LIMIT_BYTES },
    });
    this.cancel("acp_output_overflow");
  }

  private async deliver(line: string): Promise<void> {
    if (!line.trim()) return;
    await this.callbacks.onLine(line);
  }

  private sendSignal(signal: NodeJS.Signals): boolean {
    this.callbacks.unit?.signal(signal);
    if (this.child.exitCode !== null || this.child.signalCode !== null)
      return false;
    if (this.child.pid === undefined) return false;
    try {
      this.signalGroup(-this.child.pid, signal);
      return true;
    } catch (caughtError: unknown) {
      logCaughtError("CliSessionProcess", caughtError);

      // The group may already have exited; a direct signal also covers spawn races.
      return this.child.kill(signal);
    }
  }

  private finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.isFinished) return;
    this.isFinished = true;
    logEvent({
      level: code === 0 ? "info" : "warn",
      event: "cli.process.exited",
      component: "CliSessionProcess",
      message: "CLI session process exited",
      metadata: { exitCode: code, signal, code: this.errorCode },
    });
    this.deadline.close();
    if (this.escalation !== null) clearTimeout(this.escalation);
    if (this.closing !== null) clearTimeout(this.closing);
    this.callbacks.signal.removeEventListener("abort", this.abort);
    void this.finishOutput(code, signal);
  }

  private async finishOutput(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    await this.reading;
    try {
      if (this.pending) await this.deliver(this.pending);
    } catch (error: unknown) {
      logCaughtError("CliSessionProcess", error);
      this.errorCode ??= "plan_history_unavailable";
    }
    this.pending = "";
    const { unit } = this.callbacks;
    if (unit) await this.settleUnit(unit, { code, signal });
    else this.emitExit(code, signal);
  }

  /** The session ends only after its unit stopped, so nothing of it outlives the exit. */
  private async settleUnit(
    unit: CliWorkerUnitHandle,
    ended: {
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    },
  ): Promise<void> {
    try {
      // The unit settles even when Pages ended it, so its environment file never stays.
      const result = await unit.settle();
      this.errorCode = this.errorCode ?? unitErrorCode(result);
    } catch (caughtError: unknown) {
      logCaughtError("CliSessionProcess", caughtError);
      this.errorCode = "credential_cleanup_failed";
    }
    this.emitExit(ended.code, ended.signal);
  }

  private emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    const exit: CliSessionExit = {
      code,
      signal,
      errorCode: this.errorCode,
      stderrTail: this.stderrTail,
    };
    this.completion.emit("exit", exit);
  }
}
