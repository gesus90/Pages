/** The most paths of one area of responsibility. */
export const PLAN_SWARM_SCOPE_PATHS = 64;

/** The longest path of an area or a lock. */
export const PLAN_SWARM_PATH_LENGTH = 1024;

/**
 * Brings a path of the working directory into one form: no `./`, no doubled
 * or trailing slash.
 *
 * @param input - A path relative to the working directory of the swarm.
 * @returns The path, `""` for the whole directory, or `null` for an absolute
 * path, one that leaves the directory with `..` or one with control characters.
 */
export function normalizePlanSwarmPath(input: string): string | null {
  if (input.length > PLAN_SWARM_PATH_LENGTH) return null;
  if (/[\u0000-\u001f\u007f\\]/u.test(input)) return null;
  if (input.startsWith("/")) return null;
  const parts = input.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) return null;
  return parts.join("/");
}

/**
 * Whether a path lies in an area path: the same path or below it.
 *
 * @param path - A normalized file path.
 * @param area - A normalized area path; `""` covers everything.
 */
export function isPlanSwarmPathWithin(path: string, area: string): boolean {
  return area === "" || path === area || path.startsWith(`${area}/`);
}

/** Whether two normalized area paths share a file: one lies in the other. */
export function doPlanSwarmPathsOverlap(
  first: string,
  second: string,
): boolean {
  return (
    isPlanSwarmPathWithin(first, second) || isPlanSwarmPathWithin(second, first)
  );
}

/**
 * Reads an area of responsibility.
 *
 * @param paths - The paths or directories the main model named.
 * @returns The normalized paths without repetitions, or `null` when one is
 * invalid or there are too many.
 */
export function readPlanSwarmScope(
  paths: readonly string[],
): readonly string[] | null {
  if (paths.length > PLAN_SWARM_SCOPE_PATHS) return null;
  const normalized: string[] = [];
  for (const path of paths) {
    const entry = normalizePlanSwarmPath(path);
    if (entry === null) return null;
    if (!normalized.includes(entry)) normalized.push(entry);
  }
  return normalized;
}

/**
 * Finds the paths of a new area that overlap an area already handed out.
 *
 * @param scope - The new area.
 * @param taken - The areas of the subtasks that run at the same time.
 * @returns Every overlapping pair, empty when the areas are disjoint.
 */
export function planSwarmScopeOverlaps(
  scope: readonly string[],
  taken: readonly {
    readonly owner: string;
    readonly scope: readonly string[];
  }[],
): readonly {
  readonly path: string;
  readonly owner: string;
  readonly other: string;
}[] {
  return scope.flatMap((path) =>
    taken.flatMap((entry) =>
      entry.scope
        .filter((other) => doPlanSwarmPathsOverlap(path, other))
        .map((other) => ({ path, owner: entry.owner, other })),
    ),
  );
}
