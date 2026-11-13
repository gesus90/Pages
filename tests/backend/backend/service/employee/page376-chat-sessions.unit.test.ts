import { expect, it, vi } from "vitest";

import { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";

import type { AgentEmployeeSessionDependencies } from "@/backend/service/employee/AgentEmployeeSessions";
import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const agent: User = {
  ...person,
  id: "agent",
  displayName: "Ed",
  isAgent: true,
};
const employee = {
  revision: 3,
  access: "read_only",
  connectionId: "connection",
};

interface Fixture {
  readonly service: AgentEmployeeSessions;
  readonly start: ReturnType<typeof vi.fn>;
  readonly steer: ReturnType<typeof vi.fn>;
  readonly sessionIds: Map<string, string>;
  readonly restartIfNeeded: ReturnType<typeof vi.fn>;
  readonly afterRound: ReturnType<typeof vi.fn>;
  readonly settleJob: () => void;
}

function fixture(): Fixture {
  const sessionIds = new Map<string, string>();
  let settle: () => void = () => undefined;
  const start = vi.fn(async (input: { employee?: { onSettled?: () => void } }) => {
    settle = input.employee?.onSettled ?? settle;
    return { job: { id: "job" }, messageId: "message" };
  });
  const steer = vi.fn(async () => null as unknown);
  const restartIfNeeded = vi.fn(async () => undefined);
  const afterRound = vi.fn(async () => undefined);
  const dependencies = {
    store: {
      conversations: () => ({
        // One row per agent, chat and purpose, as the unique key of the table holds it.
        ensure: vi.fn(
          async (key: {
            agentId: string;
            personId: string;
            purpose: string;
          }) => {
            const id = `${key.agentId}:${key.personId}:${key.purpose}`;
            if (!sessionIds.has(id)) sessionIds.set(id, `session-${String(sessionIds.size + 1)}`);
            return { sessionId: sessionIds.get(id) };
          },
        ),
        find: vi.fn(
          async (agentId: string, personId: string, purpose: string) => {
            const sessionId = sessionIds.get(`${agentId}:${personId}:${purpose}`);
            return sessionId ? { sessionId } : null;
          },
        ),
      }),
    },
    acp: { start, settled: vi.fn(async () => undefined), steer },
    createSessionId: () => "unused",
    lifecycle: () => ({ restartIfNeeded, afterRound }),
  };
  const service = new AgentEmployeeSessions(
    dependencies as unknown as AgentEmployeeSessionDependencies,
  );
  Reflect.set(service, "assignment", async () => ({
    connection: { id: "connection", provider: "claude_code" },
    model: "model",
    reasoningEffort: null,
    run: { access: "read_only", timeoutSeconds: 0 },
  }));
  Reflect.set(service, "brief", async () => ({
    brief: { instructions: "", prompt: {} },
    audience: { agentId: agent.id, chat: null, people: [] },
  }));
  return {
    service,
    start,
    steer,
    sessionIds,
    restartIfNeeded,
    afterRound,
    settleJob: () => settle(),
  };
}

function round(
  purpose: "chat" | "conversation" | "memory",
  group?: string,
  extra: object = {},
): Parameters<AgentEmployeeSessions["run"]>[0] {
  const request: unknown = {
    agent,
    employee,
    person: purpose === "memory" ? null : person,
    purpose,
    conversationId: group,
    conversationLabel: group ? `Gruppe ${group}` : undefined,
    text: "Hallo",
    clientMessageId: null,
    ...extra,
  };
  return request as Parameters<AgentEmployeeSessions["run"]>[0];
}

it("gives an agent in a direct chat and three groups exactly four sessions, however many messages follow", async () => {
  const { service, start, sessionIds } = fixture();
  const chats = [
    () => round("chat"),
    () => round("conversation", "group-a"),
    () => round("conversation", "group-b"),
    () => round("conversation", "group-c"),
  ];
  for (let message = 0; message < 4; message += 1)
    for (const chat of chats) await service.run(chat());
  expect(sessionIds.size).toBe(4);
  const used = new Set(
    start.mock.calls.map(
      ([input]: [{ request: { sessionId: string } }]) => input.request.sessionId,
    ),
  );
  expect(used.size).toBe(4);
  expect(start).toHaveBeenCalledTimes(16);
});

it("gives a run of the agent's own a short session that continues no earlier one", async () => {
  const { service, start } = fixture();
  await service.run(round("memory"));
  await service.run(round("chat"));
  expect(start.mock.calls[0]?.[0]).toMatchObject({
    employee: { isFreshSession: true },
  });
  const chat: unknown = start.mock.calls[1]?.[0];
  expect(JSON.stringify(chat)).not.toContain("isFreshSession");
});

it("restarts a full session before its round and looks at its fill when the round ended", async () => {
  const { service, restartIfNeeded, afterRound, settleJob } = fixture();
  await service.run(round("conversation", "group-a"));
  expect(restartIfNeeded).toHaveBeenCalledWith(agent, "session-1");
  settleJob();
  await vi.waitFor(() =>
    expect(afterRound).toHaveBeenCalledWith(agent, "session-1"),
  );
});

it("does not restart or measure a run of the agent's own", async () => {
  const { service, restartIfNeeded, afterRound, settleJob } = fixture();
  await service.run(round("memory"));
  settleJob();
  expect(restartIfNeeded).not.toHaveBeenCalled();
  expect(afterRound).not.toHaveBeenCalled();
});

it("tells background work whether the agent works in a chat", async () => {
  const { service, settleJob } = fixture();
  expect(service.isWorkingInChat("agent")).toBe(false);
  await service.run(round("conversation", "group-a"));
  expect(service.isWorkingInChat("agent")).toBe(true);
  const free = service.whenOutOfChats("agent");
  settleJob();
  await expect(free).resolves.toBe(true);
  expect(service.isWorkingInChat("agent")).toBe(false);
  // A run of the agent's own is no chat.
  await service.run(round("memory"));
  expect(service.isWorkingInChat("agent")).toBe(false);
});

it("gives up the wait of a background run after the longest wait", async () => {
  const wait = vi.fn(async () => undefined);
  const { service } = fixture();
  Reflect.set(
    service,
    "dependencies",
    { ...Reflect.get(service, "dependencies"), wait },
  );
  await service.run(round("chat"));
  await expect(service.whenOutOfChats("agent")).resolves.toBe(false);
  expect(wait).toHaveBeenCalled();
});

it("steers into the running job of the chat of a conversation, and only into one that exists", async () => {
  const { service, steer } = fixture();
  await expect(
    service.steerChat(agent, { purpose: "conversation", conversationId: "group-a" }, "Neu"),
  ).resolves.toBe(false);
  expect(steer).not.toHaveBeenCalled();
  await service.run(round("conversation", "group-a"));
  steer.mockResolvedValueOnce({ messageId: "m", jobId: "job", status: "pending" });
  await expect(
    service.steerChat(agent, { purpose: "conversation", conversationId: "group-a" }, "Neu"),
  ).resolves.toBe(true);
  expect(steer).toHaveBeenCalledWith(
    agent,
    expect.objectContaining({ sessionId: "session-1", text: "Neu" }),
  );
  steer.mockResolvedValueOnce(null);
  await expect(
    service.steerChat(agent, { purpose: "conversation", conversationId: "group-a" }, "Neu"),
  ).resolves.toBe(false);
});

it("waits for the running answer of its chat instead of joining it for a scheduled message", async () => {
  const { service, steer } = fixture();
  steer.mockResolvedValue({ messageId: "m", jobId: "job", status: "pending" });
  await service.run(round("chat", undefined, { isScheduled: true }));
  expect(steer).not.toHaveBeenCalled();
  await service.run(round("chat"));
  expect(steer).toHaveBeenCalledOnce();
});
