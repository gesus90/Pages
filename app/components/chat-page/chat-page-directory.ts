import type { VirtualChatDirectory } from "@/definition/VirtualChat";

/**
 * The directory of the chat page while participants, groups and histories
 * are not stored yet: no participants, no groups, no histories.
 *
 * @remarks
 * `modelChoices` and `toolChoices` stay filled, because the dialogs "Neue
 * Gruppe" and "Neuer Teilnehmer" offer them. A later ticket replaces this
 * constant with stored data; the page reads only the
 * {@link VirtualChatDirectory} contract.
 */
export const EMPTY_CHAT_DIRECTORY: VirtualChatDirectory = {
  participants: [],
  groups: [],
  histories: {},
  modelChoices: ["Claude Opus 5.5", "Claude Sonnet 5.5", "Claude Haiku 5.5"],
  toolChoices: [
    "Tickets",
    "Wiki",
    "Projekte",
    "GitHub",
    "Terminal",
    "Arbeitsplätze",
  ],
};
