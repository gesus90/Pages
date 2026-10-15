/** Runtime values are supplied by the server, never by parameter bindings. */
export interface AgentRunContext {
  readonly notes: string;
}

/** Shared by the scanner, binder, editor hints and preview. */
export const AGENT_RUN_BUILTINS = {
  "@run.notes": {
    contextKey: "notes",
    hintKey: "settings.agents.definition.runNotesHint",
  },
} as const;

export type AgentRunBuiltin = keyof typeof AGENT_RUN_BUILTINS;

/** A separate namespace preserves all previously valid parameter accesses. */
export function isAgentRunBuiltin(token: string): token is AgentRunBuiltin {
  return Object.hasOwn(AGENT_RUN_BUILTINS, token);
}

/** A located built-in does not declare or create a parameter port. */
export interface AgentBuiltinPlaceholder {
  readonly token: AgentRunBuiltin;
  readonly start: number;
  readonly end: number;
}
