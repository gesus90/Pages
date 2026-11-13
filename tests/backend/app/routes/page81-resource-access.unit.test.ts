import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { loader } from "@/app/routes/agent-resources";

import { TICKET_ACTOR } from "../../backend/service/agents/page55-ticket-fixture";

import type { AccountAccess } from "@/definition/Authorization";

const services = vi.hoisted(() => ({
  getContext: vi.fn(),
  snapshot: vi.fn(),
  observer: vi.fn(),
  chatSessions: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    administrationService: { getContext: services.getContext },
    acpResourceScheduler: { inspect: services.snapshot },
    agentCliGitHubCredentials: { leftovers: () => [] },
    conversationObserverMonitor: { health: services.observer },
    picaAcpSessionPool: { describe: services.chatSessions },
  }),
}));

function account(changes: Partial<AccountAccess> = {}): AccountAccess {
  return {
    userId: "owner",
    role: null,
    isAdmin: true,
    mode: "admin",
    firstName: "Synthetic",
    lastName: "Admin",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
    ...changes,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  services.getContext.mockResolvedValue(account());
  services.chatSessions.mockReturnValue([]);
});

async function request(isAuthenticated = true): Promise<Response> {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, isAuthenticated ? TICKET_ACTOR : null);
  return loader({
    context,
    request: new Request("http://pages.invalid/agent-api/resources"),
    params: {},
    url: new URL("http://pages.invalid/agent-api/resources"),
    pattern: "/agent-api/resources",
  });
}

it.each([{ isAdmin: false }, { isActive: false }, { mode: "role" as const }])(
  "denies global process details for %j before consulting the scheduler",
  async (changes) => {
    services.getContext.mockResolvedValueOnce(account(changes));
    const result = await request();
    expect(result.status).toBe(403);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(services.snapshot).not.toHaveBeenCalled();
  },
);

it("rejects an unauthenticated request without loading account or process details", async () => {
  const result = await request(false);
  expect(result.status).toBe(403);
  expect(services.getContext).not.toHaveBeenCalled();
  expect(services.snapshot).not.toHaveBeenCalled();
});

it("returns the authorized snapshot without caching and rechecks the account on every poll", async () => {
  const snapshot = {
    active: [{ provider: "codex_cli", state: "cleanup_failed" }],
    waiting: [{ provider: "claude_code", reason: "capacity" }],
    availableMemory: 1024,
  };
  services.snapshot.mockReturnValue(snapshot);
  const result = await request();
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({
    ...snapshot,
    leftovers: [],
    chatSessions: [],
  });
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  services.getContext.mockResolvedValueOnce(account({ isAdmin: false }));
  expect((await request()).status).toBe(403);
  expect(services.snapshot).toHaveBeenCalledOnce();
  expect(services.getContext).toHaveBeenCalledTimes(2);
});

it("adds the group observer's health and keeps the view when it cannot be read (PAGE-340)", async () => {
  const health = {
    since: "2026-11-11T20:00:00.000Z",
    succeeded: 0,
    failed: 2,
    refused: 0,
    lastSuccessAt: null,
    lastFailure: null,
  };
  services.snapshot.mockReturnValue({ active: [], waiting: [] });
  services.observer.mockResolvedValueOnce(health);
  expect(await (await request()).json()).toEqual({
    active: [],
    waiting: [],
    leftovers: [],
    chatSessions: [],
    observer: health,
  });

  services.observer.mockRejectedValueOnce(new Error("database busy"));
  const fallback = await request();
  expect(fallback.status).toBe(200);
  expect(await fallback.json()).toEqual({
    active: [],
    waiting: [],
    leftovers: [],
    chatSessions: [],
  });
});

it("adds the chat sessions the agents hold open between rounds (PAGE-335)", async () => {
  services.snapshot.mockReturnValue({ active: [], waiting: [] });
  const held = {
    instanceId: "instance-1",
    agentId: "agent-1",
    agentName: "Ed",
    conversation: "Gruppe „A-Team“",
    state: "idle",
    lastActivityAt: "2026-11-12T14:00:00.000Z",
  };
  services.chatSessions.mockReturnValue([held]);
  const result = await request();
  expect(await result.json()).toMatchObject({ chatSessions: [held] });
});
