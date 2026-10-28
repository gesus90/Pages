import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/account-version";
import { recordAccountAuthorizationVersion } from "@/backend/logging/AccountAuthorizationLog";

import { outcomeOf } from "../actions/action-fixtures";
import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  administrationService: { version: vi.fn() },
  picaSettingsService: { read: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));
vi.mock("@/backend/logging/AccountAuthorizationLog", () => ({
  recordAccountAuthorizationVersion: vi.fn(),
}));

const REQUEST = new Request("http://pages.invalid/account/version");

beforeEach(() => {
  vi.resetAllMocks();
});

it("returns the authorization and Pica fingerprint of the own account, uncached", async () => {
  services.administrationService.version.mockResolvedValue("v7");
  services.picaSettingsService.read.mockResolvedValue({ revision: 3 });

  const outcome = await outcomeOf(
    await loader(routeArguments(REQUEST, EMPLOYEE, {})),
  );

  expect(services.administrationService.version).toHaveBeenCalledWith(
    EMPLOYEE.id,
  );
  expect(recordAccountAuthorizationVersion).toHaveBeenCalledWith(
    EMPLOYEE.id,
    "v7",
  );
  expect(outcome.body).toEqual({ version: "v7:pica:3" });
  expect(outcome.headers.get("Cache-Control")).toBe("no-store");
});

it("refuses a request without a signed-in account", async () => {
  const response = await thrownResponse(
    loader(routeArguments(REQUEST, null, {})),
  );

  expect(response.status).toBe(403);
  expect(services.administrationService.version).not.toHaveBeenCalled();
});
