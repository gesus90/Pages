import { nativeAcpProvider } from "@/definition/AgentConfiguration";

import type { NativeAcpProviderId } from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";

/** Where the agent keeps its own work list, as the list rules name it. */
export interface AgentWorkListTarget {
  /** The tool or field the list is sent with, as Markdown. */
  readonly tool: string;
  /** How an entry that failed or was interrupted is marked with that tool. */
  readonly failure: string;
  /** How many tickets the node is bound to; 0 for a fixed assignment. */
  readonly ticketCount: number;
}

/**
 * The content rules of the agent's own work list, the same for every way it is reported.
 * @remarks
 * The terminal shows the node name and the ticket title as the heading of the
 * list, so an entry has to name a concrete step; a generic entry such as the
 * node name would repeat the heading and say nothing about the work.
 */
export function workListLines(target: AgentWorkListTarget): readonly string[] {
  return [
    `- First, before you run a command or change a file, send your own list of concrete work steps with ${target.tool}: every entry open, only the first one in progress. Each entry names one verifiable action and what it acts on, such as "Fix the retry limit in RunQueue.ts" or "Run the import script with the sample file and compare the output". Never use a generic entry such as "Work on the ticket", "Implement the task" or the name of the node: the node name and the ticket title already stand above the list. Never add an entry for the closing report: Pages checks the list when you report, so every entry must be done by then.`,
    target.ticketCount === 0
      ? "- Derive the steps from the instruction above. Take over an explicit checklist or numbered list of steps of the instruction one to one and in its order. A simple single task needs exactly one concrete entry."
      : `- Read the ticket first and build its list from its goal, requirements and acceptance criteria: one entry per necessary piece of work or required check. Every ticket gets its own list from its own content; never carry over the list of another ticket.${target.ticketCount > 1 ? " Several tickets are bound: begin each entry with the key of its ticket." : ""}`,
    "- After each finished entry, send the complete list again at once: that entry done, the next one in progress. Do this before you begin the next entry, even when the entry took a single command; never collect several finished entries for one later update.",
    `- Every update carries the complete list; it replaces the previous one. Add newly found necessary steps to the same list instead of starting a new one. Keep exactly one entry in progress. Mark an entry done only when its work is executed or its required check is proven. ${target.failure}`,
  ];
}

/** The work list of a session without Pages MCP lives in the runner's own task list tool. */
const NATIVE_TARGET = {
  tool: "your built-in task list tool (Codex: `update_plan`)",
  failure:
    "Leave an entry that failed or was interrupted open and name the reason in its text.",
} as const;

const NATIVE_PROGRESS_LINES = [
  "- Reuse the list while continuing the same work. Update it immediately when work progresses, changes or is blocked. Name the blocker on the affected entry. During long work, update the list at least every 5 minutes, even if nothing changed.",
  "- Before returning the result or closing the step, update the list one last time. Leave unfinished entries open and name each one with its reason in the final answer.",
] as const;

/** The native work list rules and the remaining progress rules of an ACP runner. */
export interface NativeProgressInstructions {
  /** The rules of the agent's own work list; empty when the runner keeps none. */
  readonly workList: readonly string[];
  /** How the list is kept up to date and closed; empty with the work list. */
  readonly progress: readonly string[];
}

/**
 * Whether the ACP session of a runner offers a built-in task list that reaches Pages as a structured plan.
 * @remarks
 * `agy acp` offers no task list tool at all: told to use one, Antigravity kept
 * no list and sent no plan update. With Pages MCP it keeps its list in
 * `update_step_progress` like every runner. OpenCode's `todowrite` stays
 * allowed in "Lesend", and Pages reads its calls as the plan.
 */
function hasNativeTaskList(
  runner: NativeAcpProviderId,
  isReadOnly: boolean,
): boolean {
  if (runner === "antigravity") return false;
  return !isReadOnly || runner === "codex_cli" || runner === "opencode";
}

/** Selects the native work list and progress rules for an ACP runner and its plan permission mode. */
export function nativeProgressInstructions(context: {
  readonly provider: AgentProviderId;
  readonly isReadOnly: boolean;
  /** How many tickets the node is bound to; absent for an assignment without tickets. */
  readonly ticketCount?: number;
}): NativeProgressInstructions {
  const runner = nativeAcpProvider(context.provider);
  if (runner === null || !hasNativeTaskList(runner, context.isReadOnly))
    return { workList: [], progress: [] };
  return {
    workList: workListLines({
      ...NATIVE_TARGET,
      ticketCount: context.ticketCount ?? 0,
    }),
    progress: NATIVE_PROGRESS_LINES,
  };
}

/** Selects native progress instructions for an ACP runner and its plan permission mode. */
export function nativePlanProgressInstructions(context: {
  readonly provider: AgentProviderId;
  readonly isReadOnly: boolean;
  /** How many tickets the node is bound to; absent for an assignment without tickets. */
  readonly ticketCount?: number;
}): readonly string[] {
  const { workList, progress } = nativeProgressInstructions(context);
  return [...workList, ...progress];
}
