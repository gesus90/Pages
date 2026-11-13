import { isPlanSwarmPathWithin } from "@/definition/AgentPlanSwarmScope";

/** One changed path of `git status --porcelain=v2 -z`, before its content is read. */
export interface SwarmStatusEntry {
  readonly path: string;
  /** The status line without its path: kind, XY, modes and object names. */
  readonly signature: string;
  /** The former path of a rename or copy. */
  readonly origin?: string;
}

/**
 * What the working directory looks like at one moment.
 *
 * @remarks
 * `entries` maps every path that differs from `HEAD`, untracked files
 * included, to a signature of its status and content, so a file changed
 * again while it already differed is still noticed.
 */
export interface SwarmWorkspaceState {
  readonly head: string;
  readonly index: string;
  readonly entries: ReadonlyMap<string, string>;
}

/** What may change in a period: the areas and the locks of the helpers active in it. */
export interface SwarmAllowance {
  readonly workerId: string;
  readonly scope: readonly string[];
  readonly locks: readonly string[];
}

/** A change no active helper was allowed to make. */
export interface SwarmFinding {
  readonly kind: "outside" | "head" | "index";
  readonly files: readonly string[];
}

function fieldCount(kind: string): number {
  if (kind === "1") return 8;
  if (kind === "2") return 9;
  if (kind === "u") return 10;
  return 1;
}

/**
 * Reads the output of `git status --porcelain=v2 -z --untracked-files=all`.
 *
 * @param output - The raw output, records separated by NUL.
 * @returns Every changed, new, deleted or renamed path; a rename also names
 * its former path. Header and ignored records are skipped.
 */
export function readSwarmStatus(output: string): readonly SwarmStatusEntry[] {
  const records = output.split("\0");
  const entries: SwarmStatusEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const kind = record.charAt(0);
    if (!["1", "2", "u", "?"].includes(kind)) continue;
    const fields = record.split(" ");
    const count = fieldCount(kind);
    const path = fields.slice(count).join(" ");
    const signature = fields.slice(0, count).join(" ");
    if (kind !== "2") {
      entries.push({ path, signature });
      continue;
    }
    const origin = records[index + 1] ?? "";
    index += 1;
    entries.push({ path, signature, origin });
  }
  return entries;
}

/**
 * Names every path that changed between two states.
 *
 * @returns The sorted paths that appeared, disappeared or changed their signature.
 */
export function changedSwarmPaths(
  before: SwarmWorkspaceState,
  after: SwarmWorkspaceState,
): readonly string[] {
  const paths = new Set([...before.entries.keys(), ...after.entries.keys()]);
  return [...paths]
    .filter((path) => before.entries.get(path) !== after.entries.get(path))
    .sort();
}

function isAllowed(
  path: string,
  allowances: readonly SwarmAllowance[],
): boolean {
  return allowances.some(
    (allowance) =>
      allowance.locks.includes(path) ||
      allowance.scope.some((area) => isPlanSwarmPathWithin(path, area)),
  );
}

/**
 * Compares the working directory before and after a period with what the helpers were allowed.
 *
 * @param before - The state when the period began.
 * @param after - The state when it ended.
 * @param allowances - Areas and locks of every helper active in the period.
 * @returns The findings: files outside every area and lock, and a changed
 * `HEAD` or index, which no helper may change. An allowed change of one
 * helper is never reported as a finding of another.
 */
export function findSwarmViolations(
  before: SwarmWorkspaceState,
  after: SwarmWorkspaceState,
  allowances: readonly SwarmAllowance[],
): readonly SwarmFinding[] {
  const outside = changedSwarmPaths(before, after).filter(
    (path) => !isAllowed(path, allowances),
  );
  return [
    ...(outside.length > 0
      ? [{ kind: "outside" as const, files: outside }]
      : []),
    ...(before.head === after.head
      ? []
      : [{ kind: "head" as const, files: [] }]),
    ...(before.index === after.index
      ? []
      : [{ kind: "index" as const, files: [] }]),
  ];
}
