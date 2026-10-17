import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HEALTH_TIMEOUT_MILLISECONDS,
  checkHealth,
} from "@/app/lib/health.server";

const runtime = vi.hoisted(() => ({ isSetupPending: vi.fn() }));
const healthService = vi.hoisted(() => ({ canQueryDatabase: vi.fn() }));

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: async () => runtime,
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ healthService }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  runtime.isSetupPending.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkHealth", () => {
  it("reports setup without touching the database", async () => {
    runtime.isSetupPending.mockReturnValue(true);

    expect(await checkHealth()).toBe("setup");
    expect(healthService.canQueryDatabase).not.toHaveBeenCalled();
  });

  it("reports ok when the database answers", async () => {
    healthService.canQueryDatabase.mockResolvedValue(true);

    expect(await checkHealth()).toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports unavailable when the database cannot be queried", async () => {
    healthService.canQueryDatabase.mockResolvedValue(false);

    expect(await checkHealth()).toBe("unavailable");
  });

  it("reports unavailable and logs when the check fails", async () => {
    const failure = new Error("database is gone");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    healthService.canQueryDatabase.mockRejectedValue(failure);

    expect(await checkHealth()).toBe("unavailable");
    expect(logged).toHaveBeenCalledWith(
      "[pages] The health check failed.",
      expect.objectContaining({
        type: "Error",
        message:
          "Error reported; free-form diagnostic text omitted to protect user content",
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports unavailable when the database does not answer in time", async () => {
    healthService.canQueryDatabase.mockReturnValue(new Promise(() => {}));
    const result = checkHealth();

    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MILLISECONDS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors a shorter timeout", async () => {
    healthService.canQueryDatabase.mockReturnValue(new Promise(() => {}));
    const result = checkHealth(10);

    await vi.advanceTimersByTimeAsync(10);

    expect(await result).toBe("unavailable");
  });
});
