import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: vi.fn(),
}));

import {
  isSetupPending,
  requireFinishedSetup,
} from "@/app/lib/setup-gate.server";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";

function useSetupState(isPending: boolean): void {
  vi.mocked(getPagesRuntime).mockResolvedValue({
    isSetupPending: () => isPending,
  } as unknown as PagesRuntime);
}

async function runGate(url: string): Promise<unknown> {
  const next = vi.fn().mockResolvedValue("next");

  try {
    return await requireFinishedSetup(
      {
        context: new RouterContextProvider(),
        params: {},
        request: new Request(url),
      } as never,
      next,
    );
  } catch (error: unknown) {
    return error;
  }
}

describe("setup gate", () => {
  beforeEach(() => {
    useSetupState(true);
  });

  it("reports the setup state of the process", async () => {
    await expect(isSetupPending()).resolves.toBe(true);
    useSetupState(false);
    await expect(isSetupPending()).resolves.toBe(false);
  });

  it.each([
    "http://pages.invalid/setup?token=x",
    "http://pages.invalid/setup.data",
    "http://pages.invalid/set-language",
    "http://pages.invalid/health",
    "http://pages.invalid/api/v1/agents",
  ])("lets %s through while the setup is pending", async (url) => {
    await expect(runGate(url)).resolves.toBe("next");
  });

  it.each([
    "http://pages.invalid/",
    "http://pages.invalid/_root.data",
    "http://pages.invalid/dashboard",
    "http://pages.invalid/login",
    "http://pages.invalid/users/1/avatar",
  ])("sends %s to the wizard while the setup is pending", async (url) => {
    const response = (await runGate(url)) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/setup");
  });

  it("lets every request through once the setup finished", async () => {
    useSetupState(false);

    await expect(runGate("http://pages.invalid/dashboard")).resolves.toBe(
      "next",
    );
  });
});
