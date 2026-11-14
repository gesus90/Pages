import { withTurn } from "./AgentPlanSessionRecords";
import { controlledPlanSessionTurn } from "./AgentPlanTurnControl";
import { renderPlanAssignment } from "./AgentPlanContract";
import { sessionStart } from "./sessions/AgentSessionAttempts";

import type {
  PlanSession,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { NodeRun } from "./AgentPlanStepContext";
import type { AgentPlanSessionTerms } from "./AgentPlanStepAssessment";
import type {
  AgentPlanTurnReports,
  PlanTurnAssessment,
} from "./AgentPlanTurnReports";
import type { AgentPlanStepStart } from "./AgentPlanStepStart";
import type { AgentSessionService } from "./sessions/AgentSessionService";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { PlanSessionCloseout } from "./AgentPlanSessionCloseout";

const MAXIMUM_TODO_RETURNS = 3;

interface ContinuationDependencies {
  readonly reports: AgentPlanTurnReports;
  readonly start: Pick<AgentPlanStepStart, "prepare">;
  readonly sessions?: Pick<AgentSessionService, "settle" | "listen">;
  readonly hasDurableLocalSessions?: boolean;
  readonly observer: PlanSessionObserver;
  readonly save: (changes: Partial<AgentPlanSessionRecord>) => Promise<void>;
  readonly close: () => Promise<PlanSessionCloseout>;
}

/**
 * Gives incomplete work back to the same native session, with at most three corrective turns.
 *
 * @returns The final assessment, or `null` when Stop or a timeout ended a turn and its cleanup was recorded.
 */
export async function runPlanTodoTurns(
  input: {
    readonly node: NodeRun;
    readonly session: PlanSession;
    readonly terms: AgentPlanSessionTerms;
  },
  dependencies: ContinuationDependencies,
): Promise<(PlanTurnAssessment & { readonly turn: PlanSessionTurn }) | null> {
  const { node, session } = input;
  let terms = input.terms;
  let turn = await controlledTurn(node, session.turn, dependencies);
  for (;;) {
    if (!turn) return null;
    if (node.record) node.record = withTurn(node.record, turn);
    await dependencies.sessions?.settle(node.record, turn);
    const result = await dependencies.reports.assess(node, turn, terms);
    const assessed = result.assessed;
    await dependencies.save({
      acceptance: assessed?.acceptance ?? null,
      ...(assessed ? { contract: assessed.contract } : {}),
    });
    const open = openTodos(assessed);
    if (
      !assessed ||
      !canContinueTodos({ node, session, turn, assessed }, open.length)
    )
      return { ...result, turn };
    const remaining = open
      .map((todo) => `- ${todo.id}: ${todo.text}`)
      .join("\n");
    if (todoReturnCount(node) >= MAXIMUM_TODO_RETURNS) {
      const acceptance = {
        ...assessed.acceptance,
        issues: [...assessed.acceptance.issues, "todo_returns_exhausted"],
      };
      await dependencies.save({ acceptance });
      return {
        ...result,
        assessed: { ...assessed, acceptance },
        turn,
        output: `${result.output}\n\nOffene TODOs nach drei Rückgaben:\n${remaining}`,
      };
    }
    node.todoReturns = todoReturnCount(node) + 1;
    await dependencies.save({ todoReturns: node.todoReturns });
    terms = { ...terms, contract: assessed.contract };
    turn = await controlledTurn(
      node,
      nextTodoTurn(
        { node, session, terms },
        dependencies,
        open.map((todo) => todo.id),
      ),
      dependencies,
    );
  }
}

async function controlledTurn(
  node: NodeRun,
  pending: Promise<PlanSessionTurn>,
  dependencies: ContinuationDependencies,
): Promise<PlanSessionTurn | null> {
  return controlledPlanSessionTurn(
    node,
    { turn: pending },
    { close: dependencies.close, save: dependencies.save },
  );
}

function canContinueTodos(
  input: {
    readonly node: NodeRun;
    readonly session: PlanSession;
    readonly turn: PlanSessionTurn;
    readonly assessed: NonNullable<PlanTurnAssessment["assessed"]>;
  },
  count: number,
): boolean {
  return (
    count > 0 &&
    input.session.next !== undefined &&
    !input.node.control.signal.aborted &&
    input.turn.permissionDenials === 0 &&
    !input.assessed.acceptance.issues.includes("business_blocked") &&
    // Without any report the agent never said "done": the step retry handles that case.
    !input.assessed.acceptance.issues.includes("report_missing")
  );
}

async function nextTodoTurn(
  input: {
    readonly node: NodeRun;
    readonly session: PlanSession;
    readonly terms: AgentPlanSessionTerms;
  },
  dependencies: ContinuationDependencies,
  open: readonly string[],
): Promise<PlanSessionTurn> {
  const { node, session, terms } = input;
  if (!session.next) throw new Error("Session continuation unavailable");
  const prepared = await dependencies.start.prepare(
    node.run,
    node.snapshot,
    node.step,
  );
  await dependencies.reports.open(node, prepared, terms);
  const assignment = renderPlanAssignment({
    contract: {
      ...terms.contract,
      todos: terms.contract.todos.map((todo) => ({
        ...todo,
        checked: !open.includes(todo.id),
      })),
    },
    usesMcp: true,
    isReadOnly: terms.reach === "read",
    runnerLabel: node.record?.runner ?? "",
    instanceId: node.record?.instanceId ?? "",
    directory: prepared.input.directory ?? "",
    requiresAcceptance: true,
  });
  const nextInput = {
    ...prepared.input,
    prompt: `Der Schritt ist noch nicht fertig. Arbeite die offenen TODOs ab und hake sie über update_step_progress ab. Bereits erledigte TODOs bleiben erledigt.\n${open.map((id) => `- ${id}: ${terms.contract.todos.find((todo) => todo.id === id)?.text ?? ""}`).join("\n")}\n\n${assignment}`,
    recording: node.record
      ? (sessionStart(node, node.record.instanceId) ?? undefined)
      : undefined,
    acceptanceInstruction: terms.instruction,
    resourceContext: {
      runId: node.run.id,
      stepId: node.step.step.id,
      sessionScopeId: node.sessionGroup ?? node.step.step.id,
      isLocalInstruction: true,
    },
    journal:
      dependencies.hasDurableLocalSessions || !node.record
        ? undefined
        : dependencies.sessions?.listen(node, node.record.instanceId),
  };
  return session.next(nextInput, node.control.signal, dependencies.observer);
}

function todoReturnCount(node: NodeRun): number {
  return node.todoReturns ?? node.record?.todoReturns ?? 0;
}

function openTodos(
  assessed: PlanTurnAssessment["assessed"],
): NonNullable<PlanTurnAssessment["assessed"]>["contract"]["todos"] {
  return (
    assessed?.contract.todos.filter((todo) =>
      assessed.acceptance.todos.some(
        (state) => state.id === todo.id && state.status !== "done",
      ),
    ) ?? []
  );
}
