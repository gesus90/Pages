import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { logCaughtError } from "@/backend/logging/Logger";
import { acpRunOptions, isAcpProvider } from "@/definition/AgentConfiguration";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";
import {
  PLAN_INFRASTRUCTURE_RETRY_DELAYS,
  PLAN_BLOCKER_RETRIES,
} from "@/definition/AgentPlanRetry";
import {
  planDecisionCasesProblem,
  planDecisionMode,
  planDecisionOutput,
  readPlanDecisionAnswer,
} from "@/definition/AgentPlanDecision";

import { planBlockerClassOf } from "../AgentPlanBlockerRules";
import { errorCode } from "../AgentPlanStepFailure";
import { turnFailureCode } from "../AgentPlanSessionRecords";
import {
  decisionCorrectionPrompt,
  decisionPrompt,
  readDecisionSource,
} from "./AgentPlanDecisionPrompt";
import { invalidDecisionInput } from "./AgentPlanDecisionValue";

import type {
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { ResolvedAgentAssignment } from "../AgentAssignmentResolution";
import type {
  AgentPlanDecision,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentProfileService } from "../AgentProfileService";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";
import type { AgentPlanTasks } from "../AgentPlanTasks";
import type { PlanDecisionSource } from "./AgentPlanDecisionPrompt";

/** The longest turn of a decision session; a decision answers one question. */
const DECISION_TIMEOUT_MINUTES = 10;

/** What a model decision needs from the server: the ACP path, the model grant and the tickets. */
export interface PlanDecisionModelDependencies {
  readonly execution: Pick<PlanExecution, "open">;
  readonly profiles: Pick<AgentProfileService, "resolveDefinition">;
  readonly tasks: Pick<AgentPlanTasks, "snapshot">;
}

/** One activation of a model decision. */
export interface PlanDecisionRequest {
  readonly run: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
  readonly decision: AgentPlanDecision;
  /** The results the decision may read: the run's, or the current iteration's on top of the run's. */
  readonly results: ReadonlyMap<string, AgentPlanStepResult>;
  readonly signal: AbortSignal;
  /** Rechecks the executor's access to the plan before every session. */
  readonly authorize: () => Promise<void>;
}

/** How one session ended: an answer that settles the decision, or a technical failure code. */
type SessionOutcome =
  | { readonly kind: "settled"; readonly changes: Partial<AgentPlanStepResult> }
  | { readonly kind: "failure"; readonly code: string };

const OBSERVER: PlanSessionObserver = {
  started: () => undefined,
  identified: () => undefined,
};

/** The model grant a decision asks for, as an independent node configuration. */
function decisionConfiguration(
  decision: AgentPlanDecision,
): AgentPlanConfiguration | null {
  const model = decision.model;
  if (!model) return null;
  return {
    name: model.model.slice(0, 200),
    revision: 1,
    modelProfileId: agentModelKey(model.connectionId, model.model),
    connectionId: model.connectionId,
    model: model.model,
    provider: model.provider,
    reasoningEffort: model.reasoningEffort,
    template: {
      markdown: "",
      parameters: [],
      directoryParameter: null,
      run: acpRunOptions("read_only", DECISION_TIMEOUT_MINUTES),
    },
  };
}

/** Whether the settings of a model decision are complete enough to ask. */
function isReady(decision: AgentPlanDecision): boolean {
  return (
    planDecisionMode(decision) === "model" &&
    (decision.question?.trim().length ?? 0) > 0 &&
    decision.model !== undefined &&
    (planDecisionOutput(decision) === "boolean" ||
      planDecisionCasesProblem(decision.cases) === null)
  );
}

function waitFor(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AgentPlanCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, delay);
    function stop(): void {
      clearTimeout(timer);
      reject(new AgentPlanCancelledError());
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}

function cancelled(): Partial<AgentPlanStepResult> {
  return { status: "cancelled", cancellation: "confirmed", output: null };
}

/**
 * Asks the model of a decision in a short ACP session of its own (PAGE-286).
 *
 * @remarks
 * The session is never another node's: it opens under the decision, through
 * the existing ACP path with its isolation, connection lock and resource
 * scheduler, in an empty directory, read-only and without tools or MCP
 * server. The model gets the question, the allowed values and the source,
 * nothing else. An invalid answer is corrected once with its concrete
 * problem; then the decision fails. A technical failure of the session is an
 * `infrastructure` failure: it starts again after 10 s, 60 s and 300 s and
 * is then blocked. No failure ever activates an output.
 */
export class AgentPlanDecisionModel {
  private readonly dependencies: PlanDecisionModelDependencies;

  public constructor(dependencies: PlanDecisionModelDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Decides one activation of a model decision.
   *
   * @param request - The decision, the results it reads and the stop signal.
   * @returns The changes of its result: the activated branch with the answer,
   * or a failure without any branch.
   */
  public async run(
    request: PlanDecisionRequest,
  ): Promise<Partial<AgentPlanStepResult>> {
    const configuration = decisionConfiguration(request.decision);
    if (!configuration || !isReady(request.decision))
      return invalidDecisionInput();
    try {
      await request.authorize();
      const source = await readDecisionSource(this.dependencies.tasks, request);
      if (source === null) return invalidDecisionInput();
      const assignment = await this.resolve(request, configuration);
      return await this.attempts(request, source, assignment);
    } catch (error: unknown) {
      if (error instanceof AgentPlanCancelledError || request.signal.aborted)
        return cancelled();
      logCaughtError("AgentPlanDecisionModel", error);
      return { status: "failed", error: errorCode(error), output: null };
    }
  }

  private async resolve(
    request: PlanDecisionRequest,
    configuration: AgentPlanConfiguration,
  ): Promise<ResolvedAgentAssignment> {
    const { assignment } = await this.dependencies.profiles.resolveDefinition(
      request.run.userId,
      {
        agentId: request.decision.id,
        personalAgentId: null,
        projectId: request.snapshot.plan.projectId,
        configuration,
      },
    );
    if (!isAcpProvider(assignment.connection.provider))
      throw new AgentError("provider_invalid");
    return assignment;
  }

  /** Runs the session and starts it again after a technical failure, with the waits of the infrastructure class. */
  private async attempts(
    request: PlanDecisionRequest,
    source: PlanDecisionSource,
    assignment: ResolvedAgentAssignment,
  ): Promise<Partial<AgentPlanStepResult>> {
    const maximum = PLAN_BLOCKER_RETRIES.infrastructure + 1;
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await this.session(request, source, assignment);
      if (outcome.kind === "settled") return outcome.changes;
      if (request.signal.aborted) return cancelled();
      const isInfrastructure =
        planBlockerClassOf(outcome.code) === "infrastructure";
      if (!isInfrastructure || attempt >= maximum)
        return {
          status: "failed",
          error: outcome.code,
          output: null,
          ...(isInfrastructure
            ? {
                failureStop: {
                  failureClass: "infrastructure",
                  attempts: attempt,
                  maximumAttempts: maximum,
                  totalAttempts: attempt,
                },
              }
            : {}),
        };
      await request.authorize();
      await waitFor(
        PLAN_INFRASTRUCTURE_RETRY_DELAYS[attempt - 1] ?? 300_000,
        request.signal,
      );
    }
  }

  /** One session: the question, at most one correction, and its closing. */
  private async session(
    request: PlanDecisionRequest,
    source: PlanDecisionSource,
    assignment: ResolvedAgentAssignment,
  ): Promise<SessionOutcome> {
    const directory = await mkdtemp(path.join(tmpdir(), "pages-decision-"));
    let session: PlanSession | null = null;
    try {
      const prompt = decisionPrompt(request.decision, source);
      const base = {
        agent: assignment,
        userId: request.run.userId,
        directory,
        beforeStart: request.authorize,
      };
      session = await this.dependencies.execution.open(
        {
          ...base,
          prompt,
          options: acpRunOptions("read_only", DECISION_TIMEOUT_MINUTES),
          instanceId: randomUUID(),
          mcp: null,
          purpose: "decision",
          resourceContext: {
            planId: request.run.planId,
            runId: request.run.id,
            stepId: request.decision.id,
          },
        },
        request.signal,
        OBSERVER,
      );
      const open = session;
      const outcome = await this.answer(request, source, {
        first: () => open.turn,
        correct: (correction) =>
          open.next
            ? open.next(
                { ...base, prompt: correction },
                request.signal,
                OBSERVER,
              )
            : Promise.reject(new AgentError("plan_session_unavailable")),
      });
      const closed = await open.close();
      session = null;
      return closed.isConfirmed
        ? outcome
        : { kind: "failure", code: "plan_closeout_failed" };
    } catch (error: unknown) {
      if (error instanceof AgentPlanCancelledError) throw error;
      logCaughtError("AgentPlanDecisionModel", error);
      return { kind: "failure", code: errorCode(error) };
    } finally {
      await session?.close().catch((error: unknown) => {
        logCaughtError("AgentPlanDecisionModel", error);
      });
      await rm(directory, { recursive: true, force: true });
    }
  }

  /** Reads the answer, lets the model correct an invalid one once, and settles the decision. */
  private async answer(
    request: PlanDecisionRequest,
    source: PlanDecisionSource,
    turns: {
      readonly first: () => Promise<PlanSessionTurn>;
      readonly correct: (prompt: string) => Promise<PlanSessionTurn>;
    },
  ): Promise<SessionOutcome> {
    const { decision } = request;
    const first = await turns.first();
    const firstFailure = turnFailureCode(first);
    if (firstFailure !== null) return { kind: "failure", code: firstFailure };
    let answer = readPlanDecisionAnswer(first.output, decision);
    let isCorrected = false;
    if (!answer.isValid) {
      const second = await turns.correct(
        decisionCorrectionPrompt(decision, answer.problem),
      );
      const secondFailure = turnFailureCode(second);
      if (secondFailure !== null)
        return { kind: "failure", code: secondFailure };
      answer = readPlanDecisionAnswer(second.output, decision);
      isCorrected = true;
    }
    if (!answer.isValid)
      return {
        kind: "settled",
        changes: {
          status: "failed",
          error: "plan_decision_answer_invalid",
          output: answer.problem,
        },
      };
    const yesNo = answer.decision === true ? "true" : "false";
    const branch =
      answer.caseId === undefined ? yesNo : (`case:${answer.caseId}` as const);
    return {
      kind: "settled",
      changes: {
        status: "succeeded",
        branch,
        verdict: {
          decision: answer.decision,
          ...(answer.caseId === undefined ? {} : { caseId: answer.caseId }),
          reason: answer.reason,
          model: decision.model?.model ?? "",
          sourceStepId: source.nodeId,
          ...(source.activation === undefined
            ? {}
            : { sourceActivation: source.activation }),
          isCorrected,
        },
        output: `${String(answer.decision)}: ${answer.reason}`,
        error: null,
      },
    };
  }
}
