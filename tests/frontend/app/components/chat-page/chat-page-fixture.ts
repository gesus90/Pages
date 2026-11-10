import type {
  VirtualChatDirectory,
  VirtualChatMessage,
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

/** A participant that is an active agent; `overrides` change single fields. */
export function participant(
  id: string,
  overrides: Partial<VirtualParticipant> = {},
): VirtualParticipant {
  return {
    id,
    name: `Name ${id}`,
    kind: "agent",
    role: `Role ${id}`,
    username: `user-${id}`,
    color: null,
    avatarImageUrl: null,
    status: "active",
    unreadCount: 0,
    canChat: true,
    lastActivityAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}

/** A group without members; `overrides` change single fields. */
export function group(
  id: string,
  overrides: Partial<VirtualGroup> = {},
): VirtualGroup {
  return {
    id,
    name: `Group ${id}`,
    description: `About ${id}`,
    memberIds: [],
    unreadCount: 0,
    lastActivityAt: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}

/** A message of the person with the text `text <id>`. */
export function message(id: string): VirtualChatMessage {
  return { id, authorId: null, content: `text ${id}`, toolUses: [] };
}

/** An empty directory; `overrides` fill single parts. */
export function directory(
  overrides: Partial<VirtualChatDirectory> = {},
): VirtualChatDirectory {
  return {
    participants: [],
    groups: [],
    histories: {},
    contactChoices: [],
    ...overrides,
  };
}
