import { describe, expect, it } from "vitest";

import { AgentDeletionRequest } from "@/backend/service/mcp/agent/AgentDeletionRequest";

const id = "00000000-0000-4000-8000-000000000001";

describe("agent deletion request validation", () => {
  it("requires a preview and operation identifier", () => {
    expect(
      AgentDeletionRequest.delete({ previewId: id, operationId: id }),
    ).toEqual({ previewId: id, operationId: id });
    expect(() => AgentDeletionRequest.delete({ operationId: id })).toThrow();
    expect(() =>
      AgentDeletionRequest.delete({ previewId: "bad", operationId: id }),
    ).toThrow();
    expect(() => AgentDeletionRequest.delete(null)).toThrow();
  });

  it("validates restore and bounded pagination", () => {
    expect(AgentDeletionRequest.restore({ operationId: id })).toEqual({
      operationId: id,
    });
    expect(() =>
      AgentDeletionRequest.restore({ operationId: "bad" }),
    ).toThrow();
    expect(AgentDeletionRequest.list(new URLSearchParams())).toEqual({
      cursor: null,
      limit: 50,
    });
    expect(
      AgentDeletionRequest.list(new URLSearchParams("cursor=a&limit=10")),
    ).toEqual({ cursor: "a", limit: 10 });
    expect(() =>
      AgentDeletionRequest.list(new URLSearchParams("limit=101")),
    ).toThrow();
  });
});
