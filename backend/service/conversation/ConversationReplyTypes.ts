import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationRecord,
  ConversationRepository,
} from "@/backend/database/repositories/conversation/ConversationRepository";
import type { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { ConversationReplyTrigger } from "@/definition/ConversationObserver";
import type { User } from "@/definition/User";
import type { ConversationAgentGuard } from "./ConversationAgentGuard";
import type { ConversationAgentFiles } from "./content/ConversationAgentFiles";
import type { ConversationAttachments } from "./content/ConversationAttachments";
import type { ConversationMessageContentReader } from "./content/ConversationMessageContent";
import type { ConversationAgentRunner } from "./ConversationAgentReplies";
import type { ConversationContextReader } from "./ConversationContextReader";
import type { ConversationDirectory } from "./ConversationDirectory";
import type { ConversationEvents } from "./ConversationEvents";

/** The message of a person and the conversation its round of answers belongs to. */
export interface ConversationRound {
  readonly originMessageId: string;
  readonly conversation: ConversationRecord;
  readonly memberIds: readonly string[];
  /** The person who wrote the message. */
  readonly person: User;
}

/** One claimed answer of one agent in a round. */
export interface ConversationReplyJob {
  readonly round: ConversationRound;
  readonly agentId: string;
  readonly trigger: ConversationReplyTrigger;
  /** The message the agent answers: the person's, or the answer of another agent. */
  readonly triggerMessageId: string;
  readonly reason: string;
  /** A single continuation of a consumed question batch. */
  readonly isFollowUp?: boolean;
  /**
   * The messages since the agent's last one, oldest first: the round replies
   * of a batch, or everything a resumed hand-over missed (PAGE-349).
   */
  readonly contextMessageIds?: readonly string[];
}

/** What one answer of an agent uses. */
export interface ConversationReplyRunnerDependencies {
  readonly conversations: Pick<ConversationRepository, "findForMember">;
  readonly messages: Pick<
    ConversationMessageRepository,
    "find" | "history" | "insert" | "contextCount"
  >;
  readonly directory: Pick<ConversationDirectory, "read">;
  readonly runner: ConversationAgentRunner;
  readonly rounds: Pick<ConversationRoundRepository, "setTargetState">;
  readonly contexts: Pick<ConversationContextReader, "promptContext">;
  readonly events: Pick<ConversationEvents, "publish">;
  readonly publisher: { publish(event: PagesEvent): void };
  /** Pauses a chain of agent messages (PAGE-311); without it no chain is limited. */
  readonly guard?: Pick<ConversationAgentGuard, "isPaused">;
  /** Reads the file lines of an answer (PAGE-298). */
  readonly agentFiles: Pick<ConversationAgentFiles, "select" | "open">;
  /** Stores the files an answer attaches and binds them to it. */
  readonly attachments: Pick<
    ConversationAttachments,
    "stage" | "bind" | "release" | "open"
  >;
  /** The attachments and links of the stored answer. */
  readonly content: ConversationMessageContentReader;
  readonly now?: () => Date;
  /** Waits for a busy agent; tests pass a fast one. */
  readonly wait?: (milliseconds: number) => Promise<void>;
}
