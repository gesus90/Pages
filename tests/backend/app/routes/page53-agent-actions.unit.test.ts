import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action } from "@/app/routes/settings-agents";

import { TICKET_ACTOR } from "../../backend/service/agents/page55-ticket-fixture";

const services = vi.hoisted(() => ({
  administrationService: { getContext: vi.fn() },
  agentProfileService: { remove: vi.fn() },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

beforeEach(() => {
  vi.resetAllMocks();
  services.administrationService.getContext.mockResolvedValue({
    userId: "owner",
    isActive: true,
    isAdmin: true,
    mode: "admin",
  });
});

async function remove(): Promise<Response> {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, TICKET_ACTOR);
  const url = new URL("http://synthetic.invalid/settings/agents");
  return action({
    request: new Request(url, {
      method: "POST",
      body: new URLSearchParams({
        intent: "delete-profile",
        profileId: "linked",
      }),
    }),
    context,
    params: {},
    url,
    pattern: "/settings/agents",
  });
}

it("deletes for the authenticated admin without a confirmation word", async () => {
  const response = await remove();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true, intent: "delete-profile" });
  expect(services.agentProfileService.remove).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ userId: "owner" }),
    "linked",
  );
});

it.each([
  { isActive: true, isAdmin: false, mode: "role" },
  { isActive: true, isAdmin: true, mode: "role" },
  { isActive: false, isAdmin: true, mode: "admin" },
])("refuses deletion for %j", async (actor) => {
  services.administrationService.getContext.mockResolvedValue({
    userId: "owner",
    ...actor,
  });
  const response = await remove();
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: "accessDenied",
  });
  expect(services.agentProfileService.remove).not.toHaveBeenCalled();
});

it("reports storage errors without disclosing internal diagnostics", async () => {
  services.agentProfileService.remove.mockRejectedValue(
    new Error("Sensitive database diagnostic"),
  );
  const response = await remove();
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ ok: false, error: "general" });
});
