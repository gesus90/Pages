import { antigravityAcpArguments } from "@/backend/agents/acp/AntigravityAcpLaunch";

import type { CliProviderId } from "@/definition/AgentConnection";
import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type {
  CliHome,
  CliLoginChallenge,
  CliProcessResult,
  CliRunningProcess,
} from "./CliContracts";
import type { CliProcessRunner } from "./CliProcessRunner";
import type { CliSessionProcess } from "./CliSessionProcess";

/** Output bound of a control exchange, in characters. */
const EXCHANGE_OUTPUT_LIMIT = 8 * 1024 * 1024;

interface LoginOptions {
  readonly arguments: readonly string[];
  readonly parse: (output: string) => CliLoginChallenge | null;
  readonly onChallenge: (challenge: CliLoginChallenge) => void;
}

/** Shared process mechanics; provider-specific commands and parsing stay in their adapters. */
export class CliToolExecution {
  private readonly runner: CliProcessRunner;
  private readonly file: string;
  private readonly provider: CliProviderId;

  public constructor(
    runner: CliProcessRunner,
    file: string,
    provider: CliProviderId,
  ) {
    this.runner = runner;
    this.file = file;
    this.provider = provider;
  }

  /** Opens a bounded metadata/login `agy acp` process in the connection's own context. */
  public openProtocol(
    home: CliHome,
    options: {
      readonly signal: AbortSignal;
      readonly instanceId: string;
      readonly onLine: (line: string) => void | Promise<void>;
      readonly onStderr?: (tail: string) => void;
    },
  ): CliSessionProcess {
    const isolated = this.provider === "antigravity";
    return this.runner.startSession({
      file: isolated ? "/usr/bin/bwrap" : this.file,
      ...(isolated ? { toolFile: this.file } : {}),
      arguments: isolated
        ? [
            "--die-with-parent",
            "--unshare-pid",
            "--ro-bind",
            "/",
            "/",
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--bind",
            home.root,
            home.root,
            "--bind",
            home.work,
            home.work,
            "--chdir",
            home.work,
            "--",
            this.file,
            ...antigravityAcpArguments(home),
          ]
        : antigravityAcpArguments(home),
      provider: this.provider,
      home,
      workingDirectory: home.work,
      signal: options.signal,
      environment: { PAGES_RUN_INSTANCE: options.instanceId },
      timeoutMs: 600_000,
      onLine: options.onLine,
      onStderr: options.onStderr,
    });
  }

  /** Runs with ignored stdin and a stage timeout inside the caller's overall deadline. */
  public run(
    home: CliHome,
    args: readonly string[],
    signal: AbortSignal,
    timeoutMs = 15_000,
  ): Promise<CliProcessResult> {
    return this.runner.run({
      file: this.file,
      provider: this.provider,
      home,
      arguments: args,
      signal,
      timeoutMs,
      stdin: "ignore",
    });
  }

  /** Sends one prompt through stdin, never through the argument list. */
  public prompt(
    home: CliHome,
    request: {
      readonly arguments: readonly string[];
      readonly input: string;
      readonly environment?: Readonly<Record<string, string>>;
    },
    signal: AbortSignal,
    timeoutMs = 45_000,
  ): Promise<CliProcessResult> {
    return this.runner.run({
      file: this.file,
      provider: this.provider,
      home,
      arguments: request.arguments,
      signal,
      timeoutMs,
      stdin: "pipe",
      input: request.input,
      environment: request.environment,
    });
  }

  /** Catalog commands print large JSON, bounded at 8 MiB and 20 seconds. */
  public readCatalog(
    home: CliHome,
    args: readonly string[],
    signal: AbortSignal,
    input?:
      | string
      | {
          readonly input?: string;
          readonly environment: Readonly<Record<string, string>>;
        },
  ): Promise<CliProcessResult> {
    const request = typeof input === "object" ? input : { input };
    return this.runner.run({
      file: this.file,
      provider: this.provider,
      home,
      arguments: args,
      signal,
      timeoutMs: 20_000,
      stdin: request.input === undefined ? "ignore" : "pipe",
      ...request,
      maxStdoutBytes: 8 * 1024 * 1024,
    });
  }

  /**
   * Sends control requests on an input that stays open until the answer arrived.
   * @param home - The connection's CLI home.
   * @param exchange - Arguments, request lines, extra environment and the test
   * that recognizes the answer line.
   * @param signal - Deadline of the exchange.
   * @returns The result with the collected output, bounded at 8 MiB.
   * @remarks
   * A CLI that reads its input to the end shuts down there and drops a
   * request it is still working on, so the input ends only after the answer.
   * A missing answer ends with the 20-second timeout.
   */
  public async exchange(
    home: CliHome,
    exchange: {
      readonly arguments: readonly string[];
      readonly requests: readonly string[];
      readonly environment: Readonly<Record<string, string>>;
      readonly isAnswer: (line: string) => boolean;
    },
    signal: AbortSignal,
  ): Promise<CliProcessResult> {
    const lines: string[] = [];
    let size = 0;
    const session = this.runner.startSession({
      file: this.file,
      provider: this.provider,
      home,
      arguments: exchange.arguments,
      workingDirectory: home.work,
      environment: exchange.environment,
      timeoutMs: 20_000,
      signal,
      onLine: (line) => {
        size += line.length;
        if (size > EXCHANGE_OUTPUT_LIMIT) {
          session.cancel("cli_unexpected_output");
          return;
        }
        lines.push(line);
        if (exchange.isAnswer(line)) session.endInput();
      },
    });
    for (const request of exchange.requests) session.write(request);
    const result = await session.completed;
    return { ...result, stdout: lines.join("\n") };
  }

  /** Reads version only when an administrator explicitly starts a check or login. */
  public async version(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    const result = await this.run(home, ["--version"], signal, 10_000);
    if (result.errorCode)
      return { ok: false, errorCode: result.errorCode, detail: {} };
    const match = result.stdout.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b/);
    if (result.exitCode !== 0 || !match)
      return { ok: false, errorCode: "cli_unexpected_output", detail: {} };
    return { ok: true, detail: { cliVersion: match[1] } };
  }

  /** Requires a supported challenge within 20 seconds and caps total login duration. */
  public startLogin(home: CliHome, options: LoginOptions): CliRunningProcess {
    let hasChallenge = false;
    const running = this.runner.start({
      file: this.file,
      provider: this.provider,
      home,
      arguments: options.arguments,
      timeoutMs: this.provider === "codex_cli" ? 930_000 : 600_000,
      stdin:
        this.provider === "claude_code" || this.provider === "antigravity"
          ? "pipe"
          : "ignore",
      onOutput: (stdout, stderr) => {
        if (hasChallenge) return;
        const challenge = options.parse(`${stdout}\n${stderr}`);
        if (challenge) {
          hasChallenge = true;
          options.onChallenge(challenge);
        }
      },
    });
    const handshake = setTimeout(() => {
      if (!hasChallenge) running.cancel("cli_unexpected_output");
    }, 20_000);
    void running.completed.then(() => {
      clearTimeout(handshake);
    });
    return running;
  }
}
