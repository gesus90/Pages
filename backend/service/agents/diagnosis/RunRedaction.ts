import type {
  AgentPlanRun,
  AgentPlanStepActivation,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

/** The kinds of content a reader may lack the right to see. */
export type HiddenContentSource = "tickets" | "wiki" | "workspaces";

/**
 * The fields of a run view that carry content of tickets, pages or workspaces.
 *
 * @remarks
 * They are named in `hiddenFields` of every read result when the reader may
 * not see the content a run used. Status, times, errors and attempts stay.
 */
export const RUN_CONTENT_FIELDS = [
  "steps.output",
  "steps.report",
  "steps.progress",
  "steps.session.events",
  "steps.session.contract",
  "steps.session.acceptance",
  "steps.script.stdout",
  "steps.script.stderr",
  "steps.verdict",
  "steps.stack",
  "steps.resourceAccess",
  "steps.assetFailure",
  "stacks",
] as const;

function hideSession(session: AgentPlanSessionRecord): AgentPlanSessionRecord {
  const { activity: hiddenActivity, ...rest } = session;
  void hiddenActivity;
  return { ...rest, events: [], contract: null, acceptance: null };
}

function hideActivation(
  activation: AgentPlanStepActivation,
): AgentPlanStepActivation {
  const { verdict: hiddenVerdict, ...rest } = activation;
  void hiddenVerdict;
  return { ...rest, output: null };
}

/**
 * Removes the content from one step result.
 *
 * @param step - The stored step.
 * @returns The step with status, times, error, attempts and retry state, but
 * without result text, reports, acceptance, journal lines and script output.
 */
export function hideStepContent(
  step: AgentPlanStepResult,
  ticketSteps: ReadonlySet<string> = new Set(),
): AgentPlanStepResult {
  const {
    report: hiddenReport,
    progress: hiddenProgress,
    verdict: hiddenVerdict,
    stack: hiddenStack,
    resourceAccess: hiddenAccess,
    assetFailure: hiddenAsset,
    ...rest
  } = step;
  void [
    hiddenReport,
    hiddenProgress,
    hiddenVerdict,
    hiddenStack,
    hiddenAccess,
    hiddenAsset,
  ];
  return {
    ...rest,
    // A step bound to a ticket is named after it, which the reader may not see.
    ...(ticketSteps.has(step.id) ? { name: step.id } : {}),
    output: null,
    ...(step.session ? { session: hideSession(step.session) } : {}),
    ...(step.script
      ? { script: { ...step.script, stdout: null, stderr: "" } }
      : {}),
    ...(step.history ? { history: step.history.map(hideActivation) } : {}),
    isDisplayFiltered: true,
  };
}

function hideLoop(
  loop: AgentPlanLoopRun,
  ticketSteps: ReadonlySet<string>,
): AgentPlanLoopRun {
  return {
    ...loop,
    iterations: loop.iterations.map((iteration) => ({
      ...iteration,
      nodes: iteration.nodes.map((node) => hideStepContent(node, ticketSteps)),
    })),
  };
}

/**
 * Removes the content from a run the reader may not see in full.
 *
 * @param run - The stored run.
 * @param ticketSteps - The steps bound to tickets, whose names are hidden too.
 * @returns The run readable as a diagnosis: who started it, when, what
 * happened to which step and why it failed, without any ticket, page or
 * workspace content.
 */
export function hideRunContent(
  run: AgentPlanRun,
  ticketSteps: ReadonlySet<string> = new Set(),
): AgentPlanRun {
  const { stacks: hiddenStacks, ...rest } = run;
  void hiddenStacks;
  return {
    ...rest,
    steps: run.steps.map((step) => hideStepContent(step, ticketSteps)),
    ...(run.loops
      ? { loops: run.loops.map((loop) => hideLoop(loop, ticketSteps)) }
      : {}),
  };
}

/** The names of the fields {@link hideRunContent} leaves out. */
export function hiddenContentFields(
  ticketSteps: ReadonlySet<string>,
): readonly string[] {
  return ticketSteps.size > 0
    ? [...RUN_CONTENT_FIELDS, "steps.name"]
    : RUN_CONTENT_FIELDS;
}
