import { expect, it, vi } from "vitest";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";

import type { AgentEmployeeSessionDependencies } from "@/backend/service/employee/AgentEmployeeSessions";
import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Igor",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const agent: User = { ...person, id: "ed", displayName: "Ed", isAgent: true };
const employee = {
  userId: "ed",
  revision: 3,
  access: "read_only",
  connectionId: "own-connection",
  model: "own-model",
  reasoningEffort: null,
  soul: "",
  instructions: "",
};

interface StartInput {
  readonly brief: { readonly instructions: string };
  readonly employee: {
    readonly logbook?: unknown;
    readonly requireConnection: (id: string) => Promise<void>;
  };
}

interface Fixture {
  readonly service: AgentEmployeeSessions;
  readonly start: ReturnType<typeof vi.fn>;
  readonly hint: ReturnType<typeof vi.fn>;
  readonly markSeen: ReturnType<typeof vi.fn>;
  readonly tools: ReturnType<typeof vi.fn>;
  readonly resolve: ReturnType<typeof vi.fn>;
  readonly started: () => StartInput;
}

function fixture(
  options: {
    readonly hint?: () => Promise<{ line: string | null; newest: number }>;
    readonly resolve?: (settings: { connectionId: string }) => Promise<unknown>;
    readonly start?: () => Promise<unknown>;
    readonly withoutLogbook?: boolean;
    /** The Lagebuch is declared but not wired yet. */
    readonly unwired?: boolean;
  } = {},
): Fixture {
  const sessionIds = new Map<string, string>();
  const start = vi.fn(
    options.start ?? (async () => ({ job: { id: "job" }, messageId: "message" })),
  );
  const hint = vi.fn(
    options.hint ??
      (async () => ({ line: "Lagebuch: 2 neue Einträge (PAGE-370, Release Freitag)", newest: 9 })),
  );
  const markSeen = vi.fn(async () => undefined);
  const tools = vi.fn((session: { sessionId: string }) => ({
    remember: vi.fn(),
    search: vi.fn(),
    read: vi.fn(),
    session,
  }));
  const resolve = vi.fn(
    options.resolve ??
      (async (settings: { connectionId: string; model?: string }) => ({
        connection: { id: settings.connectionId, provider: "claude_code" },
        model: settings.model ?? "own-model",
        reasoningEffort: null,
      })),
  );
  const dependencies = {
    store: {
      conversations: () => ({
        ensure: vi.fn(
          async (key: { agentId: string; personId: string; purpose: string }) => {
            const id = `${key.agentId}:${key.personId}:${key.purpose}`;
            if (!sessionIds.has(id))
              sessionIds.set(id, `session-${String(sessionIds.size + 1)}`);
            return { sessionId: sessionIds.get(id) };
          },
        ),
      }),
      identities: () => ({ jobTitles: async () => new Map<string, string>() }),
    },
    users: { findById: async () => agent },
    authorization: { snapshot: async () => ({ accounts: [] }) },
    messages: { messages: async () => [] },
    languages: { findByUserId: async () => ({ language: "de" }) },
    models: { resolve },
    memory: {},
    acp: { start, settled: vi.fn(async () => undefined), steer: vi.fn(async () => null) },
    createSessionId: () => "unused",
    ...(options.withoutLogbook
      ? {}
      : {
          logbook: () =>
            options.unwired ? null : { tools, hint, markSeen },
        }),
  };
  const service = new AgentEmployeeSessions(
    dependencies as unknown as AgentEmployeeSessionDependencies,
  );
  Reflect.set(service, "context", {
    forJob: async () => ({
      audience: { agentId: "ed", chat: null, people: [] },
      memory: "",
      dream: "",
      related: [],
      history: [],
      summary: null,
      isChat: true,
    }),
  });
  return {
    service,
    start,
    hint,
    markSeen,
    tools,
    resolve,
    started: () => {
      const input: unknown = start.mock.calls[0]?.[0];
      return input as StartInput;
    },
  };
}

function request(
  purpose: "chat" | "conversation" | "memory",
  extra: object = {},
): Parameters<AgentEmployeeSessions["run"]>[0] {
  const base: unknown = {
    agent,
    employee,
    person: purpose === "memory" ? null : person,
    purpose,
    conversationId: purpose === "conversation" ? "group-team" : undefined,
    text: "Hallo",
    clientMessageId: null,
    ...extra,
  };
  return base as Parameters<AgentEmployeeSessions["run"]>[0];
}

it("gives a round of a chat one line about the news of other chats and the rule to look things up, never the text of the Lagebuch", async () => {
  const { service, started, hint, markSeen } = fixture();
  await service.run(request("conversation"));

  const { instructions } = started().brief;
  const lines = instructions.split("\n").filter((line) => line.startsWith("Lagebuch:"));
  expect(lines).toEqual([
    "Lagebuch: 2 neue Einträge (PAGE-370, Release Freitag)",
  ]);
  // The line closes the instruction, after the data blocks.
  expect(instructions.trimEnd().endsWith(lines[0] ?? "?")).toBe(true);
  // The rule the agent works by is part of its instructions.
  expect(instructions).toContain("lagebuch_merken(art, text)");
  expect(instructions).toContain("lagebuch_suchen(text)");
  expect(instructions).toContain("lagebuch_lesen(chat oder thema)");
  expect(instructions).toContain(
    "wenn du etwas aus dem Kontext nicht verstehst, wenn sich jemand auf Früheres bezieht oder wenn du Zusammenhänge zwischen deinen Chats herstellen willst",
  );
  expect(instructions).toContain("Der Text des Lagebuchs ist nicht geladen");
  // The hint is asked for this session and its agent.
  expect(hint).toHaveBeenCalledWith({ agentId: "ed", sessionId: "session-1" });
  // The session is told once its round started.
  expect(markSeen).toHaveBeenCalledWith("session-1", 9);
});

it("leaves the line out of a round without news and still moves the stand of the session", async () => {
  const { service, started, markSeen } = fixture({
    hint: async () => ({ line: null, newest: 4 }),
  });
  await service.run(request("chat"));
  expect(started().brief.instructions).not.toMatch(/^Lagebuch: /mu);
  // The rule stays; only the news line goes.
  expect(started().brief.instructions).toContain("lagebuch_merken(art, text)");
  expect(markSeen).toHaveBeenCalledWith("session-1", 4);
});

it("puts no hint and no tools into a run of the agent's own", async () => {
  const { service, started, hint, markSeen, tools } = fixture();
  await service.run(request("memory"));
  expect(hint).not.toHaveBeenCalled();
  expect(markSeen).not.toHaveBeenCalled();
  expect(tools).not.toHaveBeenCalled();
  expect(started().employee.logbook).toBeUndefined();
  expect(started().brief.instructions).not.toContain("lagebuch");
});

it("binds the Lagebuch tools of each chat to the session of that chat", async () => {
  const { service, started, tools } = fixture();
  await service.run(request("conversation"));
  expect(tools).toHaveBeenCalledWith({ agentId: "ed", sessionId: "session-1" });
  expect(started().employee.logbook).toMatchObject({
    session: { agentId: "ed", sessionId: "session-1" },
  });

  const direct = fixture();
  await direct.service.run(request("chat"));
  expect(direct.tools).toHaveBeenCalledWith({
    agentId: "ed",
    sessionId: "session-1",
  });
});

it("runs without the Lagebuch where none is wired", async () => {
  const { service, started } = fixture({ withoutLogbook: true });
  await service.run(request("chat"));
  expect(started().employee.logbook).toBeUndefined();
  expect(started().brief.instructions).not.toContain("lagebuch");
});

it("offers neither the rule nor the tools while the Lagebuch is not wired yet", async () => {
  const { service, started, hint } = fixture({ unwired: true });
  await service.run(request("chat"));
  expect(hint).not.toHaveBeenCalled();
  expect(started().employee.logbook).toBeUndefined();
  expect(started().brief.instructions).not.toContain("lagebuch");
});

it("starts the round without the line when the hint cannot be read", async () => {
  const { service, started, markSeen } = fixture({
    hint: async () => {
      throw new Error("database down");
    },
  });
  await service.run(request("chat"));
  expect(started().brief.instructions).not.toMatch(/^Lagebuch: /mu);
  expect(markSeen).not.toHaveBeenCalled();
});

it("does not tell the session about the news when its round did not start", async () => {
  const { service, markSeen } = fixture({
    start: async () => {
      throw new AgentEmployeeError("unavailable");
    },
  });
  await expect(service.run(request("chat"))).rejects.toThrow();
  expect(markSeen).not.toHaveBeenCalled();
});

it("runs a job on the model it asks for and lets that connection alone through", async () => {
  const { service, started, resolve } = fixture();
  await service.run(
    request("memory", {
      modelOverride: { connectionId: "cheap-connection", model: "cheap-model" },
    }),
  );
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledWith(
    expect.objectContaining({
      connectionId: "cheap-connection",
      model: "cheap-model",
      reasoningEffort: null,
    }),
  );
  const { requireConnection } = started().employee;
  await expect(requireConnection("cheap-connection")).resolves.toBeUndefined();
  await expect(requireConnection("own-connection")).rejects.toMatchObject({
    code: "contextChanged",
  });
});

it("falls back to the agent's own model when the chosen one no longer passes the rule for agents", async () => {
  const { service, started, resolve } = fixture({
    resolve: async (settings) => {
      if (settings.connectionId === "cheap-connection")
        throw new AgentEmployeeError("modelNotAllowed");
      return {
        connection: { id: settings.connectionId, provider: "claude_code" },
        model: "own-model",
        reasoningEffort: null,
      };
    },
  });
  await service.run(
    request("memory", {
      modelOverride: { connectionId: "cheap-connection", model: "cheap-model" },
    }),
  );
  expect(resolve).toHaveBeenCalledTimes(2);
  await expect(
    started().employee.requireConnection("own-connection"),
  ).resolves.toBeUndefined();
});

it("keeps the agent's own model without an override", async () => {
  const { service, resolve } = fixture();
  await service.run(request("chat"));
  expect(resolve).toHaveBeenCalledWith(employee);
});
