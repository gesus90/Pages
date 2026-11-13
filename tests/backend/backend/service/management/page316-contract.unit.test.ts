import { describe, expect, it } from "vitest";

import {
  managementCreateSchema,
  managementUpdateSchema,
  managementListSchema,
  managementAvatarSchema,
  parseManagement,
} from "@/backend/service/management/ManagementRequest";
import {
  managementRevision,
  requireManagementRevision,
} from "@/backend/service/management/ManagementRevision";
import { sanitizeManagementSvg } from "@/backend/service/management/ManagementAvatar";
import {
  MANAGEMENT_READ_OPERATIONS,
  MANAGEMENT_WRITE_OPERATIONS,
} from "@/definition/Management";
import { TOOL_ENTRIES } from "@/definition/AgentTools/ToolCatalog";
import {
  ownerOperations,
  sessionOperations,
} from "@/backend/service/mcp/AgentOperationCatalog";

const human = {
  kind: "human",
  displayName: "Person",
  username: "person",
  email: "person@example.test",
  role: "employee",
  departmentIds: [],
  groupIds: [],
};

describe("PAGE-316 contract", () => {
  it("requires human email and agent configuration, never credentials", () => {
    expect(parseManagement(managementCreateSchema, human)).toEqual(human);
    expect(() =>
      parseManagement(managementCreateSchema, { ...human, email: null }),
    ).toThrow();
    expect(() =>
      parseManagement(managementCreateSchema, { ...human, kind: "agent" }),
    ).toThrow();
    expect(
      parseManagement(managementCreateSchema, {
        ...human,
        kind: "agent",
        agent: {
          agentMd: "Do work",
          soulMd: "Be kind",
          connectionId: "released",
          model: "model",
          reasoningEffort: null,
        },
      }).agent?.model,
    ).toBe("model");
    expect(() =>
      parseManagement(managementCreateSchema, { ...human, password: "secret" }),
    ).toThrow(
      expect.objectContaining({
        code: "FORBIDDEN",
        details: { reason: "core_system" },
      }),
    );
    expect(() =>
      parseManagement(managementUpdateSchema, {
        expectedRevision: "r",
        access: "yolo",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "FORBIDDEN",
        details: { reason: "access_level" },
      }),
    );
  });
  it("requires revisions for patches and avatars and bounds paging to 1..100 with default 20", () => {
    expect(() =>
      parseManagement(managementUpdateSchema, { displayName: "Changed" }),
    ).toThrow();
    expect(() =>
      parseManagement(managementAvatarSchema, {
        contentType: "image/png",
        dataBase64: "aA==",
      }),
    ).toThrow();
    expect(parseManagement(managementListSchema, {}).limit).toBe(20);
    expect(() => parseManagement(managementListSchema, { limit: 0 })).toThrow();
    expect(() =>
      parseManagement(managementListSchema, { limit: 101 }),
    ).toThrow();
  });
  it("detects concurrent edits and reports the actual revision", () => {
    const revision = managementRevision({ name: "before", memberships: ["a"] });
    const current = managementRevision({ name: "before", memberships: ["b"] });
    expect(() => requireManagementRevision(current, revision)).toThrow(
      expect.objectContaining({
        code: "CONFLICT",
        details: { currentRevision: current },
      }),
    );
  });
  it("drops executable SVG, handlers, styles, external references and entities", () => {
    const svg = sanitizeManagementSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" onload="alert(1)"><script>alert(1)</script><image href="https://example.test/tracker"/><foreignObject><iframe/></foreignObject><rect width="32" height="32" fill="red" style="fill:url(https://example.test)"/></svg>',
    );
    expect(svg).toContain("<rect");
    expect(svg).not.toMatch(
      /script|onload|href|example|foreignObject|iframe|style/iu,
    );
    expect(() =>
      sanitizeManagementSvg(
        '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg/>',
      ),
    ).toThrow();
  });
  it("registers every named tool in the same pages-pica catalog", () => {
    for (const operation of [
      ...MANAGEMENT_READ_OPERATIONS,
      ...MANAGEMENT_WRITE_OPERATIONS,
    ]) {
      expect(
        TOOL_ENTRIES.find((entry) => entry.operation === operation)?.tool.name,
      ).toBe(operation);
      expect(ownerOperations(false)).toContain(operation);
    }
    const full = sessionOperations(
      {
        reach: "full",
        runId: "run",
        stepId: "step",
        operations: [],
        tickets: [],
      },
      false,
      true,
    );
    expect(full).toContain("users_create");
    expect(full).toContain("plans.run.logs.read");
    expect(full).not.toContain("admin.projects.delete");
    const read = sessionOperations(
      {
        reach: "read",
        runId: "run",
        stepId: "step",
        operations: [],
        tickets: [],
      },
      false,
      true,
    );
    expect(read).toContain("users_list");
    expect(read).not.toContain("users_update");
  });
});

it("does not grant YOLO through plan edits or execute nested scripts", async () => {
  const { requireManagementPlanAccess, requireManagementScriptExecution } =
    await import("@/backend/service/management/ManagementPlanAccess");
  expect(() =>
    requireManagementPlanAccess(
      true,
      { nodes: [{ id: "node", configuration: { run: { access: "yolo" } } }] },
      { nodes: [] },
    ),
  ).toThrow(
    expect.objectContaining({
      code: "FORBIDDEN",
      details: { reason: "access_level" },
    }),
  );
  expect(() =>
    requireManagementPlanAccess(
      true,
      {
        nodes: [
          {
            id: "node",
            configuration: { run: { access: "yolo" } },
            name: "New name",
          },
        ],
      },
      { nodes: [{ id: "node", configuration: { run: { access: "yolo" } } }] },
    ),
  ).not.toThrow();
  expect(() =>
    requireManagementScriptExecution(true, {
      nodes: [
        { type: "loop", members: [{ type: "script", content: "echo no" }] },
      ],
    }),
  ).toThrow(
    expect.objectContaining({
      code: "FORBIDDEN",
      details: { reason: "core_system" },
    }),
  );
  expect(() =>
    requireManagementScriptExecution(false, { nodes: [{ type: "script" }] }),
  ).not.toThrow();
});

it("admits the 5 MiB avatar contract through the pages-pica transport while keeping old operation budgets", async () => {
  const { agentEnvelopeLimit, PAGES_AGENT_LIMITS } =
    await import("@/definition/PagesAgentOperations");
  const { readAgentJson } = await import("@/app/lib/agent-json.server");
  const parameters = {
    userId: "agent",
    expectedRevision: "revision",
    contentType: "image/png",
    dataBase64: "A".repeat(Math.ceil((5 * 1024 * 1024) / 3) * 4),
  };
  const envelope = { operation: "users_set_avatar", parameters };
  expect(agentEnvelopeLimit(envelope.operation)).toBeGreaterThan(
    JSON.stringify(envelope).length,
  );
  const read = await readAgentJson(
    new Request("http://pages.invalid/internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    }),
  );
  expect(read.operation).toBe("users_set_avatar");
  expect(agentEnvelopeLimit("ticket.setTitle")).toBe(
    PAGES_AGENT_LIMITS.requestBytes,
  );
});

it("carries isolated audit actors across asynchronous work without leaking one call into another", async () => {
  const { managementAuditActor, withManagementAudit } =
    await import("@/backend/database/ManagementAuditContext");
  expect(managementAuditActor()).toBeUndefined();
  const actors = await Promise.all([
    withManagementAudit("first", async () => {
      await Promise.resolve();
      return managementAuditActor();
    }),
    withManagementAudit("second", async () => {
      await Promise.resolve();
      return managementAuditActor();
    }),
  ]);
  expect(actors).toEqual(["first", "second"]);
  expect(managementAuditActor()).toBeUndefined();
});
