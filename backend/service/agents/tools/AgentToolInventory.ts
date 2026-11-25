import { setTimeout as delay } from "node:timers/promises";

import { agentToolDefinition, pairedCli } from "./AgentToolRegistry";
import { AgentToolReadinessError } from "./AgentToolReadinessError";

import type { AgentToolId } from "@/definition/AgentTools";
import type {
  AgentToolHealthChecks,
  AgentToolLocation,
  AgentToolStorage,
} from "./AgentToolContracts";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type { AgentToolState, AgentToolStates } from "./AgentToolStates";

/** The pause between two looks at a tool another Pages process is changing. */
const FOREIGN_CHANGE_POLL_MS = 2_000;
/** How long a startup inventory waits for such a change at most. */
const FOREIGN_CHANGE_LIMIT_MS = 5 * 60_000;

/** How a queued tool operation behaves when another operation already runs for that tool. */
export type AgentToolQueueMode = "inspect" | "ensure" | "manage";

/**
 * Which tools a start probes in the background.
 * @remarks
 * `enabled` makes the tools ready that sessions of this instance need. `all`
 * also inspects every other registered tool without installing it, for the
 * process that shows the Tools page.
 */
export type AgentToolInventoryScope = "enabled" | "all";

/** What one startup inventory probes and how; the two runners never reject. */
export interface AgentToolStartupInventory {
  /** The tools to probe, in registry order. */
  readonly tools: readonly AgentToolDefinition[];
  readonly enabled: ReadonlySet<AgentToolId>;
  readonly states: Pick<AgentToolStates, "get">;
  readonly files: Pick<AgentToolStorage, "isLocked">;
  readonly signal: AbortSignal;
  readonly ensure: (id: AgentToolId) => Promise<void>;
  readonly inspect: (id: AgentToolId) => Promise<void>;
}

interface PendingToolWork {
  readonly promise: Promise<void>;
  readonly mode: AgentToolQueueMode;
}

/**
 * Serializes per-tool work without blocking unrelated tools.
 * @remarks
 * A read-only inventory inspection shares the outcome of any operation that
 * runs already. An `ensure` shares the outcome of a running readiness check or
 * management action; behind an inspection, which installs nothing, it still
 * runs when the tool was not found ready. Management actions always run next.
 */
export class AgentToolExclusiveQueue {
  private readonly pending = new Map<AgentToolId, PendingToolWork>();

  /** Whether an operation currently runs for this tool. */
  public has(id: AgentToolId): boolean {
    return this.pending.has(id);
  }

  /** All currently running tool promises, for graceful shutdown draining. */
  public values(): readonly Promise<void>[] {
    return [...this.pending.values()].map((entry) => entry.promise);
  }

  /** Runs `operation` exclusively for `id`, translating unexpected errors through `onError`. */
  public async run(input: {
    readonly id: AgentToolId;
    readonly mode: AgentToolQueueMode;
    readonly states: AgentToolStates;
    readonly operation: () => Promise<void>;
    readonly onError: (error: unknown) => AgentToolReadinessError;
  }): Promise<void> {
    const { id, mode, states, operation, onError } = input;
    const previous = this.pending.get(id);
    if (previous) {
      await previous.promise.catch(() => undefined);
      if (this.shouldSkipAfter(id, mode, previous.mode, states)) return;
      return this.run(input);
    }
    const work = Promise.resolve().then(operation);
    this.pending.set(id, { promise: work, mode });
    try {
      await work;
    } catch (error: unknown) {
      if (error instanceof AgentToolReadinessError) throw error;
      throw onError(error);
    } finally {
      if (this.pending.get(id)?.promise === work) this.pending.delete(id);
    }
  }

  private shouldSkipAfter(
    id: AgentToolId,
    requested: AgentToolQueueMode,
    completed: AgentToolQueueMode,
    states: AgentToolStates,
  ): boolean {
    if (requested === "inspect") return true;
    if (requested === "manage") return false;
    return completed !== "inspect" || states.get(id)?.health.status === "ready";
  }
}

/** Expands a list of tools with all transitive registry dependencies. */
export function agentToolDependencyClosure(
  ids: readonly AgentToolId[],
): Set<AgentToolId> {
  const result = new Set(ids);
  for (const id of result)
    for (const dependency of agentToolDefinition(id).dependencies)
      result.add(dependency);
  return result;
}

/** Runs the read-only location and health check of one tool without installing anything. */
export async function inspectAgentTool(input: {
  readonly id: AgentToolId;
  readonly files: Pick<AgentToolStorage, "current">;
  readonly system: (
    tool: AgentToolDefinition,
  ) => Promise<AgentToolLocation | null>;
  readonly health: Pick<AgentToolHealthChecks, "check">;
  readonly signal: AbortSignal;
}): Promise<AgentToolState> {
  const tool = agentToolDefinition(input.id);
  const location =
    (await input.files.current(tool)) ?? (await input.system(tool));
  const health = location
    ? await input.health.check(tool, location, input.signal)
    : {
        status: "missing_dependency" as const,
        diagnostic: "not_installed" as const,
        version: null,
      };
  return {
    location: location ? { ...location, version: health.version } : null,
    health,
    dependency: null,
    checkedAt: new Date().toISOString(),
  };
}

/** Re-reads the pointer for rollback generation and terminal entry after an activation. */
export async function publishedAgentToolLocation(
  files: Pick<AgentToolStorage, "current">,
  tool: AgentToolDefinition,
  location: AgentToolLocation,
): Promise<AgentToolLocation> {
  try {
    const current = await files.current(tool);
    return current?.file === location.file
      ? { ...current, version: location.version }
      : location;
  } catch {
    // The activation already succeeded; only its secondary facts stay unknown until the next check.
    return location;
  }
}

/** Checks and activates the retained previous generation of a single tool. */
export async function rollbackAgentTool(input: {
  readonly id: AgentToolId;
  readonly files: Pick<AgentToolStorage, "previous" | "activate" | "current">;
  readonly health: Pick<AgentToolHealthChecks, "check">;
  readonly signal: AbortSignal;
}): Promise<AgentToolState> {
  const tool = agentToolDefinition(input.id);
  const candidate = await input.files.previous(tool);
  if (!candidate)
    throw new AgentToolReadinessError(input.id, "failed", "rollback_failed");
  const health = await input.health.check(tool, candidate, input.signal);
  if (health.status !== "ready")
    throw new AgentToolReadinessError(input.id, "failed", "rollback_failed");
  await input.files.activate(tool, candidate);
  return {
    location: await publishedAgentToolLocation(input.files, tool, {
      ...candidate,
      version: health.version,
    }),
    health,
    dependency: null,
    checkedAt: new Date().toISOString(),
  };
}

// A refused lock names a change in another Pages process; a tool that depends on it waits as well.
function isChangedElsewhere(
  states: Pick<AgentToolStates, "get">,
  id: AgentToolId,
): boolean {
  const state = states.get(id);
  if (!state) return false;
  if (state.health.diagnostic === "update_running") return true;
  return (
    state.dependency !== null && isChangedElsewhere(states, state.dependency)
  );
}

// Resolves `true` once no Pages process holds the lock of any of these tools' combinations.
async function foreignChangesEnded(
  inventory: Pick<AgentToolStartupInventory, "files" | "signal">,
  tools: readonly AgentToolDefinition[],
): Promise<boolean> {
  const { files, signal } = inventory;
  const keys = [...new Set(tools.map((tool) => pairedCli(tool).id))];
  const deadline = Date.now() + FOREIGN_CHANGE_LIMIT_MS;
  try {
    while (Date.now() < deadline) {
      const held = await Promise.all(
        keys.map(async (key) => (await files.isLocked?.(key)) ?? false),
      );
      if (!held.includes(true)) return !signal.aborted;
      await delay(FOREIGN_CHANGE_POLL_MS, undefined, { signal });
    }
    return false;
  } catch {
    // Shutdown or an unreadable lock ended the wait; the states stay as the probes left them.
    return false;
  }
}

/**
 * Probes tools in the background after startup, one after the other.
 * @param inventory - The tools, the enabled ones among them, their states and locks, and the runners.
 * @remarks
 * An enabled tool is made ready as at every start; any other tool is only
 * inspected and never installed. The probes run in registry order, so the
 * Node.js runtime is bound before a CLI that starts with it, and one at a
 * time, so they leave the places of the process runner to sign-in checks,
 * installations and session starts. A tool another Pages process was changing
 * at the same time is probed once more when that change ended.
 */
export async function runAgentToolStartupInventory(
  inventory: AgentToolStartupInventory,
): Promise<void> {
  const { tools, enabled, states, signal, ensure, inspect } = inventory;
  const probe = (id: AgentToolId): Promise<void> =>
    enabled.has(id) ? ensure(id) : inspect(id);
  for (const tool of tools) {
    if (signal.aborted) return;
    await probe(tool.id);
  }
  const changing = tools.filter((tool) => isChangedElsewhere(states, tool.id));
  if (changing.length === 0) return;
  if (!(await foreignChangesEnded(inventory, changing))) return;
  for (const tool of changing) await probe(tool.id);
}
