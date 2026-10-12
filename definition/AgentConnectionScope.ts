/** Who may use the models offered through one connection. */
export const AGENT_CONNECTION_SCOPE_MODES = ["global", "restricted"] as const;
export type AgentConnectionScopeMode =
  (typeof AGENT_CONNECTION_SCOPE_MODES)[number];

/** Directory identities a restricted scope can name; a system function is not one. */
export const AGENT_CONNECTION_SCOPE_KINDS = [
  "person",
  "group",
  "department",
] as const;
export type AgentConnectionScopeKind =
  (typeof AGENT_CONNECTION_SCOPE_KINDS)[number];

export interface AgentConnectionScopeTarget {
  readonly kind: AgentConnectionScopeKind;
  readonly targetId: string;
}

/**
 * The usage scope of a system-wide connection.
 *
 * @remarks
 * `global` admits every active account and carries no targets. `restricted`
 * admits the named persons and the current members of the named groups and
 * departments; one match is enough. Membership is read at every check, never
 * copied into the scope.
 */
export interface AgentConnectionScope {
  readonly mode: AgentConnectionScopeMode;
  readonly targets: readonly AgentConnectionScopeTarget[];
}

/** The scope every connection had before scopes existed. */
export const GLOBAL_CONNECTION_SCOPE: AgentConnectionScope = {
  mode: "global",
  targets: [],
};

/**
 * The scope of a connection that has no stored mode.
 *
 * @remarks
 * Migration and creation always store a mode, so this only guards against a
 * hand-edited database: nobody may use the connection until an administrator
 * chooses a scope, instead of everybody.
 */
export const UNSET_CONNECTION_SCOPE: AgentConnectionScope = {
  mode: "restricted",
  targets: [],
};

/** Narrows stored and external mode names. */
export function isAgentConnectionScopeMode(
  value: unknown,
): value is AgentConnectionScopeMode {
  return AGENT_CONNECTION_SCOPE_MODES.some((mode) => mode === value);
}

/** Narrows stored and external target kinds; a system function is rejected. */
export function isAgentConnectionScopeKind(
  value: unknown,
): value is AgentConnectionScopeKind {
  return AGENT_CONNECTION_SCOPE_KINDS.some((kind) => kind === value);
}
