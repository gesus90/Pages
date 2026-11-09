import { AgentError } from "@/backend/error/AgentErrors";
import { currentPlanStackEntry } from "@/definition/AgentPlanStack";

import { planStackRunOf } from "./AgentPlanStackTrigger";

import type { AgentParameterValue } from "@/definition/AgentParameters";
import type {
  AgentPlan,
  AgentPlanBinding,
  AgentPlanRun,
} from "@/definition/AgentPlan";
import type { AgentPlanStackEntry } from "@/definition/AgentPlanStack";
import type { AgentPlanTaskSnapshot } from "../AgentPlanBindings";
import type { AgentPlanScriptSnapshot } from "../AgentPlanScriptPreparation";
import type { AgentPlanStepSnapshot } from "../AgentPlanSnapshot";
import type { AgentPlanTasks } from "../AgentPlanTasks";

/** What resolving the content of a stack needs: the frozen plan, the run and a ticket read with the executor's rights. */
export interface PlanStackInputContext {
  readonly plan: AgentPlan;
  readonly run: Pick<AgentPlanRun, "stacks">;
  readonly readTask: (taskId: string) => Promise<AgentPlanTaskSnapshot>;
}

type StackBinding = Extract<AgentPlanBinding, { kind: "stack" }>;

function stackBindings(
  bindings: Readonly<Record<string, AgentPlanBinding>>,
): readonly (readonly [string, StackBinding])[] {
  return Object.entries(bindings).flatMap(([name, binding]) =>
    binding.kind === "stack" && binding.output === "content"
      ? [[name, binding] as const]
      : [],
  );
}

/**
 * The entry the newest trigger of the stack handed over.
 *
 * @throws {AgentError} `plan_stack_content_missing` before the first trigger
 * and after a trigger that found the stack used up; an earlier entry is never
 * handed over again.
 */
function currentEntry(
  binding: StackBinding,
  context: PlanStackInputContext,
): AgentPlanStackEntry {
  const stack = context.plan.nodes.find((node) => node.id === binding.stackId);
  if (stack?.type !== "stack") throw new AgentError("plan_binding_invalid");
  const entry = currentPlanStackEntry(
    stack,
    planStackRunOf(context.run, stack.id),
  );
  if (!entry) throw new AgentError("plan_stack_content_missing");
  return entry;
}

/**
 * The ticket the newest trigger of a stack handed over, for a node that needs the ticket itself.
 *
 * @throws {AgentError} `plan_binding_invalid` for an entry that is no ticket.
 */
export function planStackTicketId(
  binding: StackBinding,
  context: Pick<PlanStackInputContext, "plan" | "run">,
): string {
  const entry = currentEntry(binding, { ...context, readTask: noTaskRead });
  if (entry.type !== "task") throw new AgentError("plan_binding_invalid");
  return entry.taskId;
}

function noTaskRead(): Promise<AgentPlanTaskSnapshot> {
  return Promise.reject(new AgentError("plan_binding_invalid"));
}

/** The value of an entry for a parameter: the ticket itself, its text, the file, or the entry's own value. */
async function entryValue(
  entry: AgentPlanStackEntry,
  parameterType: string | undefined,
  context: PlanStackInputContext,
): Promise<AgentParameterValue> {
  if (entry.type === "parameter") return entry.value;
  if (entry.type === "asset") {
    if (parameterType !== "asset") throw new AgentError("plan_binding_invalid");
    return { type: "asset", assetId: entry.file.assetId };
  }
  if (parameterType === "ticket")
    return { type: "ticket", ticketId: entry.taskId };
  const task = await context.readTask(entry.taskId);
  return { type: "text", text: task.markdown };
}

/**
 * The node an agent runs with the content of the stacks it reads.
 *
 * @param step - The frozen node, whose stack inputs still hold a stand-in.
 * @param context - The plan, the run and the ticket read.
 * @returns The node with each content input set to the entry the newest
 * trigger handed over. A ticket entry also joins the node's tickets, so the
 * run contract lists its todos and criteria and the agent may work on it,
 * within the rights the executor already has.
 */
export async function planStackStepInput(
  step: AgentPlanStepSnapshot,
  context: PlanStackInputContext,
): Promise<AgentPlanStepSnapshot> {
  const bound = stackBindings(step.step.bindings);
  if (bound.length === 0) return step;
  const values: Record<string, AgentParameterValue | null> = {
    ...step.prepared.parameters.values,
  };
  const taskIds = [...step.taskIds];
  for (const [name, binding] of bound) {
    const entry = currentEntry(binding, context);
    const declared = step.template.parameters.find(
      (parameter) => parameter.name === name,
    );
    values[name] = await entryValue(entry, declared?.type, context);
    if (entry.type === "task" && !taskIds.includes(entry.taskId))
      taskIds.push(entry.taskId);
  }
  // The preparation saw only the first entry; the files of this entry are read when the node starts.
  const boundNames = new Set(bound.map(([name]) => name));
  const assetInputs = step.prepared.parameters.assetInputs?.filter(
    (input) => !boundNames.has(input.parameter),
  );
  return {
    ...step,
    taskIds,
    prepared: {
      ...step.prepared,
      parameters: {
        ...step.prepared.parameters,
        values,
        ...(assetInputs ? { assetInputs } : {}),
      },
    },
  };
}

/**
 * The script a node runs with the content of the stacks it reads, as text inputs.
 *
 * @remarks
 * A ticket entry reaches a script as the ticket's text, a value entry as its
 * text or number.
 */
export async function planStackScriptInput(
  script: AgentPlanScriptSnapshot,
  context: PlanStackInputContext,
): Promise<AgentPlanScriptSnapshot> {
  const bound = stackBindings(script.step.bindings);
  if (bound.length === 0) return script;
  const inputs: Record<string, string> = { ...script.inputs };
  const taskIds = [...script.taskIds];
  for (const [name, binding] of bound) {
    const entry = currentEntry(binding, context);
    const value = await entryValue(entry, "text", context);
    inputs[name] =
      value.type === "number" ? String(value.number) : textOf(value);
    if (entry.type === "task" && !taskIds.includes(entry.taskId))
      taskIds.push(entry.taskId);
  }
  return { ...script, inputs, taskIds };
}

function textOf(value: AgentParameterValue): string {
  if (value.type === "text") return value.text;
  throw new AgentError("plan_binding_invalid");
}

/**
 * The node an agent of a run starts with: its stack inputs set to the handed-over entries.
 *
 * @param node - The run, snapshot and node of one start.
 * @param tasks - The ticket reads of the executor; without `snapshot` a ticket
 * handed to a text input fails the start.
 */
export function planStackNodeInput(
  node: {
    readonly run: AgentPlanRun;
    readonly snapshot: { readonly plan: AgentPlan };
    readonly step: AgentPlanStepSnapshot;
  },
  tasks: Partial<Pick<AgentPlanTasks, "snapshot">>,
): Promise<AgentPlanStepSnapshot> {
  return planStackStepInput(node.step, {
    plan: node.snapshot.plan,
    run: node.run,
    readTask: async (taskId) => {
      if (!tasks.snapshot) throw new AgentError("plan_binding_invalid");
      return tasks.snapshot(
        node.run.userId,
        node.snapshot.plan.projectId,
        taskId,
      );
    },
  });
}
