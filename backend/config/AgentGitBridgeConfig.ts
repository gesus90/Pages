import type { TomlTable } from "smol-toml";

/**
 * Lets one plan step of one project reach one repository through a host SSH alias.
 *
 * @remarks
 * Nothing has a default: without a complete entry no session gets a bridge.
 */
export interface AgentGitBridgeSetting {
  readonly projectId: string;
  readonly planId: string;
  readonly stepId: string;
  /** Exact `owner/name` of the project's GitHub integration. */
  readonly repository: string;
  /** A `Host` of the server account's SSH configuration; it must resolve to GitHub. */
  readonly sshAlias: string;
  /** Exact branches the step may update; empty allows fetching only. */
  readonly pushRefs: readonly string[];
}

const UUID_PATTERN = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu;
const STEP_PATTERN = /^[a-z\d][a-z\d._-]{0,127}$/iu;
const REPOSITORY_PATTERN = /^[a-z\d-]+\/[a-z\d_][a-z\d_.-]*$/iu;
const ALIAS_PATTERN = /^[a-z\d][a-z\d._-]{0,62}$/iu;
const PUSH_REF_PATTERN = /^refs\/heads\/[a-z\d][a-z\d._/-]*$/iu;

function readText(
  entry: Readonly<Record<string, unknown>>,
  key: string,
  pattern: RegExp,
): string {
  const text = entry[key];
  if (typeof text !== "string" || !pattern.test(text) || text.includes(".."))
    throw new Error(`"agentGitBridges" has an invalid "${key}".`);
  return text;
}

function readPushRefs(input: unknown): readonly string[] {
  if (input === undefined) return [];
  if (
    !Array.isArray(input) ||
    input.some(
      (ref) =>
        typeof ref !== "string" ||
        !PUSH_REF_PATTERN.test(ref) ||
        ref.includes(".."),
    )
  )
    throw new Error('"agentGitBridges" has an invalid "pushRefs".');
  return input.map(String);
}

function readEntry(input: unknown): AgentGitBridgeSetting {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error('"agentGitBridges" must hold tables.');
  const entry = Object.fromEntries(Object.entries(input));
  return {
    projectId: readText(entry, "projectId", UUID_PATTERN),
    planId: readText(entry, "planId", UUID_PATTERN),
    stepId: readText(entry, "stepId", STEP_PATTERN),
    repository: readText(entry, "repository", REPOSITORY_PATTERN),
    sshAlias: readText(entry, "sshAlias", ALIAS_PATTERN),
    pushRefs: readPushRefs(entry.pushRefs),
  };
}

/**
 * Reads the bridges an operator configured by hand.
 *
 * @param table - The configuration document.
 * @returns The validated entries, empty when the key is missing.
 * @throws {Error} When an entry is incomplete, malformed or repeated for one step.
 */
export function readAgentGitBridges(
  table: TomlTable,
): readonly AgentGitBridgeSetting[] {
  const input = table.agentGitBridges;
  if (input === undefined) return [];
  if (!Array.isArray(input))
    throw new Error('"agentGitBridges" must be a list of tables.');
  const bridges = input.map(readEntry);
  const steps = new Set(
    bridges.map(({ projectId, planId, stepId }) =>
      JSON.stringify([projectId, planId, stepId]),
    ),
  );
  if (steps.size !== bridges.length)
    throw new Error('"agentGitBridges" names one step twice.');
  return bridges;
}
