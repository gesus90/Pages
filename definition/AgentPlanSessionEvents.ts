import type {
  AgentSessionEventPage,
  AgentSessionKey,
} from "./AgentSessionEvents.js";

/** Shared bounds for legacy attempt keys and MCP event windows. */
export const AGENT_PLAN_SESSION_READ_LIMITS = {
  attemptIdLength: 300,
  eventPage: 32,
  defaultEventPage: 16,
} as const;

/** Retained events of one authorized attempt, with additional display filtering made explicit. */
export interface AgentPlanSessionEvents {
  readonly key: AgentSessionKey;
  readonly history: AgentSessionEventPage;
  readonly isFiltered: boolean;
}
