import {
  Ban,
  CalendarClock,
  BellOff,
  Diamond,
  FolderOpen,
  Globe,
  Layers,
  MessageCircleQuestionMark,
  NotebookText,
  RotateCw,
  ShieldCheck,
  Users,
} from "lucide-react";

import { CONVERSATION_DEFAULT_REPLY_MODE } from "@/definition/ConversationDecision";
import { shortModelName } from "@/definition/AgentChatControl";

import type { LucideIcon } from "lucide-react";
import type { AgentChatModelLabel } from "@/definition/AgentChatControl";
import type {
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

/** Translates a key of the language files, as `t` of i18next does. */
export type ChatMenuTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

/** An entry that opens a dialog or the column beside the chat, or runs one action. */
export interface ChatMenuAction {
  readonly kind: "action";
  readonly id: string;
  readonly icon: LucideIcon;
  readonly label: string;
  /** A short remark at the right edge, such as a count or the current mode. */
  readonly note?: string;
  /** Shows the arrow of an entry that opens a dialog or the column beside the chat. */
  readonly opensMore?: boolean;
  readonly isDestructive?: boolean;
  readonly isDisabled?: boolean;
  readonly onSelect: () => void;
}

/** A switch that works at once and leaves the menu open. */
export interface ChatMenuToggle {
  readonly kind: "toggle";
  readonly id: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly isOn: boolean;
  readonly onToggle: () => void;
}

/** An entry with a nested choice, such as the agent whose model in this chat changes. */
export interface ChatMenuSubmenu {
  readonly kind: "submenu";
  readonly id: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly note?: string;
  readonly entries: readonly ChatMenuAction[];
}

export type ChatMenuEntry = ChatMenuAction | ChatMenuToggle | ChatMenuSubmenu;

/** A group of entries under a small heading; a separated one stands apart below a line. */
export interface ChatMenuSection {
  readonly id: string;
  readonly title?: string;
  readonly isSeparated?: boolean;
  readonly entries: readonly ChatMenuEntry[];
}

/** The whole chat menu (PAGE-389): its head and its sections. */
export interface ChatMenuModel {
  readonly title: string;
  readonly subtitle: string;
  readonly sections: readonly ChatMenuSection[];
}

/** What every chat offers: its media and its two switches. */
export interface ChatMenuCommonInput {
  readonly t: ChatMenuTranslate;
  /** The remark of "Medien & Dateien", such as the count or "…" while it loads. */
  readonly mediaNote: string;
  readonly onOpenMedia: () => void;
  /** `null` where the chat cannot be marked confidential, as with a person. */
  readonly isConfidential: boolean | null;
  readonly onToggleConfidential: () => void;
  /** `null` where there is nothing to mute, as with an agent. */
  readonly isMuted: boolean | null;
  readonly onToggleMute: () => void;
}

/** The dialogs of a group the menu opens. */
export type ChatMenuGroupDialog =
  "context" | "reply" | "sessions" | "members" | "dissolve" | "tasks";

/** What the menu of a group needs beyond the common part. */
export interface GroupChatMenuInput extends ChatMenuCommonInput {
  readonly group: VirtualGroup;
  /** The agents among the members, whose model in this chat the menu changes. */
  readonly agents: readonly VirtualParticipant[];
  readonly onOpenDialog: (dialog: ChatMenuGroupDialog) => void;
  readonly onOpenModel: (agent: VirtualParticipant) => void;
}

/** What the menu of a direct chat needs beyond the common part. */
export interface DirectChatMenuInput extends ChatMenuCommonInput {
  readonly participant: VirtualParticipant;
  /** Opens the released domains of a stored chat with a person; absent shows no entry. */
  readonly onOpenEmbedDomains?: () => void;
  readonly onOpenModel: () => void;
  /** Starts a new session of the agent, as `/new` does (PAGE-380). */
  readonly onNewSession: () => void;
  readonly isNewSessionPending: boolean;
}

/** The model of an agent in this chat as the menu names it, such as "Opus · hoch". */
export function chatModelNote(
  t: ChatMenuTranslate,
  model: AgentChatModelLabel | undefined,
): string {
  if (model === undefined) return t("chatPage.chatMenu.modelDefault");
  const name = shortModelName(model.name);
  if (model.reasoningEffort === null) return name;
  const effort = t(`chatPage.modelChoice.effort.${model.reasoningEffort}`, {
    defaultValue: model.reasoningEffort,
  });
  return `${name} · ${effort}`;
}

/** "Medien & Dateien", the first entry of every chat (PAGE-387). */
function mediaEntry(input: ChatMenuCommonInput): ChatMenuAction {
  return {
    kind: "action",
    id: "media",
    icon: FolderOpen,
    label: input.t("chatPage.media.menuEntry"),
    note: input.mediaNote,
    opensMore: true,
    onSelect: input.onOpenMedia,
  };
}

/** The switches "Vertraulich" and "Stummschalten"; each only where the chat has it. */
function settingsSection(input: ChatMenuCommonInput): ChatMenuSection {
  const { t } = input;
  const entries: ChatMenuEntry[] = [];
  if (input.isConfidential !== null)
    entries.push({
      kind: "toggle",
      id: "confidential",
      icon: ShieldCheck,
      label: t("chatPage.chatMenu.confidential"),
      isOn: input.isConfidential,
      onToggle: input.onToggleConfidential,
    });
  if (input.isMuted !== null)
    entries.push({
      kind: "toggle",
      id: "mute",
      icon: BellOff,
      label: t("chatPage.chatMenu.mute"),
      isOn: input.isMuted,
      onToggle: input.onToggleMute,
    });
  return {
    id: "settings",
    title: t("chatPage.chatMenu.sections.settings"),
    entries,
  };
}

/**
 * "Modell für diesen Chat" of a group: with one agent it opens its choice at
 * once, with several it asks which agent first. Absent without agents or
 * without the right to steer them (PAGE-380).
 */
function groupModelEntry(input: GroupChatMenuInput): ChatMenuEntry | null {
  const { t, group, agents } = input;
  if (group.canControlSessions !== true || agents.length === 0) return null;
  const models = group.agentModels ?? {};
  const label = t("chatPage.chatMenu.model");
  const [onlyAgent] = agents;
  if (agents.length === 1 && onlyAgent !== undefined)
    return {
      kind: "action",
      id: "model",
      icon: Diamond,
      label,
      note: chatModelNote(t, models[onlyAgent.id]),
      opensMore: true,
      onSelect: () => input.onOpenModel(onlyAgent),
    };
  const changed = agents.filter(
    (agent) => models[agent.id]?.isOverride === true,
  );
  return {
    kind: "submenu",
    id: "model",
    icon: Diamond,
    label,
    note:
      changed.length === 0
        ? t("chatPage.chatMenu.modelDefault")
        : t("chatPage.chatMenu.modelChanged", { count: changed.length }),
    entries: agents.map((agent) => ({
      kind: "action",
      id: `model:${agent.id}`,
      icon: Diamond,
      label: agent.name,
      note: chatModelNote(t, models[agent.id]),
      opensMore: true,
      onSelect: () => input.onOpenModel(agent),
    })),
  };
}

/** "Mitglieder", "Wer antwortet?", the sessions and the model of the group. */
function collaborationSection(input: GroupChatMenuInput): ChatMenuSection {
  const { t, group, onOpenDialog } = input;
  const model = groupModelEntry(input);
  const entries: ChatMenuEntry[] = [
    {
      kind: "action",
      id: "members",
      icon: Users,
      label: t("chatPage.chatMenu.members"),
      note: String(groupMemberCount(group)),
      opensMore: true,
      onSelect: () => onOpenDialog("members"),
    },
    {
      kind: "action",
      id: "reply",
      icon: MessageCircleQuestionMark,
      label: t("chatPage.chatMenu.reply"),
      note: t(
        `chatPage.replySettings.modes.${group.replyMode ?? CONVERSATION_DEFAULT_REPLY_MODE}.short`,
      ),
      opensMore: true,
      onSelect: () => onOpenDialog("reply"),
    },
    ...(model === null ? [] : [model]),
  ];
  if (input.agents.length > 0)
    entries.push({
      kind: "action",
      id: "tasks",
      icon: CalendarClock,
      label: t("chatPage.groupMenu.tasks"),
      opensMore: true,
      onSelect: () => onOpenDialog("tasks"),
    });
  if (input.agents.length > 0)
    entries.push({
      kind: "action",
      id: "sessions",
      icon: Layers,
      label: t("chatPage.chatMenu.sessions"),
      opensMore: true,
      onSelect: () => onOpenDialog("sessions"),
    });
  return {
    id: "collaboration",
    title: t("chatPage.chatMenu.sections.collaboration"),
    entries,
  };
}

/** The members of a group with the person who looks at it, who is one of them. */
export function groupMemberCount(group: VirtualGroup): number {
  return group.memberIds.length + 1;
}

/**
 * The chat menu of a group (PAGE-389): "Inhalte" with "Medien & Dateien" and
 * "Gruppenkontext", "Zusammenarbeit" with the members, who answers, the
 * model per chat and the sessions of the agents, "Einstellungen" with the
 * two switches and, apart and red, "Gruppe auflösen".
 *
 * @remarks
 * Entries the person may not use are left out: the model without the right
 * to steer the agents, the dissolution for everybody but the creator. The
 * members dialog stays open to all; only the creator changes them in it.
 */
export function groupChatMenu(input: GroupChatMenuInput): ChatMenuModel {
  const { t, group } = input;
  const sections: ChatMenuSection[] = [
    {
      id: "content",
      title: t("chatPage.chatMenu.sections.content"),
      entries: [
        mediaEntry(input),
        {
          kind: "action",
          id: "context",
          icon: NotebookText,
          label: t("chatPage.chatMenu.context"),
          opensMore: true,
          onSelect: () => input.onOpenDialog("context"),
        },
      ],
    },
    collaborationSection(input),
    settingsSection(input),
  ];
  if (group.isOwner === true)
    sections.push({
      id: "danger",
      isSeparated: true,
      entries: [
        {
          kind: "action",
          id: "dissolve",
          icon: Ban,
          label: t("chatPage.chatMenu.dissolve"),
          opensMore: true,
          isDestructive: true,
          onSelect: () => input.onOpenDialog("dissolve"),
        },
      ],
    });
  return {
    title: group.name,
    subtitle: t("chatPage.chatMenu.groupSubtitle", {
      count: groupMemberCount(group),
    }),
    sections: sections.filter((section) => section.entries.length > 0),
  };
}

/** What only an agent offers in its direct chat: its model and a new session. */
function agentEntries(input: DirectChatMenuInput): readonly ChatMenuAction[] {
  const { t, participant } = input;
  return [
    {
      kind: "action",
      id: "model",
      icon: Diamond,
      label: t("chatPage.chatMenu.model"),
      note: chatModelNote(t, participant.chatModel),
      opensMore: true,
      onSelect: input.onOpenModel,
    },
    {
      kind: "action",
      id: "new",
      icon: RotateCw,
      label: t("chatPage.chatMenu.newSession"),
      note: "/new",
      isDisabled: input.isNewSessionPending,
      onSelect: input.onNewSession,
    },
  ];
}

/**
 * The chat menu of a direct chat (PAGE-389): "Medien & Dateien", with a
 * person "Eingebettete Webseiten", with an agent "Modell für diesen Chat"
 * and "Neue Sitzung", then the switches "Vertraulich" and "Stummschalten"
 * where the chat has them.
 */
export function directChatMenu(input: DirectChatMenuInput): ChatMenuModel {
  const { t, participant } = input;
  const isAgent = participant.kind === "agent";
  const content: ChatMenuEntry[] = [mediaEntry(input)];
  if (!isAgent && input.onOpenEmbedDomains !== undefined)
    content.push({
      kind: "action",
      id: "embed",
      icon: Globe,
      label: t("chatPage.chatMenu.embedDomains"),
      opensMore: true,
      onSelect: input.onOpenEmbedDomains,
    });
  if (isAgent) content.push(...agentEntries(input));
  const sections: ChatMenuSection[] = [
    { id: "content", entries: content },
    settingsSection(input),
  ];
  return {
    title: participant.name,
    subtitle: t("chatPage.chatMenu.directSubtitle", {
      kind: t(`chatPage.kind.${participant.kind}`),
    }),
    sections: sections.filter((section) => section.entries.length > 0),
  };
}

/** The menu of a conversation of agents only, which the person reads: only its media. */
export function agentConversationChatMenu(
  input: Pick<ChatMenuCommonInput, "t" | "mediaNote" | "onOpenMedia"> & {
    readonly group: VirtualGroup;
  },
): ChatMenuModel {
  const common: ChatMenuCommonInput = {
    ...input,
    isConfidential: null,
    onToggleConfidential: () => undefined,
    isMuted: null,
    onToggleMute: () => undefined,
  };
  return {
    title: input.group.name,
    subtitle: input.t("chatPage.agentConversation"),
    sections: [{ id: "content", entries: [mediaEntry(common)] }],
  };
}
