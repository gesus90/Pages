import type {
  AgentProfileDetail,
  AgentProfileList,
} from "@/definition/AgentProfileRead";

/** Narrows an endpoint answer to the list of agent profiles. */
export function isAgentProfileList(value: unknown): value is AgentProfileList {
  return (
    typeof value === "object" &&
    value !== null &&
    "agents" in value &&
    Array.isArray(value.agents) &&
    "total" in value
  );
}

/** Narrows an endpoint answer to one agent profile. */
export function isAgentProfileDetail(
  value: unknown,
): value is AgentProfileDetail {
  return (
    typeof value === "object" &&
    value !== null &&
    "load" in value &&
    "displayName" in value &&
    "hiddenFields" in value
  );
}
