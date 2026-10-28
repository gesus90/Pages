import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/agent-plan-session-download";
import { sessionHistoryDownload } from "@/backend/service/agents/sessions/SessionHistoryStream";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  agentSessionService: { history: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));
vi.mock("@/backend/service/agents/sessions/SessionHistoryStream", () => ({
  sessionHistoryDownload: vi.fn(),
}));

const KEY = {
  planId: "plan-1",
  runId: "run-1",
  stepId: "step-1",
  attemptId: "attempt-1",
};
const PARAMS = { runId: "run-1", stepId: "step-1" };
const ADDRESS =
  "http://pages.invalid/agent-api/session/download?planId=plan-1&attemptId=attempt-1";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sessionHistoryDownload).mockReturnValue(
    new Blob(["history"]).stream(),
  );
});

it("exports the journal up to its last event as a text attachment", async () => {
  services.agentSessionService.history.mockResolvedValue({ cursor: 42 });
  const request = new Request(ADDRESS);

  const response = await loader(routeArguments(request, EMPLOYEE, PARAMS));

  expect(services.agentSessionService.history).toHaveBeenCalledWith(
    EMPLOYEE.id,
    KEY,
    { after: 0, tail: true, limit: 1 },
  );
  expect(Object.fromEntries(response.headers)).toMatchObject({
    "cache-control": "no-store",
    "content-disposition": 'attachment; filename="agent-history.txt"',
    "content-type": "text/plain; charset=utf-8",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  });
  expect(await response.text()).toBe("history");
  const options = vi.mocked(sessionHistoryDownload).mock.calls[0]?.[0];
  expect(options).toMatchObject({ lastSequence: 42, signal: request.signal });
  await options?.read(7);
  expect(services.agentSessionService.history).toHaveBeenLastCalledWith(
    EMPLOYEE.id,
    KEY,
    { after: 7, limit: 32 },
  );
});

it("exports an empty journal from the start", async () => {
  services.agentSessionService.history.mockResolvedValue({ cursor: null });

  await loader(routeArguments(new Request(ADDRESS), EMPLOYEE, PARAMS));

  expect(sessionHistoryDownload).toHaveBeenCalledWith(
    expect.objectContaining({ lastSequence: 0 }),
  );
});

it("refuses a visitor", async () => {
  const response = await loader(
    routeArguments(new Request(ADDRESS), null, PARAMS),
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "session-download",
    error: "plan_access_denied",
  });
});

it("refuses an address without attempt", async () => {
  const response = await loader(
    routeArguments(
      new Request("http://pages.invalid/x?planId=plan-1"),
      EMPLOYEE,
      PARAMS,
    ),
  );

  expect(response.status).toBe(400);
  expect(services.agentSessionService.history).not.toHaveBeenCalled();
});
