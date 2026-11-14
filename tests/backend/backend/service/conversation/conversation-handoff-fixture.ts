import { vi } from "vitest";

import { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import { ConversationAgentReplies } from "@/backend/service/conversation/ConversationAgentReplies";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import { toConversationMessage } from "@/backend/service/conversation/ConversationReader";
import { CONVERSATION_AGENT_SEND_PREFIX } from "@/definition/Conversation";
import { CONVERSATION_NO_RULE_OVERRIDES } from "@/definition/ConversationDecision";
import { conversationRoundLimits } from "@/definition/ConversationObserver";

import type { ConversationFollowUp } from "@/backend/database/repositories/conversation/ConversationFollowUpRepository";
import type { ConversationHandoffRequest } from "@/backend/database/repositories/conversation/ConversationHandoffRepository";
import type {
  NewConversationMessage,
  StoredConversationMessage,
} from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationReplyClaim,
  ConversationTargetState,
} from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import type {
  ConversationAgentRepliesDependencies,
  ConversationAgentRequest,
} from "@/backend/service/conversation/ConversationAgentReplies";
import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationReplySettings } from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";

export const PERSON: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

export const AGENT_IDS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

const CONVERSATION = {
  id: "group",
  kind: "group",
  name: "Team",
  lastActivityAt: "today",
  isMuted: false,
  unreadCount: 0,
} as const;

/** One stored answer target, as `conversation_reply_targets` holds it. */
export interface MemoryTarget {
  readonly originMessageId: string;
  readonly agentId: string;
  readonly triggerMessageId: string;
  readonly trigger: ConversationReplyClaim["trigger"];
  readonly isAutomatic: boolean;
  state: ConversationTargetState;
  replyMessageId: string | null;
}

/** One stored hand-over, as `conversation_handoff_requests` holds it. */
export interface MemoryHandoff extends ConversationHandoffRequest {
  state: "pending" | "paused" | "done";
  pauseReason: string | null;
}

interface MemoryQuestion {
  readonly questionMessageId: string;
  readonly originMessageId: string;
  readonly conversationId: string;
  readonly agentId: string;
  readonly deadlineAt: string;
  consumedAt: string | null;
  readonly answers: { agentId: string; replyMessageId: string | null }[];
}

/**
 * The persistence of rounds in memory, with the same rules as the SQL of
 * `ConversationRoundRepository`: a claim is atomic, as one JavaScript turn,
 * and the unique key `(trigger, agent)` decides duplicates. It survives a
 * "restart": a new service instance may use the same state.
 */
export class MemoryRounds {
  public readonly targets = new Map<string, MemoryTarget>();
  public readonly rounds = new Map<
    string,
    { personId: string; automaticCount: number }
  >();
  public readonly handoffs = new Map<string, MemoryHandoff>();
  public readonly questions = new Map<string, MemoryQuestion>();
  public readonly claims: ConversationReplyClaim[] = [];
  private readonly routings = new Set<string>();
  private readonly stored: StoredConversationMessage[];

  public constructor(stored: StoredConversationMessage[]) {
    this.stored = stored;
  }

  /** Answers the methods of a real repository object from this memory. */
  public install(repository: ConversationRoundRepository): void {
    vi.spyOn(repository, "claim").mockImplementation(async (claim) =>
      this.claim(claim),
    );
    vi.spyOn(repository, "setTargetState").mockImplementation(
      async (target, change) => {
        const entry = this.targets.get(
          `${target.triggerMessageId ?? target.originMessageId}|${target.agentId}`,
        );
        if (!entry) return;
        entry.state = change.state;
        entry.replyMessageId = change.replyMessageId ?? entry.replyMessageId;
      },
    );
    vi.spyOn(repository, "round").mockImplementation(async (origin) => {
      const round = this.rounds.get(origin);
      if (!round) return null;
      return {
        personId: round.personId,
        automaticCount: round.automaticCount,
        agentIds: [...this.targets.values()]
          .filter((target) => target.originMessageId === origin)
          .map((target) => target.agentId),
      };
    });
    vi.spyOn(repository, "claimRouting").mockImplementation(
      async ({ triggerMessageId }) => {
        if (this.routings.has(triggerMessageId)) return false;
        this.routings.add(triggerMessageId);
        return true;
      },
    );
    vi.spyOn(repository, "finishRouting").mockResolvedValue(undefined);
    vi.spyOn(repository, "interruptStale").mockImplementation(async () => {
      let count = 0;
      for (const target of this.targets.values())
        if (target.state === "queued" || target.state === "running") {
          target.state = "interrupted";
          count += 1;
        }
      return count;
    });
    this.installHandoffs(repository);
    this.installFollowUps(repository);
  }

  /** The stored hand-overs in a state. */
  public handoffsIn(state: MemoryHandoff["state"]): MemoryHandoff[] {
    return [...this.handoffs.values()].filter((entry) => entry.state === state);
  }

  private claim(
    claim: ConversationReplyClaim,
  ): "claimed" | "duplicate" | "limit" {
    const round = this.rounds.get(claim.originMessageId) ?? {
      personId: claim.personId,
      automaticCount: 0,
    };
    this.rounds.set(claim.originMessageId, round);
    if (claim.requestedBy === claim.agentId) return "duplicate";
    if (this.isAtLimit(claim, round.automaticCount)) return "limit";
    const key = `${claim.triggerMessageId}|${claim.agentId}`;
    if (claim.handoff) {
      const request = this.handoffs.get(key);
      if (request?.state !== claim.handoff) return "duplicate";
      request.state = "done";
    }
    if (
      !claim.isFollowUp &&
      claim.trigger === "handoff" &&
      this.isBundled(claim.triggerMessageId, claim.agentId)
    )
      return "duplicate";
    if (claim.isFollowUp && !this.consumeFor(claim)) return "duplicate";
    if (!this.claimTarget(key, claim)) return "duplicate";
    if (claim.isAutomatic) round.automaticCount += 1;
    this.claims.push(claim);
    return "claimed";
  }

  private isAtLimit(claim: ConversationReplyClaim, count: number): boolean {
    return (
      claim.isAutomatic &&
      count >=
        conversationRoundLimits(claim.limits ?? {}).automaticRepliesPerOrigin
    );
  }

  private claimTarget(key: string, claim: ConversationReplyClaim): boolean {
    const existing = this.targets.get(key);
    if (existing) {
      if (claim.handoff !== "paused" || existing.state !== "interrupted")
        return false;
      existing.state = "queued";
    } else
      this.targets.set(key, {
        originMessageId: claim.originMessageId,
        agentId: claim.agentId,
        triggerMessageId: claim.triggerMessageId,
        trigger: claim.trigger,
        isAutomatic: claim.isAutomatic,
        state: "queued",
        replyMessageId: null,
      });
    return true;
  }

  private isBundled(replyId: string, agentId: string): boolean {
    return [...this.questions.values()].some(
      (question) =>
        question.agentId === agentId &&
        question.answers.some((answer) => answer.replyMessageId === replyId),
    );
  }

  private isTakeable(question: MemoryQuestion, now: string): boolean {
    return (
      question.consumedAt === null &&
      (question.deadlineAt <= now ||
        question.answers.every((answer) => answer.replyMessageId !== null))
    );
  }

  private consumeFor(claim: ConversationReplyClaim): boolean {
    const question = this.questions.get(claim.triggerMessageId);
    if (
      !question ||
      question.originMessageId !== claim.originMessageId ||
      question.agentId !== claim.agentId ||
      !this.isTakeable(question, claim.createdAt) ||
      !question.answers.some((answer) => answer.replyMessageId !== null)
    )
      return false;
    question.consumedAt = claim.createdAt;
    return true;
  }

  private sequenceOf(id: string): number {
    return this.stored.find((entry) => entry.id === id)?.sequence ?? 0;
  }

  private installHandoffs(repository: ConversationRoundRepository): void {
    vi.spyOn(repository.handoffs, "request").mockImplementation(
      async (entries) =>
        entries.filter((entry) => {
          const key = `${entry.triggerMessageId}|${entry.agentId}`;
          if (this.handoffs.has(key)) return false;
          if (!this.rounds.has(entry.originMessageId))
            this.rounds.set(entry.originMessageId, {
              personId: entry.personId,
              automaticCount: 0,
            });
          this.handoffs.set(key, {
            triggerMessageId: entry.triggerMessageId,
            agentId: entry.agentId,
            originMessageId: entry.originMessageId,
            conversationId: entry.conversationId,
            requestedBy: entry.requestedBy,
            reason: entry.reason,
            state: entry.state,
            pauseReason: entry.pauseReason,
          });
          return true;
        }),
    );
    vi.spyOn(repository.handoffs, "paused").mockImplementation(
      async (conversationId) =>
        this.handoffsIn("paused")
          .filter((entry) => entry.conversationId === conversationId)
          .map((entry) => ({ ...entry })),
    );
    vi.spyOn(repository.handoffs, "pauseUnstarted").mockImplementation(
      async () => {
        const paused: ConversationHandoffRequest[] = [];
        for (const [key, entry] of this.handoffs) {
          const target = this.targets.get(key);
          if (
            entry.state === "pending" ||
            (entry.state === "done" && target?.state === "queued")
          ) {
            entry.state = "paused";
            entry.pauseReason = "restart";
            if (target) target.state = "interrupted";
            paused.push({ ...entry });
          }
        }
        return paused;
      },
    );
  }

  private installFollowUps(repository: ConversationRoundRepository): void {
    const followUps = repository.followUps;
    vi.spyOn(followUps, "open").mockImplementation(async (question) => {
      if (this.questions.has(question.questionMessageId)) return;
      this.questions.set(question.questionMessageId, {
        questionMessageId: question.questionMessageId,
        originMessageId: question.originMessageId,
        conversationId: question.conversationId,
        agentId: question.agentId,
        deadlineAt: question.deadlineAt,
        consumedAt: null,
        answers: question.askedAgentIds.map((agentId) => ({
          agentId,
          replyMessageId: null,
        })),
      });
    });
    vi.spyOn(followUps, "record").mockImplementation(
      async (originMessageId, reply) => {
        const bundled = new Set<string>();
        for (const mentioned of new Set(reply.mentions)) {
          if (mentioned === reply.senderId) continue;
          for (const question of this.questions.values()) {
            if (question.agentId !== mentioned) continue;
            const answer = question.answers.find(
              (entry) => entry.agentId === reply.senderId,
            );
            if (
              question.originMessageId === originMessageId &&
              question.consumedAt === null &&
              answer?.replyMessageId === null &&
              this.sequenceOf(reply.id) >
                this.sequenceOf(question.questionMessageId)
            )
              answer.replyMessageId = reply.id;
            if (answer?.replyMessageId === reply.id) bundled.add(mentioned);
          }
        }
        return bundled;
      },
    );
    vi.spyOn(followUps, "pending").mockImplementation(async (filter = {}) =>
      [...this.questions.values()]
        .filter(
          (question) =>
            question.consumedAt === null &&
            (filter.originMessageId === undefined ||
              question.originMessageId === filter.originMessageId) &&
            (filter.conversationId === undefined ||
              question.conversationId === filter.conversationId),
        )
        .map((question): ConversationFollowUp => ({
          questionMessageId: question.questionMessageId,
          originMessageId: question.originMessageId,
          conversationId: question.conversationId,
          personId:
            this.rounds.get(question.originMessageId)?.personId ?? PERSON.id,
          agentId: question.agentId,
          deadlineAt: question.deadlineAt,
          answers: question.answers.map((answer) => ({ ...answer })),
        })),
    );
    vi.spyOn(followUps, "consume").mockImplementation(async (id, now) => {
      const question = this.questions.get(id);
      if (!question || !this.isTakeable(question, now)) return false;
      question.consumedAt = now;
      return true;
    });
    vi.spyOn(followUps, "context").mockImplementation(
      async (originMessageId, questionId) => {
        const replies = new Set(
          [...this.targets.values()]
            .filter((target) => target.originMessageId === originMessageId)
            .map((target) => target.replyMessageId),
        );
        return this.stored
          .filter(
            (entry) =>
              replies.has(entry.id) &&
              entry.sequence > this.sequenceOf(questionId) &&
              entry.notice === null,
          )
          .map((entry) => entry.id);
      },
    );
  }
}

function memoryMessages(
  stored: StoredConversationMessage[],
): ConversationAgentRepliesDependencies["messages"] {
  return {
    contextCount: vi.fn().mockResolvedValue(0),
    find: vi.fn(
      async (conversationId: string, id: string) =>
        stored.find((entry) => entry.id === id) ?? null,
    ),
    history: vi.fn(
      async (conversationId: string, before: number | null, limit: number) =>
        stored
          .filter((entry) => before === null || entry.sequence < before)
          .slice(-limit)
          .reverse(),
    ),
    insert: vi.fn(async (message: NewConversationMessage) => {
      const duplicate = stored.find(
        (entry) =>
          entry.senderId === message.senderId &&
          entry.clientMessageId === message.clientMessageId,
      );
      if (duplicate) return { message: duplicate, isNew: false };
      const entry = {
        ...message,
        notice: message.notice ?? null,
        sequence: stored.length + 1,
      };
      stored.push(entry);
      return { message: entry, isNew: true };
    }),
  };
}

function agentUser(id: string): User {
  return {
    ...PERSON,
    id,
    username: id,
    displayName: id.toUpperCase(),
    isAgent: true,
  };
}

/** The accounts of the group; a test may deactivate an agent. */
export function accountsOf(users: readonly User[]): ConversationAccounts {
  return new ConversationAccounts(
    new Map(
      users.map((user) => [
        user.id,
        {
          user,
          participant: {
            id: user.id,
            name: user.displayName,
            kind: user.isAgent ? "agent" : "human",
            color: null,
          },
          role: "",
          isAvailable: true,
        },
      ]),
    ),
  );
}

/** What a test of the hand-overs works with. */
export interface HandoffFixture {
  readonly service: ConversationAgentReplies;
  readonly dependencies: ConversationAgentRepliesDependencies;
  readonly memory: MemoryRounds;
  readonly stored: StoredConversationMessage[];
  readonly memberIds: string[];
  readonly users: User[];
  /** Agent IDs of the runner calls, in start order. */
  readonly started: string[];
  /** Every runner request, in start order. */
  readonly requests: ConversationAgentRequest[];
  /** The scripted texts per agent; an agent without one answers "Erledigt.". */
  readonly script: Map<string, string[]>;
  /** Moves the clock. */
  readonly advance: (milliseconds: number) => void;
  /** Stores and returns a message of the person. */
  readonly personWrites: (
    text: string,
    mentions?: string[],
  ) => ConversationMessage;
  /** Stores and returns a message an agent chose to send (PAGE-311). */
  readonly agentSends: (
    agentId: string,
    text: string,
    mentions: string[],
  ) => ConversationMessage;
  /** Stores plain earlier messages of agents, as history. */
  readonly agentHistory: (count: number) => void;
  /** A new service on the same state, as after a restart of the process. */
  readonly restart: () => ConversationAgentReplies;
  readonly settings: { current: ConversationReplySettings };
}

interface FixtureDependencyInput {
  memberIds: string[];
  stored: StoredConversationMessage[];
  accounts: ConversationAccounts;
  started: string[];
  requests: ConversationAgentRequest[];
  script: Map<string, string[]>;
  settings: { current: ConversationReplySettings };
  now: () => Date;
  rounds: ConversationRoundRepository;
}

function fixtureDependencies({
  memberIds,
  stored,
  accounts,
  started,
  requests,
  script,
  settings,
  now,
  rounds,
}: FixtureDependencyInput): ConversationAgentRepliesDependencies {
  return {
    conversations: {
      findForMember: vi.fn().mockResolvedValue(CONVERSATION),
      memberIds: vi.fn().mockResolvedValue(new Map([["group", memberIds]])),
    },
    messages: memoryMessages(stored),
    directory: { read: vi.fn().mockResolvedValue(accounts) },
    runner: {
      answer: vi.fn(async (request: ConversationAgentRequest) => {
        started.push(request.agent.id);
        requests.push(request);
        return script.get(request.agent.id)?.shift() ?? "Erledigt.";
      }),
    },
    rounds,
    contexts: { promptContext: vi.fn().mockResolvedValue({ context: null }) },
    replySettings: { find: vi.fn(async () => settings.current) },
    decisions: {
      decide: vi.fn().mockResolvedValue([]),
      recordMention: vi.fn().mockResolvedValue(undefined),
    },
    events: new ConversationEvents(),
    publisher: { publish: vi.fn() },
    guard: { isPaused: vi.fn().mockResolvedValue(false) },
    agentFiles: {
      select: vi.fn(async (text: string) => ({
        text,
        lines: [text],
        files: [],
      })),
      open: vi.fn(),
    },
    attachments: {
      stage: vi.fn(),
      bind: vi.fn(),
      release: vi.fn(),
      open: vi.fn(),
    },
    content: { describe: vi.fn().mockResolvedValue(new Map()) },
    now,
    wait: async () => undefined,
  };
}

/** Mocked persistence and runner; the reply orchestration, follow-ups and runner stay real. */
export function handoffFixture(): HandoffFixture {
  const users = [PERSON, ...AGENT_IDS.map(agentUser)];
  const memberIds = users.map((user) => user.id);
  const stored: StoredConversationMessage[] = [];
  const memory = new MemoryRounds(stored);
  let clock = Date.parse("2026-11-13T10:00:00.000Z");
  const now = (): Date => new Date(clock);
  const script = new Map<string, string[]>();
  const started: string[] = [];
  const requests: ConversationAgentRequest[] = [];
  const settings: { current: ConversationReplySettings } = {
    current: {
      conversationId: "group",
      mode: "mentions",
      overrides: CONVERSATION_NO_RULE_OVERRIDES,
    },
  };
  const accounts = accountsOf(users);
  const newRounds = (): ConversationRoundRepository => {
    const rounds = new ConversationRoundRepository({
      query: vi.fn(),
      execute: vi.fn(),
      transaction: vi.fn(),
    });
    memory.install(rounds);
    return rounds;
  };
  const dependencies = fixtureDependencies({
    memberIds,
    stored,
    accounts,
    started,
    requests,
    script,
    settings,
    now,
    rounds: newRounds(),
  });
  let counter = 0;
  const store = (
    senderId: string,
    text: string,
    mentions: string[],
    clientMessageId: string,
  ): ConversationMessage => {
    counter += 1;
    const entry: StoredConversationMessage = {
      id: `m${String(counter)}`,
      sequence: stored.length + 1,
      conversationId: "group",
      senderId,
      clientMessageId,
      text,
      mentions,
      createdAt: now().toISOString(),
      voice: null,
      notice: null,
    };
    stored.push(entry);
    return toConversationMessage(entry, accounts);
  };
  return {
    service: new ConversationAgentReplies(dependencies),
    dependencies,
    memory,
    stored,
    memberIds,
    users,
    started,
    requests,
    script,
    settings,
    advance: (milliseconds) => {
      clock += milliseconds;
    },
    personWrites: (text, mentions = []) =>
      store(PERSON.id, text, mentions, `client-${String(counter)}`),
    agentSends: (agentId, text, mentions) =>
      store(
        agentId,
        text,
        mentions,
        `${CONVERSATION_AGENT_SEND_PREFIX}${String(counter)}`,
      ),
    agentHistory: (count) => {
      for (let index = 0; index < count; index += 1)
        store(
          AGENT_IDS[index % AGENT_IDS.length] ?? "a",
          "Früher",
          [],
          `history-${String(counter)}`,
        );
    },
    restart: () =>
      new ConversationAgentReplies({ ...dependencies, rounds: newRounds() }),
  };
}
