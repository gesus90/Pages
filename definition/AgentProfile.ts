import type { AgentConfiguration } from "./AgentConfiguration";

/** Model access and optional reusable task configuration form one agent. */
export const AGENT_PROFILE_PURPOSES = ["chat", "agent"] as const;
export type AgentProfilePurpose = (typeof AGENT_PROFILE_PURPOSES)[number];
export type AgentProfileTargetKind =
  "person" | "group" | "department" | "system";

/** System targets name a function; other targets reference a directory identity. */
export interface AgentProfileTarget {
  readonly kind: AgentProfileTargetKind;
  readonly targetId: string;
}

/** Administrator-managed configuration without credentials or account metadata. */
export interface AgentProfileInput {
  readonly name: string;
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly isActive: boolean;
  readonly purposes: readonly AgentProfilePurpose[];
  readonly targets: readonly AgentProfileTarget[];
  /** Absent only for callers of the A10.1 compatibility API. */
  readonly configuration?: AgentConfiguration;
  /** A supplied revision protects editor saves against stale concurrent changes. */
  readonly revision?: number;
}

export interface AgentProfile extends AgentProfileInput {
  readonly id: string;
  /** Present only on user-created definitions; administrative model grants stay separate. */
  readonly ownerId?: string;
  readonly modelProfileId?: string;
}

/** The user-facing selection deliberately omits assignments and connection metadata. */
export interface AgentProfileChoice {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
}

/** Secret-free directory choices available only within protected administration. */
export interface AgentProfileDirectory {
  readonly persons: readonly { readonly id: string; readonly name: string }[];
  readonly groups: readonly { readonly id: string; readonly name: string }[];
  readonly departments: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}

/** Rejects unknown execution purposes at every external boundary. */
export function isAgentProfilePurpose(
  input: unknown,
): input is AgentProfilePurpose {
  return input === "chat" || input === "agent";
}

/** Narrows stored and external scope kinds without widening authorization targets. */
export function isAgentProfileTargetKind(
  input: unknown,
): input is AgentProfileTargetKind {
  return (
    input === "person" ||
    input === "group" ||
    input === "department" ||
    input === "system"
  );
}
