import type { ChildProcess } from "node:child_process";

/** One CLI tool of the remote inventory with its login state and model catalog. */
export interface CliInventoryEntry {
  tool: string;
  version?: string | null;
  authentication: string;
  models: {
    id: string;
    name: string;
    reasoningEfforts: string[];
  }[];
  catalogRevision?: string;
  acp?: { status: string };
}

/** The job description the runner hands to the CLI; only the fields used here are declared. */
export interface CliCommand {
  workspace: string;
  pagesAccess?: number;
  resultPayloadVersion?: number;
  continuation?: { resumeSessionId?: string } | undefined;
  program: {
    model: string;
    access: string;
    reasoningEffort: string | null;
    route: { tool: string; catalogRevision: string };
  };
}

/** The environment a CLI keeps; no Pages environment or provider key is inherited. */
export function cliEnvironment(): Record<string, string>;

/** Queries status and the CLI picker only; no user prompt or paid model turn is sent. */
export function cliInventory(context?: {
  jobId?: string;
  signal?: AbortSignal;
}): Promise<CliInventoryEntry[]>;

/** Rechecks the exact remote catalog and login before starting the requested tool. */
export function spawnCli(
  command: CliCommand,
  jobId: string,
  signal: AbortSignal,
  folder: string,
): Promise<ChildProcess>;

/** Projects only the final answer of a CLI run. */
export function cliOutput(command: CliCommand, stdout: string): string;

/** The stable cause an OpenCode or Antigravity node names for its failure. */
export function cliFailure(
  command: CliCommand,
  stdout: string,
): string | undefined;
