import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/agent-plan-session-events";
import { sessionHistoryStream } from "@/backend/service/agents/sessions/SessionHistoryStream";
import { AgentError } from "@/backend/error/AgentErrors";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  agentSessionService: { history: vi.fn(), view: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));
vi.mock("@/backend/service/agents/sessions/SessionHistoryStream", () => ({
  sessionHistoryStream: vi.fn(),
}));

const KEY = {
  planId: "plan-1",
  runId: "run-1",
  stepId: "step-1",
  attemptId: "attempt-1",
};
const PARAMS = { runId: "run-1", stepId: "step-1" };
const ADDRESS =
  "http://pages.invalid/agent-api/session/events?planId=plan-1&attemptId=attempt-1";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sessionHistoryStream).mockReturnValue(
    new Blob(["retry: 3000\n\n"]).stream(),
  );
});

async function follow(
  address: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  return loader(
    routeArguments(new Request(address, { headers }), EMPLOYEE, PARAMS),
  );
}

it("follows the authorized history after the query cursor", async () => {
  const response = await follow(`${ADDRESS}&after=5`);

  expect(services.agentSessionService.view).toHaveBeenCalledWith(
    EMPLOYEE.id,
    KEY,
  );
  expect(Object.fromEntries(response.headers)).toMatchObject({
    "cache-control": "no-store",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  });
  expect(await response.text()).toBe("retry: 3000\n\n");
  const options = vi.mocked(sessionHistoryStream).mock.calls[0]?.[0];
  expect(options?.after).toBe(5);
  await options?.read(9);
  expect(services.agentSessionService.history).toHaveBeenCalledWith(
    EMPLOYEE.id,
    KEY,
    { after: 9, limit: 32 },
  );
});

it("resumes from the last event the browser received", async () => {
  await follow(`${ADDRESS}&after=5`, { "Last-Event-ID": "11" });

  expect(sessionHistoryStream).toHaveBeenCalledWith(
    expect.objectContaining({ after: 11 }),
  );
});

it("starts at the beginning without a cursor", async () => {
  await follow(ADDRESS);

  expect(sessionHistoryStream).toHaveBeenCalledWith(
    expect.objectContaining({ after: 0 }),
  );
});

it("refuses a malformed cursor", async () => {
  const response = await follow(`${ADDRESS}&after=-1`);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "session-follow",
    error: "plan_invalid",
  });
});

it("refuses a session the person may not view", async () => {
  services.agentSessionService.view.mockRejectedValue(
    new AgentError("plan_access_denied"),
  );

  const response = await follow(ADDRESS);

  expect(response.status).toBe(403);
  expect(sessionHistoryStream).not.toHaveBeenCalled();
});

it("refuses a visitor", async () => {
  const response = await loader(
    routeArguments(new Request(ADDRESS), null, PARAMS),
  );

  expect(response.status).toBe(403);
});
