import type { CliHome } from "@/backend/agents/cli/CliContracts";
import type {
  AgentToolDiagnostic,
  AgentToolId,
  AgentToolStatus,
  AgentToolTerminalEntry,
} from "@/definition/AgentTools";
import type { AgentToolDefinition } from "./AgentToolRegistry";

/** A versioned immutable location, retained while an older process uses it. */
export interface AgentToolLocation {
  readonly file: string;
  readonly source: "managed" | "system" | "bundled";
  readonly release: string | null;
  readonly version: string | null;
  /** Last reviewed target applied, including an explicit rollback within that target. */
  readonly approvedTarget?: string | null;
  /** Retained generation that an explicit rollback checks and activates. */
  readonly previousRelease?: string | null;
  /** Stable terminal link of a tool with a terminal entry, and whether it resolves to this generation. */
  readonly terminalEntry?: AgentToolTerminalEntry;
}

/** One exactly resolved provider release with the integrity proof its source publishes. */
export interface AgentToolRelease {
  readonly version: string;
  /** npm `dist.integrity` (sha512) or the archive's `sha256:` digest. */
  readonly integrity: string | null;
  /** The official archive of a binary distribution; `null` for npm packages. */
  readonly archiveUrl: string | null;
  /** Declared runtime dependencies, used to match an adapter with its CLI. */
  readonly dependencies: Readonly<Record<string, string>>;
  /** For an adapter: the CLI version of the combination it is installed for. */
  readonly cliVersion?: string;
}

/** Model-free functional result; upstream text is deliberately excluded. */
export interface AgentToolHealth {
  readonly status: AgentToolStatus;
  readonly diagnostic: AgentToolDiagnostic;
  readonly version: string | null;
  /** Actual browser version, separate from the approved Playwright package revision. */
  readonly runtimeVersion?: string;
}

/** Cancellation and disposable scratch directory shared by the steps of one run. */
export interface AgentToolRunContext {
  readonly signal: AbortSignal;
  readonly temporaryDirectory: string;
}

/** Persistence boundary kept separate from credentials and the connection store. */
export interface AgentToolStorage {
  readonly root: string;
  initialize?(): Promise<void>;
  home(): Promise<CliHome>;
  current(tool: AgentToolDefinition): Promise<AgentToolLocation | null>;
  /** Creates an unpublished generation for exactly this version. */
  candidate(
    tool: AgentToolDefinition,
    version: string | null,
  ): Promise<AgentToolLocation>;
  activate(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
  ): Promise<void>;
  previous(tool: AgentToolDefinition): Promise<AgentToolLocation | null>;
  discard(location: AgentToolLocation): Promise<void>;
  remove(tool: AgentToolDefinition): Promise<void>;
  prune?(tool: AgentToolDefinition): Promise<void>;
  readEnabled(): Promise<readonly AgentToolId[]>;
  writeEnabled(ids: readonly AgentToolId[]): Promise<void>;
}

/** Installers receive only reviewed registry definitions and generated private paths. */
export interface AgentToolInstallation {
  install(
    tool: AgentToolDefinition,
    candidate: AgentToolLocation,
    target: AgentToolRelease | null,
    signal: AbortSignal,
  ): Promise<void>;
}

/**
 * Checks can be replaced with synthetic implementations in unit tests.
 * @remarks
 * `cli` names the CLI generation an adapter is checked with, so an adapter
 * candidate is verified together with the CLI candidate it will run with.
 */
export interface AgentToolHealthChecks {
  check(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
    signal: AbortSignal,
    cli?: AgentToolLocation,
  ): Promise<AgentToolHealth>;
}
