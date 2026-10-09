import type { CliProviderId } from "@/definition/AgentConnection";
import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type {
  CliHome,
  CliLoginChallenge,
  CliProcessResult,
  CliRunningProcess,
} from "./CliContracts";
import type { CliProcessRunner } from "./CliProcessRunner";

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

  /** Catalog commands print large JSON, bounded at 8 MiB and 20 seconds. */
  public readCatalog(
    home: CliHome,
    args: readonly string[],
    signal: AbortSignal,
    input?: string,
  ): Promise<CliProcessResult> {
    return this.runner.run({
      file: this.file,
      provider: this.provider,
      home,
      arguments: args,
      signal,
      timeoutMs: 20_000,
      stdin: input === undefined ? "ignore" : "pipe",
      input,
      maxStdoutBytes: 8 * 1024 * 1024,
    });
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
      stdin: this.provider === "claude_code" ? "pipe" : "ignore",
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
