import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanContract } from "@/backend/agents/AgentPlanSessionInput";
import {
  planStepReportCallSchema,
  readPlanStepReport,
} from "@/backend/agents/AgentPlanStepReportInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { isAgentProvider } from "@/definition/AgentConnection";
import { AGENT_RUN_REACHES } from "@/definition/McpAuthorization";

import { sanitizeArtifactText } from "./AgentPlanOutput";
import { describePlanIssue } from "./AgentPlanRetryNotice";
import { AgentPlanStepAssessment } from "./AgentPlanStepAssessment";

import type { AgentProviderId } from "@/definition/AgentConnection";
import type {
  AgentPlanStepReport,
  AgentPlanStepReportReceipt,
} from "@/definition/AgentPlanStepReport";
import type { AgentPlanContract } from "@/definition/AgentPlanSession";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { StepReportRejectionReason } from "@/definition/PagesAgentOperations";
import type {
  AgentPlanStepReportRepository,
  PlanStepReportSlot,
  StoredPlanStepReport,
} from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import type { AgentPlanSessionTerms } from "./AgentPlanStepAssessment";
import type { AgentPlanStepProgressService } from "./AgentPlanStepProgressService";
import type { AgentPlanTasks } from "./AgentPlanTasks";

const MAXIMUM_PROBLEMS = 50;
const MAXIMUM_PROBLEM_TEXT = 500;

/** Findings the agent cannot repair itself; the assessment after its turn judges them as before. */
const OUTSIDE_AGENT_ISSUE = /^(?:ticket_changed|ticket_unreadable):/u;

/** What a report of one attempt is checked against, stored with its slot. */
export interface PlanStepReportTerms extends AgentPlanSessionTerms {
  readonly projectId: string;
  readonly provider: AgentProviderId;
}

/** The attempt a turn opens, as the runner of the step knows it. */
export interface PlanStepReportOpening extends Omit<
  PlanStepReportSlot,
  "termsJson"
> {
  readonly terms: PlanStepReportTerms;
}

function rejection(
  code: "INVALID_REQUEST" | "FORBIDDEN" | "CONFLICT",
  reason: StepReportRejectionReason,
  problems: readonly string[],
): AgentOperationError {
  return new AgentOperationError(code, {
    reason,
    problems: problems
      .slice(0, MAXIMUM_PROBLEMS)
      .map((problem) => problem.slice(0, MAXIMUM_PROBLEM_TEXT)),
  });
}

function readTerms(text: string): PlanStepReportTerms {
  const terms = readAgentObject(JSON.parse(text));
  const contract = readPlanContract(terms.contract);
  const reach = AGENT_RUN_REACHES.find((entry) => entry === terms.reach);
  if (
    !contract ||
    !reach ||
    typeof terms.instruction !== "string" ||
    typeof terms.projectId !== "string" ||
    !isAgentProvider(terms.provider)
  )
    throw new Error("Invalid step report terms");
  return {
    contract,
    reach,
    instruction: terms.instruction,
    projectId: terms.projectId,
    provider: terms.provider,
  };
}

function sanitizedReport(report: AgentPlanStepReport): AgentPlanStepReport {
  return {
    status: report.status,
    message: sanitizeArtifactText(report.message),
    todos: report.todos,
    criteria: report.criteria.map((criterion) => ({
      ...criterion,
      evidence: sanitizeArtifactText(criterion.evidence),
    })),
    decisions: report.decisions.map(sanitizeArtifactText),
    summary: sanitizeArtifactText(report.summary),
  };
}

function repeatedIds(ids: readonly string[]): readonly string[] {
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

/** IDs that do not belong to the current contract, or that name one entry twice. */
function identifierProblems(
  report: AgentPlanStepReport,
  contract: AgentPlanContract,
): readonly string[] {
  const todos = report.todos.map((todo) => todo.id);
  const criteria = report.criteria.map((criterion) => criterion.id);
  const knownTodos = contract.todos.map((todo) => todo.id);
  const knownCriteria = contract.criteria.map((criterion) => criterion.id);
  return [
    ...todos
      .filter((id) => !knownTodos.includes(id))
      .map(
        (id) =>
          `todos: ${id} is no todo of this step (${knownTodos.join(", ") || "none"})`,
      ),
    ...criteria
      .filter((id) => !knownCriteria.includes(id))
      .map(
        (id) =>
          `criteria: ${id} is no criterion of this step (${knownCriteria.join(", ") || "none"})`,
      ),
    ...repeatedIds(todos).map((id) => `todos: ${id} is named twice`),
    ...repeatedIds(criteria).map((id) => `criteria: ${id} is named twice`),
  ];
}

/**
 * Takes the results agents report through `report_step_result`.
 *
 * @remarks
 * The credential alone says for which run and which node or group a call counts;
 * the runner of the step opens the slot of the attempt whose turn runs and closes
 * it before it assesses the turn. So a call never reaches a foreign step, an
 * earlier attempt or a turn that already ended. A valid call stands in for the
 * text report; the assessment after the turn checks it once more against the
 * tickets as they are then.
 */
export class AgentPlanStepReportService {
  private readonly repository: Pick<
    AgentPlanStepReportRepository,
    "open" | "close" | "find" | "save"
  >;
  private readonly assessment: AgentPlanStepAssessment;

  public constructor(
    repository: Pick<
      AgentPlanStepReportRepository,
      "open" | "close" | "find" | "save"
    >,
    tasks: Pick<AgentPlanTasks, "checklist">,
    progress?: Pick<AgentPlanStepProgressService, "current">,
  ) {
    this.repository = repository;
    this.assessment = new AgentPlanStepAssessment(tasks, progress);
  }

  /** Lets the given attempt report; it starts without a result unless it already held the slot, as after a restart. */
  public async open(opening: PlanStepReportOpening): Promise<void> {
    const { terms, ...slot } = opening;
    await this.repository.open({ ...slot, termsJson: JSON.stringify(terms) });
  }

  /**
   * Ends the reporting of an attempt.
   *
   * @param slot - The attempt, under the scope of its credential.
   * @returns The report that counts for the attempt; `null` when the text decides.
   */
  public async close(
    slot: Pick<PlanStepReportSlot, "runId" | "sessionScopeId" | "attemptId">,
  ): Promise<AgentPlanStepReport | null> {
    const stored = await this.repository.close(slot);
    return stored === null
      ? null
      : readPlanStepReport(readAgentObject(JSON.parse(stored)));
  }

  /**
   * Checks one call and makes it the result of the running attempt.
   *
   * @param identity - The verified caller; only a session credential has a run.
   * @param input - The arguments of the tool.
   * @returns Which attempt holds the result now.
   * @throws {AgentOperationError} With the concrete problems; the stored result stays as it was.
   */
  public async report(
    identity: AgentIdentity,
    input: unknown,
  ): Promise<AgentPlanStepReportReceipt> {
    if (!identity.run) throw new AgentOperationError("FORBIDDEN");
    const { runId, stepId: sessionScopeId } = identity.run;
    const parsed = planStepReportCallSchema.safeParse(input ?? {});
    if (!parsed.success)
      throw rejection(
        "INVALID_REQUEST",
        "step_report_invalid",
        parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
        ),
      );
    const { runId: namedRun, stepId: namedStep, ...fields } = parsed.data;
    if (namedRun !== undefined && namedRun !== runId)
      throw rejection("FORBIDDEN", "step_report_foreign", [
        "runId: this connection reports only for its own run.",
      ]);
    const slot = await this.repository.find({ runId, sessionScopeId });
    if (!slot)
      throw rejection("CONFLICT", "step_report_closed", [
        "No turn of this step is running, so there is nothing to report on.",
      ]);
    if (namedStep !== undefined && namedStep !== slot.stepId)
      throw rejection("FORBIDDEN", "step_report_foreign", [
        "stepId: this connection reports only for the step it runs now.",
      ]);
    const report = sanitizedReport(fields);
    await this.requireValid(identity.userId, slot, report);
    if (!(await this.repository.save(slot, JSON.stringify(report))))
      throw rejection("CONFLICT", "step_report_closed", [
        "This attempt ended while the call was checked.",
      ]);
    return {
      runId,
      stepId: slot.stepId,
      attemptId: slot.attemptId,
      status: report.status,
      replaced: slot.reportJson !== null,
    };
  }

  /** Applies the conditions of the acceptance at once, so the agent can still repair what they find. */
  private async requireValid(
    userId: string,
    slot: StoredPlanStepReport,
    report: AgentPlanStepReport,
  ): Promise<void> {
    const terms = readTerms(slot.termsJson);
    const assessed = await this.assess(
      userId,
      { ...terms, progress: slot },
      report,
    );
    // An unreadable ticket is a reason to report blocked, so it refuses only a claim of completion.
    if (!assessed && report.status === "done")
      throw rejection("CONFLICT", "step_report_invalid", [
        "Pages could not read the bound tickets to check this report. Call again; report blocked if it keeps failing.",
      ]);
    const problems = [
      ...identifierProblems(report, assessed?.contract ?? terms.contract),
      ...(report.status === "done"
        ? (assessed?.acceptance.issues ?? [])
            .filter((issue) => !OUTSIDE_AGENT_ISSUE.test(issue))
            .map((issue) => {
              const todo = assessed?.contract.todos.find((entry) =>
                issue.endsWith(`:${entry.id}`),
              );
              return `${describePlanIssue(issue)}${todo ? `: ${todo.text}` : ""}`;
            })
        : []),
    ];
    if (problems.length > 0)
      throw rejection("INVALID_REQUEST", "step_report_invalid", problems);
  }

  private async assess(
    userId: string,
    terms: PlanStepReportTerms & { readonly progress: StoredPlanStepReport },
    report: AgentPlanStepReport,
  ): Promise<Awaited<ReturnType<AgentPlanStepAssessment["assess"]>> | null> {
    try {
      return await this.assessment.assess(
        terms,
        "",
        {
          userId,
          projectId: terms.projectId,
          provider: terms.provider,
          progress: terms.progress,
        },
        report,
      );
    } catch (error: unknown) {
      logCaughtError("AgentPlanStepReportService", error);
      return null;
    }
  }
}
