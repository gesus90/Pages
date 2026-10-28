import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/agent-run-record";
import { AgentError } from "@/backend/error/AgentErrors";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  agentPlanService: { run: vi.fn() },
  agentRunArchive: { read: vi.fn() },
  pageAgentService: { requireVisible: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const REQUEST = new Request("http://pages.invalid/agent-api/run-record");
const PARAMS = { agentId: "agent-1", runId: "record-1" };

beforeEach(() => {
  vi.resetAllMocks();
});

it("delivers the markdown after rechecking agent, record and plan run", async () => {
  services.agentRunArchive.read.mockResolvedValue({
    markdown: "# Run",
    record: { planRunId: "plan-run-1" },
  });

  const response = await loader(routeArguments(REQUEST, EMPLOYEE, PARAMS));

  expect(services.pageAgentService.requireVisible).toHaveBeenCalledWith(
    EMPLOYEE.id,
    "agent-1",
  );
  expect(services.agentRunArchive.read).toHaveBeenCalledWith(
    EMPLOYEE.id,
    "agent-1",
    "record-1",
  );
  expect(services.agentPlanService.run).toHaveBeenCalledWith(
    EMPLOYEE.id,
    "plan-run-1",
  );
  expect(Object.fromEntries(response.headers)).toMatchObject({
    "cache-control": "no-store",
    "content-type": "text/markdown; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  expect(await response.text()).toBe("# Run");
});

it("refuses a visitor", async () => {
  const response = await loader(routeArguments(REQUEST, null, PARAMS));

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "agent_usage_denied" });
  expect(services.agentRunArchive.read).not.toHaveBeenCalled();
});

it("refuses a record whose plan run is no longer accessible", async () => {
  services.agentRunArchive.read.mockResolvedValue({
    markdown: "# Run",
    record: { planRunId: "plan-run-1" },
  });
  services.agentPlanService.run.mockRejectedValue(
    new AgentError("plan_access_denied"),
  );

  const response = await loader(routeArguments(REQUEST, EMPLOYEE, PARAMS));

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "plan_access_denied" });
});
