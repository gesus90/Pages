import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

/** How the unit of a worker ended, as systemd reports it. */
export type CliWorkerUnitResult =
  | "success"
  | "oom-kill"
  | "timeout"
  | "exit-code"
  | "signal"
  | "core-dump"
  | "resources"
  | "unknown";

/** The unit one worker runs in; only this handle stops or signals it. */
export interface CliWorkerUnitHandle {
  readonly name: string;
  /** Sends a signal to every process in the unit's cgroup, never to anything outside it. */
  signal(signal: NodeJS.Signals): void;
  /** Called once output arrived: the unit read its environment file, which is removed now. */
  started(): void;
  /** Stops what is left of the unit, reads its result and removes its traces. */
  settle(): Promise<CliWorkerUnitResult>;
}

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
  /** The tool itself when `file` is a wrapper that starts it; the tool's folder belongs on the PATH. */
  readonly toolFile?: string;
  readonly arguments: readonly string[];
  readonly provider: CliProviderId;
  readonly home: CliHome;
  /** Authorized plan cwd; login and text requests keep the isolated default directory. */
  readonly workingDirectory?: string;
  readonly timeoutMs: number;
  readonly stdin: "pipe" | "ignore";
  /** One prompt or metadata control request sent through stdin and then closed, never through shell arguments. */
  readonly input?: string;
  /** Variables added to the isolated environment, such as a tool's own inline configuration. */
  readonly environment?: Readonly<Record<string, string>>;
  /** Raises the 256 KiB stdout cap for commands that print a whole model catalog. */
  readonly maxStdoutBytes?: number;
  readonly signal?: AbortSignal;
  readonly onOutput?: (stdout: string, stderr: string) => void;
}

/** A streaming session in an authorized working directory. */
export interface CliSessionRequest {
  readonly file: string;
  /** The tool itself when `file` is a wrapper that starts it. */
  readonly toolFile?: string;
  readonly arguments: readonly string[];
  readonly provider: CliProviderId;
  readonly home: CliHome;
  readonly workingDirectory: string;
  /** The isolation mounts the working directory read-only, as for a read-only Codex session. */
  readonly isWorkingDirectoryReadOnly?: boolean;
  /** Only this session's temporary GitHub configuration is mounted, read-only, outside its HOME. */
  readonly credentialDirectory?: string;
  /** Server-approved bundles rebound read-only after the service home is hidden. */
  readonly readOnlyFiles?: readonly string[];
  /** Variables added to the isolated environment; credentials stay out of the arguments. */
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  /** Receives every complete line of the standard output, in order. */
  readonly onLine: (line: string) => void;
  /** The limited unit the session runs in; signals and the closeout go through it. */
  readonly unit?: CliWorkerUnitHandle;
}

export interface CliRunningProcess {
  readonly processId?: number | null;
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

/** Private process input; never included in check details, snapshots or responses. */
export interface CliCredentialAccess {
  readonly modelProvider: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly redact: (text: string) => string;
}

export interface CliStatusOutcome {
  readonly outcome: ProviderCheckOutcome;
  readonly accountLabel: string | null;
  readonly credentials?: CliCredentialAccess;
}

/** What every CLI runner offers Pages; signing in differs per tool. */
export interface CliToolAdapter {
  readonly provider: CliProviderId;
  readStatus(home: CliHome, signal: AbortSignal): Promise<CliStatusOutcome>;
  version(home: CliHome, signal: AbortSignal): Promise<ProviderCheckOutcome>;
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

/** A CLI that signs in through its own interactive account flow. */
export interface CliLoginAdapter extends CliToolAdapter {
  startLogin(
    home: CliHome,
    onChallenge: (challenge: CliLoginChallenge) => void,
  ): CliRunningProcess;
  loginError(result: CliProcessResult): AgentErrorCode;
}
