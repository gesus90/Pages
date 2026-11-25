import { logCaughtError } from "@/backend/logging/Logger";
import { requireAgentAdministrator } from "@/backend/service/agents/AgentServiceAccess";
import {
  compareStableVersions,
  readStableVersion,
} from "@/definition/AgentToolVersion";

import { agentToolCombination } from "./AgentToolCombinations";
import { AgentToolReadinessError } from "./AgentToolReadinessError";

import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentToolDiagnostic,
  AgentToolId,
  AgentToolOperationView,
  AgentToolUpdateTargetVersion,
  AgentToolUpdateView,
  AgentToolView,
} from "@/definition/AgentTools";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type { AgentToolManagerService } from "./AgentToolManagerService";
import type { AgentToolOperationLog } from "./AgentToolOperationLog";
import type { AgentToolRebindService } from "./AgentToolRebindService";
import type { AgentToolState } from "./AgentToolStates";
import type { AgentToolUpdateSearch } from "./AgentToolUpdateSearch";

/** What the update view of one tool is computed from. */
interface UpdateFacts {
  readonly tool: AgentToolDefinition;
  readonly state: AgentToolState;
  readonly updates: AgentToolUpdateSearch;
  /** The last operation of each tool of the combination. */
  readonly operations: readonly (AgentToolOperationView | null)[];
}

interface UpdateJobDependencies {
  readonly manager: Pick<AgentToolManagerService, "start" | "acceptUpdate">;
  readonly rebind: Pick<AgentToolRebindService, "manage">;
}

/** Results of the update search that keep an update from starting. */
const SEARCH_BLOCKERS: Readonly<Record<string, AgentToolDiagnostic>> = {
  incompatible: "release_incompatible",
  source_unreachable: "release_unavailable",
  check_failed: "release_unavailable",
};

function targetVersions(
  id: AgentToolId,
  updates: AgentToolUpdateSearch,
): readonly AgentToolUpdateTargetVersion[] {
  return agentToolCombination(id).ids.map((toolId) => ({
    id: toolId,
    version: updates.target(toolId)?.version ?? null,
  }));
}

function activeVersionOf(state: AgentToolState): string | null {
  return state.location?.version ?? state.health.version;
}

// Next to an external installation the target is compared with the version that installation reports.
function isNewerTarget(facts: UpdateFacts): boolean {
  const { tool, state, updates } = facts;
  if (state.checkedAt === null || state.location === null) return false;
  const target = updates.target(tool.id);
  const active = activeVersionOf(state);
  const next = target ? readStableVersion(target.version) : null;
  const current = active ? readStableVersion(active) : null;
  if (!next || !current) return false;
  return compareStableVersions(next, current) > 0;
}

function blockerOf(facts: UpdateFacts): AgentToolDiagnostic | null {
  const { tool, state, updates, operations } = facts;
  if (operations.some((operation) => operation?.state === "running"))
    return "update_running";
  if (!updates.hasSearched(tool.id)) return "update_not_checked";
  const active = activeVersionOf(state);
  const release = updates.view(tool, {
    installed: state.checkedAt === null ? null : state.location !== null,
    version: active,
    source: state.location?.source ?? null,
  });
  const fromSearch = SEARCH_BLOCKERS[release.state];
  if (fromSearch) return fromSearch;
  if (state.checkedAt === null) return "not_checked";
  if (state.location === null) return "not_installed";
  if (active === null || readStableVersion(active) === null)
    return "not_checked";
  return updates.target(tool.id) ? null : "release_unavailable";
}

/**
 * Whether and to which checked releases "Aktualisieren" moves a tool and its partner.
 * @param tool - The tool of the row.
 * @param state - Its cached installation and health.
 * @param updates - The results of the last update search.
 * @param log - The last operations, read for every tool of the combination.
 * @remarks
 * The target names every tool of the combination, so the server can refuse
 * a click whose page showed another release of the CLI or of its adapter.
 */
export function agentToolUpdateView(
  tool: AgentToolDefinition,
  state: AgentToolState,
  updates: AgentToolUpdateSearch,
  log: Pick<AgentToolOperationLog, "get">,
): AgentToolUpdateView {
  const facts: UpdateFacts = {
    tool,
    state,
    updates,
    operations: agentToolCombination(tool.id).ids.map((id) => log.get(id)),
  };
  const isExternal = state.location?.source === "system";
  if (!tool.release)
    return {
      isSupported: false,
      isExternal,
      target: null,
      isNewer: false,
      targetVersions: [],
      blocker: null,
    };
  const versions = targetVersions(tool.id, updates);
  const blocker = blockerOf(facts);
  return {
    isSupported: true,
    isExternal,
    target:
      blocker === null
        ? versions
            .map((entry) => `${entry.id}@${entry.version ?? "-"}`)
            .join("+")
        : null,
    isNewer: isNewerTarget(facts),
    targetVersions: versions,
    blocker,
  };
}

/**
 * Refuses an update whose page showed another target than the checked one now.
 * @param view - The tool's current view.
 * @param expected - The target the page sent with the click.
 * @throws {AgentToolReadinessError} `target_changed` or the reason no update can start.
 */
export function requireUpdateTarget(
  view: AgentToolView,
  expected: string | null,
): void {
  const { update, id } = view;
  if (!update.isSupported)
    throw new AgentToolReadinessError(id, "unsupported", "not_installed");
  if (update.blocker)
    throw new AgentToolReadinessError(id, "failed", update.blocker);
  if (update.target !== expected)
    throw new AgentToolReadinessError(id, "failed", "target_changed");
}

/**
 * Starts the single update a click named, after the server checked its target again.
 * @remarks
 * Only active system administrators start an update. The click carries the
 * target the page showed; when the checked target changed since, nothing
 * starts and the page shows the new one for a new click. One update of a
 * combination runs at a time: a second click or a concurrent direct request
 * is refused while it runs, here and, through the tools directory's lock,
 * in every other Pages process. The update itself runs on after the
 * request; its phases, result and repetition appear in the tool's row.
 */
export class AgentToolUpdateJobs {
  private readonly dependencies: UpdateJobDependencies;
  private readonly running = new Map<AgentToolId, Promise<void>>();

  public constructor(dependencies: UpdateJobDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Accepts an update and runs it in the background.
   * @param actor - The requesting account, checked for administrator rights.
   * @param id - The tool whose row was clicked.
   * @param expectedTarget - The target the page showed with the click.
   * @throws {AgentToolReadinessError} `target_changed`, `update_running` or the reason no update can start.
   */
  public async start(
    actor: AccountAccess,
    id: AgentToolId,
    expectedTarget: string | null,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    const { manager } = this.dependencies;
    await manager.start();
    const key = agentToolCombination(id).cli.id;
    if (this.running.has(key))
      throw new AgentToolReadinessError(id, "updating", "update_running");
    manager.acceptUpdate(id, expectedTarget);
    const job = this.run(actor, id).finally(() => {
      this.running.delete(key);
    });
    this.running.set(key, job);
  }

  /** Waits for running updates; the manager's shutdown ends their children. */
  public async shutdown(): Promise<void> {
    await Promise.allSettled([...this.running.values()]);
  }

  private async run(actor: AccountAccess, id: AgentToolId): Promise<void> {
    try {
      await this.dependencies.rebind.manage(actor, id, "update");
    } catch (error: unknown) {
      // The operation log of the row already names the failed phase and its repetition.
      if (!(error instanceof AgentToolReadinessError))
        logCaughtError("AgentToolUpdateJobs", error);
    }
  }
}
