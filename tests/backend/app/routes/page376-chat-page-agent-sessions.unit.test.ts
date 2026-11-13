import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/chat-page-agent-sessions";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const OVERVIEW = {
  agentId: "agent",
  agentName: "Ed",
  sessions: [],
  openSessions: 0,
  restingSessions: 0,
  tokensToday: 0,
  settings: { idleMinutes: 30, restartPercent: 80 },
  canChangeSettings: false,
};

const services = vi.hoisted(() => ({
  administrationService: { getContext: vi.fn() },
  agentChatSessionService: {
    overview: vi.fn(),
    act: vi.fn(),
    saveSettings: vi.fn(),
  },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const ACCESS = {
  userId: "employee",
  role: null,
  isAdmin: false,
  mode: "role",
  firstName: "Em",
  lastName: "Ployee",
  isActive: true,
  departments: [],
  managedDepartments: [],
  allDepartments: false,
  allProjects: false,
  hasHadDepartment: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  services.administrationService.getContext.mockResolvedValue(ACCESS);
  services.agentChatSessionService.overview.mockResolvedValue(OVERVIEW);
});

function post(fields: Record<string, string>): Promise<Response> {
  const request = new Request("http://pages.invalid/chat-page-api/agent-sessions", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return action(routeArguments(request, EMPLOYEE, {}));
}

it("reads the sessions of an agent for the signed-in account", async () => {
  const response = await loader(
    routeArguments(
      new Request("http://pages.invalid/chat-page-api/agent-sessions?agentId=agent"),
      EMPLOYEE,
      {},
    ),
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ ok: true, overview: OVERVIEW });
  expect(services.agentChatSessionService.overview).toHaveBeenCalledWith(
    expect.objectContaining({ user: EMPLOYEE, isAdministrator: false }),
    "agent",
  );
});

it("lets an administrator in the active admin mode see and change everything", async () => {
  services.administrationService.getContext.mockResolvedValue({
    ...ACCESS,
    isAdmin: true,
    mode: "admin",
  });
  await loader(
    routeArguments(
      new Request("http://pages.invalid/chat-page-api/agent-sessions?agentId=agent"),
      EMPLOYEE,
      {},
    ),
  );
  expect(services.agentChatSessionService.overview).toHaveBeenCalledWith(
    expect.objectContaining({ isAdministrator: true }),
    "agent",
  );
});

it("refuses a request without an account", async () => {
  await expect(
    loader(routeArguments(new Request("http://pages.invalid/x"), null, {})),
  ).rejects.toMatchObject({ status: 403 });
});

it.each(["stop", "summarize", "restart"])("runs %s on one session and answers with the sessions as they stand", async (intent) => {
  const response = await post({ intent, agentId: "agent", sessionId: "session-1" });
  expect(services.agentChatSessionService.act).toHaveBeenCalledWith(
    expect.objectContaining({ user: EMPLOYEE }),
    intent,
    "session-1",
  );
  await expect(response.json()).resolves.toMatchObject({ ok: true, overview: { agentId: "agent" } });
});

it("saves the idle time and the restart threshold of an agent", async () => {
  await post({ intent: "save-settings", agentId: "agent", idleMinutes: "20", restartPercent: "70" });
  expect(services.agentChatSessionService.saveSettings).toHaveBeenCalledWith(
    expect.objectContaining({ user: EMPLOYEE }),
    "agent",
    { idleMinutes: "20", restartPercent: "70" },
  );
});

it("maps a refusal of the service to its status and an unknown change to 400", async () => {
  services.agentChatSessionService.act.mockRejectedValueOnce(new AgentEmployeeError("notFound"));
  const missing = await post({ intent: "stop", agentId: "agent", sessionId: "x" });
  expect(missing.status).toBe(404);
  await expect(missing.json()).resolves.toEqual({ ok: false, error: "notFound" });
  services.agentChatSessionService.saveSettings.mockRejectedValueOnce(new AgentEmployeeError("forbidden"));
  const forbidden = await post({ intent: "save-settings", agentId: "agent" });
  expect(forbidden.status).toBe(403);
  const unknown = await post({ intent: "delete", agentId: "agent" });
  expect(unknown.status).toBe(400);
});
