import { readAnswer } from "./PicaAcpTurnResult";

import type { NewChatMessage } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ChatSteerStatus } from "@/definition/ChatJob";
import type { PicaAcpAnswerOutput } from "./PicaAcpAnswerOutput";
import type { PicaAcpJobDependencies } from "./PicaAcpJobDependencies";
import type { PicaAcpJournal } from "./PicaAcpJournal";

/** What a job writes to its conversation and journal: the stores and the job's identity. */
export interface PicaAcpAnswerStoreInput {
  readonly dependencies: Pick<PicaAcpJobDependencies, "messages" | "steers">;
  readonly userId: string;
  readonly sessionId: string;
  readonly journal: Pick<PicaAcpJournal, "record">;
  readonly answers: PicaAcpAnswerOutput;
}

/** Stores the answers of a job and records the delivery of its steers. */
export class PicaAcpAnswerStore {
  private readonly input: PicaAcpAnswerStoreInput;

  public constructor(input: PicaAcpAnswerStoreInput) {
    this.input = input;
  }

  /**
   * Stores the answer of a turn as a message of the conversation.
   *
   * @returns The ID of the stored message.
   */
  public async store(
    turn: number,
    output: string,
    ending: Pick<NewChatMessage, "isStopped"> = {},
  ): Promise<string> {
    const { dependencies, userId, sessionId, journal, answers } = this.input;
    await answers.settle(turn);
    const content = readAnswer(output);
    const message = await dependencies.messages.append(userId, sessionId, {
      role: "assistant",
      content,
      ...ending,
    });
    // Files of this turn are linked before the answer event, so the browser reads them with it.
    await answers.claim(turn, message.id);
    await journal.record({ kind: "answer", turn, messageId: message.id });
    return message.id;
  }

  /** Records the status a steer message got from the adapter. */
  public async steer(
    messageId: string,
    status: ChatSteerStatus,
  ): Promise<void> {
    const { dependencies, journal } = this.input;
    await dependencies.steers.update(messageId, status);
    await journal.record({ kind: "steer", messageId, status });
  }
}
