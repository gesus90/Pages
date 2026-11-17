import { logCaughtError } from "@/backend/logging/Logger";

import { changedEvent } from "./ConversationReplyNotices";

import type { ConversationDeliveryState } from "@/definition/ConversationRecipientDelivery";
import type {
  ConversationReplyJob,
  ConversationReplyRunnerDependencies,
} from "./ConversationReplyTypes";

const COMPONENT = "ConversationAgentReplies";

/** Where the deliveries are stored and who hears about them. */
type DeliveryDependencies = Pick<
  ConversationReplyRunnerDependencies,
  "rounds" | "publisher" | "now"
>;

/**
 * Records per recipient what the server confirmed about the message of a
 * person and tells the members of the conversation about it.
 * @remarks
 * Only jobs that carry a delivery intent are recorded. The writes of one job
 * run one after the other, so a later state never loses against an earlier
 * one; a failed write is logged and never stops the answer.
 */
export class ConversationReplyDeliveries {
  private readonly dependencies: DeliveryDependencies;
  private readonly writes = new Map<string, Promise<void>>();

  public constructor(dependencies: DeliveryDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Records the confirmed delivery of the job's message to its agent.
   * @returns Once this and every earlier write of the job ended.
   */
  public record(
    job: ConversationReplyJob,
    state: ConversationDeliveryState,
  ): Promise<void> {
    if (job.delivery === undefined) return Promise.resolve();
    const key = `${job.triggerMessageId}:${job.agentId}`;
    const write = (this.writes.get(key) ?? Promise.resolve()).then(() =>
      this.write(job, state),
    );
    this.writes.set(key, write);
    return write.finally(() => {
      if (this.writes.get(key) === write) this.writes.delete(key);
    });
  }

  private async write(
    job: ConversationReplyJob,
    state: ConversationDeliveryState,
  ): Promise<void> {
    const conversationId = job.round.conversation.id;
    try {
      await this.dependencies.rounds.deliveries.record(
        {
          originMessageId: job.round.originMessageId,
          agentId: job.agentId,
          triggerMessageId: job.triggerMessageId,
        },
        {
          state,
          updatedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
        },
      );
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);
      return;
    }
    this.dependencies.publisher.publish(changedEvent(conversationId));
  }
}
