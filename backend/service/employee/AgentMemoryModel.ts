import { awaitAgentJobAnswer } from "./AgentJobAnswer";
import { createLogbookMessage, readLogbookAnswer } from "./AgentLogbookPrompt";
import { createDreamMessage, readDreamAnswer } from "./AgentLearningPrompt";
import {
  createSummaryMessage,
  createTopicMessage,
  readSummaryAnswer,
  readTopicAnswer,
} from "./AgentMemoryPrompt";

import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AgentConversationPurpose } from "@/backend/database/repositories/employee/AgentConversationRepository";
import type { AgentLearningSource } from "@/backend/database/repositories/employee/AgentLearningSourceRepository";
import type { User } from "@/definition/User";
import type { AgentEmployeeSessions } from "./AgentEmployeeSessions";
import type { AgentLogbookDraft } from "./AgentLogbookService";
import type { LogbookSummaryMessage } from "./AgentLogbookPrompt";
import type { AgentDreamAnswerLesson } from "./AgentLearningPrompt";
import type {
  AgentExchange,
  AgentSummaryMessage,
  AgentTopicUpdate,
} from "./AgentMemoryPrompt";

/** How often a waiting call looks at its job. */
const POLL_MILLISECONDS = 2_000;
/** How long a topic update or a summary waits for its job. */
const MEMORY_TIMEOUT_MILLISECONDS = 5 * 60_000;
/** How long a dream run waits for its job. */
const DREAM_TIMEOUT_MILLISECONDS = 30 * 60_000;

/** The agent a model call runs for. */
export interface AgentMemoryCaller {
  readonly agent: User;
  readonly employee: StoredAgentEmployee;
  /**
   * The call belongs to the life of a chat session, such as the summary
   * before its restart (PAGE-376), and does not wait until the agent has no
   * chat to work in.
   */
  readonly runsNow?: boolean;
  /**
   * Runs the call on this model instead of the agent's own (PAGE-377), such as
   * the cheap model of the background summary of the Lagebuch.
   */
  readonly model?: {
    readonly connectionId: string;
    readonly model: string;
  };
}

/**
 * The model calls of the memory (PAGE-305): the topic update after an
 * answer, the summary of a long chat and the dream run.
 *
 * @remarks
 * Pages binds them through this interface, so the simulation and tests
 * replace them without a model provider and without cost. Each returns
 * `null` when no usable answer arrived; the memory then stays unchanged.
 */
export interface AgentMemoryModel {
  topics(
    caller: AgentMemoryCaller,
    input: {
      readonly topics: readonly {
        readonly title: string;
        readonly text: string;
      }[];
      readonly exchange: AgentExchange;
    },
  ): Promise<readonly AgentTopicUpdate[] | null>;
  summarize(
    caller: AgentMemoryCaller,
    input: {
      readonly previous: string | null;
      readonly messages: readonly AgentSummaryMessage[];
    },
  ): Promise<string | null>;
  dream(
    caller: AgentMemoryCaller,
    input: {
      readonly dream: string;
      readonly sources: readonly AgentLearningSource[];
      readonly today: string;
    },
  ): Promise<readonly AgentDreamAnswerLesson[] | null>;
  /**
   * The entries of the Lagebuch a quiet chat brings that it lacks (PAGE-377);
   * `null` when no usable answer arrived.
   */
  logbook(
    caller: AgentMemoryCaller,
    input: {
      readonly chat: string;
      readonly existing: readonly string[];
      readonly messages: readonly LogbookSummaryMessage[];
    },
  ): Promise<readonly AgentLogbookDraft[] | null>;
}

/** What the model calls over the agent's own sessions use. */
export interface AgentSessionMemoryModelDependencies {
  readonly sessions: Pick<AgentEmployeeSessions, "run" | "job"> &
    Partial<Pick<AgentEmployeeSessions, "whenOutOfChats">>;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  readonly now?: () => Date;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

/**
 * The model calls of the memory in sessions of the agent's own account,
 * with its own model: topic updates and summaries in its memory session,
 * the dream run in its dream session.
 *
 * @remarks
 * Each call is a short run of its own that continues no earlier session
 * (PAGE-376), and it starts only while the agent works in no chat; the
 * summary before the restart of a chat session is the one call that does
 * not wait.
 */
export class AgentSessionMemoryModel implements AgentMemoryModel {
  private readonly dependencies: AgentSessionMemoryModelDependencies;

  public constructor(dependencies: AgentSessionMemoryModelDependencies) {
    this.dependencies = dependencies;
  }

  /** Asks for the topics a finished exchange brings or changes. */
  public async topics(
    caller: AgentMemoryCaller,
    input: Parameters<AgentMemoryModel["topics"]>[1],
  ): Promise<readonly AgentTopicUpdate[] | null> {
    const answer = await this.ask(caller, {
      purpose: "memory",
      text: createTopicMessage(input.topics, input.exchange),
      timeoutMilliseconds: MEMORY_TIMEOUT_MILLISECONDS,
    });
    return answer === null ? null : readTopicAnswer(answer);
  }

  /** Asks for the summary of the older part of a chat. */
  public async summarize(
    caller: AgentMemoryCaller,
    input: Parameters<AgentMemoryModel["summarize"]>[1],
  ): Promise<string | null> {
    const answer = await this.ask(caller, {
      purpose: "memory",
      text: createSummaryMessage(input.previous, input.messages),
      timeoutMilliseconds: MEMORY_TIMEOUT_MILLISECONDS,
    });
    return answer === null ? null : readSummaryAnswer(answer);
  }

  /** Asks for the lessons of the day. */
  public async dream(
    caller: AgentMemoryCaller,
    input: Parameters<AgentMemoryModel["dream"]>[1],
  ): Promise<readonly AgentDreamAnswerLesson[] | null> {
    const answer = await this.ask(caller, {
      purpose: "learning",
      text: createDreamMessage(input.dream, input.sources, input.today),
      timeoutMilliseconds: DREAM_TIMEOUT_MILLISECONDS,
    });
    return answer === null ? null : readDreamAnswer(answer, input.today);
  }

  /** Asks which entries of the Lagebuch the new messages of a quiet chat bring. */
  public async logbook(
    caller: AgentMemoryCaller,
    input: Parameters<AgentMemoryModel["logbook"]>[1],
  ): Promise<readonly AgentLogbookDraft[] | null> {
    const answer = await this.ask(caller, {
      purpose: "memory",
      text: createLogbookMessage(input.chat, input.existing, input.messages),
      timeoutMilliseconds: MEMORY_TIMEOUT_MILLISECONDS,
    });
    return answer === null ? null : readLogbookAnswer(answer);
  }

  private async ask(
    caller: AgentMemoryCaller,
    task: {
      readonly purpose: AgentConversationPurpose;
      readonly text: string;
      readonly timeoutMilliseconds: number;
    },
  ): Promise<string | null> {
    // Background work runs only while the agent works in no chat (PAGE-376).
    if (
      caller.runsNow !== true &&
      this.dependencies.sessions.whenOutOfChats &&
      !(await this.dependencies.sessions.whenOutOfChats(caller.agent.id))
    )
      return null;
    const started = await this.dependencies.sessions.run({
      agent: caller.agent,
      employee: caller.employee,
      person: null,
      purpose: task.purpose,
      text: task.text,
      clientMessageId: null,
      ...(caller.model ? { modelOverride: caller.model } : {}),
    });
    if (!started) return null;
    return awaitAgentJobAnswer(
      {
        agent: caller.agent,
        sessionId: started.sessionId,
        jobId: started.start.job.id,
      },
      {
        sessions: this.dependencies.sessions,
        messages: this.dependencies.messages,
        pollMilliseconds: POLL_MILLISECONDS,
        timeoutMilliseconds: task.timeoutMilliseconds,
        now: () => this.dependencies.now?.() ?? new Date(),
        wait: this.dependencies.wait,
      },
    );
  }
}
