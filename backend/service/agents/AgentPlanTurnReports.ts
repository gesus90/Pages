import { planStepOutput } from "./AgentPlanAcceptance";
import { sanitizePlanOutput } from "./AgentPlanOutput";
import { AgentPlanStepAssessment } from "./AgentPlanStepAssessment";

import type { AgentPlanStepReport } from "@/definition/AgentPlanStepReport";
import type { AgentPlanSessionTerms } from "./AgentPlanStepAssessment";
import type { NodeRun } from "./AgentPlanStepContext";
import type { AgentPlanStepReportService } from "./AgentPlanStepReportService";
import type { PreparedPlanStep } from "./AgentPlanStepStart";
import type { AgentPlanStepProgressService } from "./AgentPlanStepProgressService";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";

/** How the turn reached Pages, as the runner of the step bound it. */
export interface PlanTurnBinding {
  /** Whether the session of the turn actually received the Pages MCP tools. */
  readonly usesMcp: boolean;
}

/** The assessment of a finished turn and what the node hands on. */
export interface PlanTurnAssessment {
  /** `null` when the turn failed technically, so there is nothing to assess. */
  readonly assessed: Awaited<
    ReturnType<AgentPlanStepAssessment["assess"]>
  > | null;
  /** The sanitized output of the node. */
  readonly output: string;
}

/**
 * Connects the turns of local agent nodes to `report_step_result`.
 * @remarks
 * A session credential names a node, or a group whose members take turns. The
 * slot of a turn says which attempt of which member may report under it.
 */
export class AgentPlanTurnReports {
  private readonly reports:
    Pick<AgentPlanStepReportService, "open" | "close"> | undefined;
  private readonly assessment: AgentPlanStepAssessment;

  public constructor(
    reports: Pick<AgentPlanStepReportService, "open" | "close"> | undefined,
    tasks: Pick<AgentPlanTasks, "checklist">,
    progress?: Pick<AgentPlanStepProgressService, "current">,
  ) {
    this.reports = reports;
    this.assessment = new AgentPlanStepAssessment(tasks, progress);
  }

  /** Lets the attempt of this turn report, under the scope its credential was issued for. */
  public async open(
    node: NodeRun,
    prepared: PreparedPlanStep,
    terms: AgentPlanSessionTerms,
  ): Promise<void> {
    const attemptId = node.record?.attemptId;
    if (!attemptId) return;
    await this.reports?.open({
      runId: node.run.id,
      sessionScopeId: node.sessionGroup ?? node.step.step.id,
      stepId: node.step.step.id,
      attemptId,
      terms: {
        ...terms,
        projectId: node.snapshot.plan.projectId,
        provider: prepared.input.agent.connection.provider,
      },
    });
  }

  /**
   * Ends the reporting of a finished turn, then assesses it.
   * @remarks
   * The slot closes first, also for a failed turn, so nothing can change what
   * gets assessed. An Antigravity turn with Pages MCP owes its own work list
   * also when it closes with a text report instead of `report_step_result`:
   * `agy acp` keeps no native task list, so without that obligation a closing
   * `pages-report` passed with zero of zero todos and an empty terminal list.
   * The open obligation sends the turn back to the same session, which then
   * names the missing list.
   */
  public async assess(
    node: NodeRun,
    turn: Pick<PlanSessionTurn, "output" | "failure" | "errorCode">,
    terms: AgentPlanSessionTerms,
    binding: PlanTurnBinding = { usesMcp: false },
  ): Promise<PlanTurnAssessment> {
    const stepReport = await this.close(node);
    const output = sanitizePlanOutput(planStepOutput(turn.output, stepReport));
    if (turn.failure !== null || turn.errorCode !== null)
      return { assessed: null, output };
    const assessed = await this.assessment.assess(
      terms,
      turn.output,
      {
        userId: node.run.userId,
        projectId: node.snapshot.plan.projectId,
        provider: node.step.provider,
        requiresWorkList:
          binding.usesMcp && node.step.provider === "antigravity",
        ...(node.record?.attemptId
          ? {
              progress: {
                runId: node.run.id,
                stepId: node.step.step.id,
                attemptId: node.record.attemptId,
              },
            }
          : {}),
      },
      stepReport,
    );
    return { assessed, output };
  }

  private async close(node: NodeRun): Promise<AgentPlanStepReport | null> {
    const attemptId = node.record?.attemptId;
    if (!attemptId || !this.reports) return null;
    return this.reports.close({
      runId: node.run.id,
      sessionScopeId: node.sessionGroup ?? node.step.step.id,
      attemptId,
    });
  }
}
