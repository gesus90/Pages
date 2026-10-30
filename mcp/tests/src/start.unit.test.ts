import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCredentialCommand } from "../../src/credential-command.ts";
import { CredentialStoreError } from "../../src/credential-error.ts";
import { PagesTransportError } from "../../src/pages-transport-error.ts";
import { createServer } from "../../src/server.ts";
import { start } from "../../src/start.ts";
import { readStdioConfiguration } from "../../src/stdio-configuration.ts";
import { verifyPages } from "../../src/verification.ts";

vi.mock("@modelcontextprotocol/server/stdio", () => ({ serveStdio: vi.fn() }));
vi.mock("../../src/credential-command.ts", () => ({
  runCredentialCommand: vi.fn(),
}));
vi.mock("../../src/stdio-configuration.ts", () => ({
  readStdioConfiguration: vi.fn(),
}));
vi.mock("../../src/server.ts", () => ({ createServer: vi.fn() }));
vi.mock("../../src/verification.ts", () => ({ verifyPages: vi.fn() }));

const CONFIGURATION = {
  agentsUrl: new URL("https://pages.example/api/v1/agents"),
  token: "token",
};
const STARTUP_FAILED =
  "[pages-mcp] Startup failed. Check PAGES_URL, PAGES_TOKEN or local pairing credentials and Pages authorization.";

const ORIGINAL_ARGUMENTS = process.argv;
const ORIGINAL_EXIT_CODE = process.exitCode;

function startWith(...argumentsList: string[]): Promise<void> {
  process.argv = ["node", "pages-mcp.cjs", ...argumentsList];
  return start();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  process.exitCode = undefined;
});

afterEach(() => {
  process.argv = ORIGINAL_ARGUMENTS;
  process.exitCode = ORIGINAL_EXIT_CODE;
});

describe("start credential commands", () => {
  it.each(["pair", "rotate", "unpair", "status"])(
    "runs %s and exits with its code",
    async (command) => {
      vi.mocked(runCredentialCommand).mockResolvedValue(4);
      await startWith(command, "--url", "https://pages.example");
      expect(runCredentialCommand).toHaveBeenCalledWith(
        [command, "--url", "https://pages.example"],
        process.env,
      );
      expect(process.exitCode).toBe(4);
      expect(readStdioConfiguration).not.toHaveBeenCalled();
    },
  );

  it.each([["--stdio"], ["serve"], ["--url", "https://pages.example"]])(
    "rejects the unsupported arguments %j before any lookup",
    async (...argumentsList) => {
      await startWith(...argumentsList);
      expect(console.error).toHaveBeenCalledWith(
        "[pages-mcp] Unsupported startup argument. Pages MCP runs only over stdio: start without arguments, or use pair, status, rotate or unpair for credentials.",
      );
      expect(process.exitCode).toBe(1);
      expect(readStdioConfiguration).not.toHaveBeenCalled();
      expect(runCredentialCommand).not.toHaveBeenCalled();
    },
  );
});

describe("start stdio server", () => {
  it("initializes health checks without reading credentials or verifying Pages", async () => {
    await startWith("health-check");
    const factory = vi.mocked(serveStdio).mock.calls[0]?.[0];
    await factory?.({ era: "legacy" });
    const resolve = vi.mocked(createServer).mock.calls[0]?.[0];
    expect(resolve?.()).toEqual({
      agentsUrl: new URL("http://127.0.0.1:1/api/v1/agents"),
      token: "pages-tool-health-probe",
    });
    expect(readStdioConfiguration).not.toHaveBeenCalled();
    expect(verifyPages).not.toHaveBeenCalled();
    expect(runCredentialCommand).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("verifies Pages before serving stdio with the resolved configuration", async () => {
    const server = new McpServer({ name: "unit-test", version: "1.0.0" });
    vi.mocked(readStdioConfiguration).mockResolvedValue(CONFIGURATION);
    vi.mocked(verifyPages).mockResolvedValue({
      identity: { userId: "u1", isAdmin: false, permissions: [] },
      tools: [],
    });
    vi.mocked(createServer).mockReturnValue(server);
    vi.mocked(serveStdio).mockReturnValue({ close: async () => undefined });
    await startWith();
    expect(readStdioConfiguration).toHaveBeenCalledWith(process.env);
    expect(verifyPages).toHaveBeenCalledWith(CONFIGURATION);
    const factory = vi.mocked(serveStdio).mock.calls[0]?.[0];
    expect(factory?.({ era: "legacy" })).toBe(server);
    const resolve = vi.mocked(createServer).mock.calls[0]?.[0];
    expect(resolve?.()).toBe(CONFIGURATION);
    expect(process.exitCode).toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("reports local credential problems with their fixed message", async () => {
    vi.mocked(readStdioConfiguration).mockRejectedValue(
      new CredentialStoreError("No paired credential."),
    );
    await startWith();
    expect(console.error).toHaveBeenCalledWith(
      "[pages-mcp] No paired credential.",
    );
    expect(process.exitCode).toBe(1);
    expect(serveStdio).not.toHaveBeenCalled();
  });

  it("hides unexpected startup failures and preserves fixed transport diagnostics", async () => {
    vi.mocked(readStdioConfiguration).mockResolvedValue(CONFIGURATION);
    vi.mocked(verifyPages).mockRejectedValue(new Error("token abc rejected"));
    await startWith();
    expect(console.error).toHaveBeenCalledWith(STARTUP_FAILED);
    expect(process.exitCode).toBe(1);
    expect(serveStdio).not.toHaveBeenCalled();
    vi.mocked(verifyPages).mockRejectedValue(new PagesTransportError());
    await startWith();
    expect(console.error).toHaveBeenLastCalledWith(
      "[pages-mcp] Could not reach the Pages agent API. Check the connection before retrying; an interrupted write may already have applied.",
    );
    expect(process.exitCode).toBe(1);
    expect(serveStdio).not.toHaveBeenCalled();
  });

  it("reports a failing credential command as a startup failure", async () => {
    vi.mocked(runCredentialCommand).mockRejectedValue(new Error("crash"));
    await startWith("status");
    expect(console.error).toHaveBeenCalledWith(STARTUP_FAILED);
    expect(process.exitCode).toBe(1);
  });
});
