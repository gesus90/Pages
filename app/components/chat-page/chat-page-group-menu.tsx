import {
  Bell,
  BellOff,
  ChevronDown,
  Layers,
  MessageCircleQuestionMark,
  NotebookText,
  ShieldCheck,
  ShieldOff,
  UserPlus,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import { CONVERSATION_DEFAULT_REPLY_MODE } from "@/definition/ConversationDecision";

import { ChatPageMenuEntry, MENU_SECTION_LABEL } from "./chat-page-menu-entry";

import type { VirtualGroup } from "@/definition/VirtualChat";
import type { ConfidentialControl } from "./chat-page-confidential";

/** The dialogs the group menu opens, besides the popup of an agent. */
export type GroupDialogKind = "context" | "reply" | "sessions" | "members";

interface ChatPageGroupMenuProps {
  readonly group: VirtualGroup;
  /** `null` when the group cannot be muted. */
  readonly isMuted: boolean | null;
  readonly onToggleMute: () => void;
  /** The confidential mark of the group; absent shows no entry. */
  readonly confidential: ConfidentialControl | undefined;
  readonly onOpenDialog: (dialog: GroupDialogKind) => void;
}

/** The entry that switches the confidential mark, with the current state as its remark. */
function ConfidentialEntry({
  control,
}: {
  readonly control: ConfidentialControl | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (control === undefined || control.isConfidential === null) return null;
  return (
    <ChatPageMenuEntry
      icon={control.isConfidential ? ShieldCheck : ShieldOff}
      label={t("chatPage.groupMenu.confidential")}
      note={
        control.isConfidential
          ? t("chatPage.confidentialOn")
          : t("chatPage.confidentialOff")
      }
      onSelect={control.onToggle}
    />
  );
}

/**
 * The one menu of a group in the head of the chat (PAGE-376): who answers
 * (with the current mode as its remark, PAGE-379), the group context, the sessions of the agents, confidentiality, muting and
 * the members.
 *
 * @remarks
 * It gathers the buttons the head used to show side by side. Each entry
 * opens the dialog or runs the change the button did.
 */
export function ChatPageGroupMenu({
  group,
  isMuted,
  onToggleMute,
  confidential,
  onOpenDialog,
}: ChatPageGroupMenuProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("chatPage.groupMenu.label")}
          size="sm"
          variant="outline"
        >
          {t("chatPage.groupMenu.trigger")}
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className={MENU_SECTION_LABEL}>
          {t("chatPage.groupMenu.section", { name: group.name })}
        </DropdownMenuLabel>
        <ChatPageMenuEntry
          icon={MessageCircleQuestionMark}
          label={t("chatPage.groupMenu.reply")}
          note={t(
            `chatPage.replySettings.modes.${group.replyMode ?? CONVERSATION_DEFAULT_REPLY_MODE}.short`,
          )}
          onSelect={() => onOpenDialog("reply")}
        />
        <ChatPageMenuEntry
          icon={NotebookText}
          label={t("chatPage.groupMenu.context")}
          onSelect={() => onOpenDialog("context")}
        />
        <ChatPageMenuEntry
          icon={Layers}
          label={t("chatPage.groupMenu.sessions")}
          onSelect={() => onOpenDialog("sessions")}
        />
        <ConfidentialEntry control={confidential} />
        {isMuted === null ? null : (
          <ChatPageMenuEntry
            icon={isMuted ? BellOff : Bell}
            label={isMuted ? t("chatPage.unmute") : t("chatPage.mute")}
            onSelect={onToggleMute}
          />
        )}
        <DropdownMenuSeparator />
        <ChatPageMenuEntry
          icon={UserPlus}
          label={t("chatPage.groupMenu.members")}
          onSelect={() => onOpenDialog("members")}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
