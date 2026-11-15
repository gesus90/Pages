import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { ChatBrowserPanel } from "@/app/components/chat/browser/chat-browser-panel";
import { Button } from "@/app/components/ui/button";

import {
  ChatMenuRequestContext,
  useChatMenuRequestState,
} from "./chat-menu/chat-menu-request";
import { MentionDirectoryContext } from "./mentions/mention-context";
import { ChatDecisionHealth } from "./mentions/chat-decision-health";
import { ChatPageCommandOutcome } from "./chat-page-command-outcome";
import { ChatPageComposer } from "./chat-page-composer";
import {
  ChatPageContextRings,
  contextRingEntries,
} from "./chat-page-context-rings";
import { useConfidential } from "./chat-page-confidential";
import { ChatPageDropZone } from "./chat-page-drop-zone";
import { ChatPageHeader } from "./chat-page-header";
import { ChatPageHistory } from "./chat-page-history";
import { ChatPageLiveTools } from "./chat-page-tool-uses";
import { ChatPageList } from "./chat-page-list";
import { ChatPagePicker } from "./chat-page-picker";
import { CardOverlay } from "./content/card-panel";
import { MediaOverviewOverlay } from "./media/media-overview-panel";
import {
  ChatContentProvider,
  useChatContent,
} from "./content/chat-content-context";
import { SplitPanel } from "./content/split-panel";
import { useChatToastSelection } from "./use-chat-toast-selection";
import { useChatListCollapse } from "./use-chat-list-collapse";
import { useChatCommandRunner } from "./use-chat-command-runner";
import { useChatPage } from "./use-chat-page";
import { useMessageReveal } from "./use-message-reveal";
import { useVoiceSending } from "./use-voice-sending";
import { formatVoiceDuration } from "./voice-audio";

import type { ChatDecisionStatus } from "@/definition/ConversationDecision";
import type { ConversationDelivery } from "@/definition/ConversationLiveAnswer";
import type {
  VirtualChatDirectory,
  VirtualChatSelection,
} from "@/definition/VirtualChat";
import type { ChatPageState, OpenedConversation } from "./use-chat-page";

function conversationName(opened: OpenedConversation): string {
  return opened.kind === "group" ? opened.group.name : opened.participant.name;
}

function conversationKey(opened: OpenedConversation): string {
  return opened.kind === "group"
    ? `group:${opened.group.id}`
    : `participant:${opened.participant.id}`;
}

/** The hint in the input: groups take mentions, agents commands, people plain text. */
function placeholderKey(opened: OpenedConversation): string {
  if (opened.kind === "group") return "chatPage.groupPlaceholder";
  return opened.participant.kind === "agent"
    ? "chatPage.participantPlaceholder"
    : "chatPage.personPlaceholder";
}

/** The hint that agents wrote the most they may in a row, with the way to let them go on (PAGE-311). */
function AgentPausedBanner({
  onResume,
}: {
  readonly onResume: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-3 rounded-[14px] bg-warning-subtle p-4 text-sm text-warning"
      role="status"
    >
      <p className="min-w-0 flex-1">
        <strong>{t("chatPage.agentPaused.title")}</strong>{" "}
        {t("chatPage.agentPaused.hint")}
      </p>
      <Button onClick={onResume} size="sm" type="button" variant="outline">
        {t("chatPage.agentPaused.resume")}
      </Button>
    </div>
  );
}

function readOnlyFootText(
  t: (key: string, options?: Record<string, unknown>) => string,
  opened: OpenedConversation,
  name: string,
): string | null {
  if (opened.kind === "group" && opened.group.isAgentConversation === true)
    return t("chatPage.agentConversationReadOnly");
  if (opened.kind === "participant" && !opened.participant.canChat)
    return opened.participant.kind === "agent"
      ? t("chatPage.agentInactive", { name })
      : t("chatPage.personInactive", { name });
  return null;
}

function composerAnswering(
  page: ChatPageState,
): { readonly name: string; readonly onStop: () => void } | undefined {
  if (!page.isAnswering) return undefined;
  const workerNames = page.activity.map((entry) => entry.agent.name);
  const names = workerNames.length > 0 ? workerNames : page.answeringNames;
  return { name: names.join(", "), onStop: page.stopAll };
}

/** The input at the foot, or why nothing can be sent to the opened participant. */
function ConversationFoot({
  page,
  opened,
  mentionRef,
}: {
  readonly page: ChatPageState;
  readonly opened: OpenedConversation;
  /** Receives what the menu of an agent in the head uses to mention it (PAGE-376). */
  readonly mentionRef: React.RefObject<((username: string) => void) | null>;
}): React.ReactElement {
  const { t } = useTranslation();
  const sending = useVoiceSending(page.selection, page.voiceMaximumMs);
  const commands = useChatCommandRunner(opened);
  const name = conversationName(opened);

  // A chat command steers an agent and is never sent as a message (PAGE-380).
  function handleSend(
    content: string,
    attachmentIds: readonly string[],
    delivery?: ConversationDelivery,
  ): void {
    if (attachmentIds.length === 0 && commands.runIfCommand(content)) return;
    page.send(content, attachmentIds, delivery);
  }

  const readOnlyMessage = readOnlyFootText(t, opened, name);
  if (readOnlyMessage !== null)
    return (
      <p className="mr-22 shrink-0 rounded-[14px] bg-surface p-4 text-sm text-muted-foreground shadow-card">
        {readOnlyMessage}
      </p>
    );

  // An agent's history on the page is its chat session, which takes text only.
  const hasVoice =
    opened.kind === "group" || opened.participant.kind === "human";
  const memberIds =
    opened.kind === "group" ? opened.group.memberIds : [opened.participant.id];
  const aside =
    contextRingEntries(opened).length > 0 ? (
      <ChatPageContextRings opened={opened} chatName={name} />
    ) : undefined;
  return (
    <div className="flex shrink-0 flex-col gap-2">
      {page.sendFailure ? (
        <p className="mr-22 text-sm text-destructive" role="alert">
          {t(`chatPage.sendFailure.${page.sendFailure}`, { name })}
        </p>
      ) : null}
      {sending.failure ? (
        <p className="mr-22 text-sm text-destructive" role="alert">
          {t(`chatPage.voice.failure.${sending.failure}`, {
            maximum: formatVoiceDuration(page.voiceMaximumMs),
          })}
        </p>
      ) : null}
      <ChatPageCommandOutcome runner={commands} />
      <ChatPageComposer
        key={conversationKey(opened)}
        label={t("chatPage.inputLabel", { name })}
        placeholder={t(placeholderKey(opened), { name })}
        onSend={handleSend}
        answering={composerAnswering(page)}
        activity={page.activity}
        aside={aside}
        memberIds={memberIds}
        attachments={
          hasVoice && page.selection ? { selection: page.selection } : undefined
        }
        voice={
          hasVoice ? { sending, maximumMs: page.voiceMaximumMs } : undefined
        }
        mentionRef={mentionRef}
      />
    </div>
  );
}

/** The opened conversation directly on the page background, without card. */
function ChatPageConversation({
  page,
  status,
}: {
  readonly page: ChatPageState;
  readonly status?: ChatDecisionStatus;
}): React.ReactElement {
  const { t } = useTranslation();
  const { opened } = page;
  const confidential = useConfidential(opened);
  const mentionRef = useRef<((username: string) => void) | null>(null);
  if (!opened)
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <span className="pages-scene-veil rounded-full px-3 py-1.5">
          {t("chatPage.nothingSelected")}
        </span>
      </p>
    );
  const name = conversationName(opened);
  return (
    <ChatPageDropZone
      aria-label={name}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:min-w-[360px]"
    >
      <ChatPageHeader
        opened={opened}
        participants={page.allParticipants}
        isAnswering={page.isAnswering}
        onStop={page.stop}
        onStopAgent={page.stopGroupAgent}
        onAddMember={page.addMember}
        onSelect={page.select}
        onMention={(username) => mentionRef.current?.(username)}
        isMuted={page.isMuted}
        onToggleMute={page.toggleMute}
        confidential={confidential}
      />
      <ChatDecisionHealth
        status={status}
        opened={opened}
        messages={page.messages}
      />
      {opened.kind === "group" && opened.group.isAgentPaused === true ? (
        <AgentPausedBanner onResume={page.resumeAgents} />
      ) : null}
      <ChatPageHistory
        messages={page.messages}
        name={name}
        findParticipant={page.findParticipant}
        isAnswering={page.isAnswering}
        older={{
          hasMore: page.hasOlder,
          isLoading: page.isLoadingOlder,
          onLoad: page.loadOlder,
        }}
        answeringNames={page.answeringNames}
        live={page.live}
      />
      {page.live.answers.length === 0 ? (
        <ChatPageLiveTools tools={page.liveTools} onCancel={page.cancelTool} />
      ) : null}
      <ChatBrowserPanel isOpen />
      <ConversationFoot
        key={conversationKey(opened)}
        page={page}
        opened={opened}
        mentionRef={mentionRef}
      />
    </ChatPageDropZone>
  );
}

/** The stored conversation of the opened entry; agents and new direct ones have none. */
function storedConversationId(
  opened: OpenedConversation | null,
): string | null {
  if (!opened) return null;
  return opened.kind === "group"
    ? opened.group.id
    : (opened.participant.conversationId ?? null);
}

/**
 * The list of conversations; while the split view is open it makes room
 * for chat and panel on screens below 1536 px (PAGE-298).
 */
function ListSlot({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { beside, media } = useChatContent();
  const isSplit = beside !== null || media === "beside";
  return (
    <div className={isSplit ? "hidden 2xl:contents" : "contents"}>
      {children}
    </div>
  );
}

/**
 * The chat page with people, agents and groups (PAGE-254, PAGE-266,
 * PAGE-259).
 *
 * @remarks
 * Two columns 32 px apart down to the foot of the page: the list card of 340
 * px with a scroll area for each list, and the chat without card or
 * background. The list collapses to a bar of avatars of 72 px, by its toggle
 * or `Ctrl+Shift+L`, and the chat takes the room (PAGE-325). From 768 px on
 * the page fills the screen and the document never scrolls; only the
 * history and the list do.
 * Below `lg` the list stands above the chat; below `md` a selection replaces
 * it. Messages go to active agents, which answer over ACP, and into the
 * stored conversations with people and of groups (PAGE-278). The list holds
 * only existing people and agents the person chose or who wrote to them, and
 * groups of them. Content of messages shows as cards; one of them opens
 * right of the chat in the split view or over the page (PAGE-298), as does
 * "Medien & Dateien" of the chat (PAGE-387). A right click or a long press
 * on a conversation of the list opens it with its chat menu at the point
 * (PAGE-389).
 */
export function ChatPage({
  directory,
  requestedSelection,
}: {
  readonly directory: VirtualChatDirectory;
  readonly requestedSelection?: VirtualChatSelection;
}): React.ReactElement {
  const { t } = useTranslation();
  const page = useChatPage(directory, requestedSelection);
  useChatToastSelection({
    selection: page.selection,
    requested: requestedSelection,
    select: page.select,
  });
  const collapse = useChatListCollapse(
    directory.viewPreferences?.isListCollapsed === true,
  );
  const chatMenu = useChatMenuRequestState();
  const revealMessage = useMessageReveal({
    messageCount: page.messages.length,
    hasOlder: page.hasOlder,
    isLoadingOlder: page.isLoadingOlder,
    loadOlder: page.loadOlder,
  });
  return (
    <MentionDirectoryContext value={directory.mentionDirectory}>
      <ChatMenuRequestContext value={chatMenu}>
        <section className="pages-page-fill pages-page-fixed flex w-full flex-col">
          <header className="shrink-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("chatPage.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("chatPage.subtitle")}
            </p>
          </header>
          <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4 md:gap-8 lg:flex-row">
            <ChatContentProvider
              conversationId={storedConversationId(page.opened)}
              conversationKey={page.opened ? conversationKey(page.opened) : ""}
              directory={directory}
              onPreviewSend={page.sendFromPreview}
              onRevealMessage={revealMessage}
            >
              <ListSlot>
                <ChatPageList
                  page={page}
                  directory={directory}
                  collapse={collapse}
                />
                <ChatPagePicker page={page} />
              </ListSlot>
              <ChatPageConversation
                page={page}
                status={directory.chatDecisionStatus}
              />
              <SplitPanel
                storedWidth={directory.viewPreferences?.splitWidth ?? null}
              />
              <MediaOverviewOverlay />
              <CardOverlay />
            </ChatContentProvider>
          </div>
        </section>
      </ChatMenuRequestContext>
    </MentionDirectoryContext>
  );
}
