import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ChatCallBar } from "@/app/components/chat-call/chat-call-bar";
import { useDirectCall } from "@/app/components/chat-call/use-direct-call";
import { ChatBrowserPanel } from "@/app/components/chat/browser/chat-browser-panel";
import { ChatBrowsersProvider } from "@/app/components/chat/browser/chat-browsers-context";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { useToastCenter } from "@/app/components/ui/toast/toast-provider";
import { toastChatKey } from "@/app/components/ui/toast/toast-types";
import { backendRequestHeaders } from "@/app/lib/backend-request";

import {
  ChatMenuRequestContext,
  useChatMenuRequestState,
} from "./chat-menu/chat-menu-request";
import { MentionDirectoryContext } from "./mentions/mention-context";
import { ChatPageCommandOutcome } from "./chat-page-command-outcome";
import { ChatPageComposer } from "./chat-page-composer";
import { openedSessionIds } from "./chat-page-browser-sessions";
import { chatInputOf, isAgentChat } from "./chat-page-input";
import { useConfidential } from "./chat-page-confidential";
import { ChatPageDropZone } from "./chat-page-drop-zone";
import { ChatPageHeader } from "./chat-page-header";
import { ChatPageHistory } from "./chat-page-history";
import { ChatPageLiveTools } from "./chat-page-tool-strip";
import { ChatPageList } from "./chat-page-list";
import { CardOverlay } from "./content/card-panel";
import { messageElement } from "./content/chat-image-viewer";
import { MediaOverviewOverlay } from "./media/media-overview-panel";
import {
  ChatContentProvider,
  useChatContent,
} from "./content/chat-content-context";
import { SplitPanel } from "./content/split-panel";
import { useBesideBrowser } from "./content/use-beside-browser";
import { useChatListCollapse } from "./use-chat-list-collapse";
import { useChatCommandRunner } from "./use-chat-command-runner";
import { useChatPage } from "./use-chat-page";
import { useVoiceSending } from "./use-voice-sending";
import { formatVoiceDuration } from "./voice-audio";

import type { ChatDecisionStatus } from "@/definition/ConversationDecision";
import type { ConversationDelivery } from "@/definition/ConversationLiveAnswer";
import type {
  VirtualChatDirectory,
  VirtualChatMessage,
  VirtualChatSelection,
} from "@/definition/VirtualChat";
import type { DirectCall } from "@/app/components/chat-call/use-direct-call";
import type { ComposerAnswering } from "./chat-page-composer";
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

/** The hint that agents wrote the most they may in a row, with the way to let them go on. */
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

function composerAnswering(page: ChatPageState): ComposerAnswering | undefined {
  if (!page.isAnswering) return undefined;
  const workerNames = page.activity.map((entry) => entry.agent.name);
  const names = workerNames.length > 0 ? workerNames : page.answeringNames;
  return {
    name: names.join(", "),
    onStop: page.stopAll,
    isGroup: page.opened?.kind === "group",
  };
}

/** The input at the foot, or why nothing can be sent to the opened participant. */
function ConversationFoot({
  page,
  opened,
  call,
  mentionRef,
}: {
  readonly page: ChatPageState;
  readonly opened: OpenedConversation;
  /** The call of a direct chat; `null` in a group. */
  readonly call: DirectCall | null;
  /** Receives what the menu of an agent in the head uses to mention it. */
  readonly mentionRef: React.RefObject<((username: string) => void) | null>;
}): React.ReactElement {
  const { t } = useTranslation();
  const sending = useVoiceSending(page.selection, page.voiceMaximumMs, {
    isAgentChat: isAgentChat(opened),
  });
  const commands = useChatCommandRunner(opened);
  const name = conversationName(opened);

  // A chat command steers an agent and is never sent as a message.
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

  const input = chatInputOf(opened, page.selection, {
    sending,
    maximumMs: page.voiceMaximumMs,
  });
  const memberIds =
    opened.kind === "group" ? opened.group.memberIds : [opened.participant.id];
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
        memberIds={memberIds}
        attachments={input.attachments}
        voice={input.voice}
        call={
          call ? { isRunning: call.isRunning, onStart: call.start } : undefined
        }
        mentionRef={mentionRef}
      />
    </div>
  );
}

/**
 * The message a "Zur Nachricht" link points to, once its chat is the opened
 * one; another chat never looks for it.
 */
function focusOf(
  selection: VirtualChatSelection | null,
  requested: VirtualChatSelection | undefined,
  messageId: string | undefined,
): { readonly focusMessageId?: string } {
  if (messageId === undefined || !requested || !selection) return {};
  return selection.kind === requested.kind && selection.id === requested.id
    ? { focusMessageId: messageId }
    : {};
}

/** The opened conversation directly on the page background, without card. */
function ChatPageConversation({
  page,
  status,
  focusMessageId,
  readingPositions,
}: {
  readonly page: ChatPageState;
  readonly status?: ChatDecisionStatus;
  /** The message a "Zur Nachricht" link points to. */
  readonly focusMessageId?: string;
  /** Where the person stopped reading in each chat, by chat key. */
  readonly readingPositions: Readonly<Record<string, string>> | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const { opened } = page;
  const { besideBrowserId, openBrowserBeside } = useChatContent();
  const confidential = useConfidential(opened);
  const mentionRef = useRef<((username: string) => void) | null>(null);
  const call = useDirectCall(
    opened?.kind === "participant" ? opened.participant : null,
  );
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
      {call?.phase ? (
        <ChatCallBar
          phase={call.phase}
          name={name}
          onEnd={call.end}
          audio={call.audio}
        />
      ) : null}
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
        isLoading={page.isHistoryLoading}
        chatKey={conversationKey(opened)}
        readingPositions={readingPositions}
        {...(focusMessageId === undefined ? {} : { focusMessageId })}
      />
      {page.live.answers.length === 0 ? (
        <ChatPageLiveTools tools={page.liveTools} onCancel={page.cancelTool} />
      ) : null}
      <ChatBrowserPanel
        chatSessionIds={openedSessionIds(opened)}
        besideBrowserId={besideBrowserId}
        onOpenBeside={openBrowserBeside}
        className="mr-22 mb-3"
      />
      <ConversationFoot
        key={conversationKey(opened)}
        page={page}
        opened={opened}
        call={call}
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
 * for chat and panel on screens below 1536 px.
 */
function ListSlot({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const { beside, media } = useChatContent();
  const besideBrowser = useBesideBrowser();
  const isSplit =
    beside !== null || besideBrowser !== null || media === "beside";
  return (
    <div className={isSplit ? "hidden 2xl:contents" : "contents"}>
      {children}
    </div>
  );
}

interface ChatPageProps {
  readonly directory: VirtualChatDirectory;
  readonly requestedSelection?: VirtualChatSelection;
  /** The message of a "Zur Nachricht" link in the requested chat. */
  readonly requestedMessageId?: string;
}

function ChatPageLayout({
  directory,
  requestedSelection,
  requestedMessageId,
}: ChatPageProps): React.ReactElement {
  const { t } = useTranslation();
  const page = useChatPage(directory, requestedSelection);
  useChatToastSelection({
    selection: page.selection,
    requested: requestedSelection,
    select: page.select,
  });
  useVisibleChatPresence(page.selection, storedConversationId(page.opened));
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
                readingPositions={directory.viewPreferences?.readingPositions}
                {...focusOf(
                  page.selection,
                  requestedSelection,
                  requestedMessageId,
                )}
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

/**
 * The chat page with people, agents and groups.
 *
 * @remarks
 * Two columns 32 px apart down to the foot of the page: the list card of 340
 * px with a scroll area for each list, and the chat without card or
 * background. The list collapses to a bar of avatars of 72 px, by its toggle
 * or `Ctrl+Shift+L`, and the chat takes the room. From 768 px on
 * the page fills the screen and the document never scrolls; only the
 * history and the list do.
 * Below `lg` the list stands above the chat; below `md` a selection replaces
 * it. Messages go to active agents, which answer over ACP, and into the
 * stored conversations with people and of groups. The list holds
 * only existing people and agents the person chose or who wrote to them, and
 * groups of them. Content of messages shows as cards; one of them opens
 * right of the chat in the split view or over the page, as does
 * "Medien & Dateien" of the chat. A right click or a long press
 * on a conversation of the list opens it with its chat menu at the point.
 * The operator browser of an agent shows only in the chat it works in, as a
 * preview row above the input or beside the chat, and its list entry carries
 * a globe in the color of its state.
 */
export function ChatPage(props: ChatPageProps): React.ReactElement {
  return (
    <ChatBrowsersProvider isOpen>
      <ChatPageLayout {...props} />
    </ChatBrowsersProvider>
  );
}

const PRESENCE_HEARTBEAT_MILLISECONDS = 20_000;

function ChatDecisionHealth({
  status,
  opened,
  messages,
}: {
  readonly status: ChatDecisionStatus | undefined;
  readonly opened: OpenedConversation | null;
  readonly messages: readonly VirtualChatMessage[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (opened?.kind !== "group" || status === undefined) return null;
  const last = [...messages]
    .reverse()
    .find((message) => message.decision)?.decision;
  const isDecision =
    !opened.group.replyMode || opened.group.replyMode === "decision";
  const hasFallback =
    isDecision && last !== undefined && last.fallback !== "none";
  return (
    <p
      role="status"
      className="text-xs text-muted-foreground"
      data-chat-decision-status={status}
    >
      {opened.group.replyMode && opened.group.replyMode !== "decision"
        ? t(`chatPage.replySettings.modes.${opened.group.replyMode}.label`)
        : t(`chatPage.decisionHealth.${status}`)}
      {hasFallback
        ? ` · ${t(`chatPage.replySettings.decisions.result.unavailable.${last.fallback}`)}`
        : ""}
    </p>
  );
}

function encodeChatSelection(selection: VirtualChatSelection | null): string {
  return selection ? `${selection.kind}:${selection.id}` : "";
}

function decodeChatSelection(value: string): VirtualChatSelection | null {
  const separator = value.indexOf(":");
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (kind === "group" || kind === "participant") return { kind, id };
  return null;
}

function ChatPagePicker({
  page,
}: {
  readonly page: ChatPageState;
}): React.ReactElement {
  const { t } = useTranslation();
  const options = [
    ...page.allGroups.map((group) => ({
      value: encodeChatSelection({ kind: "group", id: group.id }),
      label: group.name,
      description: t("chatPage.groupOption"),
    })),
    ...page.allParticipants.map((participant) => ({
      value: encodeChatSelection({ kind: "participant", id: participant.id }),
      label: participant.name,
      description: participant.role,
    })),
  ];

  function handleChange(value: string): void {
    const selection = decodeChatSelection(value);
    if (selection) page.select(selection);
  }

  return (
    <div className="shrink-0 md:hidden">
      <Select
        ariaLabel={t("chatPage.selectLabel")}
        className="w-full"
        onValueChange={handleChange}
        options={options}
        placeholder={t("chatPage.selectLabel")}
        size="default"
        value={encodeChatSelection(page.selection)}
      />
    </div>
  );
}

function useChatToastSelection(options: {
  readonly selection: VirtualChatSelection | null;
  readonly requested: VirtualChatSelection | undefined;
  readonly select: (selection: VirtualChatSelection) => void;
}): void {
  const { dispatch } = useToastCenter();
  const { select } = options;
  const kind = options.requested?.kind;
  const id = options.requested?.id;
  useEffect(() => {
    if (kind && id) select({ kind, id });
  }, [kind, id, select]);
  const key = options.selection ? toastChatKey(options.selection) : null;
  useEffect(() => {
    const update = (): void => {
      dispatch({
        type: "open-chat",
        key: document.visibilityState === "visible" ? key : null,
      });
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      dispatch({ type: "open-chat", key: null });
    };
  }, [key, dispatch]);
}

interface RevealHistory {
  readonly messageCount: number;
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
  loadOlder(): void;
}

function useMessageReveal(history: RevealHistory): (messageId: string) => void {
  const [wanted, setWanted] = useState<string | null>(null);
  const requestedAt = useRef<number | null>(null);
  const { messageCount, hasOlder, isLoadingOlder, loadOlder } = history;

  useEffect(() => {
    if (wanted === null) return;
    const element = messageElement(wanted);
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      element.focus({ preventScroll: true });
      setWanted(null);
      return;
    }
    if (isLoadingOlder || !hasOlder || requestedAt.current === messageCount)
      return;
    requestedAt.current = messageCount;
    loadOlder();
  }, [wanted, messageCount, hasOlder, isLoadingOlder, loadOlder]);

  return function reveal(messageId: string): void {
    requestedAt.current = null;
    setWanted(messageId);
  };
}

function useVisibleChatPresence(
  selection: VirtualChatSelection | null,
  conversationId: string | null,
): void {
  const connectionId = useRef<string | null>(null);
  const selectedChatKey = selection ? toastChatKey(selection) : null;
  useEffect(() => {
    connectionId.current ??= crypto.randomUUID();
    const id = connectionId.current;
    function report(): void {
      const isVisible = document.visibilityState === "visible";
      const chatKey = isVisible ? selectedChatKey : null;
      void fetch("/chat-page-api/presence", {
        method: "POST",
        headers: backendRequestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          connectionId: id,
          chatKey,
          conversationId: chatKey === null ? null : conversationId,
        }),
        keepalive: true,
      }).catch(() => undefined);
    }
    report();
    const timer = window.setInterval(
      () => report(),
      PRESENCE_HEARTBEAT_MILLISECONDS,
    );
    const onVisibilityChange = (): void => report();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedChatKey, conversationId]);
  useEffect(
    () => () => {
      if (connectionId.current === null) return;
      void fetch("/chat-page-api/presence", {
        method: "POST",
        headers: backendRequestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          connectionId: connectionId.current,
          chatKey: null,
          conversationId: null,
        }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [],
  );
}
