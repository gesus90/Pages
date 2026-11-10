import type {
  AgentPlanSessionInput,
  PlanSession,
  PlanSessionObserver,
  PlanSessionRunner,
} from "@/backend/agents/AgentPlanExecution";
import type { LocalSessions } from "./LocalSessions";

/** Plan sessions have independent owners; Pica and login keep their existing execution contracts. */
export class DurableCliSessions implements PlanSessionRunner {
  public readonly hasDurableLocalSessions = true;
  private readonly local: LocalSessions;
  private readonly direct: PlanSessionRunner;

  public constructor(local: LocalSessions, direct: PlanSessionRunner) {
    this.local = local;
    this.direct = direct;
  }

  /**
   * Starts plan work through the durable owner after the existing authorization boundary.
   *
   * @remarks
   * The short session of a decision model or the group observer has no
   * transcript to keep and no turn to resume, so it runs directly, still
   * under the resource scheduler.
   */
  public open(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession> {
    return input.chat || input.purpose !== undefined || !input.resourceContext
      ? this.direct.open(input, signal, observer)
      : this.local.open(input, signal, observer);
  }

  /**
   * Releases the owner only after all native processes and public results have settled.
   *
   * @remarks
   * The transcripts of the run stay; they go when the plan starts a new run.
   */
  public async finishPlanRun(runId: string): Promise<void> {
    await this.local.finishRun(runId);
  }
}
