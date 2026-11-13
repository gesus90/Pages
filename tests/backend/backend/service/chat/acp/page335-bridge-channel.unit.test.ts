import { expect, it, vi } from "vitest";

import { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import { PicaBridge } from "@/backend/service/chat/acp/PicaBridge";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type {
  PicaBridgeOwner,
  PicaBridgeResponse,
} from "@/backend/service/chat/acp/PicaBridge";

const BRIDGE_URL = "http://127.0.0.1:4100/pica-bridge";
const CATALOG = [
  {
    id: "projects_list",
    description: "Lists projects.",
    access: "user",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

function owner(jobId: string): PicaBridgeOwner & {
  readonly onTool: ReturnType<typeof vi.fn<PicaBridgeOwner["onTool"]>>;
} {
  return {
    jobId,
    userId: "agent-1",
    sessionId: "chat-session",
    catalog: [...CATALOG],
    onTool: vi.fn<PicaBridgeOwner["onTool"]>(),
    onImages: async () => {
      throw new Error("no images");
    },
  };
}

function context(jobId: string): RuntimeExecutionContext {
  return Object.freeze({
    userId: "agent-1",
    sessionId: "chat-session",
    runId: jobId,
    signal: new AbortController().signal,
    authorize: async () => undefined,
  });
}

function mcp(
  bridge: PicaBridge,
  authorization: string,
  method: "tools/list" | "tools/call",
): Promise<PicaBridgeResponse> {
  return bridge.handle({
    method: "POST",
    authorization,
    readBody: async () =>
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params:
          method === "tools/call"
            ? { name: "missing_tool", arguments: {} }
            : {},
      }),
  });
}

it("keeps the MCP credential of a resting chat session and binds it to the next job", async () => {
  const bridge = new PicaBridge(BRIDGE_URL);
  const firstOwner = owner("job-1");
  const first = bridge.open(firstOwner);
  const channel = first.openMcpChannel();
  const { authorization } = channel.descriptor;
  expect(channel.descriptor.url).toBe(BRIDGE_URL);

  const listed = await mcp(bridge, authorization, "tools/list");
  expect(listed.status).toBe(200);
  expect(JSON.stringify(listed.body)).toContain("projects_list");
  expect(
    JSON.stringify((await mcp(bridge, authorization, "tools/call")).body),
  ).toContain("TURN_INACTIVE");

  first.close();
  // Between jobs the session still lists its tools, but calls nothing.
  expect((await mcp(bridge, authorization, "tools/list")).status).toBe(200);
  expect(
    JSON.stringify((await mcp(bridge, authorization, "tools/call")).body),
  ).toContain("TURN_INACTIVE");

  const secondOwner = owner("job-2");
  const second = bridge.open(secondOwner);
  second.attachMcpChannel(channel);
  second.setTurn({
    id: "message-1",
    answerTurn: 1,
    tools: new RuntimeToolRegistry(),
    context: context("job-2"),
  });
  const called = await mcp(bridge, authorization, "tools/call");
  expect(JSON.stringify(called.body)).toContain("UNKNOWN_TOOL");
  expect(secondOwner.onTool).toHaveBeenCalled();
  expect(firstOwner.onTool).not.toHaveBeenCalled();

  second.close();
  channel.close();
  expect((await mcp(bridge, authorization, "tools/list")).status).toBe(401);
  // A closed channel is never bound again.
  bridge.open(owner("job-3")).attachMcpChannel(channel);
  expect((await mcp(bridge, authorization, "tools/list")).status).toBe(401);
});
