import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/chat-page-agent-logbook";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const OVERVIEW = {
  agentId: "agent",
  agentName: "Ed",
  entries: [],
  count: 0,
  fillPercent: 0,
  settings: { limit: 200, quietMinutes: 2, model: null },
  instanceModel: null,
  models: [],
  chats: [],
  canChangeSettings: false,
};

const services = vi.hoisted(() => ({
  administrationService: { getContext: vi.fn() },
  agentLogbookAdministration: {
    overview: vi.fn(),
    saveSettings: vi.fn(),
    remove: vi.fn(),
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
  services.agentLogbookAdministration.overview.mockResolvedValue(OVERVIEW);
});

function post(body: URLSearchParams): Promise<Response> {
  const request = new Request(
    "http://pages.invalid/chat-page-api/agent-logbook",
    {
      method: "POST",
      body,
    },
  );
  return action(routeArguments(request, EMPLOYEE, {}));
}

it("reads the Lagebuch of an agent for the signed-in account", async () => {
  const response = await loader(
    routeArguments(
      new Request(
        "http://pages.invalid/chat-page-api/agent-logbook?agentId=agent",
      ),
      EMPLOYEE,
      {},
    ),
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    ok: true,
    overview: OVERVIEW,
  });
  expect(services.agentLogbookAdministration.overview).toHaveBeenCalledWith(
    expect.objectContaining({ user: EMPLOYEE, isAdministrator: false }),
    "agent",
  );
});

it("lets an administrator in the active admin mode see all entries", async () => {
  services.administrationService.getContext.mockResolvedValue({
    ...ACCESS,
    isAdmin: true,
    mode: "admin",
  });
  await loader(
    routeArguments(
      new Request(
        "http://pages.invalid/chat-page-api/agent-logbook?agentId=agent",
      ),
      EMPLOYEE,
      {},
    ),
  );
  expect(services.agentLogbookAdministration.overview).toHaveBeenCalledWith(
    expect.objectContaining({ isAdministrator: true }),
    "agent",
  );
});

it("refuses a request without an account", async () => {
  await expect(
    loader(routeArguments(new Request("http://pages.invalid/x"), null, {})),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    action(
      routeArguments(
        new Request("http://pages.invalid/x", {
          method: "POST",
          body: new URLSearchParams(),
        }),
        null,
        {},
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it("saves limit, quiet time and model of an agent and answers with the Lagebuch as it stands", async () => {
  const response = await post(
    new URLSearchParams({
      intent: "save-settings",
      agentId: "agent",
      limit: "120",
      quietMinutes: "5",
      modelConnectionId: "c",
      model: "m",
    }),
  );
  expect(services.agentLogbookAdministration.saveSettings).toHaveBeenCalledWith(
    expect.objectContaining({ user: EMPLOYEE }),
    "agent",
    { limit: "120", quietMinutes: "5", modelConnectionId: "c", model: "m" },
  );
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    overview: { agentId: "agent" },
  });
});

it("removes the entries named in the request", async () => {
  const body = new URLSearchParams();
  body.set("intent", "remove-entries");
  body.set("agentId", "agent");
  body.append("entryId", "a");
  body.append("entryId", "b");
  await post(body);
  expect(services.agentLogbookAdministration.remove).toHaveBeenCalledWith(
    expect.objectContaining({ user: EMPLOYEE }),
    "agent",
    ["a", "b"],
  );
});

it("maps a refusal of the service to its status and an unknown change to 400", async () => {
  services.agentLogbookAdministration.saveSettings.mockRejectedValueOnce(
    new AgentEmployeeError("forbidden"),
  );
  const forbidden = await post(
    new URLSearchParams({ intent: "save-settings", agentId: "agent" }),
  );
  expect(forbidden.status).toBe(403);
  await expect(forbidden.json()).resolves.toEqual({
    ok: false,
    error: "forbidden",
  });

  services.agentLogbookAdministration.remove.mockRejectedValueOnce(
    new AgentEmployeeError("notFound"),
  );
  const missing = await post(
    new URLSearchParams({ intent: "remove-entries", agentId: "x" }),
  );
  expect(missing.status).toBe(404);

  const unknown = await post(
    new URLSearchParams({ intent: "wipe", agentId: "agent" }),
  );
  expect(unknown.status).toBe(400);
});
