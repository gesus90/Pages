import { beforeEach, expect, it, vi } from "vitest";

import { logAcpToolUpdate } from "@/backend/agents/acp/AcpSessionToolLogging";
import { logEvent } from "@/backend/logging/Logger";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

beforeEach(() => {
  vi.mocked(logEvent).mockClear();
});

it("ignores other updates", () => {
  logAcpToolUpdate(
    {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "x" },
    },
    "s",
  );
  expect(logEvent).not.toHaveBeenCalled();
});

it("logs a failed tool call as warning", () => {
  logAcpToolUpdate(
    { sessionUpdate: "tool_call_update", toolCallId: "t", status: "failed" },
    "s",
  );
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "warn",
      metadata: {
        sessionId: "s",
        toolId: "t",
        status: "failed",
        kind: "tool_call_update",
      },
    }),
  );
});

it("logs another tool call as debug", () => {
  logAcpToolUpdate(
    { sessionUpdate: "tool_call", toolCallId: "t", title: "T" },
    null,
  );
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: "debug" }),
  );
});
