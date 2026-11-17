import type { OpenedConversation } from "./use-chat-page";
import type {
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

/**
 * The chat sessions of a participant's chat: the session of an agent in its
 * direct chat with the person; a person has none.
 */
export function participantSessionIds(
  participant: Pick<VirtualParticipant, "session">,
): readonly string[] {
  return participant.session ? [participant.session.sessionId] : [];
}

/** The chat sessions of a group: one for each agent that works in it. */
export function groupSessionIds(
  group: Pick<VirtualGroup, "agentSessions">,
): readonly string[] {
  return (group.agentSessions ?? []).map((session) => session.sessionId);
}

/** The chat sessions of the open chat, which decide which browsers it shows. */
export function openedSessionIds(
  opened: OpenedConversation,
): readonly string[] {
  return opened.kind === "group"
    ? groupSessionIds(opened.group)
    : participantSessionIds(opened.participant);
}
