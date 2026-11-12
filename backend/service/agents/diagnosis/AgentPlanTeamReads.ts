import { AgentPlanTeamRuns } from "./AgentPlanTeamRuns";
import {
  createAgentRunDiagnosis,
  UNNAMED_STARTERS,
} from "./AgentRunDiagnosisStores";

import type { PlanDependencies } from "../AgentPlanDependencies";
import type { ReadableRun } from "./AgentPlanRunTeamReader";
import type { AgentRunDiagnosisService } from "./AgentRunDiagnosisService";

/**
 * The team-wide reading of runs the plan service offers (PAGE-307).
 *
 * @remarks
 * The plan service extends it, so reading a run of any visible plan sits
 * next to the owner-only `run` and `controlRun` without growing the service.
 */
export class AgentPlanTeamReads {
  /** Lists, overviews, timelines and logs of runs; `null` without diagnosis tables. */
  public readonly diagnosis: AgentRunDiagnosisService | null;
  /** The runs of a plan for everybody who may see it, whoever started them. */
  public readonly teamRuns: AgentPlanTeamRuns;
  protected readonly dependencies: PlanDependencies;
  private readonly teamReader: ReturnType<
    typeof createAgentRunDiagnosis
  >["reader"];

  public constructor(dependencies: PlanDependencies) {
    this.dependencies = dependencies;
    const diagnosis = createAgentRunDiagnosis(dependencies, {
      starters: dependencies.starters ?? UNNAMED_STARTERS,
      stores: dependencies.diagnosisStores,
    });
    this.teamReader = diagnosis.reader;
    this.diagnosis = diagnosis.service;
    this.teamRuns = new AgentPlanTeamRuns(dependencies, diagnosis.reader);
  }

  /**
   * Reads a run of any plan the person may see, whoever started it.
   *
   * @remarks
   * Reading only: content of tickets, pages and workspaces the person may not
   * see is left out and named in `hiddenFields`. Control stays with
   * `controlRun` and the owner rules.
   * @throws {AgentError} `plan_access_denied` for a missing run and for a plan the person cannot see.
   */
  public async readableRun(userId: string, id: string): Promise<ReadableRun> {
    return this.teamReader.read(userId, id);
  }
}
