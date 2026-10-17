import { useCallback, useEffect, useState } from "react";

import {
  chatApi,
  chatErrorCode,
  readChatOverview,
  readChatSessionView,
} from "@/app/lib/chat-client";
import { readChatCommand } from "@/definition/Chat";

import { toChatView, useChatCommands } from "./use-chat-commands";
import { useChatContext } from "./use-chat-context";
import { useChatJob } from "./use-chat-job";
import { isQuotaDemoCommand, useChatQuotaDemo } from "./use-chat-quota-demo";
import { useChatSend } from "./use-chat-send";
import { applyChatSessionRead, useChatUploads } from "./use-chat-uploads";

import type { ChatConfirmationWord, ChatContextSize } from "@/definition/Chat";
import type { ChatTemporaryPassword } from "@/definition/AgentAdministration";
import type { ChatCommands } from "./use-chat-commands";
import type { ChatJobs } from "./use-chat-job";
import type { ChatQuotaDemo } from "./use-chat-quota-demo";
import type { ChatSending, ChatSubmitOutcome } from "./use-chat-send";
import type { ChatUploads, ChatView } from "./use-chat-uploads";

/** Limits that apply to the person, read when the panel opens first. */
interface ChatLimits {
  readonly limitBytes: number;
  readonly confirmationWord: ChatConfirmationWord;
}

/** Everything the chat panel shows and does. */
export interface ChatController {
  readonly isLoading: boolean;
  readonly view: ChatView;
  readonly limits: ChatLimits | null;
  readonly sending: ChatSending | null;
  readonly temporaryPasswords: readonly ChatTemporaryPassword[];
  readonly error: string | null;
  readonly commands: ChatCommands;
  readonly context: ChatContextSize | null;
  readonly isCompacting: boolean;
  readonly uploads: ChatUploads;
  /** The server-side job of a Codex agent in the open conversation (PAGE-68). */
  readonly jobs: ChatJobs;
  /** The simulated quota state of the panel, started with `/quota` (PAGE-96). */
  readonly quotaDemo: ChatQuotaDemo;
  submit(text: string): Promise<ChatSubmitOutcome>;
  cancel(): void;
  dismissTemporaryPasswords(): void;
}

const EMPTY_VIEW: ChatView = { session: null, messages: [], pending: [] };

/** Loads the panel when it opens first, so the session field shows its ID. */
function useChatLoad(
  isOpen: boolean,
  setView: (view: ChatView) => void,
  setError: (code: string) => void,
): { readonly isLoading: boolean; readonly limits: ChatLimits | null } {
  const [limits, setLimits] = useState<ChatLimits | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || limits !== null) return undefined;
    let isCurrent = true;
    async function load(): Promise<void> {
      setIsLoading(true);
      try {
        const result = await chatApi({ intent: "open" });
        const overview = readChatOverview(result.overview);
        if (!isCurrent) return;
        setView(toChatView(overview));
        setLimits({
          limitBytes: overview.attachmentLimitBytes,
          confirmationWord: overview.confirmationWord,
        });
      } catch (failure: unknown) {
        if (isCurrent) setError(chatErrorCode(failure));
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }
    void load();
    return () => {
      isCurrent = false;
    };
  }, [isOpen, limits, setView, setError]);

  return { isLoading, limits };
}

/**
 * The state of the chat panel: the open session, sending, the chat commands
 * and the attachments of the next message.
 */
export function useChat(isOpen: boolean): ChatController {
  const [view, setView] = useState<ChatView>(EMPTY_VIEW);
  const [error, setError] = useState<string | null>(null);
  const { isLoading, limits } = useChatLoad(isOpen, setView, setError);
  // Stable, so following a job does not restart its reads on every render.
  const refresh = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const result = await chatApi({ intent: "session", sessionId });
      const fresh = readChatSessionView(result.view);
      setView((current) => applyChatSessionRead(current, fresh));
    } catch {
      // The next read of the job reads the conversation again.
    }
  }, []);
  const jobs = useChatJob({ isOpen, view, reload: refresh, setError });
  const sender = useChatSend({
    isOpen,
    view,
    setView,
    setError,
    onJob: jobs.attach,
    refresh,
  });
  const commands = useChatCommands({ setView, setError });
  const context = useChatContext({
    isOpen,
    view,
    reported: jobs.isRunning ? (jobs.live?.usage.context ?? null) : undefined,
    setError,
    setNotice: commands.setNotice,
  });
  const quotaDemo = useChatQuotaDemo({ setNotice: commands.setNotice });
  const uploads = useChatUploads({
    view,
    limitBytes: limits?.limitBytes ?? null,
    setView,
    setError,
  });

  async function submit(text: string): Promise<ChatSubmitOutcome> {
    if (context.isCompacting || commands.isDeleting) return "restore";
    setError(null);
    commands.setNotice(null);
    if (isQuotaDemoCommand(text)) {
      commands.closePicker();
      quotaDemo.start();
      return "clear";
    }
    const command = readChatCommand(text);
    if (command !== null) {
      if (command === "/compact") {
        commands.closePicker();
        await context.compact();
      } else await commands.run(command);
      return "clear";
    }
    if (/^\/\S*$/u.test(text.trim())) {
      commands.setNotice("unknownCommand");
      return "restore";
    }
    // The conversation replaces the session list, so the answer and its progress stay in view.
    commands.closePicker();
    const sessionId = view.session?.id;
    // The simulated quota keeps the message in the input; only sending it again asks the agent.
    if (quotaDemo.isHolding && sessionId !== undefined) {
      quotaDemo.hold(sessionId);
      return "restore";
    }
    return sender.send(text);
  }

  return {
    isLoading,
    view,
    limits,
    sending: sender.sending,
    temporaryPasswords: sender.temporaryPasswords,
    error,
    commands,
    context: context.context,
    isCompacting: context.isCompacting,
    uploads,
    jobs,
    quotaDemo,
    submit,
    cancel: sender.cancel,
    dismissTemporaryPasswords: sender.dismissTemporaryPasswords,
  };
}
