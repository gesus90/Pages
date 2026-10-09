import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../mcp/node_modules/@modelcontextprotocol/server/dist/stdio.mjs",
  () => ({ serveStdio: vi.fn() }),
);
vi.mock("../../mcp/src/configuration", () => ({ readConfiguration: vi.fn() }));
vi.mock("../../mcp/src/server", () => ({ createServer: vi.fn() }));

import { serveStdio } from "../../mcp/node_modules/@modelcontextprotocol/server/dist/stdio.mjs";
import { readConfiguration } from "../../mcp/src/configuration";
import { createServer } from "../../mcp/src/server";
import { start } from "../../mcp/src/start";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = 0;
});
afterEach(() => {
  process.exitCode = 0;
});

describe("MCP startup", () => {
  it("validates configuration before opening stdio", () => {
    start();
    expect(readConfiguration).toHaveBeenCalledWith(process.env);
    expect(serveStdio).toHaveBeenCalledWith(createServer);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([new Error("PAGES_TOKEN is required."), "invalid"])(
    "fails clearly when configuration cannot be read",
    (failure) => {
      vi.mocked(readConfiguration).mockImplementation(() => {
        throw failure;
      });
      start();
      expect(process.exitCode).toBe(1);
      expect(serveStdio).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("[pages-mcp]"),
      );
    },
  );

  it("redacts an unexpected startup exception", () => {
    vi.mocked(serveStdio).mockImplementation(() => {
      throw new Error("sentinel-secret");
    });
    start();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      "[pages-mcp] Could not start the stdio server.",
    );
  });

  it("starts the entry point", async () => {
    await import("../../mcp/src/main");
    expect(serveStdio).toHaveBeenCalledWith(createServer);
  });
});
