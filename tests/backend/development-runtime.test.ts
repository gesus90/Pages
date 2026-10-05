import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  initializePagesRuntime: vi.fn(),
}));

vi.mock("@/backend/runtime/PagesServer", () => ({
  announceServer: vi.fn(),
}));

import { resolveDefaultConfigPath } from "@/backend/config/PagesConfig";
import { startDevelopmentRuntime } from "@/backend/runtime/DevelopmentRuntime";
import { initializePagesRuntime } from "@/backend/runtime/PagesRuntime";
import { announceServer } from "@/backend/runtime/PagesServer";

import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";

describe("startDevelopmentRuntime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the default configuration and announces the dev server", async () => {
    const runtime = {} as PagesRuntime;

    vi.mocked(initializePagesRuntime).mockResolvedValue(runtime);

    await startDevelopmentRuntime([
      "http://localhost:5173/",
      "http://10.0.0.2:5173/",
    ]);

    expect(initializePagesRuntime).toHaveBeenCalledWith(
      resolveDefaultConfigPath(),
    );
    expect(announceServer).toHaveBeenCalledWith(runtime, [
      "http://localhost:5173",
      "http://10.0.0.2:5173",
    ]);
  });

  it("reports a configuration it cannot load", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(initializePagesRuntime).mockRejectedValue(new Error("broken"));

    await startDevelopmentRuntime([]);

    expect(error).toHaveBeenCalledWith(
      "[pages] The configuration could not be loaded.",
      expect.any(Error),
    );
  });
});
