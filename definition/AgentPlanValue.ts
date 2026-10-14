import type { AgentPlanParameter } from "./AgentPlan";

function hasFiniteNumbers(input: unknown): boolean {
  const pending: unknown[] = [input];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "number" && !Number.isFinite(current)) return false;
    if (current !== null && typeof current === "object")
      for (const entry of Object.values(current)) pending.push(entry);
  }
  return true;
}

/** Checks a single value without evaluating expressions or expanding JSON objects into fields. */
export function planValueIssue(
  parameter: Pick<AgentPlanParameter, "format" | "value">,
): "number" | "json" | null {
  if (parameter.value.type === "number")
    return Number.isFinite(parameter.value.number) ? null : "number";
  if (parameter.value.type !== "text" || parameter.format === "string")
    return null;
  try {
    const parsed: unknown = JSON.parse(parameter.value.text);
    if (!hasFiniteNumbers(parsed)) return parameter.format;
    if (parameter.format === "number" && typeof parsed !== "number")
      return "number";
    return null;
  } catch {
    return parameter.format;
  }
}
