import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/agent-ticket-choices";
import { AgentError } from "@/backend/error/AgentErrors";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  pageAgentService: { ticketChoices: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const REQUEST = new Request("http://pages.invalid/agent-api/ticket-choices");

beforeEach(() => {
  vi.resetAllMocks();
});

it("refuses a visitor without asking the service", async () => {
  const response = await loader(routeArguments(REQUEST, null, {}));

  expect(response.status).toBe(403);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    ok: false,
    intent: "",
    error: "agent_usage_denied",
  });
  expect(services.pageAgentService.ticketChoices).not.toHaveBeenCalled();
});

it("answers a refusal of the service without leaking details", async () => {
  services.pageAgentService.ticketChoices.mockRejectedValue(
    new AgentError("agent_usage_denied"),
  );

  const response = await loader(routeArguments(REQUEST, EMPLOYEE, {}));

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "agent_usage_denied" });
});
