import { PLAN_SCRIPT_BYTES } from "@/definition/AgentPlanScript";

import { sanitizeArtifactText } from "./AgentPlanOutput";

import type { ChildProcess } from "node:child_process";
import type {
  AgentPlanScriptFailure,
  AgentPlanScriptRun,
} from "@/definition/AgentPlanScript";

/** Bounded byte capture, with strict decoding only after the stream has finished. */
class ScriptStream {
  private readonly maximum: number;
  private readonly chunks: Buffer[] = [];
  private length = 0;

  public constructor(maximum: number) {
    this.maximum = maximum;
  }

  /** Refuses excess bytes instead of silently returning a truncated data value. */
  public receive(chunk: Buffer): boolean {
    this.length += chunk.length;
    if (this.length > this.maximum) return false;
    this.chunks.push(chunk);
    return true;
  }

  /** Decodes a complete UTF-8 stream, rejecting malformed sequences. */
  public text(): string {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Buffer.concat(this.chunks),
    );
  }
}

interface ScriptCapturedText {
  readonly stdout: string | null;
  readonly stderr: string;
  readonly failure: AgentPlanScriptFailure | null;
}

function capturedText(
  stdout: ScriptStream,
  stderr: ScriptStream,
): ScriptCapturedText {
  const output = decodedStream(stdout);
  const diagnostic = decodedStream(stderr);
  const failure = output === null || diagnostic === null ? "encoding" : null;
  const safeDiagnostic = sanitizeArtifactText(diagnostic ?? "").replace(
    /[\x00-\x08\x0b-\x1f\x7f]/gu,
    " ",
  );
  if (output !== null && sanitizeArtifactText(output) !== output)
    return { stdout: null, stderr: safeDiagnostic, failure: "credentials" };
  return { stdout: output, stderr: safeDiagnostic, failure };
}

function decodedStream(stream: ScriptStream): string | null {
  try {
    return stream.text();
  } catch {
    return null;
  }
}

/** Collects only this attempt's bounded streams and actual exit events. */
export class AgentPlanScriptCapture {
  private readonly stdout = new ScriptStream(PLAN_SCRIPT_BYTES.stdout);
  private readonly stderr = new ScriptStream(PLAN_SCRIPT_BYTES.stderr);
  private failure: AgentPlanScriptFailure | null = null;
  private exitCode: number | null = null;
  private signal: string | null = null;
  private hasExited = false;
  private readonly completion = { resolve: (): void => undefined };
  private readonly ended: Promise<void>;
  private readonly closed: Promise<void>;

  public constructor(child: ChildProcess) {
    this.ended = new Promise((resolve) => {
      this.completion.resolve = resolve;
    });
    child.once("error", () => {
      this.hasExited = true;
      this.interrupt("spawn");
    });
    child.once("exit", (code, signal) => {
      this.hasExited = true;
      this.exitCode = code;
      this.signal = signal;
      this.completion.resolve();
    });
    this.closed = new Promise((resolve) =>
      child.once("close", () => resolve()),
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      if (!this.stdout.receive(chunk)) this.interrupt("output_limit");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (!this.stderr.receive(chunk)) this.interrupt("output_limit");
    });
    child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
      // An input-free script can close stdin without reading the empty object.
      if (error.code !== "EPIPE") this.interrupt("io");
    });
    child.stdout?.on("error", () => this.interrupt("io"));
    child.stderr?.on("error", () => this.interrupt("io"));
  }

  /** Records the first external cause and begins cleanup without waiting for inherited pipes. */
  public interrupt(reason: AgentPlanScriptFailure): void {
    this.failure ??= reason;
    this.completion.resolve();
  }

  /** Waits for an exit or an explicit interruption. */
  public async wait(): Promise<void> {
    await this.ended;
  }

  /** Confirms root exit and transport closure with a finite deadline. */
  public async confirmClosed(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const isClosed = await Promise.race([
        this.closed.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 3500);
        }),
      ]);
      return isClosed && this.hasExited;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Returns the exact safe text and exit evidence; unconfirmed cleanup can never succeed. */
  public result(
    record: AgentPlanScriptRun,
    isConfirmed: boolean,
  ): AgentPlanScriptRun {
    const text = capturedText(this.stdout, this.stderr);
    const failure = this.failure ?? text.failure ?? this.exitFailure();
    return {
      ...record,
      ...text,
      exitCode: this.exitCode,
      signal: this.signal,
      failure: failure ?? (isConfirmed ? null : "cleanup"),
      closeout: isConfirmed ? "confirmed" : "failed",
      endedAt: new Date().toISOString(),
    };
  }

  private exitFailure(): AgentPlanScriptFailure | null {
    if (this.signal) return "signal";
    return this.exitCode === 0 ? null : "exit";
  }
}
