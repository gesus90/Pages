import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/agent-plan-session";
import { AgentError } from "@/backend/error/AgentErrors";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({
  agentSessionService: {
    cancel: vi.fn(),
    history: vi.fn(),
    send: vi.fn(),
    view: vi.fn(),
  },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const sessions = services.agentSessionService;
const KEY = {
  planId: "plan-1",
  runId: "run-1",
  stepId: "step-1",
  attemptId: "attempt-1",
};
const PARAMS = { runId: "run-1", stepId: "step-1" };
const ADDRESS =
  "http://pages.invalid/agent-api/session?planId=plan-1&attemptId=attempt-1";

beforeEach(() => {
  vi.resetAllMocks();
});

async function post(
  fields: Readonly<Record<string, string>>,
  user: User | null = EMPLOYEE,
): Promise<Response> {
  return action(
    routeArguments(
      new Request(ADDRESS, {
        body: new URLSearchParams(fields),
        method: "POST",
      }),
      user,
      PARAMS,
    ),
  );
}

it("reads the view and one history page from the journal", async () => {
  sessions.view.mockResolvedValue({ state: "running" });
  sessions.history.mockResolvedValue({ events: [], cursor: 3 });

  const response = await loader(
    routeArguments(new Request(`${ADDRESS}&tail=1`), EMPLOYEE, PARAMS),
  );

  expect(sessions.view).toHaveBeenCalledWith(EMPLOYEE.id, KEY);
  expect(sessions.history).toHaveBeenCalledWith(EMPLOYEE.id, KEY, {
    after: 0,
    tail: true,
    limit: 200,
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    ok: true,
    view: { state: "running" },
    page: { events: [], cursor: 3 },
  });
});

it("refuses a visitor to read the session", async () => {
  const response = await loader(
    routeArguments(new Request(ADDRESS), null, PARAMS),
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "session-read",
    error: "plan_access_denied",
  });
});

it("sends an instruction to the own node session", async () => {
  sessions.send.mockResolvedValue({ delivery: "queued" });

  const response = await post({ intent: "send", text: "Continue" });

  expect(sessions.send).toHaveBeenCalledWith(EMPLOYEE.id, KEY, {
    kind: "instruction",
    text: "Continue",
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    ok: true,
    intent: "send",
    delivery: "queued",
  });
});

it.each([
  ["no text", {}],
  ["an overlong text", { text: "x".repeat(20_001) }],
])("refuses an instruction with %s", async (caseName, fields) => {
  const response = await post({ intent: "send", ...fields });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "send",
    error: "plan_invalid",
  });
  expect(sessions.send).not.toHaveBeenCalled();
});

it.each(["turn", "run"])("cancels the %s", async (scope) => {
  sessions.cancel.mockResolvedValue("cancelled");

  const response = await post({ intent: "cancel", scope });

  expect(sessions.cancel).toHaveBeenCalledWith(EMPLOYEE.id, KEY, scope);
  expect(await response.json()).toEqual({
    ok: true,
    intent: "cancel",
    outcome: "cancelled",
  });
});

it.each([
  ["an unknown scope", { intent: "cancel", scope: "plan" }],
  ["an unknown intent", { intent: "pause", scope: "run" }],
  ["no intent", {}],
])("refuses %s", async (caseName, fields) => {
  const response = await post(fields);

  expect(response.status).toBe(400);
  expect(sessions.cancel).not.toHaveBeenCalled();
});

it("answers a refusal of the session service", async () => {
  sessions.cancel.mockRejectedValue(new AgentError("plan_access_denied"));

  const response = await post({ intent: "cancel", scope: "run" });

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ intent: "cancel" });
});

it("refuses a visitor to steer the session", async () => {
  const response = await post({ intent: "send", text: "x" }, null);

  expect(response.status).toBe(403);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(sessions.send).not.toHaveBeenCalled();
});
