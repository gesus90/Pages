import { useState } from "react";

import { parseAgentChatCommand } from "@/definition/AgentChatControl";

import { useAgentControl } from "./use-agent-control";

import type { AgentChatCommandOutcome } from "@/definition/AgentChatControl";
import type { OpenedConversation } from "./use-chat-page";

/** The chat commands of the opened chat and what the last one answered. */
export interface ChatCommandRunner {
  /** Whether the chat takes commands: the direct chat with an agent or a group. */
  readonly isAvailable: boolean;
  /** What the last command answered; `null` before one or once dismissed. */
  readonly outcome: AgentChatCommandOutcome | null;
  readonly isPending: boolean;
  /** Whether the failure of the request, such as `forbidden`, is shown. */
  readonly failure: ReturnType<typeof useAgentControl>["failure"];
  /** Runs the text as a command when it is one. */
  runIfCommand(text: string): boolean;
  /** Runs a command, such as one a choice of the last answer completed. */
  run(text: string): void;
  dismiss(): void;
}

/** The fields that name the chat of a command. */
function chatFields(opened: OpenedConversation): Record<string, string> | null {
  if (opened.kind === "group")
    return opened.group.isAgentConversation === true
      ? null
      : { kind: "group", conversationId: opened.group.id };
  return opened.participant.kind === "agent"
    ? { kind: "direct", agentId: opened.participant.id }
    : null;
}

/**
 * Runs `/model`, `/new` and `/compact` typed into the input field of a chat
 * with agents (PAGE-380) instead of sending them: a command never reaches an
 * agent and asks for no answer.
 *
 * @param opened - The opened conversation.
 */
export function useChatCommandRunner(
  opened: OpenedConversation,
): ChatCommandRunner {
  const request = useAgentControl();
  const [outcome, setOutcome] = useState<AgentChatCommandOutcome | null>(null);
  const fields = chatFields(opened);

  function run(text: string): void {
    if (fields === null) return;
    setOutcome(null);
    void request
      .send({ intent: "command", text, ...fields })
      .then((response) => {
        if (response?.ok === true && response.outcome)
          setOutcome(response.outcome);
      });
  }

  function runIfCommand(text: string): boolean {
    if (fields === null || parseAgentChatCommand(text) === null) return false;
    run(text);
    return true;
  }

  function dismiss(): void {
    setOutcome(null);
    request.clearFailure();
  }

  return {
    isAvailable: fields !== null,
    outcome,
    isPending: request.isPending,
    failure: request.failure,
    runIfCommand,
    run,
    dismiss,
  };
}
