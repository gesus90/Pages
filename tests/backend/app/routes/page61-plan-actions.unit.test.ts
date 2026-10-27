import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action } from "@/app/routes/agent-plans";
import { AgentError } from "@/backend/error/AgentErrors";

import { TICKET_ACTOR } from "../../backend/service/agents/page55-ticket-fixture";

const service = vi.hoisted(() => ({ remove: vi.fn(), visible: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    agentPlanService: service,
    agentPlanManagement: { remove: service.remove },
  }));
const services = vi.hoisted(() => ({
  agentPlanService: { visible: vi.fn() },
  agentPlanManagement: { remove: vi.fn() },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const DELETED = { id: "plan", projectId: "project" };
const SAME_PROJECT = { id: "sibling", projectId: "project" };
const OTHER_PROJECT = { id: "other", projectId: "elsewhere" };

beforeEach(() => {
  vi.resetAllMocks();
  service.visible.mockResolvedValue([]);
  services.agentPlanService.visible.mockResolvedValue([]);
});

async function remove(fields: Record<string, string>): Promise<Response> {
  const provider = new RouterContextProvider();
  provider.set(authenticatedUserContext, TICKET_ACTOR);
  return action({
    request: new Request("http://synthetic.invalid/agents/plans", {
      method: "POST",
      body: new URLSearchParams({
        intent: "delete-plan",
        planId,
        revision: "3",
        requestKey: "request-1",
      }),
      body: new URLSearchParams({ intent: "delete-plan", ...fields }),
    }),
    context: provider,
    params: {},
    url: new URL("http://synthetic.invalid/agents/plans"),
    pattern: "/agents/plans",
  });
}

it("deletes as the authenticated user and returns to the plan list", async () => {
  const response = await remove("plan");
  expect(service.remove).toHaveBeenCalledExactlyOnceWith("owner", "plan", {
    revision: 3,
    requestKey: "page-request-1",
  });
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/agents/plans");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Set-Cookie")).toBeNull();
});

it("redirects to a remaining plan of the same project and defers persistence until it opens", async () => {
  service.visible.mockResolvedValueOnce([{ id: "plan", projectId: "project" }]);
  service.visible.mockResolvedValueOnce([
    { id: "elsewhere", projectId: "another-project" },
    { id: "next", projectId: "project" },
  ]);
  const response = await remove("plan");
  expect(response.headers.get("Location")).toBe("/agents/plans?planId=next");
  expect(response.headers.get("Set-Cookie")).toBeNull();
it("deletes with the revision as the authenticated user and clears the selection of the last plan", async () => {
  services.agentPlanService.visible
    .mockResolvedValueOnce([DELETED])
    .mockResolvedValueOnce([]);
  const response = await remove({
    planId: "plan",
    revision: "3",
    requestKey: "dialog",
  });
  expect(services.agentPlanManagement.remove).toHaveBeenCalledExactlyOnceWith(
    "owner",
    "plan",
    { revision: 3, requestKey: "page-dialog" },
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/agents/plans");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Set-Cookie")).toContain("pages_plan_selection=");
  expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
});

it("opens a plan of the same project first and remembers it", async () => {
  services.agentPlanService.visible
    .mockResolvedValueOnce([DELETED, OTHER_PROJECT, SAME_PROJECT])
    .mockResolvedValueOnce([OTHER_PROJECT, SAME_PROJECT]);
  const response = await remove({
    planId: "plan",
    revision: "1",
    requestKey: "dialog",
  });
  expect(response.headers.get("Location")).toBe("/agents/plans?planId=sibling");
  expect(response.headers.get("Set-Cookie")).not.toContain("Max-Age=0");
});

it("falls back to the first readable plan of another project", async () => {
  services.agentPlanService.visible
    .mockResolvedValueOnce([DELETED])
    .mockResolvedValueOnce([OTHER_PROJECT]);
  const response = await remove({
    planId: "plan",
    revision: "1",
    requestKey: "dialog",
  });
  expect(response.headers.get("Location")).toBe("/agents/plans?planId=other");
});

it("returns a safe denial when the service refuses a user without the right", async () => {
  services.agentPlanManagement.remove.mockRejectedValue(
    new AgentError("plan_access_denied"),
  );
  const response = await remove({
    planId: "plan",
    revision: "1",
    requestKey: "dialog",
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    ok: false,
    intent: "delete-plan",
    error: "plan_access_denied",
  });
});

it("reports an active run as a conflict", async () => {
  services.agentPlanManagement.remove.mockRejectedValue(
    new AgentError("plan_running"),
  );
  const running = await remove({
    planId: "plan",
    revision: "1",
    requestKey: "dialog",
  });
  expect(running.status).toBe(409);
  expect(await running.json()).toMatchObject({ error: "plan_running" });
});

const INCOMPLETE_REQUESTS: readonly {
  readonly fields: Record<string, string>;
}[] = [
  { fields: { planId: "", revision: "1", requestKey: "dialog" } },
  { fields: { planId: "plan", revision: "0", requestKey: "dialog" } },
  { fields: { planId: "plan", revision: "x", requestKey: "dialog" } },
  { fields: { planId: "plan", revision: "1" } },
];

it.each(INCOMPLETE_REQUESTS)(
  "rejects an incomplete deletion request $fields",
  async ({ fields }) => {
    const response = await remove(fields);
    expect(response.status).toBe(400);
    expect(services.agentPlanManagement.remove).not.toHaveBeenCalled();
  },
);
