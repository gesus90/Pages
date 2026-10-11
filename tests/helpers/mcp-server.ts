import { expect, vi } from "vitest";

import { createServer } from "../../mcp/src/server";

import type { PagesConfiguration } from "../../mcp/src/configuration";

/** An initialized test transport using real MCP request handlers. */
export interface McpTestConnection {
  readonly server: ReturnType<typeof createServer>;
  readonly messages: Record<string, unknown>[];
  request(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined>;
}

/** Initializes a server and waits for each JSON-RPC reply on an in-process transport. */
export async function connectMcpServer(
  resolve: () => PagesConfiguration,
): Promise<McpTestConnection> {
  const server = createServer(resolve);
  const messages: Record<string, unknown>[] = [];
  const transport: Parameters<typeof server.connect>[0] = {
    start: async () => {},
    send: async (message) => {
      messages.push(message as Record<string, unknown>);
    },
    close: async () => {},
  };
  await server.connect(transport);
  let nextId = 0;
  transport.onmessage?.({
    jsonrpc: "2.0",
    id: nextId,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  });
  transport.onmessage?.({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  return {
    server,
    messages,
    async request(method: string, params: Record<string, unknown> = {}) {
      const id = ++nextId;
      transport.onmessage?.({ jsonrpc: "2.0", id, method, params });
      await vi.waitFor(() =>
        expect(messages.some((message) => message.id === id)).toBe(true),
      );
      return messages.find((message) => message.id === id);
    },
  };
}
