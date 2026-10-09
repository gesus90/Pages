import { EventEmitter } from "node:events";

import type { ChildProcess } from "node:child_process";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  CliGroupSignal,
  CliProcessResult,
  CliRunningProcess,
  CliRunRequest,
} from "./CliContracts";

const OUTPUT_LIMITS = { stdout: 256 * 1024, stderr: 64 * 1024 } as const;

/** Owns one bounded child and ensures cancellation reaches its entire process group. */
export class CliChildProcess implements CliRunningProcess {
  public readonly completed: Promise<CliProcessResult>;
  private readonly child: ChildProcess;
  private readonly request: CliRunRequest;
  private readonly signalGroup: CliGroupSignal;
  private readonly output = { stdout: "", stderr: "" };
  private readonly bytes = { stdout: 0, stderr: 0 };
  private readonly deadline: ReturnType<typeof setTimeout>;
  private escalation: ReturnType<typeof setTimeout> | null = null;
  private errorCode: AgentErrorCode | null = null;
  private exitCode: number | null = null;
  private isFinished = false;
  private readonly completion = new EventEmitter();
  private readonly abort: () => void;

  public constructor(
    child: ChildProcess,
    request: CliRunRequest,
    signalGroup: CliGroupSignal,
  ) {
    this.child = child;
    this.request = request;
    this.signalGroup = signalGroup;
    this.abort = () => this.cancel("check_timeout");
    this.completed = new Promise((resolve) => {
      this.completion.once("complete", resolve);
    });
    this.deadline = setTimeout(this.abort, request.timeoutMs);
    child.once("error", () => {
      this.errorCode = this.errorCode ?? "cli_not_executable";
      if (this.escalation === null) this.finish();
    });
    child.once("close", (code: number | null) => {
      this.exitCode = code;
      if (this.escalation === null) this.finish();
    });
    child.stdin?.on("error", () => this.cancel("login_code_rejected"));
    child.stdout
      ?.setEncoding("utf8")
      .on("data", (chunk: string) => this.receive("stdout", chunk));
    child.stderr
      ?.setEncoding("utf8")
      .on("data", (chunk: string) => this.receive("stderr", chunk));
    request.signal?.addEventListener("abort", this.abort, { once: true });
    if (request.signal?.aborted) this.abort();
    if (request.input !== undefined) child.stdin?.end(request.input);
  }

  /** SIGKILL still follows SIGTERM if the wrapper exits before its descendants. */
  public cancel(code: AgentErrorCode): void {
    if (this.isFinished || this.escalation !== null) return;
    this.errorCode = code;
    this.escalation = setTimeout(() => {
      this.sendSignal("SIGKILL");
      this.finish();
    }, 3_000);
    this.sendSignal("SIGTERM");
  }

  /** Writes only to a live login pipe; values are never retained by this runner. */
  public write(code: string): boolean {
    if (
      this.isFinished ||
      this.escalation !== null ||
      !this.child.stdin?.writable
    )
      return false;
    try {
      this.child.stdin.write(`${code}\n`);
      return true;
    } catch {
      this.cancel("login_code_rejected");
      return false;
    }
  }

  private receive(stream: "stdout" | "stderr", chunk: string): void {
    if (this.isFinished || this.escalation !== null) return;
    this.bytes[stream] += Buffer.byteLength(chunk);
    const limit =
      stream === "stdout"
        ? (this.request.maxStdoutBytes ?? OUTPUT_LIMITS.stdout)
        : OUTPUT_LIMITS.stderr;
    if (this.bytes[stream] > limit) {
      this.cancel("cli_unexpected_output");
      return;
    }
    this.output[stream] += chunk;
    try {
      this.request.onOutput?.(this.output.stdout, this.output.stderr);
    } catch {
      this.cancel("cli_unexpected_output");
    }
  }

  private sendSignal(signal: NodeJS.Signals): void {
    if (this.child.pid === undefined) return;
    try {
      this.signalGroup(-this.child.pid, signal);
    } catch {
      // The group may already have exited; a direct signal also covers spawn races.
      this.child.kill(signal);
    }
  }

  private finish(): void {
    if (this.isFinished) return;
    this.isFinished = true;
    clearTimeout(this.deadline);
    if (this.escalation !== null) clearTimeout(this.escalation);
    this.request.signal?.removeEventListener("abort", this.abort);
    const result: CliProcessResult = {
      exitCode: this.exitCode,
      stdout: this.output.stdout,
      stderr: this.output.stderr,
      errorCode: this.errorCode,
    };
    this.completion.emit("complete", result);
  }
}
