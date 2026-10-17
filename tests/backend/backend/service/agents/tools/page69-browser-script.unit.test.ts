import { runInNewContext } from "node:vm";

import { expect, it, vi } from "vitest";

import { BROWSER_PROBE_SCRIPT } from "@/backend/service/agents/tools/AgentToolHealthService";

function browserScriptWorld(shouldFail = false): {
  readonly launch: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly run: () => Promise<void>;
  readonly process: {
    readonly env: Readonly<Record<string, string>>;
    exitCode: number;
    readonly stdout: { readonly write: ReturnType<typeof vi.fn> };
  };
} {
  const close = vi.fn(async () => undefined);
  const launch = vi.fn(async () => ({
    version: () => "145.0.0.0",
    newPage: async () => ({
      goto: async () => {
        if (shouldFail) throw new Error("synthetic browser failure");
      },
    }),
    close,
  }));
  const probeProcess = {
    env: {
      PAGES_BROWSER: "chromium",
      PAGES_PLAYWRIGHT_ENTRY: "/synthetic/mcp.js",
    },
    exitCode: 0,
    stdout: { write: vi.fn() },
  };
  const loadModule = (name: string): unknown => {
    if (name === "node:fs") return { realpathSync: () => "/synthetic/mcp.js" };
    if (name === "node:module")
      return {
        createRequire: () => (module: string) =>
          module === "playwright/package.json"
            ? { version: "1.64.0-alpha-1790635538000" }
            : { chromium: { launch } },
      };
    throw new Error("Unexpected module in browser probe");
  };
  return {
    launch,
    close,
    process: probeProcess,
    run: async () => {
      const outcome: unknown = runInNewContext(BROWSER_PROBE_SCRIPT, {
        require: loadModule,
        process: probeProcess,
        Error,
      });
      await Promise.resolve(outcome);
    },
  };
}

it("launches a mocked headless browser with its sandbox and always closes it", async () => {
  const world = browserScriptWorld();
  await world.run();
  expect(world.launch).toHaveBeenCalledWith({
    headless: true,
    chromiumSandbox: true,
  });
  expect(world.close).toHaveBeenCalledOnce();
  expect(world.process.exitCode).toBe(0);
});

it("closes a browser after a failed page probe and returns a failure without leaking upstream output", async () => {
  const world = browserScriptWorld(true);
  await world.run();
  expect(world.close).toHaveBeenCalledOnce();
  expect(world.process.exitCode).toBe(1);
});

it("reports a fixed sandbox diagnosis without exposing native browser logs", async () => {
  const world = browserScriptWorld();
  world.launch.mockRejectedValueOnce(
    new Error("Chromium sandboxing failed: synthetic private path"),
  );
  await world.run();
  expect(world.process.stdout.write).toHaveBeenCalledExactlyOnceWith(
    "browser_sandbox_unavailable",
  );
  expect(world.process.exitCode).toBe(1);
});
