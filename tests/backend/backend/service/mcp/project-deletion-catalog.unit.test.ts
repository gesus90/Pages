import { describe, expect, it } from "vitest";

import {
  ownerOperations,
  readingOperations,
  sessionOperations,
} from "@/backend/service/mcp/AgentOperationCatalog";
import { isChatOperation } from "@/backend/service/chat/ChatToolCatalog";
import { PAGES_AGENT_WRITE_OPERATIONS } from "@/definition/PagesAgentWrites";

import type { AgentRunScope } from "@/definition/McpAuthorization";

const SCOPE_READ = "admin.projects.deletionScope";
const DELETE = "admin.projects.delete";

function session(
  reach: AgentRunScope["reach"],
  operations: string[] = [],
): AgentRunScope {
  return {
    reach,
    operations,
    runId: "run",
    stepId: "step",
    tickets: [],
  };
}

describe("who is offered the project deletion", () => {
  it("offers both operations to a personal administrator", () => {
    const offered = ownerOperations(true);
    expect(offered).toContain(SCOPE_READ);
    expect(offered).toContain(DELETE);
  });

  it("offers neither to anyone else, so tools/list does not show them", () => {
    const offered = ownerOperations(false);
    expect(offered).not.toContain(SCOPE_READ);
    expect(offered).not.toContain(DELETE);
  });

  it("counts the deletion among the writes and the extent among the reads", () => {
    expect(PAGES_AGENT_WRITE_OPERATIONS).toContain(DELETE);
    expect(readingOperations(true)).toContain(SCOPE_READ);
    expect(readingOperations(true)).not.toContain(DELETE);
    expect(readingOperations(false)).not.toContain(SCOPE_READ);
  });
});

describe("an agent plan run never receives the deletion", () => {
  it.each(["read", "full"] as const)(
    "withholds it from the %s reach even for an administrator",
    (reach) => {
      expect(sessionOperations(session(reach), true)).not.toContain(DELETE);
    },
  );

  it("withholds it from a ticket reach that names it", () => {
    expect(
      sessionOperations(session("tickets", [DELETE, "ticket.setStatus"]), true),
    ).toEqual(["ticket.setStatus"]);
  });

  it("still lets an administrator's run read the extent and use its other operations", () => {
    expect(sessionOperations(session("full"), true)).toContain(SCOPE_READ);
    expect(sessionOperations(session("read"), true)).toContain(SCOPE_READ);
    expect(sessionOperations(session("full"), true)).toContain(
      "admin.roles.assign",
    );
  });
});

describe("the chat agent", () => {
  it.each([SCOPE_READ, DELETE])("does not know %s", (operation) => {
    expect(isChatOperation(operation)).toBe(false);
  });

  it("keeps the administration operations it already had", () => {
    expect(isChatOperation("admin.users.list")).toBe(true);
    expect(isChatOperation("admin.groups.delete")).toBe(true);
  });
});
