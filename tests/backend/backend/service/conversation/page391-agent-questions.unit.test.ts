import { describe, expect, it, vi } from "vitest";

import {
  AgentChatQuestionService,
  AgentQuestionWaiters,
} from "@/backend/service/conversation/AgentChatQuestionService";
import { ConversationError } from "@/backend/error/ConversationError";
import { awaitAgentJobAnswer } from "@/backend/service/employee/AgentJobAnswer";
import {
  isAgentWritten,
  toVirtualMessage,
} from "@/backend/service/employee/ChatConversationView";

import { partialStub } from "../../stub-fixture";

import type {
  NewAgentQuestion,
  StoredAgentQuestion,
} from "@/backend/database/repositories/conversation/AgentChatQuestionRepository";
import type { ConversationService } from "@/backend/service/conversation/ConversationService";
import type { AgentQuestionAnswer } from "@/definition/AgentChatQuestion";
import type { ChatMessage } from "@/definition/Chat";
import type { ChatJob } from "@/definition/ChatJob";
import type { ConversationMessage } from "@/definition/Conversation";
import type { User } from "@/definition/User";

function user(id: string, overrides: Partial<User> = {}): User {
  return {
    id,
    username: id,
    displayName: id === "igor" ? "Igor" : id,
    role: "employee",
    isActive: true,
    mustChangePassword: false,
    isAgent: false,
    ...overrides,
  };
}

const AGENT = user("agent-1", { displayName: "Ada", isAgent: true });
const IGOR = user("igor");
const MARA = user("mara");
const OTHER_AGENT = user("agent-2", { isAgent: true });

/** An in-memory store of questions, as the repository behaves. */
function questionStore(): {
  readonly rows: Map<string, StoredAgentQuestion>;
  readonly store: ConstructorParameters<
    typeof AgentChatQuestionService
  >[0]["questions"];
} {
  const rows = new Map<string, StoredAgentQuestion>();
  return {
    rows,
    store: {
      insert: async (question: NewAgentQuestion) => {
        rows.set(question.id, {
          ...question,
          status: "open",
          answers: [],
          answeredBy: null,
          answeredAt: null,
        });
      },
      find: async (id) => rows.get(id) ?? null,
      findByMessageIds: async (ids) =>
        [...rows.values()].filter((row) => ids.includes(row.messageId)),
      answer: async (id, answer) => {
        const row = rows.get(id);
        if (row?.status !== "open") return false;
        rows.set(id, { ...row, status: "answered", ...answer });
        return true;
      },
      close: async (id, status) => {
        const row = rows.get(id);
        if (row?.status === "open") rows.set(id, { ...row, status });
      },
    },
  };
}

/** The service with fakes at its boundaries: the conversations and the users. */
function world(options: { readonly members?: readonly string[] } = {}): {
  readonly service: AgentChatQuestionService;
  readonly sent: {
    conversationId: string;
    clientMessageId: string;
    text: string;
  }[];
  readonly published: unknown[];
  readonly rows: Map<string, StoredAgentQuestion>;
  readonly expire: () => void;
} {
  const sent: {
    conversationId: string;
    clientMessageId: string;
    text: string;
  }[] = [];
  const published: unknown[] = [];
  const { rows, store } = questionStore();
  let timeout: () => void = () => undefined;
  const users = new Map(
    [AGENT, IGOR, MARA, OTHER_AGENT].map((entry) => [entry.id, entry]),
  );
  const service = new AgentChatQuestionService({
    users: { findById: async (id: string) => users.get(id) ?? null },
    service: partialStub<Pick<ConversationService, "send" | "openDirect">>({
      send: vi.fn(
        async (
          _: User,
          sending: {
            conversationId: string;
            clientMessageId: string;
            text: string;
          },
        ) => {
          sent.push(sending);
          return partialStub<ConversationMessage>({
            id: `message-${String(sent.length)}`,
          });
        },
      ),
      openDirect: vi.fn(async () => ({ id: "direct-1" })),
    }),
    reader: {
      memberIds: async () => [
        ...(options.members ?? ["agent-1", "igor", "mara", "agent-2"]),
      ],
    },
    questions: store,
    publisher: { publish: (event) => published.push(event) },
    waiters: new AgentQuestionWaiters(),
    now: () => new Date("2026-11-15T12:00:00.000Z"),
    createId: () => "question-1",
    wait: (_, signal) =>
      new Promise<void>((resolve) => {
        timeout = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  });
  return { service, sent, published, rows, expire: () => timeout() };
}

const ASK = {
  items: [
    {
      text: "Ticket PAGE-12 wirklich löschen?",
      options: ["Abbrechen", "Löschen"],
      recommended: 1,
      isMultipleChoice: false,
    },
  ],
  timeoutMinutes: 15,
  confirmation: null,
};

/** Lets the question reach its wait before the test answers it. */
async function settled(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function answerOf(
  optionIds: string[],
  freeText: string | null = null,
): AgentQuestionAnswer[] {
  return [{ questionId: "q1", optionIds, freeText }];
}

describe("PAGE-391 interim messages", () => {
  it("stores an interim message as the agent's message of the group, marked as interim", async () => {
    const { service, sent } = world();
    const chat = service.bind("agent-1", {
      kind: "conversation",
      conversationId: "group-1",
      askerId: "igor",
    });
    await expect(chat.say("Bin dran, Tests laufen …")).resolves.toEqual({
      messageId: "message-1",
    });
    expect(sent[0]).toMatchObject({
      conversationId: "group-1",
      text: "Bin dran, Tests laufen …",
    });
    expect(sent[0]?.clientMessageId).toMatch(/^agent-interim-/u);
  });

  it("writes to the direct conversation with the person in a direct chat", async () => {
    const { service, sent } = world();
    await service
      .bind("agent-1", { kind: "direct", personId: "igor" })
      .say("Zwischenstand");
    expect(sent[0]?.conversationId).toBe("direct-1");
  });

  it("shows an interim message quieter and joins it to the direct chat with the agent", () => {
    const message = {
      id: "m1",
      conversationId: "direct-1",
      clientMessageId: "agent-interim-1",
      sender: { id: "agent-1", kind: "agent", name: "Ada", color: null },
      text: "Bin dran",
      createdAt: "2026-11-15T12:00:00.000Z",
      mentions: [],
      attachments: [],
      links: [],
    } satisfies ConversationMessage;
    expect(toVirtualMessage(message, IGOR)).toMatchObject({ isInterim: true });
    expect(isAgentWritten(message, "agent-1")).toBe(true);
    expect(
      isAgentWritten(
        { ...message, clientMessageId: "agent-question-1" },
        "agent-1",
      ),
    ).toBe(true);
    expect(
      toVirtualMessage({ ...message, clientMessageId: "reply-1" }, IGOR)
        .isInterim,
    ).toBeUndefined();
  });
});

describe("PAGE-391 questions", () => {
  it("asks with the recommended answer first, waits, and hands a click to the agent", async () => {
    const { service, sent, rows } = world();
    const chat = service.bind("agent-1", {
      kind: "conversation",
      conversationId: "group-1",
      askerId: null,
    });
    const pending = chat.ask(ASK, new AbortController().signal);
    await settled();
    expect(sent[0]?.clientMessageId).toBe("agent-question-question-1");
    expect(sent[0]?.text).toContain("Löschen (empfohlen)");
    expect(
      rows.get("question-1")?.items[0]?.options.map((option) => option.label),
    ).toEqual(["Löschen", "Abbrechen"]);
    expect(service.isWaiting("agent-1", "group-1")).toBe(true);
    await service.answer(IGOR, {
      questionId: "question-1",
      answers: answerOf(["o2"]),
    });
    await expect(pending).resolves.toMatchObject({
      status: "answered",
      answeredBy: "Igor",
      answers: [
        { chosen: ["Löschen"], isRecommendedChosen: true, freeText: null },
      ],
    });
    expect(service.isWaiting("agent-1")).toBe(false);
  });

  it("hands a free answer to the agent", async () => {
    const { service } = world();
    const pending = service
      .bind("agent-1", { kind: "direct", personId: "igor" })
      .ask(ASK, new AbortController().signal);
    await settled();
    await service.answer(IGOR, {
      questionId: "question-1",
      answers: answerOf([], "Erst morgen"),
    });
    await expect(pending).resolves.toMatchObject({
      answers: [{ chosen: [], freeText: "Erst morgen" }],
    });
  });

  it("lets the agent continue without an answer within the time limit and locks the card as expired", async () => {
    const { service, rows, expire } = world();
    const pending = service
      .bind("agent-1", {
        kind: "conversation",
        conversationId: "group-1",
        askerId: null,
      })
      .ask(ASK, new AbortController().signal);
    await settled();
    expect(rows.get("question-1")?.expiresAt).toBe("2026-11-15T12:15:00.000Z");
    expire();
    await expect(pending).resolves.toEqual({
      status: "expired",
      questionId: "question-1",
    });
    expect(rows.get("question-1")?.status).toBe("expired");
    await expect(
      service.answer(IGOR, {
        questionId: "question-1",
        answers: answerOf(["o1"]),
      }),
    ).rejects.toThrow(ConversationError);
  });

  it("lets only the person who addressed the agent answer in a group, and never an agent", async () => {
    const { service } = world();
    void service
      .bind("agent-1", {
        kind: "conversation",
        conversationId: "group-1",
        askerId: "igor",
      })
      .ask(ASK, new AbortController().signal);
    await settled();
    await expect(
      service.answer(MARA, {
        questionId: "question-1",
        answers: answerOf(["o1"]),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.answer(OTHER_AGENT, {
        questionId: "question-1",
        answers: answerOf(["o1"]),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const views = await service.views(MARA, ["message-1"]);
    expect(views.get("message-1")?.canAnswer).toBe(false);
    expect(
      (await service.views(IGOR, ["message-1"])).get("message-1")?.canAnswer,
    ).toBe(true);
  });
});

describe("PAGE-391 question access and lifecycle", () => {
  it("lets every human member answer when nobody addressed the agent, but not a non-member", async () => {
    const { service } = world({ members: ["agent-1", "mara"] });
    const pending = service
      .bind("agent-1", {
        kind: "conversation",
        conversationId: "group-1",
        askerId: null,
      })
      .ask(ASK, new AbortController().signal);
    await settled();
    await expect(
      service.answer(IGOR, {
        questionId: "question-1",
        answers: answerOf(["o1"]),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await service.answer(MARA, {
      questionId: "question-1",
      answers: answerOf(["o1"]),
    });
    await expect(pending).resolves.toMatchObject({ answeredBy: "mara" });
  });

  it("locks the card after the answer and shows who chose what", async () => {
    const { service } = world();
    void service
      .bind("agent-1", { kind: "direct", personId: "igor" })
      .ask(ASK, new AbortController().signal);
    await settled();
    const view = await service.answer(IGOR, {
      questionId: "question-1",
      answers: answerOf(["o1"]),
    });
    expect(view).toMatchObject({
      status: "answered",
      canAnswer: false,
      answeredBy: { id: "igor", name: "Igor" },
      answers: [{ questionId: "q1", optionIds: ["o1"] }],
    });
    await expect(
      service.answer(IGOR, {
        questionId: "question-1",
        answers: answerOf(["o2"]),
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses an answer without a choice or with two choices for a single-choice question", async () => {
    const { service } = world();
    void service
      .bind("agent-1", { kind: "direct", personId: "igor" })
      .ask(ASK, new AbortController().signal);
    await settled();
    await expect(
      service.answer(IGOR, { questionId: "question-1", answers: answerOf([]) }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      service.answer(IGOR, {
        questionId: "question-1",
        answers: answerOf(["o1", "o2"]),
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("ends the question with its round", async () => {
    const { service, rows } = world();
    const round = new AbortController();
    const pending = service
      .bind("agent-1", { kind: "direct", personId: "igor" })
      .ask(ASK, round.signal);
    await settled();
    round.abort();
    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
    expect(rows.get("question-1")?.status).toBe("cancelled");
  });
});

describe("PAGE-391 the answer of a conversation waits with the question", () => {
  it("does not count the time the agent waits for the person towards the answer's timeout", async () => {
    const run = (isWaitingForPerson?: () => boolean): Promise<string> => {
      let now = 0;
      let polls = 0;
      return awaitAgentJobAnswer(
        { agent: AGENT, sessionId: "session-1", jobId: "job-1" },
        {
          sessions: {
            job: async () => {
              polls += 1;
              return partialStub<ChatJob>({
                state: polls < 7 ? "running" : "completed",
              });
            },
          },
          messages: {
            messages: async () => [
              partialStub<ChatMessage>({
                role: "assistant",
                content: "Fertig",
              }),
            ],
          },
          pollMilliseconds: 1,
          timeoutMilliseconds: 10,
          now: () => new Date(now),
          wait: async () => {
            now += 3;
          },
          ...(isWaitingForPerson ? { isWaitingForPerson } : {}),
        },
      );
    };
    // Without a question, 18 of 10 milliseconds end the wait as before.
    await expect(run()).rejects.toMatchObject({ failureCode: "timeout" });
    let waitingPolls = 0;
    await expect(run(() => (waitingPolls += 1) <= 4)).resolves.toBe("Fertig");
  });
});
