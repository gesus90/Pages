import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action, loader } from "@/app/routes/page-agents";
import { loader as ticketChoices } from "@/app/routes/agent-ticket-choices";

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

async function submit(
  method: string,
  intent = "delete-agent",
): Promise<Response> {
  return action({
    request: new Request("http://synthetic.invalid/agents/agents", {
      method,
      ...(method === "POST"
        ? {
            body: new URLSearchParams({
              intent,
              agentId: "agent",
              confirmation: "LÖSCHEN",
            }),
          }
        : {}),
    }),
    context: context(),
    params: {},
    url: new URL("http://synthetic.invalid/agents/agents"),
    pattern: "/agents/agents",
  });
}

it("sends an old form submission to the plan editor without deleting an agent", async () => {
  const response = await submit("POST");
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe(
    "/agents/plans?notice=direct-models",
  );
  expect(service.remove).not.toHaveBeenCalled();
  expect(service.save).not.toHaveBeenCalled();
});

it("answers anything but a POST with method not allowed", async () => {
  expect((await submit("PUT")).status).toBe(405);
  expect(service.remove).not.toHaveBeenCalled();
});

it("redirects the retired definition page to the plan editor", () => {
  const response = loader();
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(
    "/agents/plans?notice=direct-models",
  );
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
