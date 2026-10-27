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

async function submit(intent: string): Promise<Response> {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, TICKET_ACTOR);
  const url = new URL("http://synthetic.invalid/settings/agents");
  return action({
    request: new Request(url, {
      method: "POST",
      body: new URLSearchParams({ intent, profileId: "linked" }),
    }),
    context,
    params: {},
    url,
    pattern: "/settings/agents",
  });
}

it.each([
  "save-profile",
  "delete-profile",
  "profile-usages",
  "delete-assignment",
])(
  "answers the retired profile intent %s as gone for the authenticated admin",
  async (intent) => {
    const response = await submit(intent);
    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: false,
      intent: "",
      error: "profile_management_retired",
    });
    expect(services.agentProfileService.remove).not.toHaveBeenCalled();
  },
);

it.each([
  { isActive: true, isAdmin: false, mode: "role" },
  { isActive: true, isAdmin: true, mode: "role" },
  { isActive: false, isAdmin: true, mode: "admin" },
])("refuses a retired profile intent for %j", async (actor) => {
  services.administrationService.getContext.mockResolvedValue({
    userId: "owner",
    ...actor,
  });
  const response = await submit("delete-profile");
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: "accessDenied",
  });
  expect(services.agentProfileService.remove).not.toHaveBeenCalled();
});

it("rejects an unknown intent as a bad request for the admin", async () => {
  expect((await submit("no-such-intent")).status).toBe(400);
});
