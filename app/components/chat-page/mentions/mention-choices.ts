import { CONVERSATION_ALL_ALIASES } from "@/definition/ConversationMention";

import type { ConversationMentionDirectory } from "@/definition/ConversationMention";

/** One picker row; unavailable identities explain their disabled state. */
export interface MentionChoice {
  readonly key: string;
  readonly name: string;
  readonly username: string;
  readonly alternatives: readonly string[];
  readonly section: "aliases" | "members" | "outside";
  readonly role: string;
  readonly color?: string | null;
  readonly avatarImageUrl?: string | null;
  readonly count: number;
  readonly isSelectable: boolean;
}

/** Builds only aliases visible on the server and only recipients of this conversation. */
export function mentionChoices(
  directory: ConversationMentionDirectory,
  memberIds: readonly string[],
): MentionChoice[] {
  const agents = directory.members.filter(
    (member) => memberIds.includes(member.id) && member.kind === "agent",
  );
  const all: MentionChoice = {
    key: "all",
    name: "@alle",
    username: "alle",
    alternatives: ["all", "team"],
    section: "aliases",
    role: "",
    count: agents.length,
    isSelectable: agents.length > 0,
  };
  const aliases = directory.aliases.map((alias): MentionChoice => ({
    key: `${alias.kind}:${alias.name}`,
    name: `@${alias.name}`,
    username: alias.name,
    alternatives: [],
    section: "aliases",
    role: alias.kind,
    count: agents.filter((member) => alias.memberIds.includes(member.id))
      .length,
    isSelectable: agents.some((member) => alias.memberIds.includes(member.id)),
  }));
  const members = directory.members
    .filter((member) => member.id !== directory.selfId)
    .map((member): MentionChoice => ({
      key: member.id,
      name: member.name,
      username: member.username,
      alternatives: [],
      section: memberIds.includes(member.id) ? "members" : "outside",
      role: member.role,
      color: member.color,
      avatarImageUrl: member.avatarImageUrl,
      count: 0,
      isSelectable: memberIds.includes(member.id),
    }));
  return [
    all,
    ...aliases,
    ...members.filter((entry) => entry.isSelectable),
    ...members.filter((entry) => !entry.isSelectable),
  ];
}

/** Filters names, canonical handles and alternate spellings together. */
export function filterMentionChoices(
  choices: readonly MentionChoice[],
  query: string,
): MentionChoice[] {
  const needle = query.toLowerCase();
  return choices.filter((choice) =>
    [choice.name, choice.username, ...choice.alternatives].some((name) =>
      name.toLowerCase().includes(needle),
    ),
  );
}

/** The current partial handle and the length the editor replaces. */
export interface MentionToken {
  readonly query: string;
  readonly length: number;
}

/** The active @ token, excluding emails. Code exclusions belong to the editor query. */
export function activeMention(text: string): MentionToken | null {
  const match = /(?:^|\s)@([\p{L}\p{N}._-]{0,100})$/u.exec(text);
  return match ? { query: match[1], length: match[1].length + 1 } : null;
}

/** Recognizes reserved collective mentions independently of language. */
export function isAllMention(name: string): boolean {
  return CONVERSATION_ALL_ALIASES.includes(name.toLowerCase());
}
