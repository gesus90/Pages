import { randomUUID } from "node:crypto";

import { ConversationLiveAnswer } from "./ConversationLiveAnswer";
import { sharedConversationEvents } from "./ConversationEvents";

import type { LiveAnswerSnapshot } from "@/definition/ConversationLiveAnswer";
import type { ConversationEvents } from "./ConversationEvents";
import type { LiveAnswerTarget } from "./ConversationLiveAnswer";

/** How long an ended answer stays readable for a client that reconnects. */
const ENDED_ANSWER_RETENTION_MS = 10 * 60_000;

/** What the stream is created with. */
export interface ConversationAnswerStreamOptions {
  readonly events: Pick<ConversationEvents, "publish">;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/**
 * The answers agents are writing now, for the chat page of the web.
 * @remarks
 * Every job of an agent in a chat opens one {@link ConversationLiveAnswer},
 * which publishes its parts as `answer` events on the in-process channel of
 * conversations; `conversations.v1` sends them on to the web. A client that
 * connects while an answer is written, or shortly after it ended, reads it
 * from {@link ConversationAnswerStream.snapshots}, so nothing is missing after
 * a reconnect. Nothing is stored.
 */
export class ConversationAnswerStream {
  private readonly events: Pick<ConversationEvents, "publish">;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly answers = new Set<ConversationLiveAnswer>();

  /**
   * Creates the stream.
   * @param options - The channel it publishes to, and test hooks.
   */
  public constructor(options: ConversationAnswerStreamOptions) {
    this.events = options.events;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  /**
   * Opens the live answer of one job.
   * @param target - Who reads it and how it ends.
   * @returns The sink the job reports to.
   */
  public open(target: LiveAnswerTarget): ConversationLiveAnswer {
    this.forgetEnded();
    const answer = new ConversationLiveAnswer(target, {
      publish: (payload, recipientIds) =>
        this.events.publish({ kind: "answer", payload, recipientIds }),
      now: this.now,
      createId: this.createId,
    });
    this.answers.add(answer);
    return answer;
  }

  /**
   * The answers an account may read now: running ones and those that ended
   * a short while ago, thoughts only where the account may see them.
   * @param userId - The account of the connection.
   * @returns The snapshots, oldest answer first.
   */
  public snapshots(userId: string): LiveAnswerSnapshot[] {
    this.forgetEnded();
    return [...this.answers].flatMap((answer) => {
      const snapshot = answer.snapshotFor(userId);
      return snapshot ? [snapshot] : [];
    });
  }

  private forgetEnded(): void {
    const limit = this.now().getTime() - ENDED_ANSWER_RETENTION_MS;
    for (const answer of this.answers)
      if (answer.hasEndedBefore(limit)) this.answers.delete(answer);
  }
}

declare global {
  var pagesConversationAnswerStream: ConversationAnswerStream | undefined;
}

/**
 * The one stream of the process, shared by the jobs of agents and the
 * connections of `conversations.v1`.
 * @returns The same stream on every call.
 */
export function sharedConversationAnswerStream(): ConversationAnswerStream {
  globalThis.pagesConversationAnswerStream ??= new ConversationAnswerStream({
    events: sharedConversationEvents(),
  });
  return globalThis.pagesConversationAnswerStream;
}
