import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/agent-plan-runs";
import { AgentError } from "@/backend/error/AgentErrors";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({
  agentPlanService: { control: vi.fn(), run: vi.fn() },
  runnerService: { observePlan: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

async function poll(
  query: string,
  headers: Readonly<Record<string, string>> = {},
  user: User | null = EMPLOYEE,
): Promise<Response> {
  return loader(
    routeArguments(
      new Request(`http://pages.invalid/agent-api/plan-runs${query}`, {
        headers,
      }),
      user,
      {},
    ),
  );
}

it("polls the control state of a plan", async () => {
  services.agentPlanService.control.mockResolvedValue({ state: "idle" });

  const response = await poll("?planId=plan-1");

  expect(services.agentPlanService.control).toHaveBeenCalledWith(
    EMPLOYEE.id,
    "plan-1",
  );
  expect(services.runnerService.observePlan).not.toHaveBeenCalled();
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("ETag")).toMatch(/^W\/"/u);
  expect(await response.json()).toEqual({
    ok: true,
    intent: "poll-control",
    control: { state: "idle" },
  });
});

it.each([
  ["open", true],
  ["renew", false],
])("reports an %s observation of the plan", async (observation, isOpen) => {
  services.agentPlanService.control.mockResolvedValue({ state: "idle" });

  await poll("?planId=plan-1", { "X-Plan-Observation": observation });

  expect(services.runnerService.observePlan).toHaveBeenCalledWith(
    "plan-1",
    isOpen,
  );
});

it("answers an unchanged control state with 304", async () => {
  services.agentPlanService.control.mockResolvedValue({ state: "idle" });
  const first = await poll("?planId=plan-1", { "X-Plan-Observation": "stop" });

  const second = await poll("?planId=plan-1", {
    "If-None-Match": first.headers.get("ETag") ?? "",
  });

  expect(second.status).toBe(304);
  expect(services.runnerService.observePlan).not.toHaveBeenCalled();
});

it("polls one run of the executing user", async () => {
  services.agentPlanService.run.mockResolvedValue({ id: "run-1" });

  const response = await poll("?runId=run-1");

  expect(services.agentPlanService.run).toHaveBeenCalledWith(
    EMPLOYEE.id,
    "run-1",
  );
  expect(await response.json()).toEqual({
    ok: true,
    intent: "poll-run",
    run: { id: "run-1" },
  });
});

it("names the polled run in a refusal", async () => {
  services.agentPlanService.run.mockRejectedValue(
    new AgentError("plan_access_denied"),
  );

  const response = await poll("?runId=run-1");

  expect(response.status).toBe(403);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    ok: false,
    intent: "poll-run",
    error: "plan_access_denied",
    runId: "run-1",
  });
});

it("refuses a visitor without naming a run", async () => {
  const response = await poll("?runId=run-1", {}, null);

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ runId: "" });
});

it("refuses a poll without run or plan", async () => {
  const response = await poll("");

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "plan_invalid" });
});
