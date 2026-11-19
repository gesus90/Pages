import type { LiveAnswerSink } from "@/backend/service/conversation/ConversationLiveAnswer";

/** What a voice call reads from the answer of a running job. */
export interface AnswerTap {
  /** New text of the answer of a turn; `isReset` replaces the text of that turn so far. */
  text(turn: number, delta: string, isReset: boolean): void;
  /** The answer of a turn was stored as a message of the session. */
  stored(turn: number, messageId: string): void;
  /** The job ended; no more text follows. */
  ended(): void;
}

/**
 * Lets a call listen to the live answer of a job without taking it from the
 * chat page.
 * @param inner - The live answer the chat page shows; every report goes to it
 * unchanged, so the text answer appears in the chat as usual. Without one
 * only the call listens.
 * @param tap - What the call wants to hear.
 * @returns The sink the job reports to.
 */
export function tapLiveAnswer(
  inner: LiveAnswerSink | undefined,
  tap: AnswerTap,
): LiveAnswerSink {
  return {
    start: (turn) => inner?.start(turn),
    complete: (turn) => inner?.complete(turn),
    journaled: (event) => {
      inner?.journaled(event);
      if (event.kind === "text")
        tap.text(event.turn, event.delta, event.isReset);
      if (event.kind === "answer") tap.stored(event.turn, event.messageId);
      // A job ends with its journal entry; only a failed start reports through `finish`.
      if (event.kind === "end") tap.ended();
    },
    thought: (turn, delta) => inner?.thought(turn, delta),
    cancelTools: () => inner?.cancelTools(),
    useModel: (model) => inner?.useModel(model),
    ...(inner?.confirmModel
      ? { confirmModel: (reported) => inner.confirmModel?.(reported) }
      : {}),
    finish: (end) => {
      inner?.finish(end);
      tap.ended();
    },
  };
}
