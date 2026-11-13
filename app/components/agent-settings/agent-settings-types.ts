import type { AgentChatKind } from "@/definition/AgentChatSession";

/**
 * The chat a person opened the popup from, so its row stands out in the table.
 *
 * @remarks
 * A chat is named by its kind and ID: the ID of the group's conversation, or
 * of the person of a direct chat. A caller that does not know that ID, such
 * as the head of a direct chat with an agent, names the session instead.
 */
export type AgentSettingsCurrentChat =
  | { readonly kind: AgentChatKind; readonly id: string }
  | { readonly sessionId: string };

/** What the head of the popup shows of the agent before the sessions arrive. */
export interface AgentSettingsIdentity {
  readonly name: string;
  /** Role or model line under the name; left out when empty. */
  readonly subtitle?: string;
  /** The person color as `#rrggbb`. */
  readonly color?: string | null;
  readonly avatarImageUrl?: string | null;
}
