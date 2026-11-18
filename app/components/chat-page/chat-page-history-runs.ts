import type { AgentAnswerModel } from "@/definition/AgentChatControl";
import type { VirtualChatMessage } from "@/definition/VirtualChat";
import type { LiveAnswerView } from "./live/live-answer-state";

/** Consecutive messages of one author: `null` for the person's own messages. */
interface MessageRun {
  readonly authorId: string | null;
  readonly messages: readonly VirtualChatMessage[];
}

/**
 * The model an answer is known to have: the one kept with its message, or the
 * live snapshot while that metadata is still being saved.
 */
export function knownAnswerModel(
  message: VirtualChatMessage | undefined,
  ended: ReadonlyMap<string, LiveAnswerView>,
): AgentAnswerModel | undefined {
  if (!message) return undefined;
  return message.answerModel ?? ended.get(message.id)?.model;
}

function canShareAnswerHead(
  first: AgentAnswerModel | undefined,
  next: AgentAnswerModel | undefined,
): boolean {
  if (first?.provider !== "openrouter" && next?.provider !== "openrouter")
    return true;
  if (!first || !next || first.provider !== next.provider) return false;
  return (
    first.modelId === next.modelId &&
    first.name === next.name &&
    first.isFree === next.isFree &&
    first.reasoningEffort === next.reasoningEffort &&
    first.modelStatus === next.modelStatus &&
    first.reasoningStatus === next.reasoningStatus
  );
}

/**
 * Splits messages into runs of one author; a run breaks where two answers
 * with different OpenRouter models would share one head.
 */
export function groupRuns(
  messages: readonly VirtualChatMessage[],
  ended: ReadonlyMap<string, LiveAnswerView>,
): MessageRun[] {
  const runs: MessageRun[] = [];
  for (const message of messages) {
    const last = runs.at(-1);
    if (
      last &&
      last.authorId === message.authorId &&
      canShareAnswerHead(
        knownAnswerModel(last.messages[0], ended),
        knownAnswerModel(message, ended),
      )
    )
      runs[runs.length - 1] = {
        authorId: last.authorId,
        messages: [...last.messages, message],
      };
    else runs.push({ authorId: message.authorId, messages: [message] });
  }
  return runs;
}
