import { describe, expect, it } from "vitest";

import { McpAgentProfileRequest } from "@/backend/service/mcp/agent/McpAgentProfileRequest";

describe("agent profile request validation", () => {
  it("reads normalized filters and bounded pagination", () => {
    expect(
      McpAgentProfileRequest.list(
        new URLSearchParams("groupId=%20team%20&cursor=12&limit=25"),
      ),
    ).toEqual({ groupId: "team", cursor: "12", limit: 25 });
    expect(McpAgentProfileRequest.list(new URLSearchParams())).toEqual({});
    expect(McpAgentProfileRequest.identifier("  agent  ", "id")).toBe("agent");
  });

  it("rejects duplicate, unknown and invalid query fields", () => {
    for (const query of [
      "limit=1&limit=2",
      "unknown=x",
      "limit=0",
      "limit=101",
      "limit=1.5",
      "cursor=-1",
      "projectId=%20",
    ]) {
      expect(() =>
        McpAgentProfileRequest.list(new URLSearchParams(query)),
      ).toThrow();
    }
    expect(() => McpAgentProfileRequest.identifier(undefined, "id")).toThrow();
    expect(() =>
      McpAgentProfileRequest.identifier("x".repeat(101), "id"),
    ).toThrow();
  });
});
