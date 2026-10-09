import { useEffect, useRef, useState } from "react";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import {
  assistantApi,
  assistantErrorCode,
  readAssistantConversations,
  readAssistantMessages,
} from "@/app/lib/text-assistant-client";

import type {
  AssistantConversation,
  AssistantMessage,
  TextAssistantContext,
  TextAssistantPreferences,
} from "@/definition/TextAssistant";

/** State for the current user's explicitly opened context. */
export interface AssistantHistoryState {
  readonly conversations: readonly AssistantConversation[];
  readonly messages: readonly AssistantMessage[];
  readonly conversationId: string | null;
  readonly preferences: TextAssistantPreferences;
  readonly error: string;
  readonly select: (id: string | null) => Promise<void>;
  readonly refresh: (id: string) => Promise<void>;
  readonly remove: () => Promise<void>;
  readonly configure: (preferences: TextAssistantPreferences) => Promise<void>;
}

interface HistorySetters {
  readonly setConversations: React.Dispatch<
    React.SetStateAction<AssistantConversation[]>
  >;
  readonly setMessages: React.Dispatch<
    React.SetStateAction<AssistantMessage[]>
  >;
  readonly setConversationId: (id: string | null) => void;
  readonly setPreferences: (preferences: TextAssistantPreferences) => void;
  readonly setError: (error: string) => void;
}

function useHistoryLoader(
  context: TextAssistantContext,
  isOpen: boolean,
  state: HistorySetters,
): void {
  const { kind, id } = context;
  const { setConversations, setPreferences, setError } = state;
  useEffect(() => {
    if (!isOpen) return undefined;
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const result = await assistantApi(
          {
            intent: "history",
            context: { kind, id, version: kind === "wiki" ? "0" : "" },
          },
          controller.signal,
        );
        const saved = readAgentObject(result.preferences);
        if (controller.signal.aborted) return;
        setConversations(readAssistantConversations(result.conversations));
        setPreferences({
          autoApply: saved.autoApply === true,
          targetLanguage:
            typeof saved.targetLanguage === "string"
              ? saved.targetLanguage
              : "de",
        });
      } catch (failure: unknown) {
        if (!controller.signal.aborted) setError(assistantErrorCode(failure));
      }
    }
    void load();
    return () => controller.abort();
  }, [kind, id, isOpen, setConversations, setPreferences, setError]);
}

function useHistoryOperations(
  context: TextAssistantContext,
  state: HistorySetters,
): Pick<AssistantHistoryState, "select" | "refresh" | "remove" | "configure"> {
  const current = useRef<{
    key: string;
    selection: string | null;
    revision: number;
  }>({ key: "", selection: null, revision: 0 });
  const key = `${context.kind}:${context.id}`;
  if (current.current.key !== key)
    current.current = {
      key,
      selection: null,
      revision: current.current.revision + 1,
    };
  useEffect(
    () => () => {
      current.current.revision += 1;
    },
    [key],
  );

  async function select(selected: string | null): Promise<void> {
    const revision = ++current.current.revision;
    current.current.selection = selected;
    state.setError("");
    state.setConversationId(selected);
    state.setMessages([]);
    if (selected === null) return;
    try {
      const result = await assistantApi({
        intent: "messages",
        context,
        id: selected,
      });
      if (current.current.key === key && current.current.revision === revision)
        state.setMessages(readAssistantMessages(result.messages));
    } catch (failure: unknown) {
      if (current.current.key === key && current.current.revision === revision)
        state.setError(assistantErrorCode(failure));
    }
  }

  async function refresh(selected: string): Promise<void> {
    if (current.current.key !== key) return;
    await select(selected);
    const revision = current.current.revision;
    try {
      const result = await assistantApi({ intent: "history", context });
      if (current.current.key === key && current.current.revision === revision)
        state.setConversations(
          readAssistantConversations(result.conversations),
        );
    } catch (failure: unknown) {
      if (current.current.key === key && current.current.revision === revision)
        state.setError(assistantErrorCode(failure));
    }
  }

  async function remove(): Promise<void> {
    const selected = current.current.selection;
    if (selected === null) return;
    try {
      await assistantApi({ intent: "delete", id: selected });
      if (current.current.key !== key) return;
      state.setConversations((entries) =>
        entries.filter((entry) => entry.id !== selected),
      );
      if (current.current.selection === selected) await select(null);
    } catch (failure: unknown) {
      if (current.current.key === key)
        state.setError(assistantErrorCode(failure));
    }
  }

  async function configure(next: TextAssistantPreferences): Promise<void> {
    try {
      await assistantApi({ intent: "preferences", preferences: next });
      state.setPreferences(next);
    } catch (failure: unknown) {
      if (current.current.key === key)
        state.setError(assistantErrorCode(failure));
    }
  }

  return { select, refresh, remove, configure };
}

/** Opening reads history/preferences only; no provider turn or conversation is created. */
export function useAssistantHistory(
  context: TextAssistantContext,
  isOpen: boolean,
): AssistantHistoryState {
  const [conversations, setConversations] = useState<AssistantConversation[]>(
    [],
  );
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<TextAssistantPreferences>({
    autoApply: false,
    targetLanguage: "de",
  });
  const [error, setError] = useState("");
  const { kind, id } = context;
  useEffect(() => {
    setConversationId(null);
    setConversations([]);
    setMessages([]);
    setError("");
  }, [kind, id]);
  const setters = {
    setConversations,
    setMessages,
    setConversationId,
    setPreferences,
    setError,
  };
  useHistoryLoader(context, isOpen, setters);
  const operations = useHistoryOperations(context, setters);
  return {
    conversations,
    messages,
    conversationId,
    preferences,
    error,
    ...operations,
  };
}
