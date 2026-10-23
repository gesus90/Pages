import { withoutTicketFlow } from "@/definition/AgentPlanGraph";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { readPlanInput } from "./AgentPlanInput";

const PLAN_METADATA = ["id", "ownerId", "departmentId"];

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function requireKnownFields(stored: unknown, parsed: unknown): void {
  if (Array.isArray(stored) && Array.isArray(parsed)) {
    if (stored.length !== parsed.length)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "plan_schema_unsupported",
      });
    stored.forEach((entry: unknown, index) =>
      requireKnownFields(entry, parsed[index]),
    );
    return;
  }
  if (!isRecord(stored) || !isRecord(parsed)) return;
  for (const [key, entry] of Object.entries(stored)) {
    if (Object.hasOwn(parsed, key)) {
      requireKnownFields(entry, parsed[key]);
      continue;
    }
    if (key === "completion" && entry === "report" && parsed.type === "agent")
      continue;
    if (key === "kind" && entry === "flow" && "from" in parsed) continue;
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "plan_schema_unsupported",
    });
  }
}

/** Refuses unknown persisted structure before the normal reader can discard fields during duplication. */
export function requireCloneablePlan(input: unknown): void {
  if (!isRecord(input))
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "plan_schema_unsupported",
    });
  const content = Object.fromEntries(
    Object.entries(input).filter(([key]) => !PLAN_METADATA.includes(key)),
  );
  const parsed = readPlanInput(content);
  requireKnownFields(content, parsed);
  if (withoutTicketFlow(parsed).edges.length !== parsed.edges.length)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "plan_schema_unsupported",
    });
}
