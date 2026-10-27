import { readAgentObject } from "./AgentPayload";
import { readPlanText } from "./AgentPlanInput";

/** Extracts node-to-ticket bindings from a private run snapshot without exposing prompts or host paths. */
export function readPlanStepTickets(
  input: unknown,
): Readonly<Record<string, readonly string[]>> {
  const snapshot = readAgentObject(input);
  const result: Record<string, readonly string[]> = {};
  const steps: readonly unknown[] = Array.isArray(snapshot.steps)
    ? snapshot.steps
    : [];
  for (const entry of steps) {
    const step = readAgentObject(entry);
    const node = readAgentObject(step.step);
    if (typeof node.id !== "string") continue;
    const ids: readonly unknown[] = Array.isArray(step.taskIds)
      ? step.taskIds
      : [];
    const prepared = readAgentObject(step.prepared);
    const values = readAgentObject(readAgentObject(prepared.parameters).values);
    const bound = Object.values(values).flatMap((inputValue) => {
      if (inputValue === null) return [];
      const parameter = readAgentObject(inputValue);
      return parameter.type === "ticket"
        ? [readPlanText(parameter.ticketId)]
        : [];
    });
    result[readPlanText(node.id)] = [
      ...new Set([...ids.map((id) => readPlanText(id)), ...bound]),
    ];
  }
  const remote: readonly unknown[] = Array.isArray(snapshot.remoteSteps)
    ? snapshot.remoteSteps
    : [];
  for (const entry of remote) {
    const step = readAgentObject(entry);
    const node = readAgentObject(step.step);
    if (node.type !== "agent") continue;
    const parameters = readAgentObject(step.parameters);
    result[readPlanText(node.id)] = Object.keys(
      readAgentObject(parameters.tickets),
    );
  }
  return result;
}
