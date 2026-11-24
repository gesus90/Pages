import path from "node:path";

import { AGENT_TOOL_REGISTRY } from "./AgentToolRegistry";

import type { ManagedInterpreterProfile } from "@/definition/InterpreterProfile";
import type { AgentToolStorage } from "./AgentToolContracts";
import type { AgentToolState } from "./AgentToolStates";

/** The prefix of the profile IDs Pages reserves for its managed runtimes. */
export const MANAGED_INTERPRETER_PREFIX = "pages-";

const TRANSITIONAL: ReadonlySet<string> = new Set([
  "installing",
  "updating",
  "repairing",
]);

let managedNode: string | null = null;
let runtimeStore: Pick<AgentToolStorage, "current" | "previous"> | null = null;

/**
 * Binds the Node.js that Pages-managed starts put on `PATH` to the ready managed generation.
 * @remarks
 * Only a verified managed generation counts; without one, new starts keep
 * the Node.js that runs Pages. The Pages service process itself never
 * switches. A start reads the binding once, so a running session keeps the
 * generation it started with while a later start sees a new one.
 * @param state - The latest state of the Node.js tool.
 */
export function bindManagedNode(state: AgentToolState): void {
  const { location, health } = state;
  // A running installation or repair leaves the published generation in use.
  if (TRANSITIONAL.has(health.status)) return;
  managedNode =
    location?.source === "managed" && health.status === "ready"
      ? location.file
      : null;
}

/** The folder whose `node` agent sessions, probes and plan scripts start. */
export function agentNodeDirectory(): string {
  return path.dirname(managedNode ?? process.execPath);
}

/** Names the tools directory whose managed runtimes the Pages-managed interpreter profiles start. */
export function registerManagedRuntimes(
  files: Pick<AgentToolStorage, "current" | "previous">,
): void {
  runtimeStore = files;
}

/**
 * The Pages-managed interpreter profiles of the active runtime generations.
 * @remarks
 * Each profile reads the published pointer when a script is prepared, so a
 * new start in any Pages process uses the generation activated last, and a
 * started script keeps its program. Profiles with their own paths are not
 * part of this list and never switch.
 */
export async function managedInterpreterProfiles(): Promise<
  readonly ManagedInterpreterProfile[]
> {
  const store = runtimeStore;
  if (!store) return [];
  const profiles: ManagedInterpreterProfile[] = [];
  for (const tool of AGENT_TOOL_REGISTRY) {
    if (tool.kind !== "runtime") continue;
    try {
      const current = await store.current(tool);
      if (!current) continue;
      const previous = await store.previous(tool);
      profiles.push({
        id: `${MANAGED_INTERPRETER_PREFIX}${tool.id}`,
        name: `${tool.name} (Pages)`,
        path: current.file,
        version: current.version,
        retainedPaths: previous
          ? [current.file, previous.file]
          : [current.file],
      });
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error ? error.code : null;
      console.warn(
        `[pages] Managed runtime ${tool.id} cannot be read (${String(code ?? "invalid")}).`,
      );
    }
  }
  return profiles;
}
