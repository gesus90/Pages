import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAudioSettings } from "@/app/components/chat-call/audio-settings-context";
import { useAudioPreferences } from "@/app/components/chat-call/audio-preferences";

import { targetFields } from "../agent-control-api";
import { ChatPageEmbedDomainsDialog } from "../chat-page-embed-domains";
import { useChatContent } from "../content/chat-content-context";
import { useMediaOverview } from "../media/media-overview-api";
import { useAgentControl } from "../use-agent-control";
import {
  agentConversationChatMenu,
  directChatMenu,
  groupChatMenu,
} from "./chat-menu-model";
import { useChatMenuAnchor } from "./chat-menu-request";
import { ChatPageChatMenu } from "./chat-page-chat-menu";

import type {
  AudioPreferences,
  ChosenAudioDevice,
} from "@/app/components/chat-call/audio-preferences";
import type { AgentChatControlTarget } from "@/definition/AgentChatControl";
import type {
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";
import type { ConfidentialControl } from "../chat-page-confidential";
import type { ChatMenuGroupDialog } from "./chat-menu-model";

/** The switches of the opened chat the head passes on to its menu. */
export interface ChatMenuSwitches {
  /** `null` when there is nothing to mute, as with an agent. */
  readonly isMuted: boolean | null;
  readonly onToggleMute: () => void;
  /** The confidential mark of a chat with agents; absent shows none. */
  readonly confidential?: ConfidentialControl;
}

/**
 * The count of "Medien & Dateien", read anew from the server each
 * time the menu opens by its button or from the list.
 */
function useMenuMediaNote(
  conversationId: string | null,
  anchorStamp: number,
): { readonly note: string; onOpen(): void } {
  const [openings, setOpenings] = useState(0);
  const isRequested = openings > 0 || anchorStamp > 0;
  const { overview } = useMediaOverview(
    conversationId,
    isRequested ? `${openings}:${anchorStamp}` : null,
  );
  const count = overview ? overview.files.length + overview.links.length : null;
  return {
    note: count === null && conversationId !== null ? "…" : String(count ?? 0),
    onOpen: () => setOpenings((value) => value + 1),
  };
}

/** The common part of the switches as the menu model takes it. */
function switchInput(switches: ChatMenuSwitches): {
  readonly isConfidential: boolean | null;
  readonly onToggleConfidential: () => void;
  readonly isMuted: boolean | null;
  readonly onToggleMute: () => void;
} {
  return {
    isConfidential: switches.confidential?.isConfidential ?? null,
    onToggleConfidential: () => switches.confidential?.onToggle(),
    isMuted: switches.isMuted,
    onToggleMute: switches.onToggleMute,
  };
}

/** The name a chosen device contributes; `null` without a choice or a name. */
function deviceLabel(device: ChosenAudioDevice | null): string | null {
  return device !== null && device.label !== "" ? device.label : null;
}

/** The value of "Audio-Einstellungen": the chosen device, or the default without a choice. */
function audioNote(preferences: AudioPreferences, defaultNote: string): string {
  const label =
    deviceLabel(preferences.microphone) ?? deviceLabel(preferences.speaker);
  return label ?? defaultNote;
}

/** The ☰ of a group in its head, also opened by a right click on it in the list. */
export function GroupChatMenu({
  group,
  members,
  switches,
  onOpenDialog,
  onOpenModel,
}: {
  readonly group: VirtualGroup;
  readonly members: readonly VirtualParticipant[];
  readonly switches: ChatMenuSwitches;
  readonly onOpenDialog: (dialog: ChatMenuGroupDialog) => void;
  readonly onOpenModel: (
    agent: VirtualParticipant,
    target: AgentChatControlTarget,
  ) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { openMedia } = useChatContent();
  const anchor = useChatMenuAnchor({ kind: "group", id: group.id });
  const media = useMenuMediaNote(group.id, anchor.stamp);
  const model =
    group.isAgentConversation === true
      ? agentConversationChatMenu({
          t,
          group,
          mediaNote: media.note,
          onOpenMedia: openMedia,
        })
      : groupChatMenu({
          t,
          group,
          agents: members.filter((member) => member.kind === "agent"),
          mediaNote: media.note,
          onOpenMedia: openMedia,
          ...switchInput(switches),
          onOpenDialog,
          onOpenModel: (agent) =>
            onOpenModel(agent, {
              kind: "group",
              agentId: agent.id,
              conversationId: group.id,
            }),
        });
  return (
    <ChatPageChatMenu
      model={model}
      onOpen={media.onOpen}
      anchor={anchor.point}
      onAnchorClose={anchor.close}
    />
  );
}

/**
 * The ☰ of a direct chat in its head, also opened by a right click on it in
 * the list, with the dialog of the released domains of a person.
 */
export function DirectChatMenu({
  participant,
  switches,
  onOpenModel,
}: {
  readonly participant: VirtualParticipant;
  readonly switches: ChatMenuSwitches;
  readonly onOpenModel: (
    agent: VirtualParticipant,
    target: AgentChatControlTarget,
  ) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const content = useChatContent();
  const request = useAgentControl();
  const [isEmbedOpen, setIsEmbedOpen] = useState(false);
  const audioSettings = useAudioSettings();
  const audioPreferences = useAudioPreferences();
  const anchor = useChatMenuAnchor({ kind: "participant", id: participant.id });
  const conversationId = participant.conversationId ?? null;
  const media = useMenuMediaNote(conversationId, anchor.stamp);
  const target: AgentChatControlTarget = {
    kind: "direct",
    agentId: participant.id,
  };
  const model = directChatMenu({
    t,
    participant,
    mediaNote: media.note,
    onOpenMedia: content.openMedia,
    ...switchInput(switches),
    audio: {
      note: audioNote(audioPreferences, t("chatCall.audio.defaultDevice")),
      onOpen: audioSettings.open,
    },
    onOpenEmbedDomains:
      content.conversationId === null ? undefined : () => setIsEmbedOpen(true),
    onOpenModel: () => onOpenModel(participant, target),
    onNewSession: () => {
      void request.send({ intent: "new", ...targetFields(target) });
    },
    isNewSessionPending: request.isPending,
  });
  return (
    <>
      {request.failure === null ? null : (
        <span className="text-xs text-destructive" role="alert">
          {t(`chatPage.control.failure.${request.failure}`)}
        </span>
      )}
      <ChatPageChatMenu
        model={model}
        onOpen={media.onOpen}
        anchor={anchor.point}
        onAnchorClose={anchor.close}
      />
      {participant.kind === "agent" ? null : (
        <ChatPageEmbedDomainsDialog
          isOpen={isEmbedOpen}
          onOpenChange={setIsEmbedOpen}
        />
      )}
    </>
  );
}
