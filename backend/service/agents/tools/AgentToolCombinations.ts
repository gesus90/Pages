import { AgentToolActivation } from "./AgentToolActivation";
import { AgentToolReadinessError } from "./AgentToolReadinessError";
import {
  agentToolDefinition,
  isArchiveRelease,
  pairedCli,
} from "./AgentToolRegistry";

import type {
  AgentToolAction,
  AgentToolDiagnostic,
  AgentToolId,
} from "@/definition/AgentTools";
import type {
  AgentToolActivated,
  AgentToolActivationStep,
} from "./AgentToolActivation";
import type {
  AgentToolHealthChecks,
  AgentToolInstallation,
  AgentToolLocation,
  AgentToolRelease,
  AgentToolStorage,
} from "./AgentToolContracts";
import type { AgentToolOperationLog } from "./AgentToolOperationLog";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type { AgentToolStates } from "./AgentToolStates";
import type { AgentToolUpdateSearch } from "./AgentToolUpdateSearch";

/** A CLI with its adapter, or a tool that changes alone. */
export interface AgentToolCombination {
  readonly cli: AgentToolDefinition;
  readonly adapter: AgentToolDefinition | null;
  readonly ids: readonly AgentToolId[];
}

/** What the manager lends the combination flow: its state, locks and readiness steps. */
export interface AgentToolCombinationHost {
  readonly files: AgentToolStorage;
  readonly installer: AgentToolInstallation;
  readonly health: AgentToolHealthChecks;
  readonly updates: AgentToolUpdateSearch;
  readonly operations: AgentToolOperationLog;
  readonly states: AgentToolStates;
  readonly signal: AbortSignal;
  inspect(id: AgentToolId): Promise<void>;
  ready(id: AgentToolId): Promise<void>;
  dependenciesReady(tool: AgentToolDefinition): Promise<void>;
  exclusive(
    id: AgentToolId,
    operation: () => Promise<void>,
    mustRun: boolean,
  ): Promise<void>;
  published(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
  ): Promise<AgentToolLocation>;
}

interface CombinationSteps {
  readonly cli: AgentToolActivationStep;
  readonly adapter: AgentToolActivationStep | null;
}

/** The CLI of a tool together with the adapter it needs. */
export function agentToolCombination(id: AgentToolId): AgentToolCombination {
  const cli = pairedCli(agentToolDefinition(id));
  const adapter = cli.adapter ? agentToolDefinition(cli.adapter) : null;
  return { cli, adapter, ids: adapter ? [cli.id, adapter.id] : [cli.id] };
}

function diagnosticOf(
  error: unknown,
  signal: AbortSignal,
): AgentToolDiagnostic {
  // A shutdown ends the change before its result; the next start shows it as interrupted.
  if (signal.aborted) return "update_interrupted";
  return error instanceof AgentToolReadinessError
    ? error.diagnostic
    : "installation_failed";
}

// A managed generation has to be the published one; an external tool has none published.
function isPublished(
  published: AgentToolLocation | null,
  used: AgentToolLocation | undefined,
): boolean {
  if (!used) return true;
  return published ? published.file === used.file : used.source !== "managed";
}

/**
 * Resolves the tools of a start so that a CLI and its adapter belong to one published combination.
 * @param files - The storage whose combination pointer is read once per pair.
 * @param ids - Every tool the start needs.
 * @param ensure - Makes one tool ready and returns the generation it uses.
 * @remarks
 * A switch while the tools were resolved one after the other makes the
 * start resolve them again, so it sees the old or the new checked
 * combination and never one tool of each.
 * @throws {AgentToolReadinessError} `update_running` when the combination kept changing.
 */
export async function resolvePublishedCombination(
  files: AgentToolStorage,
  ids: ReadonlySet<AgentToolId>,
  ensure: (id: AgentToolId) => Promise<AgentToolLocation>,
): Promise<ReadonlyMap<AgentToolId, AgentToolLocation>> {
  const clis = [...ids]
    .map((id) => agentToolDefinition(id))
    .filter((tool) => tool.adapter !== undefined && ids.has(tool.adapter));
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const locations = new Map<AgentToolId, AgentToolLocation>();
    for (const id of ids) locations.set(id, await ensure(id));
    let isConsistent = true;
    for (const cli of clis) {
      const pair = await files.currentPair?.(cli);
      if (!pair || !cli.adapter) continue;
      isConsistent &&=
        isPublished(pair.cli, locations.get(cli.id)) &&
        isPublished(pair.adapter, locations.get(cli.adapter));
    }
    if (isConsistent) return locations;
  }
  throw new AgentToolReadinessError(
    clis[0]?.id ?? "node",
    "updating",
    "update_running",
  );
}

/**
 * Updates, rolls back and installs a CLI together with its adapter.
 * @remarks
 * Both tools are locked, adapter first like every readiness path. A failed
 * step leaves the previous generations and their state as they were; the
 * operation log names the phase and the action that repeats it.
 */
export class AgentToolCombinations {
  private readonly host: AgentToolCombinationHost;

  public constructor(host: AgentToolCombinationHost) {
    this.host = host;
  }

  /** Runs one administrator action on the combination of a tool. */
  public async change(id: AgentToolId, action: AgentToolAction): Promise<void> {
    const combination = agentToolCombination(id);
    const { cli, adapter, ids } = combination;
    const { operations } = this.host;
    operations.start(
      ids,
      action,
      action === "rollback" ? "rolling_back" : "resolving",
    );
    const run = async (): Promise<void> => {
      try {
        await this.host.dependenciesReady(cli);
        await this.locked(cli.id, async () => {
          // An adapter installs next to a working CLI; the CLI's own lock is already held here.
          if (action === "install" && id !== cli.id)
            await this.host.ready(cli.id);
          if (action === "rollback") await this.rollback(combination);
          else await this.update(combination, action, id);
        });
      } catch (error: unknown) {
        // The previous generations stay active, so their state stays as it was.
        if (error instanceof AgentToolReadinessError) throw error;
        throw new AgentToolReadinessError(id, "failed", "installation_failed");
      }
    };
    try {
      await this.host.exclusive(
        adapter?.id ?? cli.id,
        () => (adapter ? this.host.exclusive(cli.id, run, true) : run()),
        true,
      );
      operations.succeed(ids);
    } catch (error: unknown) {
      operations.fail(ids, diagnosticOf(error, this.host.signal), action);
      throw error;
    }
  }

  /**
   * Confirms one exact release at its official source.
   * @remarks
   * A binary archive is never installed without the source's digest; an npm
   * package falls back to npm's own registry integrity check.
   */
  public async exactTarget(
    tool: AgentToolDefinition,
    version: string | null,
  ): Promise<AgentToolRelease | null> {
    if (!tool.release || version === null) return null;
    const release = await this.host.updates.exact(
      tool,
      version,
      this.host.signal,
    );
    if (release) return release;
    if (isArchiveRelease(tool))
      throw new AgentToolReadinessError(
        tool.id,
        "failed",
        "release_unavailable",
      );
    return { version, integrity: null, archiveUrl: null, dependencies: {} };
  }

  /**
   * Installs one tool alone, as a first installation or a repair.
   * @param tool - The tool to install.
   * @param version - The exact release; the reviewed one for a first installation.
   */
  public async install(
    tool: AgentToolDefinition,
    version: string | null,
  ): Promise<void> {
    const target =
      (await this.exactTarget(tool, version)) ??
      (version === null
        ? null
        : { version, integrity: null, archiveUrl: null, dependencies: {} });
    if (target === null)
      throw new AgentToolReadinessError(
        tool.id,
        "unsupported",
        "not_installed",
      );
    await this.locked(pairedCli(tool).id, async () => {
      const activated = await this.activation([tool.id]).update(
        { tool, target },
        null,
      );
      await this.publish(activated);
    });
  }

  /**
   * Runs a change while this process holds the combination's lock across all Pages processes.
   * @remarks
   * Another process that holds it makes the change fail with
   * `update_running`; the actual installation then decides what a repeated
   * request still has to do.
   */
  private async locked(
    key: AgentToolId,
    work: () => Promise<void>,
  ): Promise<void> {
    const release = await this.host.files.lock?.(key);
    try {
      await work();
    } finally {
      await release?.();
    }
  }

  private async update(
    combination: AgentToolCombination,
    action: AgentToolAction,
    requested: AgentToolId,
  ): Promise<void> {
    const steps = await this.steps(combination, action, requested);
    if (steps === null) return;
    const activated = await this.activation(combination.ids).update(
      steps.cli,
      steps.adapter,
    );
    await this.publish(activated);
  }

  private async rollback(combination: AgentToolCombination): Promise<void> {
    await this.host.inspect(combination.cli.id);
    if (combination.adapter) await this.host.inspect(combination.adapter.id);
    const restored = await this.activation(combination.ids).rollback(
      combination.cli,
      combination.adapter,
    );
    await this.publish(restored);
  }

  private activation(ids: readonly AgentToolId[]): AgentToolActivation {
    const { files, installer, health, signal, operations, states } = this.host;
    return new AgentToolActivation({
      files,
      installer,
      health,
      signal,
      progress: (phase) => operations.phase(ids, phase),
      locate: (tool) => Promise.resolve(states.get(tool.id)?.location ?? null),
    });
  }

  // Every state of a combination changes in the same turn, so a start never reads one of each.
  private async publish(
    activated: readonly AgentToolActivated[],
  ): Promise<void> {
    const locations: AgentToolLocation[] = [];
    for (const entry of activated)
      locations.push(await this.host.published(entry.tool, entry.location));
    const checkedAt = new Date().toISOString();
    activated.forEach((entry, index) => {
      this.host.states.set(entry.tool.id, {
        location: locations[index] ?? entry.location,
        health: entry.health,
        dependency: null,
        checkedAt,
      });
    });
  }

  /**
   * Chooses what changes: `null` when the actual installation already is the target.
   * @remarks
   * Reading the actual state first makes a repeated update after a failure
   * or an interruption continue from there, without a second activation.
   */
  private async steps(
    combination: AgentToolCombination,
    action: AgentToolAction,
    requested: AgentToolId,
  ): Promise<CombinationSteps | null> {
    const { cli, adapter } = combination;
    const cliTarget = await this.target(cli, action, requested);
    const adapterTarget = adapter
      ? await this.target(adapter, action, requested)
      : null;
    if (cliTarget === null && adapterTarget === null) return null;
    const cliVersion = this.targetVersion(cliTarget, cli.id);
    const adapterLocation = adapter ? this.installedLocation(adapter.id) : null;
    if (!adapter || (adapterTarget === null && adapterLocation === null))
      return { cli: { tool: cli, target: cliTarget }, adapter: null };
    return {
      cli: { tool: cli, target: cliTarget },
      adapter: {
        tool: adapter,
        target:
          adapterTarget && cliVersion
            ? { ...adapterTarget, cliVersion }
            : adapterTarget,
      },
    };
  }

  private targetVersion(
    cliTarget: AgentToolRelease | null,
    cliId: AgentToolId,
  ): string | null | undefined {
    return cliTarget?.version ?? this.host.states.get(cliId)?.location?.version;
  }

  private installedLocation(toolId: AgentToolId): AgentToolLocation | null {
    return this.host.states.get(toolId)?.location ?? null;
  }

  // The release one tool of the combination moves to, or `null` to keep it.
  private async target(
    tool: AgentToolDefinition,
    action: AgentToolAction,
    requested: AgentToolId,
  ): Promise<AgentToolRelease | null> {
    await this.host.inspect(tool.id);
    const state = this.host.states.get(tool.id);
    const location = state?.location ?? null;
    const isManagedReady = isManagedReadyState(state);
    if (action === "install")
      return tool.id !== requested || isManagedReady
        ? null
        : this.installTarget(tool);
    const target = this.host.updates.target(tool.id);
    // A partner without a usable release, or one Pages does not manage, stays
    // as it is and is checked again with the new partner.
    if (keepsExistingPartner(tool, requested, target, location)) return null;
    this.requireUsable(tool, location, target);
    return isManagedReady && location?.version === target?.version
      ? null
      : target;
  }

  // An explicit managed installation takes the searched release, otherwise the reviewed one.
  private async installTarget(
    tool: AgentToolDefinition,
  ): Promise<AgentToolRelease | null> {
    return (
      this.host.updates.target(tool.id) ?? this.exactTarget(tool, tool.version)
    );
  }

  private requireUsable(
    tool: AgentToolDefinition,
    location: AgentToolLocation | null,
    target: AgentToolRelease | null,
  ): asserts target is AgentToolRelease {
    const { updates } = this.host;
    if (!updates.hasSearched(tool.id))
      throw new AgentToolReadinessError(
        tool.id,
        "failed",
        "update_not_checked",
      );
    const release = updates.view(tool, {
      installed: location !== null,
      version: location?.version ?? null,
      source: location?.source ?? null,
    });
    if (release.state === "incompatible")
      throw new AgentToolReadinessError(
        tool.id,
        "unsupported",
        "release_incompatible",
      );
    if (!target)
      throw new AgentToolReadinessError(
        tool.id,
        "failed",
        "release_unavailable",
      );
  }
}

function isManagedReadyState(
  state: ReturnType<AgentToolStates["get"]>,
): boolean {
  return (
    state?.location?.source === "managed" && state?.health.status === "ready"
  );
}

function keepsExistingPartner(
  tool: AgentToolDefinition,
  requested: AgentToolId,
  target: AgentToolRelease | null,
  location: AgentToolLocation | null,
): boolean {
  return (
    tool.id !== requested && (target === null || location?.source !== "managed")
  );
}
