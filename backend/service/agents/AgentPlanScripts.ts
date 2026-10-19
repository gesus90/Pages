import { AgentError } from "@/backend/error/AgentErrors";
import { planInterpreters } from "@/definition/AgentPlanScript";

import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanInterpreter } from "@/definition/AgentPlanScript";
import type { InterpreterSnapshot } from "@/definition/InterpreterProfile";

/** Reads the configured interpreter profiles and their last checks. */
export interface AgentPlanInterpreterSource {
  readonly snapshot: () => Promise<InterpreterSnapshot>;
}

/**
 * The interpreter profiles that script nodes name, as plans see them.
 *
 * @remarks
 * Plans get each profile's name, version and status, never its program
 * path. Without a source, as in a server without interpreter settings, no
 * profile exists and no script reference is valid.
 */
export class AgentPlanScripts {
  private readonly source: AgentPlanInterpreterSource | null;

  public constructor(source: AgentPlanInterpreterSource | null) {
    this.source = source;
  }

  /** Lists the configured profiles with their last check, for the plan editor. */
  public async interpreters(): Promise<readonly AgentPlanInterpreter[]> {
    if (!this.source) return [];
    const snapshot = await this.source.snapshot();
    return planInterpreters(snapshot.profiles, snapshot.checks);
  }

  /**
   * Requires every script node to name a configured interpreter profile.
   *
   * @remarks
   * A script whose saved profile has since been removed from the server keeps
   * it while its reference stays unchanged: the card shows it as missing and
   * the plan does not run, but other changes of the plan can still be saved.
   * A new or changed reference must name a configured profile; nothing falls
   * back to another one.
   *
   * @param nodes - The nodes about to be saved or inserted.
   * @param saved - The nodes of the plan's saved revision; empty for new nodes.
   * @throws {AgentError} `plan_script_profile_missing` for an unknown profile.
   */
  public async requireProfiles(
    nodes: readonly AgentPlanNode[],
    saved: readonly AgentPlanNode[],
  ): Promise<void> {
    const scripts = nodes.filter((node) => node.type === "script");
    if (scripts.length === 0) return;
    const profiles = await this.interpreters();
    for (const script of scripts) {
      const previous = saved.find((node) => node.id === script.id);
      if (
        !profiles.some(
          (profile) => profile.id === script.interpreterProfileId,
        ) &&
        !(
          previous?.type === "script" &&
          previous.interpreterProfileId === script.interpreterProfileId
        )
      )
        throw new AgentError("plan_script_profile_missing");
    }
  }
}
