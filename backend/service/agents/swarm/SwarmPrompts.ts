import type {
  AgentPlanSwarmRun,
  AgentPlanSwarmTaskView,
} from "@/definition/AgentPlanSwarmRun";

/** What the main model gets once, when its session starts. */
export interface SwarmMainPromptInput {
  readonly task: string;
  readonly instruction: string | null;
  readonly view: AgentPlanSwarmRun;
  /** Whether the board comes from an earlier run that is resumed. */
  readonly isResumed: boolean;
}

function workerLines(view: AgentPlanSwarmRun): string {
  return view.workers
    .map(
      (worker) =>
        `- ${worker.id}: ${worker.provider} · ${worker.model} · ${worker.access}`,
    )
    .join("\n");
}

function boardLines(view: AgentPlanSwarmRun): string {
  if (view.tasks.length === 0) return "No subtask was handed out yet.";
  return view.tasks
    .map(
      (task) =>
        `- ${task.id} [${task.status}] ${task.scope.join(", ") || "no area"}: ${task.instruction.slice(0, 300)}${task.result ? `\n  Result: ${task.result.slice(0, 500)}` : ""}`,
    )
    .join("\n");
}

/**
 * The first prompt of the main model.
 *
 * @remarks
 * It names the helpers, the tools and the rules. A resumed run adds the
 * stored board: finished subtasks keep their results and run never again.
 */
export function swarmMainPrompt(input: SwarmMainPromptInput): string {
  return [
    "You are the main model of a Pages swarm node. Split the task below into subtasks, hand them to your helpers, watch them, handle failures and sum up.",
    "",
    "## Task",
    input.task,
    ...(input.instruction
      ? ["", "## Additional instruction", input.instruction]
      : []),
    "",
    "## Helpers",
    workerLines(input.view),
    "",
    "## Tools",
    "- swarm_assign: hand a subtask to a given helper or the next free one, optionally with an area of responsibility (paths or directories). Areas of subtasks that run at the same time must not overlap; an overlap is refused.",
    "- swarm_status: the state of every helper and subtask, TODOs and held locks. It returns at once; with waitSeconds it returns at the next change at the latest after that time.",
    "- swarm_result: the result of one subtask.",
    "- swarm_cancel: cancel a subtask.",
    "- swarm_finish: end the node with a summary, as succeeded or failed. Nothing ends the node without it.",
    "",
    "## Rules",
    "- Helpers do not commit. Commit yourself at the end if the task asks for it.",
    "- A helper that failed or did not start gives you its error. Hand the subtask out again (at most three times), split it differently or go on without it.",
    "- Pages reports changes outside the areas and locks of the helpers as violations with their files. Decide what to do with them.",
    '- When no helper starts, do the task yourself or end with swarm_finish as failed with the reason "no helper capacity".',
    ...(input.isResumed
      ? [
          "",
          "## Resumed run",
          "This run resumes after an interruption. Finished subtasks keep their results and must not run again; open subtasks went back on the board and their locks are free.",
          boardLines(input.view),
        ]
      : []),
  ].join("\n");
}

/** The prompt that wakes the main model again after its turn ended without `swarm_finish`. */
export function swarmMainReminder(view: AgentPlanSwarmRun): string {
  return [
    "The swarm has not ended yet. Current board:",
    boardLines(view),
    "",
    "Hand out further subtasks, wait for running ones with swarm_status, or end the node with swarm_finish.",
  ].join("\n");
}

/** The prompt of one subtask for a helper. */
export function swarmWorkerPrompt(input: {
  readonly workerId: string;
  readonly task: AgentPlanSwarmTaskView;
  readonly instruction: string | null;
}): string {
  const { task } = input;
  return [
    `You are helper ${input.workerId} of a Pages swarm. Work on this subtask and answer with its result.`,
    "",
    `## Subtask ${task.id}`,
    task.instruction,
    ...(input.instruction
      ? ["", "## Shared instruction", input.instruction]
      : []),
    "",
    "## Rules",
    task.scope.length > 0
      ? `- You may write only in your area: ${task.scope.join(", ")}.`
      : "- You have no area: lock every file before you change it.",
    "- Before you change a file outside your area, lock it with swarm_lock. It answers at once; if another helper holds it, do something else first and try again later. Release it with swarm_unlock. swarm_locks lists who holds which lock.",
    "- Reading needs no lock.",
    "- Never commit, never change the Git index or HEAD.",
    "- End with a short result of what you did and found.",
  ].join("\n");
}
