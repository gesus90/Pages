import { nativeAcpProvider } from "@/definition/AgentConfiguration";

import type { AgentProviderId } from "@/definition/AgentConnection";

const NATIVE_PROGRESS_LINES = [
  "- At the start of your assignment, create a list of concrete, verifiable tasks with your built-in task list tool. Reuse the list while continuing the same work. Keep exactly one task in progress while working.",
  "- Update the list immediately when work progresses, changes or is blocked. Name the blocker on the affected task. During long work, update the list at least every 5 minutes, even if nothing changed.",
  "- Before returning the result or closing the step, update the list one last time. Leave unfinished tasks open and name each one with its reason in the final answer.",
] as const;

/** Selects native progress instructions for an ACP runner and its plan permission mode. */
export function nativePlanProgressInstructions(context: {
  readonly provider: AgentProviderId;
  readonly isReadOnly: boolean;
}): readonly string[] {
  const runner = nativeAcpProvider(context.provider);
  if (runner === null || (context.isReadOnly && runner !== "codex_cli"))
    return [];
  return NATIVE_PROGRESS_LINES;
}
