import { EventEmitter } from "node:events";

import {
  logCaughtError,
  logEvent,
  logDiagnostic,
} from "@/backend/logging/Logger";

import type { ChildProcess } from "node:child_process";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  CliGroupSignal,
  CliProcessResult,
  CliRunningProcess,
} from "./CliContracts";

// One event line of a runner may be large (a file it read), never unbounded.
const MAXIMUM_LINE_CHARACTERS = 4 * 1024 * 1024;
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
  readonly signal: AbortSignal;
  /** Receives every complete line of the standard output, in order. */
  readonly onLine: (line: string) => void;
}

/**
 * One long-running CLI session whose events stream line by line.
 *
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
  private readonly deadline: ReturnType<typeof setTimeout> | null;
  private readonly abort: () => void;
  private escalation: ReturnType<typeof setTimeout> | null = null;
  private closing: ReturnType<typeof setTimeout> | null = null;
  private errorCode: AgentErrorCode | null = null;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;
  private pending = "";
  private stderrTail = "";
  private isFinished = false;

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
    this.deadline =
      callbacks.timeoutMs > 0
        ? setTimeout(() => this.cancel("check_timeout"), callbacks.timeoutMs)
        : null;
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
      this.receive(chunk);
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(
        -STDERR_TAIL_CHARACTERS,
      );
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

  /** Ends the input; an interactive session then finishes on its own. */
  public endInput(): void {
    if (this.child.stdin?.writable) this.child.stdin.end();
  }

  /** Terminates the whole process group, with a kill after the grace period. */
  public cancel(code: AgentErrorCode): void {
    if (this.isFinished || this.escalation !== null) return;
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
    this.sendSignal(code === "check_timeout" ? "SIGKILL" : "SIGTERM");
  }

  private receive(chunk: string): void {
    this.pending += chunk;
    let newline = this.pending.indexOf("\n");
    while (newline >= 0) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      this.deliver(line);
      newline = this.pending.indexOf("\n");
    }
    // A runaway line is cut, not buffered without end.
    if (this.pending.length > MAXIMUM_LINE_CHARACTERS) {
      this.deliver(this.pending.slice(0, MAXIMUM_LINE_CHARACTERS));
      this.pending = "";
    }
  }

  private deliver(line: string): void {
    if (!line.trim()) return;
    try {
      this.callbacks.onLine(line);
    } catch (error: unknown) {
      logCaughtError("CliSessionProcess", error);

      logDiagnostic(
        "CliSessionProcess",
        "error",
        "Pages could not read an event of a CLI session.",
        error,
      );
    }
  }

  private sendSignal(signal: NodeJS.Signals): void {
    if (this.child.pid === undefined) return;
    try {
      this.signalGroup(-this.child.pid, signal);
    } catch (caughtError: unknown) {
      logCaughtError("CliSessionProcess", caughtError);

      // The group may already have exited; a direct signal also covers spawn races.
      this.child.kill(signal);
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
    if (this.pending) this.deliver(this.pending);
    this.pending = "";
    if (this.deadline !== null) clearTimeout(this.deadline);
    if (this.escalation !== null) clearTimeout(this.escalation);
    if (this.closing !== null) clearTimeout(this.closing);
    this.callbacks.signal.removeEventListener("abort", this.abort);
    const exit: CliSessionExit = {
      code,
      signal,
      errorCode: this.errorCode,
      stderrTail: this.stderrTail,
    };
    this.completion.emit("exit", exit);
  }
}
