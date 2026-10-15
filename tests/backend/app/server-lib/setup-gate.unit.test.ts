import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isSetupPending,
  requireFinishedSetup,
} from "@/app/lib/setup-gate.server";

import { SYNTHETIC_ORIGIN, thrownResponse } from "./request-fixtures";
import { routeArguments } from "./route-arguments";

const runtime = vi.hoisted(() => ({ isSetupPending: vi.fn() }));

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: async () => runtime,
}));
vi.mock("@/app/lib/services.server", () => ({}));

const next = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  next.mockResolvedValue("next-result");
});

async function gate(path: string): Promise<unknown> {
  const request = new Request(`${SYNTHETIC_ORIGIN}${path}`);

  return requireFinishedSetup(routeArguments(request, null, {}), next);
}

describe("isSetupPending", () => {
  it("reports what the runtime knows", async () => {
    runtime.isSetupPending.mockReturnValue(true);
    expect(await isSetupPending()).toBe(true);

    runtime.isSetupPending.mockReturnValue(false);
    expect(await isSetupPending()).toBe(false);
  });
});

describe("requireFinishedSetup", () => {
  it.each(["/", "/dashboard", "/login", "/api/v1/pairing", "/settings/x.data"])(
    "sends %s to the wizard while the setup is pending",
    async (path) => {
      runtime.isSetupPending.mockReturnValue(true);

      const response = await thrownResponse(gate(path));

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/setup");
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/setup",
    "/setup.data",
    "/health",
    "/set-language",
    "/api/v1/agents",
    "/api/v1/agent-assets",
  ])("keeps %s reachable while the setup is pending", async (path) => {
    runtime.isSetupPending.mockReturnValue(true);

    expect(await gate(path)).toBe("next-result");
  });

  it.each(["/setup/", "/health/extra", "/api/v1/agents/other", "/Setup"])(
    "does not widen the exception to %s",
    async (path) => {
      runtime.isSetupPending.mockReturnValue(true);

      const response = await thrownResponse(gate(path));

      expect(response.headers.get("Location")).toBe("/setup");
    },
  );

  it("is transparent once the setup is finished", async () => {
    runtime.isSetupPending.mockReturnValue(false);

    expect(await gate("/dashboard")).toBe("next-result");
    expect(next).toHaveBeenCalledOnce();
  });
});
