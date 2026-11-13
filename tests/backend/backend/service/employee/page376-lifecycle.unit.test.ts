import { expect, it, vi } from "vitest";

import { AgentChatContext } from "@/backend/service/employee/AgentChatContext";
import {
  AgentChatSessionLifecycle,
  contextPercentOf,
} from "@/backend/service/employee/AgentChatSessionLifecycle";

import type { StoredAgentChatSession } from "@/backend/database/repositories/employee/AgentChatSessionRepository";
import type { AgentChatSessionLifecycleDependencies } from "@/backend/service/employee/AgentChatSessionLifecycle";
import type { User } from "@/definition/User";

const agent: User = {
  id: "agent",
  username: "ed",
  displayName: "Ed",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
  isAgent: true,
};

function session(
  fields: Partial<StoredAgentChatSession> = {},
): StoredAgentChatSession {
  return {
    sessionId: "session",
    agentId: "agent",
    kind: "group",
    chatId: "group-1",
    chatName: "Team",
    isConfidential: false,
    deliveredSequence: 12,
    needsRestart: false,
    contextUsed: null,
    contextSize: null,
    tokensTotal: 0,
    tokensToday: 0,
    tokensDay: null,
    restartCount: 0,
    lastActivityAt: null,
    ...fields,
  };
}

interface Fixture {
  readonly lifecycle: AgentChatSessionLifecycle;
  readonly stored: { current: StoredAgentChatSession };
  readonly order: string[];
  readonly summarize: ReturnType<typeof vi.fn>;
  readonly saveSummary: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly removeAcp: ReturnType<typeof vi.fn>;
  readonly recordUsage: ReturnType<typeof vi.fn>;
}

function fixture(
  options: {
    readonly context?: { readonly used: number; readonly size: number };
    readonly restartPercent?: number;
    readonly summary?: string | null | Error;
  } = {},
): Fixture {
  const order: string[] = [];
  const stored = { current: session() };
  const transcript = [
    { id: "m1", role: "user", content: "Hallo", createdAt: "t1" },
    { id: "m2", role: "assistant", content: "Hi", createdAt: "t2" },
  ];
  const summarize = vi.fn(async () => {
    order.push("summarize");
    const { summary } = options;
    if (summary instanceof Error) throw summary;
    return summary === undefined ? "Lage des Chats" : summary;
  });
  const saveSummary = vi.fn(async () => {
    order.push("saveSummary");
  });
  const close = vi.fn(async () => {
    order.push("close");
  });
  const removeAcp = vi.fn(async () => {
    order.push("forgetAgentSession");
  });
  const recordUsage = vi.fn(
    async (
      id: string,
      usage: { contextUsed: number | null; contextSize: number | null },
    ) => {
      stored.current = {
        ...stored.current,
        contextUsed: usage.contextUsed,
        contextSize: usage.contextSize,
      };
    },
  );
  const chatSessions = {
    find: vi.fn(async () => stored.current),
    settings: vi.fn(async () => ({
      idleMinutes: null,
      restartPercent: options.restartPercent ?? 80,
    })),
    recordUsage,
    setNeedsRestart: vi.fn(async (id: string, needsRestart: boolean) => {
      stored.current = { ...stored.current, needsRestart };
    }),
    markRestarted: vi.fn(async () => {
      order.push("markRestarted");
      stored.current = {
        ...stored.current,
        needsRestart: false,
        deliveredSequence: 0,
        contextUsed: null,
      };
    }),
  };
  const dependencies = {
    store: {
      chatSessions: () => chatSessions,
      employees: () => ({ find: vi.fn(async () => ({ userId: "agent" })) }),
      chats: () => ({ summary: vi.fn(async () => null), saveSummary }),
    },
    messages: { messages: vi.fn(async () => transcript) },
    acp: {
      update: vi.fn(async () => ({
        job: {
          state: "completed",
          usage: {
            context: options.context ?? null,
            tokens: { total: 1200 },
            cost: null,
          },
        },
      })),
      stop: vi.fn(async () => undefined),
      settled: vi.fn(async () => undefined),
    },
    pool: { close },
    acpSessions: { remove: removeAcp },
    summaries: () => ({ summarize }),
    now: () => new Date("2026-03-04T10:00:00.000Z"),
  };
  return {
    lifecycle: new AgentChatSessionLifecycle(
      dependencies as unknown as AgentChatSessionLifecycleDependencies,
    ),
    stored,
    order,
    summarize,
    saveSummary,
    close,
    removeAcp,
    recordUsage,
  };
}

it("restarts a session at the threshold: first the summary, then the end of the process and a new inbox", async () => {
  const { lifecycle, order, summarize, recordUsage, stored } = fixture({
    context: { used: 85_000, size: 100_000 },
  });
  await lifecycle.afterRound(agent, "session");
  expect(recordUsage).toHaveBeenCalledWith(
    "session",
    expect.objectContaining({
      contextUsed: 85_000,
      contextSize: 100_000,
      tokens: 1200,
      day: "2026-03-04",
    }),
  );
  // The agent writes its state down first, the session starts anew afterwards.
  expect(order).toEqual([
    "summarize",
    "saveSummary",
    "close",
    "forgetAgentSession",
    "markRestarted",
  ]);
  expect(summarize).toHaveBeenCalledWith(
    expect.objectContaining({ runsNow: true }),
    expect.objectContaining({ previous: null }),
  );
  expect(stored.current).toMatchObject({
    needsRestart: false,
    deliveredSequence: 0,
  });
});

it("leaves a session below the threshold of its agent alone", async () => {
  const below = fixture({ context: { used: 59_000, size: 100_000 } });
  await below.lifecycle.afterRound(agent, "session");
  expect(below.close).not.toHaveBeenCalled();
  expect(below.summarize).not.toHaveBeenCalled();
  // The same fill restarts a session whose agent set a lower threshold.
  const lower = fixture({
    context: { used: 59_000, size: 100_000 },
    restartPercent: 50,
  });
  await lower.lifecycle.afterRound(agent, "session");
  expect(lower.close).toHaveBeenCalledOnce();
});

it("restarts with the summary it had when no new summary comes, and keeps the chat usable", async () => {
  for (const summary of [null, new Error("model down")]) {
    const { lifecycle, close, removeAcp, saveSummary, stored } = fixture({
      context: { used: 90, size: 100 },
      summary,
    });
    await lifecycle.afterRound(agent, "session");
    expect(saveSummary).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(removeAcp).toHaveBeenCalledWith("agent", "session");
    expect(stored.current.needsRestart).toBe(false);
  }
});

it("restarts a marked session before its next round and never fails the round", async () => {
  const marked = fixture();
  marked.stored.current = session({ needsRestart: true });
  await marked.lifecycle.restartIfNeeded(agent, "session");
  expect(marked.close).toHaveBeenCalledOnce();

  const unmarked = fixture();
  await unmarked.lifecycle.restartIfNeeded(agent, "session");
  expect(unmarked.close).not.toHaveBeenCalled();

  const failing = fixture({ summary: new Error("down") });
  failing.stored.current = session({ needsRestart: true });
  failing.close.mockRejectedValueOnce(new Error("pool broke"));
  await expect(
    failing.lifecycle.restartIfNeeded(agent, "session"),
  ).resolves.toBeUndefined();
  // The second attempt to forget the process went through.
  expect(failing.close).toHaveBeenCalledTimes(2);
});

it("shares one restart between concurrent calls", async () => {
  const { lifecycle, close } = fixture();
  await Promise.all([
    lifecycle.restart(agent, "session"),
    lifecycle.restart(agent, "session"),
  ]);
  expect(close).toHaveBeenCalledOnce();
});

it("reads the fill of the context in percent", () => {
  expect(contextPercentOf(session())).toBeNull();
  expect(contextPercentOf(session({ contextUsed: 58, contextSize: 100 }))).toBe(
    58,
  );
  expect(
    contextPercentOf(session({ contextUsed: 120, contextSize: 100 })),
  ).toBe(100);
});

it("gives a restarted session its summary and the last messages of the chat", async () => {
  const transcript = Array.from({ length: 30 }, (_, index) => ({
    id: `m${String(index + 1)}`,
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `Nachricht ${String(index + 1)}`,
    createdAt: "2026-03-04T10:00:00.000Z",
  }));
  const context = new AgentChatContext({
    store: {
      employees: () => ({
        find: vi.fn(async () => ({ memory: "", dream: "DREAM-Inhalt" })),
      }),
      // The summary covers the whole transcript, as after a restart.
      chats: () => ({
        summary: vi.fn(async () => ({
          summary: "Lage des Chats",
          throughId: "m30",
        })),
        conversationPeople: vi.fn(async () => ["person"]),
      }),
    },
    messages: { messages: vi.fn(async () => transcript) },
    memory: {
      share: vi.fn(async (audience: unknown, entries: unknown[]) => entries),
      related: vi.fn(async () => []),
    },
  } as unknown as ConstructorParameters<typeof AgentChatContext>[0]);
  const brief = await context.brief(
    { agentId: "agent", person: null, conversationId: "group-1" },
    { sessionId: "session", message: "Weiter" },
  );
  expect(brief.summary).toBe("Lage des Chats");
  expect(brief.dream).toBe("DREAM-Inhalt");
  expect(brief.history.map((message) => message.content)).toEqual(
    transcript.slice(-10).map((message) => message.content),
  );
});
