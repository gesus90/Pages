import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

/** All paths are owned by a single Pages connection, never a user's private CLI home. */
export interface CliHome {
  readonly root: string;
  readonly home: string;
  readonly config: string;
  readonly work: string;
}

export interface CliProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorCode: AgentErrorCode | null;
}

export interface CliRunRequest {
  readonly file: string;
  readonly arguments: readonly string[];
  readonly provider: CliProviderId;
  readonly home: CliHome;
  readonly timeoutMs: number;
  readonly stdin: "pipe" | "ignore";
  /** Raises the 256 KiB stdout cap for commands that print a whole model catalog. */
  readonly maxStdoutBytes?: number;
  readonly signal?: AbortSignal;
  readonly onOutput?: (stdout: string, stderr: string) => void;
}

export interface CliRunningProcess {
  readonly completed: Promise<CliProcessResult>;
  cancel(code: AgentErrorCode): void;
  write(code: string): boolean;
}

export type CliSpawn = (
  file: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;
export type CliGroupSignal = (pid: number, signal: NodeJS.Signals) => void;

export interface CliLoginChallenge {
  readonly verificationUrl: string;
  readonly userCode?: string;
}

/** Model and effort a CLI test passes on; null keeps the CLI default. */
export interface CliModelSelection {
  readonly model: string | null;
  readonly reasoningEffort: string | null;
}

export interface CliStatusOutcome {
  readonly outcome: ProviderCheckOutcome;
  readonly accountLabel: string | null;
}

export interface CliToolAdapter {
  readonly provider: CliProviderId;
  readStatus(home: CliHome, signal: AbortSignal): Promise<CliStatusOutcome>;
  version(home: CliHome, signal: AbortSignal): Promise<ProviderCheckOutcome>;
  startLogin(
    home: CliHome,
    onChallenge: (challenge: CliLoginChallenge) => void,
  ): CliRunningProcess;
  loginError(result: CliProcessResult): AgentErrorCode;
  runTest(
    home: CliHome,
    selection: CliModelSelection,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome>;
  listModels(
    home: CliHome,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]>;
  logout(home: CliHome, signal: AbortSignal): Promise<ProviderCheckOutcome>;
}
