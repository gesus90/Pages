import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { startAgentTools } from "@/backend/runtime/AgentToolsStartup";
import { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import { getApplicationServices } from "@/app/lib/services.server";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(async () => undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startAgentTools", () => {
  it("initializes profiles but does not start services during setup", async () => {
    const runtime = new PagesRuntime(new ConfigFile("/config.toml"), {
      databasePath: null,
      firstRun: true,
      port: 4100,
    });
    const initialize = vi
      .spyOn(runtime.interpreterProfiles, "initialize")
      .mockResolvedValue();

    await startAgentTools(runtime);

    expect(initialize).toHaveBeenCalledOnce();
    expect(getApplicationServices).not.toHaveBeenCalled();
  });

  it("warms services after setup", async () => {
    const runtime = new PagesRuntime(new ConfigFile("/config.toml"), {
      databasePath: "/data/pages.db",
      firstRun: false,
      port: 4100,
    });
    vi.spyOn(runtime.interpreterProfiles, "initialize").mockResolvedValue();

    await startAgentTools(runtime);

    expect(getApplicationServices).toHaveBeenCalledOnce();
  });

  it("warns and keeps startup available when profile initialization fails", async () => {
    const runtime = new PagesRuntime(new ConfigFile("/config.toml"), {
      databasePath: null,
      firstRun: true,
      port: 4100,
    });
    vi.spyOn(runtime.interpreterProfiles, "initialize").mockRejectedValue(
      new Error("failure"),
    );
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(startAgentTools(runtime)).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("Agent startup checks"),
    );
    expect(getApplicationServices).not.toHaveBeenCalled();
    warning.mockRestore();
  });
});
