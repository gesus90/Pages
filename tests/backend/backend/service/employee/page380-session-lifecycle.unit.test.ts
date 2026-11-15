import { describe, expect, it, vi } from "vitest";

import { AgentChatContext } from "@/backend/service/employee/AgentChatContext";
import { AgentChatSessionLifecycle } from "@/backend/service/employee/AgentChatSessionLifecycle";
import { resolveAgentModel } from "@/backend/service/employee/AgentEmployeeAssignments";
import { chatModelKey } from "@/backend/service/employee/AgentEmployeeSessionTypes";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AgentChatContextDependencies } from "@/backend/service/employee/AgentChatContext";
import type { AgentChatSessionLifecycleDependencies } from "@/backend/service/employee/AgentChatSessionLifecycle";
import type { AgentEmployeeSessionDependencies } from "@/backend/service/employee/AgentEmployeeSessionTypes";
import type { User } from "@/definition/User";

const agent: User = {
  id: "ed",
  username: "ed",
  displayName: "Ed",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
  isAgent: true,
};
const person: User = {
  ...agent,
  id: "igor",
  username: "igor",
  displayName: "Igor",
  isAgent: false,
};

const TRANSCRIPT = [
  { id: "m1", role: "user", content: "Alt", createdAt: "t1" },
  { id: "m2", role: "assistant", content: "Alte Antwort", createdAt: "t2" },
];

/**
 * A lifecycle whose store offers only the repositories of the session; any
 * access to the memory, `DREAM.md`, lessons, recipes or the Lagebuch entries
 * would fail, which proves that none of them is touched.
 */
function lifecycleFixture(): {
  readonly lifecycle: AgentChatSessionLifecycle;
  readonly order: string[];
  readonly saveSummary: ReturnType<typeof vi.fn>;
  readonly summarize: ReturnType<typeof vi.fn>;
} {
  const order: string[] = [];
  const step = (name: string): ReturnType<typeof vi.fn<() => Promise<void>>> =>
    vi.fn(async () => {
      order.push(name);
    });
  const saveSummary = vi.fn(async () => {
    order.push("saveSummary");
  });
  const summarize = vi.fn(async () => "Zusammenfassung");
  const dependencies = {
    store: {
      chatSessions: () => ({
        markRestarted: step("markRestarted"),
        remove: step("removeRow"),
      }),
      chats: () => ({ summary: vi.fn(async () => null), saveSummary }),
      employees: () => ({ find: vi.fn(async () => ({ userId: "ed" })) }),
    },
    messages: {
      messages: vi.fn(async () => TRANSCRIPT),
      remove: step("removeMessages"),
    },
    acp: {
      update: vi.fn(),
      stop: step("stopAnswer"),
      settled: step("settled"),
    },
    pool: { close: step("closeProcess") },
    acpSessions: { remove: step("forgetAgentSession") },
    summaries: () => ({ summarize }),
    logbook: step("logbook"),
    now: () => new Date("2026-11-14T12:00:00.000Z"),
  };
  return {
    lifecycle: new AgentChatSessionLifecycle(
      dependencies as unknown as AgentChatSessionLifecycleDependencies,
    ),
    order,
    saveSummary,
    summarize,
  };
}

describe("the lifecycle of PAGE-380", () => {
  it("renews a session without a summary of the old one: answer first, Lagebuch, then a new start", async () => {
    const { lifecycle, order, saveSummary, summarize } = lifecycleFixture();
    await lifecycle.renew(agent, "session");
    expect(order).toEqual([
      "settled",
      "logbook",
      "saveSummary",
      "closeProcess",
      "forgetAgentSession",
      "markRestarted",
    ]);
    // An empty summary up to the newest message marks the start of the new session.
    expect(saveSummary).toHaveBeenCalledWith("session", {
      summary: "",
      throughId: "m2",
    });
    expect(summarize).not.toHaveBeenCalled();
  });

  it("closes and deletes a session for good, cancelling a running answer", async () => {
    const { lifecycle, order } = lifecycleFixture();
    await lifecycle.close(agent, "session", { isAborted: true });
    expect(order).toEqual([
      "stopAnswer",
      "settled",
      "logbook",
      "closeProcess",
      "forgetAgentSession",
      "removeMessages",
      "removeRow",
    ]);
  });

  it("runs one change of a session at a time, so no second session starts", async () => {
    const { lifecycle, order } = lifecycleFixture();
    await Promise.all([
      lifecycle.renew(agent, "session"),
      lifecycle.renew(agent, "session"),
    ]);
    expect(order.filter((name) => name === "closeProcess")).toHaveLength(1);
  });
});

describe("the context of a renewed session (PAGE-380)", () => {
  function context(
    summary: { summary: string; throughId: string } | null,
  ): AgentChatContext {
    const transcript = [
      ...TRANSCRIPT,
      { id: "m3", role: "user", content: "Neu", createdAt: "t3" },
    ];
    return new AgentChatContext({
      store: {
        employees: () => ({
          find: async () => ({ memory: "", dream: "# Lektionen" }),
        }),
        chats: () => ({ summary: async () => summary }),
      },
      messages: { messages: async () => transcript },
      memory: { share: async () => [], related: async () => [] },
    } as unknown as AgentChatContextDependencies);
  }

  it("starts with DREAM.md and the messages after /new, without the old messages or a summary", async () => {
    const brief = await context({ summary: "", throughId: "m2" }).brief(
      { agentId: "ed", person },
      { sessionId: "session", message: "Neu" },
    );
    expect(brief.summary).toBeNull();
    expect(brief.history.map((message) => message.id)).toEqual(["m3"]);
    expect(brief.dream).toContain("Lektionen");
  });

  it("keeps the last messages and the summary after an ordinary restart", async () => {
    const brief = await context({ summary: "Stand", throughId: "m2" }).brief(
      { agentId: "ed", person },
      { sessionId: "session", message: "Neu" },
    );
    expect(brief.summary).toBe("Stand");
    expect(brief.history.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });
});

describe("the model of a round (PAGE-380)", () => {
  const employee: StoredAgentEmployee = {
    userId: "ed",
    connectionId: "claude",
    model: "claude-sonnet-5-5",
    reasoningEffort: "medium",
    access: "read_only",
    soul: "",
    instructions: "",
    memory: "",
    isLearningEnabled: true,
    learningIntervalHours: 1,
    learnedThrough: null,
    lastLearningAt: null,
    lastLearningResult: null,
    revision: 1,
    createdAt: "2026-11-14T00:00:00.000Z",
    updatedAt: "2026-11-14T00:00:00.000Z",
    voiceId: null,
    voiceSpeedTenths: 10,
    dream: "",
    memoryCharacters: 10000,
    dreamCharacters: 10000,
    dreamSchedule: {
      isEnabled: false,
      interval: 1,
      unit: "days",
      time: null,
      weekday: null,
      isOnFullLogbook: false,
    },
    dreamRequest: null,
  };

  it("names the chat whose choice a round follows", () => {
    const base = { agent, employee, text: "", clientMessageId: null };
    expect(chatModelKey({ ...base, purpose: "chat", person })).toEqual({
      agentId: "ed",
      chatKind: "direct",
      chatId: "igor",
    });
    expect(
      chatModelKey({
        ...base,
        purpose: "conversation",
        person,
        conversationId: "team",
      }),
    ).toEqual({ agentId: "ed", chatKind: "group", chatId: "team" });
    expect(
      chatModelKey({ ...base, purpose: "learning", person: null }),
    ).toBeNull();
  });

  it("answers with the chosen model and level of the chat, else with the agent's own", async () => {
    const resolve = vi.fn(async (settings: StoredAgentEmployee) => ({
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
    }));
    const models = {
      resolve,
    } as unknown as AgentEmployeeSessionDependencies["models"];
    await resolveAgentModel(models, employee, {
      connectionId: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
    });
    expect(resolve).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: "claude-opus-5-5",
        reasoningEffort: "high",
      }),
    );
    await resolveAgentModel(models, employee, undefined);
    expect(resolve).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-5-5",
        reasoningEffort: "medium",
      }),
    );
  });
});
