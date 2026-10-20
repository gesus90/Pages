import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";

import { AgentError } from "@/backend/error/AgentErrors";
import { planInterpreters } from "@/definition/AgentPlanScript";
import { interpreterProfileSchema } from "@/definition/InterpreterProfile";

import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AgentPlanInterpreter } from "@/definition/AgentPlanScript";
import type {
  InterpreterProfile,
  InterpreterSnapshot,
} from "@/definition/InterpreterProfile";

/** The script nodes of a plan, those inside loops included. */
function scriptsOf(
  nodes: readonly AgentPlanNode[],
): readonly AgentPlanScript[] {
  const scripts: AgentPlanScript[] = [];
  for (const node of nodes) {
    const candidates: readonly AgentPlanNode[] =
      node.type === "loop" ? node.steps : [node];
    for (const candidate of candidates)
      if (candidate.type === "script") scripts.push(candidate);
  }
  return scripts;
}

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

  /** Resolves the exact stable profile and checks its executable, without running script content. */
  public async executable(id: string): Promise<InterpreterProfile> {
    const snapshot = await this.source?.snapshot();
    const profile = snapshot?.profiles.find((entry) => entry.id === id);
    if (!profile) throw new AgentError("plan_script_profile_missing");
    if (!interpreterProfileSchema.safeParse(profile).success)
      throw new AgentError("plan_script_invalid");
    try {
      await access(profile.path, constants.X_OK);
      if (!(await stat(profile.path)).isFile())
        throw new AgentError("plan_script_interpreter_unavailable");
    } catch {
      throw new AgentError("plan_script_interpreter_unavailable");
    }
    if (snapshot?.checks[id]?.status === "error")
      throw new AgentError("plan_script_interpreter_unavailable");
    return profile;
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
    const scripts = scriptsOf(nodes);
    if (scripts.length === 0) return;
    const profiles = await this.interpreters();
    for (const script of scripts) {
      const previous = scriptsOf(saved).find((node) => node.id === script.id);
      if (
        !profiles.some(
          (profile) => profile.id === script.interpreterProfileId,
        ) &&
        !(
          previous !== undefined &&
          previous.interpreterProfileId === script.interpreterProfileId
        )
      )
        throw new AgentError("plan_script_profile_missing");
    }
  }
}
