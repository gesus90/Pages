import { ChatPageAgentSessionsDialog } from "./chat-page-agent-sessions-dialog";
import { ChatPageGroupContext } from "./chat-page-group-context";
import { ChatPageMemberDialog } from "./chat-page-member-dialog";
import { ChatPageReplySettings } from "./chat-page-reply-settings";

import type { AgentSettingsTab } from "@/app/components/agent-settings/agent-settings-tabs";
import type {
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";
import type { AgentSessionEntry } from "./chat-page-agent-sessions-dialog";
import type { GroupDialogKind } from "./chat-page-group-menu";

interface ChatPageGroupDialogsProps {
  readonly group: VirtualGroup;
  readonly members: readonly VirtualParticipant[];
  /** The person's own participants, which the member dialog offers. */
  readonly participants: readonly VirtualParticipant[];
  readonly onAddMember: (groupId: string, participantId: string) => void;
  /** The dialog that is open; `null` while none is. */
  readonly dialog: GroupDialogKind | null;
  readonly onDialogChange: (dialog: GroupDialogKind | null) => void;
  readonly onOpenSettings: (
    agent: VirtualParticipant,
    tab: AgentSettingsTab,
  ) => void;
}

/** The agents of the group with the session each keeps in it. */
function sessionEntries(
  group: VirtualGroup,
  members: readonly VirtualParticipant[],
): readonly AgentSessionEntry[] {
  return members
    .filter((member) => member.kind === "agent")
    .map((agent) => ({
      agent,
      brief: group.agentSessions?.find((entry) => entry.agentId === agent.id),
    }));
}

/**
 * The dialogs of the group menu and of the plus behind the member chips:
 * who answers, the group context, the sessions of the agents in the group
 * and the members. One of them is open at a time.
 */
export function ChatPageGroupDialogs({
  group,
  members,
  participants,
  onAddMember,
  dialog,
  onDialogChange,
  onOpenSettings,
}: ChatPageGroupDialogsProps): React.ReactElement {
  function handleOpenChange(kind: GroupDialogKind, isOpen: boolean): void {
    if (isOpen) onDialogChange(kind);
    else if (dialog === kind) onDialogChange(null);
  }

  return (
    <>
      <ChatPageReplySettings
        group={group}
        isOpen={dialog === "reply"}
        onOpenChange={(isOpen) => handleOpenChange("reply", isOpen)}
      />
      <ChatPageGroupContext
        group={group}
        isOpen={dialog === "context"}
        onOpenChange={(isOpen) => handleOpenChange("context", isOpen)}
      />
      <ChatPageAgentSessionsDialog
        isOpen={dialog === "sessions"}
        onOpenChange={(isOpen) => handleOpenChange("sessions", isOpen)}
        chatName={group.name}
        entries={sessionEntries(group, members)}
        onOpenSettings={(agent) => {
          onDialogChange(null);
          onOpenSettings(agent, "sessions");
        }}
      />
      <ChatPageMemberDialog
        group={group}
        participants={participants}
        onAdd={onAddMember}
        isOpen={dialog === "members"}
        onOpenChange={(isOpen) => handleOpenChange("members", isOpen)}
      />
    </>
  );
}
