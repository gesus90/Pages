import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/agent-plan-prompt";
import { AgentError } from "@/backend/error/AgentErrors";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({ agentPlanService: { prompt: vi.fn() } }));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const REQUEST = new Request("http://pages.invalid/agent-api/prompt");

beforeEach(() => {
  vi.resetAllMocks();
});

it("shows the executor the plain prompt of a node", async () => {
  services.agentPlanService.prompt.mockResolvedValue("Do <b>this</b>");

  const response = await loader(
    routeArguments(REQUEST, EMPLOYEE, { runId: " run-1 ", stepId: "step-1" }),
  );

  expect(services.agentPlanService.prompt).toHaveBeenCalledWith(
    EMPLOYEE.id,
    "run-1",
    "step-1",
  );
  expect(Object.fromEntries(response.headers)).toMatchObject({
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  expect(await response.text()).toBe("Do <b>this</b>");
});

it("refuses a visitor", async () => {
  const response = await loader(
    routeArguments(REQUEST, null, { runId: "run-1", stepId: "step-1" }),
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "plan-prompt",
    error: "plan_access_denied",
  });
});

it("refuses a malformed node", async () => {
  const response = await loader(
    routeArguments(REQUEST, EMPLOYEE, { runId: "run-1", stepId: "" }),
  );

  expect(response.status).toBe(400);
  expect(services.agentPlanService.prompt).not.toHaveBeenCalled();
});

it("refuses a run of somebody else", async () => {
  services.agentPlanService.prompt.mockRejectedValue(
    new AgentError("plan_access_denied"),
  );

  const response = await loader(
    routeArguments(REQUEST, EMPLOYEE, { runId: "run-1", stepId: "step-1" }),
  );

  expect(response.status).toBe(403);
});
