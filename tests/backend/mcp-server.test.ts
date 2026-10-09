import { describe, expect, it, vi } from "vitest";

import { createServer } from "../../mcp/src/server";

describe("MCP protocol foundation", () => {
  it("advertises its version and an explicitly empty tool list", async () => {
    const verify = vi
      .fn()
      .mockResolvedValue({ userId: "test", isAdmin: false, permissions: [] });
    const server = createServer(verify);
    const messages: unknown[] = [];
    const transport: Parameters<typeof server.connect>[0] = {
      start: async () => {},
      send: async (message) => {
        messages.push(message);
      },
      close: async () => {},
    };
    await server.connect(transport);
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    await vi.waitFor(() =>
      expect(messages).toContainEqual(
        expect.objectContaining({
          id: 1,
          result: expect.objectContaining({
            serverInfo: { name: "pages-mcp", version: "0.1.0" },
            capabilities: { tools: { listChanged: true } },
          }),
        }),
      ),
    );
    transport.onmessage?.({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    await vi.waitFor(() =>
      expect(messages).toContainEqual({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [] },
      }),
    );
    verify.mockRejectedValue(new Error("sentinel-secret"));
    for (const [id, method] of [
      [3, "tools/list"],
      [4, "tools/call"],
    ] as const) {
      transport.onmessage?.({
        jsonrpc: "2.0",
        id,
        method,
        params: { name: "missing" },
      });
      await vi.waitFor(() =>
        expect(messages).toContainEqual(
          expect.objectContaining({
            id,
            error: expect.objectContaining({
              message: "Pages authorization failed.",
            }),
          }),
        ),
      );
    }
    verify.mockResolvedValue({
      userId: "test",
      isAdmin: false,
      permissions: [],
    });
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "missing" },
    });
    await vi.waitFor(() =>
      expect(messages).toContainEqual(
        expect.objectContaining({
          id: 5,
          error: expect.objectContaining({
            message: "No tool is available in this version.",
          }),
        }),
      ),
    );
    expect(JSON.stringify(messages)).not.toContain("sentinel-secret");
    await server.close();
  });
});
