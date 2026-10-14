import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action } from "@/app/routes/page-agents";
import { loader as ticketChoices } from "@/app/routes/agent-ticket-choices";
import { AgentError } from "@/backend/error/AgentErrors";

import { TICKET_ACTOR } from "../../backend/service/agents/page55-ticket-fixture";

const service = vi.hoisted(() => ({
  remove: vi.fn(),
  save: vi.fn(),
  ticketChoices: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ pageAgentService: service }),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function context(): RouterContextProvider {
  const provider = new RouterContextProvider();
  provider.set(authenticatedUserContext, TICKET_ACTOR);
  return provider;
}

async function remove(
  confirmation: string,
  intent = "delete-agent",
): Promise<Response> {
  return action({
    request: new Request("http://synthetic.invalid/agents/agents", {
      method: "POST",
      body: new URLSearchParams({ intent, agentId: "agent", confirmation }),
    }),
    context: context(),
    params: {},
    url: new URL("http://synthetic.invalid/agents/agents"),
    pattern: "/agents/agents",
  });
}

it("requires explicit confirmation and delegates deletion under the authenticated user", async () => {
  expect((await remove("")).status).toBe(400);
  expect(service.remove).not.toHaveBeenCalled();
  const response = await remove("LÖSCHEN");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true, intent: "delete-agent" });
  expect(service.remove).toHaveBeenCalledExactlyOnceWith("owner", "agent");
});

it("returns a safe denial when server-side ownership verification refuses deletion", async () => {
  service.remove.mockRejectedValue(new AgentError("agent_usage_denied"));
  const response = await remove("LÖSCHEN");
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    ok: false,
    intent: "delete-agent",
    error: "agent_usage_denied",
  });
});

it("gets ticket choices from the authenticated user's authorized service boundary", async () => {
  service.ticketChoices.mockResolvedValue([
    { id: "ticket", key: "SYN-55", title: "Synthetic" },
  ]);
  const response = await ticketChoices({
    request: new Request("http://synthetic.invalid/agent-api/ticket-choices"),
    context: context(),
    params: {},
    url: new URL("http://synthetic.invalid/agent-api/ticket-choices"),
    pattern: "/agent-api/ticket-choices",
  });
  expect(service.ticketChoices).toHaveBeenCalledExactlyOnceWith("owner");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    tickets: [{ id: "ticket", key: "SYN-55", title: "Synthetic" }],
  });
});
