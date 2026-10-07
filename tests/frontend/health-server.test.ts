import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: vi.fn(),
}));

import { checkHealth } from "@/app/lib/health.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { loader } from "@/app/routes/health";

import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";

function useRuntime(isSetupPending: boolean): void {
  vi.mocked(getPagesRuntime).mockResolvedValue({
    isSetupPending: () => isSetupPending,
  } as unknown as PagesRuntime);
}

function useDatabase(canQueryDatabase: () => Promise<boolean>): void {
  vi.mocked(getApplicationServices).mockResolvedValue({
    healthService: { canQueryDatabase },
  } as unknown as Awaited<ReturnType<typeof getApplicationServices>>);
}

describe("checkHealth", () => {
  beforeEach(() => {
    useRuntime(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is ok while the database answers", async () => {
    useDatabase(async () => true);

    await expect(checkHealth()).resolves.toBe("ok");
  });

  it("is unavailable when the database fails", async () => {
    useDatabase(async () => false);

    await expect(checkHealth()).resolves.toBe("unavailable");
  });

  it("is unavailable when the services cannot start", async () => {
    vi.mocked(getApplicationServices).mockRejectedValue(new Error("locked"));

    await expect(checkHealth()).resolves.toBe("unavailable");
    expect(console.error).toHaveBeenCalledWith(
      "[pages] The health check failed.",
      expect.any(Error),
    );
  });

  it("gives up when the database does not answer in time", async () => {
    vi.useFakeTimers();
    useDatabase(() => new Promise(() => {}));

    const result = checkHealth(1000);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBe("unavailable");
  });

  it("only reports the pending setup, as no database exists yet", async () => {
    useRuntime(true);
    useDatabase(async () => {
      throw new Error("must not be asked");
    });

    await expect(checkHealth()).resolves.toBe("setup");
    expect(getApplicationServices).not.toHaveBeenCalled();
  });
});

describe("health route", () => {
  beforeEach(() => {
    useRuntime(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("answers 200 with the status and nothing else", async () => {
    useDatabase(async () => true);

    const response = await loader();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("answers 200 while the setup is pending", async () => {
    useRuntime(true);

    const response = await loader();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "setup" });
  });

  it("answers 503 when the database is unavailable", async () => {
    useDatabase(async () => false);

    const response = await loader();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
