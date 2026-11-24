import { AgentToolReadinessError } from "./AgentToolReadinessError";

import type { AgentToolId, AgentToolPhase } from "@/definition/AgentTools";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type {
  AgentToolHealth,
  AgentToolHealthChecks,
  AgentToolInstallation,
  AgentToolLocation,
  AgentToolRelease,
  AgentToolStorage,
} from "./AgentToolContracts";

/** One tool of a combination, with the exact release to install, or `null` to keep it. */
export interface AgentToolActivationStep {
  readonly tool: AgentToolDefinition;
  readonly target: AgentToolRelease | null;
}

/** A verified generation, published for new sessions. */
export interface AgentToolActivated {
  readonly tool: AgentToolDefinition;
  readonly location: AgentToolLocation;
  readonly health: AgentToolHealth;
}

interface ActivationDependencies {
  readonly files: AgentToolStorage;
  readonly installer: AgentToolInstallation;
  readonly health: AgentToolHealthChecks;
  readonly signal: AbortSignal;
  readonly progress: (phase: AgentToolPhase) => void;
  /** The generation new sessions use now: managed, or an external installation. */
  readonly locate: (
    tool: AgentToolDefinition,
  ) => Promise<AgentToolLocation | null>;
}

interface StepPhases {
  readonly installing: AgentToolPhase;
  readonly verifying: AgentToolPhase;
}

interface Prepared {
  readonly tool: AgentToolDefinition;
  readonly location: AgentToolLocation;
  readonly health: AgentToolHealth;
  readonly isCandidate: boolean;
}

function stepPhases(tool: AgentToolDefinition, isAdapter: boolean): StepPhases {
  if (isAdapter)
    return { installing: "installing_adapter", verifying: "verifying_adapter" };
  return tool.kind === "runtime"
    ? { installing: "installing_runtime", verifying: "verifying_runtime" }
    : { installing: "installing_cli", verifying: "verifying_cli" };
}

/**
 * Installs, checks and publishes one CLI and its adapter as a combination.
 * @remarks
 * Every changed tool gets its own unpublished candidate generation. The
 * adapter is checked with the CLI generation it will run with, the candidate
 * as well as a kept CLI. Only when every check passed are the generations
 * published, together in one step where the storage offers it; a failure
 * discards the candidates and leaves the previous generations active.
 * Running sessions keep the files they pinned.
 */
export class AgentToolActivation {
  private readonly dependencies: ActivationDependencies;

  public constructor(dependencies: ActivationDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Updates a combination.
   * @param cli - The CLI, or the only tool when it needs no adapter.
   * @param adapter - Its adapter, whose current generation is checked again with a new CLI.
   */
  public async update(
    cli: AgentToolActivationStep,
    adapter: AgentToolActivationStep | null,
  ): Promise<readonly AgentToolActivated[]> {
    const prepared: Prepared[] = [];
    try {
      const cliPrepared = await this.prepare(cli, null);
      prepared.push(cliPrepared);
      if (adapter)
        prepared.push(await this.prepare(adapter, cliPrepared.location));
      return await this.publish(prepared.filter((entry) => entry.isCandidate));
    } catch (error: unknown) {
      for (const entry of prepared)
        if (entry.isCandidate)
          await this.dependencies.files.discard(entry.location);
      throw error;
    }
  }

  /**
   * Restores the retained previous generations of a combination.
   * @remarks
   * A tool without a retained generation keeps its current one, which is
   * checked again with the restored partner.
   */
  public async rollback(
    cli: AgentToolDefinition,
    adapter: AgentToolDefinition | null,
  ): Promise<readonly AgentToolActivated[]> {
    const { files } = this.dependencies;
    this.dependencies.progress("rolling_back");
    const cliPrevious = await files.previous(cli);
    const adapterPrevious = adapter ? await files.previous(adapter) : null;
    if (!cliPrevious && !adapterPrevious)
      throw new AgentToolReadinessError(cli.id, "failed", "rollback_failed");
    const cliLocation = cliPrevious ?? (await this.dependencies.locate(cli));
    if (!cliLocation)
      throw new AgentToolReadinessError(cli.id, "failed", "rollback_failed");
    const restored: AgentToolActivated[] = [];
    const cliHealth = await this.verify(
      cli,
      cliLocation,
      null,
      "rollback_failed",
    );
    if (cliPrevious)
      restored.push({ tool: cli, location: cliLocation, health: cliHealth });
    if (adapter) {
      const adapterLocation =
        adapterPrevious ?? (await this.dependencies.locate(adapter));
      if (!adapterLocation)
        throw new AgentToolReadinessError(
          adapter.id,
          "failed",
          "rollback_failed",
        );
      const health = await this.verify(
        adapter,
        adapterLocation,
        cliLocation,
        "adapter_incompatible",
      );
      if (adapterPrevious)
        restored.push({ tool: adapter, location: adapterLocation, health });
    }
    return this.publish(
      restored.map((entry) => ({ ...entry, isCandidate: true })),
    );
  }

  private async prepare(
    step: AgentToolActivationStep,
    cli: AgentToolLocation | null,
  ): Promise<Prepared> {
    const { files, installer, signal, progress } = this.dependencies;
    const isAdapter = cli !== null;
    const phases = stepPhases(step.tool, isAdapter);
    if (!step.target) {
      // A kept adapter has to work with the new CLI before that CLI is published.
      const current = await this.dependencies.locate(step.tool);
      if (!current)
        throw new AgentToolReadinessError(
          step.tool.id,
          "failed",
          "not_installed",
        );
      progress(phases.verifying);
      const health = await this.verify(
        step.tool,
        current,
        cli,
        isAdapter ? "adapter_incompatible" : null,
      );
      return { tool: step.tool, location: current, health, isCandidate: false };
    }
    progress(phases.installing);
    const candidate = await files.candidate(step.tool, step.target.version);
    try {
      await installer.install(step.tool, candidate, step.target, signal);
    } catch (error: unknown) {
      await files.discard(candidate);
      throw error;
    }
    progress(phases.verifying);
    try {
      const health = await this.verify(
        step.tool,
        candidate,
        cli,
        isAdapter ? "adapter_incompatible" : null,
      );
      if (health.version !== step.target.version)
        throw new AgentToolReadinessError(
          step.tool.id,
          "unsupported",
          "version_unsupported",
        );
      return {
        tool: step.tool,
        location: { ...candidate, version: health.version },
        health,
        isCandidate: true,
      };
    } catch (error: unknown) {
      await files.discard(candidate);
      throw error;
    }
  }

  private async verify(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
    cli: AgentToolLocation | null,
    refusal: "adapter_incompatible" | "rollback_failed" | null,
  ): Promise<AgentToolHealth> {
    const health = await this.dependencies.health.check(
      tool,
      location,
      this.dependencies.signal,
      cli ?? undefined,
    );
    if (health.status === "ready") return health;
    throw new AgentToolReadinessError(
      tool.id,
      health.status,
      refusal ?? health.diagnostic,
    );
  }

  // Publishes a combination in one step where the storage offers it, otherwise
  // CLI before adapter; a failed later step restores what was active before.
  private async publish(
    entries: readonly Prepared[],
  ): Promise<readonly AgentToolActivated[]> {
    const { files, progress } = this.dependencies;
    progress("activating");
    const result = entries.map(({ tool, location, health }) => ({
      tool,
      location,
      health,
    }));
    if (files.activateCombination && entries.length > 0) {
      await files.activateCombination(result);
      return result;
    }
    const restorable = new Map<AgentToolId, AgentToolLocation | null>();
    for (const entry of entries)
      restorable.set(entry.tool.id, await files.current(entry.tool));
    const published: Prepared[] = [];
    try {
      for (const entry of entries) {
        await files.activate(entry.tool, entry.location);
        published.push(entry);
      }
    } catch (error: unknown) {
      for (const entry of published) {
        const before = restorable.get(entry.tool.id);
        if (before) await files.activate(entry.tool, before);
      }
      throw error;
    }
    return result;
  }
}
