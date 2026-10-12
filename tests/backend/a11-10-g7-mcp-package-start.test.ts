import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../mcp/node_modules/@modelcontextprotocol/server/dist/stdio.mjs",
  () => ({ serveStdio: vi.fn() }),
);
vi.mock("../../mcp/src/configuration", () => ({ readConfiguration: vi.fn() }));
vi.mock("../../mcp/src/server", () => ({ createServer: vi.fn() }));
vi.mock("../../mcp/src/verification", () => ({ verifyPages: vi.fn() }));
vi.mock("../../mcp/src/http-server", () => ({ startHttpServer: vi.fn() }));
vi.mock("../../mcp/src/credential-command", () => ({
  runCredentialCommand: vi.fn(),
}));
vi.mock("../../mcp/src/stdio-configuration", () => ({
  readStdioConfiguration: vi.fn(),
}));

import { serveStdio } from "../../mcp/node_modules/@modelcontextprotocol/server/dist/stdio.mjs";
import { readConfiguration } from "../../mcp/src/configuration";
import { runCredentialCommand } from "../../mcp/src/credential-command";
import { CredentialStoreError } from "../../mcp/src/credential-store";
import { startHttpServer } from "../../mcp/src/http-server";
import { createServer } from "../../mcp/src/server";
import { start } from "../../mcp/src/start";
import { readStdioConfiguration } from "../../mcp/src/stdio-configuration";
import { verifyPages } from "../../mcp/src/verification";

const originalArguments = process.argv;
const identity = { userId: "test", isAdmin: false, permissions: [] };
const configuration = {
  agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
  token: "paired-token",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = 0;
  process.argv = [process.execPath, "bundle.js"];
  vi.mocked(verifyPages).mockResolvedValue({ identity, tools: [] });
});

afterEach(() => {
  process.exitCode = 0;
  process.argv = originalArguments;
});

describe("MCP startup with pairing", () => {
  it.each([
    ["pair", ["pair", "--url", "http://192.168.1.8:4567", "--no-browser"], 0],
    ["rotate", ["rotate"], 0],
    ["unpair", ["unpair"], 1],
    ["status", ["status", "--url", "http://192.168.1.8:4567"], 4],
  ])(
    "runs the %s command and uses its exit code without starting a server",
    async (_command, argumentsList, exitCode) => {
      process.argv.push(...argumentsList);
      vi.mocked(runCredentialCommand).mockResolvedValue(exitCode);
      await start();
      expect(runCredentialCommand).toHaveBeenCalledExactlyOnceWith(
        argumentsList,
        process.env,
      );
      expect(process.exitCode).toBe(exitCode);
      expect(console.error).not.toHaveBeenCalled();
      expect(startHttpServer).not.toHaveBeenCalled();
      expect(readStdioConfiguration).not.toHaveBeenCalled();
      expect(verifyPages).not.toHaveBeenCalled();
      expect(serveStdio).not.toHaveBeenCalled();
    },
  );

  it("does not treat an unknown first argument as a pairing command", async () => {
    process.argv.push("pairing");
    await start();
    expect(runCredentialCommand).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("stdio startup with a paired credential", () => {
  beforeEach(() => {
    vi.stubEnv("PAGES_TOKEN", undefined);
  });

  it("reads the paired credential instead of PAGES_TOKEN, verifies it and serves stdio", async () => {
    vi.mocked(readStdioConfiguration).mockResolvedValue(configuration);
    await start();
    expect(readStdioConfiguration).toHaveBeenCalledExactlyOnceWith(process.env);
    expect(readConfiguration).not.toHaveBeenCalled();
    expect(verifyPages).toHaveBeenCalledExactlyOnceWith(configuration);
    const factory = vi.mocked(serveStdio).mock.calls[0]?.[0];
    if (!factory) throw new Error("Missing factory");
    factory({ era: "legacy" });
    const resolve = vi.mocked(createServer).mock.calls[0]?.[0];
    if (!resolve) throw new Error("Missing resolver");
    expect(resolve()).toBe(configuration);
    expect(process.exitCode).toBe(0);
  });

  it("shows the fixed credential-store text and exits 1 when no credential is paired", async () => {
    vi.mocked(readStdioConfiguration).mockRejectedValue(
      new CredentialStoreError("No paired credential. Run pages-mcp pair."),
    );
    await start();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "[pages-mcp] No paired credential. Run pages-mcp pair.",
    );
    expect(verifyPages).not.toHaveBeenCalled();
    expect(serveStdio).not.toHaveBeenCalled();
  });

  it("hides the text of any other failure behind the generic diagnostic", async () => {
    vi.mocked(readStdioConfiguration).mockRejectedValue(
      new Error("sentinel-secret"),
    );
    await start();
    expect(process.exitCode).toBe(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "sentinel-secret",
    );
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Startup failed."),
    );
    expect(serveStdio).not.toHaveBeenCalled();
  });
});
