import { describe, expect, it, vi } from "vitest";

import { createServer } from "../../mcp/src/server";

describe("MCP protocol foundation", () => {
  it("advertises its version and an explicitly empty tool list", async () => {
    const server = createServer();
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
    await server.close();
  });
});
