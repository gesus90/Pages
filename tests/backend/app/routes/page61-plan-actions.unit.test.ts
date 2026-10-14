import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action } from "@/app/routes/agent-plans";
import { AgentError } from "@/backend/error/AgentErrors";

import { TICKET_ACTOR } from "../../backend/service/agents/page55-ticket-fixture";

const service = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ agentPlanService: service }),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

async function remove(planId: string): Promise<Response> {
  const provider = new RouterContextProvider();
  provider.set(authenticatedUserContext, TICKET_ACTOR);
  return action({
    request: new Request("http://synthetic.invalid/agents/plans", {
      method: "POST",
      body: new URLSearchParams({ intent: "delete-plan", planId }),
    }),
    context: provider,
    params: {},
    url: new URL("http://synthetic.invalid/agents/plans"),
    pattern: "/agents/plans",
  });
}

it("deletes as the authenticated user and returns to the plan list", async () => {
  const response = await remove("plan");
  expect(service.remove).toHaveBeenCalledExactlyOnceWith("owner", "plan");
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/agents/plans");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("returns a safe denial when the service refuses a user without the right", async () => {
  service.remove.mockRejectedValue(new AgentError("plan_access_denied"));
  const response = await remove("plan");
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "delete-plan",
    error: "plan_access_denied",
  });
});

it("reports an active run as a conflict and rejects a missing plan", async () => {
  service.remove.mockRejectedValue(new AgentError("plan_running"));
  const running = await remove("plan");
  expect(running.status).toBe(409);
  expect(await running.json()).toMatchObject({ error: "plan_running" });
  const missing = await remove("");
  expect(missing.status).toBe(400);
  expect(service.remove).toHaveBeenCalledOnce();
});
