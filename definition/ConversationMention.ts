/** A visible group or department that can address agent members of a chat. */
export interface ConversationMentionAlias {
  readonly name: string;
  readonly memberIds: readonly string[];
  readonly kind: "group" | "department";
}

/** An identity the mention picker and message renderer can name. */
export interface ConversationMentionMember {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly kind: "agent" | "human";
  readonly role: string;
  readonly color?: string | null;
  readonly avatarImageUrl?: string | null;
}

/** Server-filtered mention choices of the signed-in account. */
export interface ConversationMentionDirectory {
  readonly selfId: string;
  readonly members: readonly ConversationMentionMember[];
  readonly aliases: readonly ConversationMentionAlias[];
}

/** Canonical spelling used by group and department aliases. */
export function conversationAliasName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

/** Reserved aliases address every agent of the current conversation. */
export const CONVERSATION_ALL_ALIASES: readonly string[] = [
  "alle",
  "all",
  "team",
];
