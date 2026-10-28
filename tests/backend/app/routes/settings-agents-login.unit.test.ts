import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/settings-agents-login";

import { accountFixture } from "../../backend/auth/account-fixture";
import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const fakes = vi.hoisted(() => ({ getContext: vi.fn(), read: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    administrationService: { getContext: fakes.getContext },
    agentCliLoginService: { read: fakes.read },
  }),
}));

beforeEach(() => {
  fakes.getContext.mockResolvedValue(
    accountFixture({ userId: EMPLOYEE.id, isAdmin: true, mode: "admin" }),
  );
});

function poll(user: User | null, method = "GET"): Promise<Response> {
  return loader(
    routeArguments(
      new Request("http://pages.invalid/settings/agents/c1/login", { method }),
      user,
      { connectionId: "c1" },
    ),
  );
}

it("returns the pending login of a connection to an administrator without caching", async () => {
  fakes.read.mockResolvedValue({ state: "pending", code: "ABCD" });
  const response = await poll(EMPLOYEE);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ state: "pending", code: "ABCD" });
  expect(fakes.read).toHaveBeenCalledWith(
    expect.objectContaining({ userId: EMPLOYEE.id }),
    "c1",
  );
});

it.each([
  ["no session", null, accountFixture()],
  ["a role-mode administrator", EMPLOYEE, accountFixture({ isAdmin: true })],
])("refuses %s", async (scenario, user, account) => {
  fakes.getContext.mockResolvedValue(account);
  const response = await poll(user);
  expect(response.status).toBe(403);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(fakes.read).not.toHaveBeenCalled();
});

it("answers other methods on the polling URL with 405", async () => {
  for (const response of [await poll(EMPLOYEE, "POST"), action()]) {
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
  expect(fakes.getContext).not.toHaveBeenCalled();
});
