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

/** Model-free functional result; upstream text is deliberately excluded. */
export interface AgentToolHealth {
  readonly status: AgentToolStatus;
  readonly diagnostic: AgentToolDiagnostic;
  readonly version: string | null;
  /** Actual browser version, separate from the approved Playwright package revision. */
  readonly runtimeVersion?: string;
}

/** Persistence boundary kept separate from credentials and the DuckDB connection store. */
export interface AgentToolStorage {
  readonly root: string;
  home(): Promise<CliHome>;
  current(tool: AgentToolDefinition): Promise<AgentToolLocation | null>;
  candidate(tool: AgentToolDefinition): Promise<AgentToolLocation>;
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
    signal: AbortSignal,
  ): Promise<void>;
}

/** Checks can be replaced with synthetic implementations in unit tests. */
export interface AgentToolHealthChecks {
  check(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
    signal: AbortSignal,
  ): Promise<AgentToolHealth>;
}
