import type { AgentPlanBinding, AgentPlanRun } from "@/definition/AgentPlan";

/**
 * The text a value of an earlier outgoing Jump gives an input that takes text.
 * @param run - The run whose Jump handed the value on.
 * @param binding - The port binding of the input.
 * @returns The value as text; empty while the Jump has not succeeded or does not hold the value.
 * @remarks
 * Text stays as it is and a number is written out. References are never
 * turned into text, so an input that reads one gets nothing instead of a guess.
 */
export function portText(
  run: Pick<AgentPlanRun, "steps">,
  binding: Extract<AgentPlanBinding, { kind: "port" }>,
): string {
  const source = run.steps.find((step) => step.id === binding.nodeId);
  const value =
    source?.status === "succeeded"
      ? source.jumpOutputs?.[binding.port]
      : undefined;
  if (value?.type === "text") return value.text;
  return value?.type === "number" ? String(value.number) : "";
}
