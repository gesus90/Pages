import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/settings-ticket-assets";

import { accountFixture } from "../../backend/auth/account-fixture";
import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const fakes = vi.hoisted(() => ({ getContext: vi.fn(), inspect: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    administrationService: { getContext: fakes.getContext },
    ticketAssetAuditService: { inspect: fakes.inspect },
  }),
}));

beforeEach(() => {
  fakes.inspect.mockResolvedValue({ missing: [], orphaned: [] });
});

function load(user: User | null): Promise<Response> {
  return loader(
    routeArguments(
      new Request("http://pages.invalid/settings/system/ticket-assets"),
      user,
      {},
    ),
  );
}

it("returns the inventory to an administrator in admin mode", async () => {
  fakes.getContext.mockResolvedValue(
    accountFixture({ isAdmin: true, mode: "admin" }),
  );
  const response = await load(EMPLOYEE);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ missing: [], orphaned: [] });
});

it.each([
  ["a role-mode administrator", accountFixture({ isAdmin: true })],
  ["an employee", accountFixture()],
])("refuses %s", async (scenario, account) => {
  fakes.getContext.mockResolvedValue(account);
  expect((await thrownResponse(load(EMPLOYEE))).status).toBe(403);
  expect(fakes.inspect).not.toHaveBeenCalled();
});

it("refuses visitors without a session", async () => {
  expect((await thrownResponse(load(null))).status).toBe(403);
  expect(fakes.getContext).not.toHaveBeenCalled();
});
