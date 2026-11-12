import type {
  ChatJob,
  ChatJobEntry,
  ChatJobToolEvent,
} from "@/definition/ChatJob";
import type { VirtualToolUse } from "@/definition/VirtualChat";

/** The tool calls of one job as the chat page shows them (PAGE-303). */
export interface AgentToolCallView {
  /** The calls each stored answer of the job was made with, by message id. */
  readonly byMessage: Readonly<Record<string, readonly VirtualToolUse[]>>;
  /** The calls after the last stored answer: those of the answer in progress. */
  readonly current: readonly VirtualToolUse[];
}

function toolUse(event: ChatJobToolEvent): VirtualToolUse {
  return {
    name: event.tool,
    detail: event.error ?? "",
    callId: event.callId,
    status: event.status,
    ...(event.input === undefined ? {} : { input: event.input }),
    ...(event.output === undefined ? {} : { output: event.output }),
    ...(event.isNative === true ? { isNative: true } : {}),
  };
}

/**
 * Folds the journal of a job into the tool calls of its answers.
 *
 * @param entries - The journal, oldest first.
 * @returns Every call in its last state, under the answer that followed it.
 *
 * @remarks
 * A call is journaled once per change of its state; the last entry wins and
 * the call keeps the place of its first entry. The calls journaled before an
 * answer belong to that answer.
 */
export function foldToolCalls(
  entries: readonly ChatJobEntry[],
): AgentToolCallView {
  const byMessage: Record<string, VirtualToolUse[]> = {};
  const owner = new Map<string, string | null>();
  const latest = new Map<string, ChatJobToolEvent>();
  let pending: string[] = [];
  for (const { event } of entries) {
    if (event.kind === "tool") {
      if (!latest.has(event.callId)) pending.push(event.callId);
      latest.set(event.callId, event);
      continue;
    }
    if (event.kind !== "answer") continue;
    for (const callId of pending) owner.set(callId, event.messageId);
    pending = [];
  }
  const current: VirtualToolUse[] = [];
  for (const [callId, event] of latest) {
    const messageId = owner.get(callId);
    if (messageId === undefined || messageId === null) {
      current.push(toolUse(event));
      continue;
    }
    (byMessage[messageId] ??= []).push(toolUse(event));
  }
  return { byMessage, current };
}

/**
 * Folds the journals of several jobs of a conversation.
 *
 * @param journals - The jobs, oldest first, each with its journal.
 * @returns The calls of every stored answer, and the calls of the answer in
 * progress of the newest job when it still runs.
 */
export function foldJobToolCalls(
  journals: readonly {
    readonly job: Pick<ChatJob, "state">;
    readonly events: readonly ChatJobEntry[];
  }[],
): AgentToolCallView {
  const byMessage: Record<string, readonly VirtualToolUse[]> = {};
  let current: readonly VirtualToolUse[] = [];
  for (const journal of journals) {
    const view = foldToolCalls(journal.events);
    Object.assign(byMessage, view.byMessage);
    current = journal.job.state === "running" ? view.current : [];
  }
  return { byMessage, current };
}
