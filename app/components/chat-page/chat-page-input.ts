import type { VirtualChatSelection } from "@/definition/VirtualChat";
import type { OpenedConversation } from "./use-chat-page";
import type { VoiceSending } from "./use-voice-sending";

/** The files the input of an opened chat takes. */
export interface ComposerAttachments {
  readonly selection: VirtualChatSelection;
  /**
   * The direct chat with an agent: its files go into the agent's chat
   * session, with its own types, size limit and no preview images.
   */
  readonly isAgentChat: boolean;
}

/** The recording of voice messages the input of an opened chat takes. */
export interface ComposerVoice {
  readonly sending: VoiceSending;
  readonly maximumMs: number;
}

/** Whether the opened chat is the direct chat with an agent. */
export function isAgentChat(opened: OpenedConversation): boolean {
  return opened.kind === "participant" && opened.participant.kind === "agent";
}

/**
 * What the input at the foot of an opened chat offers.
 *
 * @param opened - The opened group or participant.
 * @param selection - The opened chat, as uploads and recordings name it.
 * @param voice - The recording of the page.
 * @returns The same files and the same voice messages in every chat where
 * text can be written: a group, a person and an agent differ only in where
 * the files and the recognized text are stored.
 */
export function chatInputOf(
  opened: OpenedConversation,
  selection: VirtualChatSelection | null,
  voice: ComposerVoice,
): {
  readonly attachments: ComposerAttachments | undefined;
  readonly voice: ComposerVoice;
} {
  return {
    attachments: selection
      ? { selection, isAgentChat: isAgentChat(opened) }
      : undefined,
    voice,
  };
}
