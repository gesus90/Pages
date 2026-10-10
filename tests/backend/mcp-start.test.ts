import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../mcp/node_modules/@modelcontextprotocol/server/dist/stdio.mjs",
  () => ({ serveStdio: vi.fn() }),
);
vi.mock("../../mcp/src/configuration", () => ({ readConfiguration: vi.fn() }));
vi.mock("../../mcp/src/server", () => ({ createServer: vi.fn() }));
vi.mock("../../mcp/src/verification", () => ({ verifyPages: vi.fn() }));
vi.mock("../../mcp/src/http-configuration", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../mcp/src/http-configuration")
  >()),
  readHttpConfiguration: vi.fn(),
}));
vi.mock("../../mcp/src/http-server", () => ({ startHttpServer: vi.fn() }));

import { serveStdio } from "../../mcp/node_modules/@modelcontextprotocol/server/dist/stdio.mjs";
import { readConfiguration } from "../../mcp/src/configuration";
import { createServer } from "../../mcp/src/server";
import { verifyPages } from "../../mcp/src/verification";
import { startHttpServer } from "../../mcp/src/http-server";
import {
  HttpOptionError,
  readHttpConfiguration,
} from "../../mcp/src/http-configuration";
import { start } from "../../mcp/src/start";

const originalArguments = process.argv;
const identity = { userId: "test", isAdmin: false, permissions: [] };
const configuration = {
  agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
  token: "isolated-token",
};
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = 0;
  process.argv = [process.execPath, "bundle.js"];
  vi.mocked(readConfiguration).mockReturnValue(configuration);
  vi.mocked(verifyPages).mockResolvedValue({ identity, tools: [] });
});
afterEach(() => {
  process.exitCode = 0;
  process.argv = originalArguments;
});

describe("MCP startup", () => {
  it("verifies Pages before opening stdio and serves each connection with the validated configuration", async () => {
    await start();
    expect(readConfiguration).toHaveBeenCalledWith(process.env);
    expect(verifyPages).toHaveBeenCalledExactlyOnceWith(configuration);
    const factory = vi.mocked(serveStdio).mock.calls[0]?.[0];
    if (!factory) throw new Error("Missing factory");
    factory({ era: "legacy" });
    const resolve = vi.mocked(createServer).mock.calls[0]?.[0];
    if (!resolve) throw new Error("Missing resolver");
    expect(resolve()).toBe(configuration);
    expect(console.error).not.toHaveBeenCalled();
  });
  it("fails closed with token-free diagnostics on configuration, verification or SDK errors", async () => {
    for (const operation of [readConfiguration, verifyPages, serveStdio]) {
      vi.mocked(operation).mockImplementationOnce(() => {
        throw new Error("sentinel-secret");
      });
      await start();
      expect(process.exitCode).toBe(1);
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
        "sentinel-secret",
      );
    }
  });
  it("opens HTTP without a personal token and closes its listener on shutdown", async () => {
    process.argv.push("--http", "--resource", "https://mcp.invalid/mcp");
    const close = vi.fn();
    vi.mocked(startHttpServer).mockResolvedValue({ close } as never);
    const once = vi.spyOn(process, "once").mockReturnValue(process);
    await start();
    expect(readHttpConfiguration).toHaveBeenCalledWith(
      process.env,
      process.argv.slice(2),
    );
    expect(readConfiguration).not.toHaveBeenCalled();
    const shutdown = once.mock.calls.find(
      ([signal]) => signal === "SIGTERM",
    )?.[1];
    if (!shutdown) throw new Error("Missing shutdown");
    shutdown();
    expect(close).toHaveBeenCalledOnce();
  });
  it("names a rejected HTTP option with fixed text and no value", async () => {
    process.argv.push("--http", "--host", "sentinel-secret");
    vi.mocked(readHttpConfiguration).mockImplementationOnce(() => {
      throw new HttpOptionError("host");
    });
    await start();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "[pages-mcp] --host accepts only 127.0.0.1, ::1 or localhost; remote access needs a TLS reverse proxy.",
    );
    expect(startHttpServer).not.toHaveBeenCalled();
    expect(readConfiguration).not.toHaveBeenCalled();
  });
  it("starts the entry point", async () => {
    await import("../../mcp/src/main");
    await vi.waitFor(() => expect(serveStdio).toHaveBeenCalledOnce());
  });
});
