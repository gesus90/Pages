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

  /** Starts plan work through the durable owner after the existing authorization boundary. */
  public open(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession> {
    return input.chat || !input.resourceContext
      ? this.direct.open(input, signal, observer)
      : this.local.open(input, signal, observer);
  }

  /** Releases the owner only after all native processes and public results have settled. */
  public async finishPlanRun(
    runId: string,
    status: "succeeded" | "failed" | "cancelled",
  ): Promise<void> {
    await this.local.finishRun(runId);
    await this.direct.finishPlanRun?.(runId, status);
  }
}
