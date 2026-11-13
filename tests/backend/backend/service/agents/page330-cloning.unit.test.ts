import { beforeEach, expect, it, vi } from "vitest";

import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { planConfigurationForModel } from "@/definition/AgentPlanConfiguration";
import { AgentError } from "@/backend/error/AgentErrors";
import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { planPendingSelections } from "@/definition/AgentPlanSelection";

import { CloneWorld } from "./agent-plan-cloning-fixture";

import type { PageAgentModel } from "@/definition/PageAgent";

const { revision, audit } = vi.hoisted(() => ({
  revision: vi.fn(async () => undefined),
  audit: vi.fn(async () => undefined),
}));
vi.mock("@/backend/database/repositories/agent/AgentPlanRepository", () => ({
  requirePlanRevision: revision,
}));
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanAuditRepository",
  () => ({
    AgentPlanAuditRepository: class {
      public append = audit;
    },
  }),
);
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

it("copies the latest visible source using an own workspace and marks a foreign agent for selection", async () => {
  const world = new CloneWorld();
  const id = await world.clone();
  const copy = world.saved[0];
  expect(copy).toMatchObject({
    id,
    name: "Kopie von Original",
    workspaceId: "own",
    ownerId: "copier",
    usage: "private",
    sharing: { isGlobal: false, targets: [], operator: "or" },
  });
  expect(copy?.nodes[0]).toMatchObject({
    agentId: "",
    selectionRequired: "agent",
    instruction: "Keep instructions",
  });
  expect(world.receipts[0]).toMatchObject({
    sourceRevision: 7,
    workspaceId: "own",
    adjustments: [
      { code: "source_revision_updated" },
      { code: "workspace_replaced" },
      { code: "reference_cleared", nodeId: copy?.nodes[0]?.id },
    ],
  });
  if (!copy) throw new Error("missing copy");
  expect(planPendingSelections(readPlanInput(copy))).toHaveLength(1);
  expect(readPlanInput(copy).nodes).toEqual(copy.nodes);
  expect(planExecutionIssues(copy, [])).toContainEqual({
    nodeId: copy.nodes[0]?.id,
    port: null,
    reason: "profileMissing",
  });
  expect(world.source.nodes[0]).toMatchObject({ agentId: "private" });
});

it("cleans legacy ticket flow and git_closeout without refusing the source", async () => {
  const world = new CloneWorld();
  world.source = {
    ...world.source,
    nodes: [
      ...world.source.nodes,
      { id: "task", type: "task", taskId: "private-ticket", x: 1, y: 1 },
      {
        id: "close",
        type: "git_closeout",
        x: 0,
        y: 0,
        name: "old",
        role: "closeout",
        checkCommand: "verify",
        timeoutSeconds: 60,
        bindings: {},
      },
    ],
    edges: [
      { from: "task", to: "agent", fromPort: "flow-out", toPort: "flow-in" },
    ],
  };
  await world.clone();
  expect(world.saved[0]?.nodes.map((node) => node.type)).toEqual([
    "agent",
    "task",
  ]);
  expect(world.saved[0]?.edges).toEqual([]);
  expect(world.saved[0]?.nodes[1]).toMatchObject({ taskId: "" });
  expect(world.receipts[0]?.adjustments).toContainEqual({
    code: "legacy_form_cleaned",
  });
});

it("clears unreadable ticket, wiki and workspace parameters", async () => {
  const world = new CloneWorld();
  world.source = {
    ...world.source,
    nodes: [
      {
        id: "ticket",
        type: "parameter",
        name: "ticket",
        format: "string",
        value: { type: "ticket", ticketId: "hidden" },
        x: 0,
        y: 0,
      },
      {
        id: "wiki",
        type: "parameter",
        name: "wiki",
        format: "string",
        value: { type: "wiki", pageId: "hidden" },
        x: 0,
        y: 0,
      },
      {
        id: "ws",
        type: "parameter",
        name: "workspace",
        format: "string",
        value: { type: "workspace", workspaceId: "foreign" },
        x: 0,
        y: 0,
      },
    ],
  };
  await world.clone();
  expect(world.saved[0]?.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ value: { type: "text", text: "" } }),
    ]),
  );
  expect(
    world.receipts[0]?.adjustments.filter(
      (entry) => entry.code === "reference_cleared",
    ),
  ).toHaveLength(3);
});

it("suffixes a taken name and retries a concurrent source change", async () => {
  const world = new CloneWorld();
  world.save
    .mockRejectedValueOnce(new AgentError("plan_conflict"))
    .mockRejectedValueOnce(new AgentError("plan_name_taken"));
  await world.clone({ name: "Copy", expectedRevision: 7 });
  expect(world.saved[0]?.name).toBe("Copy 2");
  expect(world.require).toHaveBeenCalledWith("copier", "source");
  expect(world.receipts[0]?.adjustments).toContainEqual({
    code: "name_suffixed",
  });
});

it("keeps create defaults when teams are omitted, and validates and audits explicit teams", async () => {
  const defaults = new CloneWorld();
  await defaults.clone();
  expect(defaults.saved[0]?.teams).toEqual([
    {
      kind: "department",
      targetId: "development",
      canRead: true,
      canEdit: true,
      canRun: true,
    },
  ]);
  const world = new CloneWorld();
  const teams = [
    {
      kind: "user" as const,
      targetId: "Mei",
      canRead: true,
      canEdit: false,
      canRun: false,
    },
  ];
  await world.clone({ name: "Copy", expectedRevision: 7, teams });
  expect(world.validateTeams).toHaveBeenCalledWith(teams, "project");
  expect(world.saved[0]?.teams).toEqual(teams);
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({ action: "teams_changed", details: { teams } }),
  );
});

it.each(["canEdit", "canRun"])(
  "rejects user %s before a copy is saved",
  async (right) => {
    const world = new CloneWorld();
    world.validateTeams.mockRejectedValueOnce(
      new AgentError("plan_user_team_read_only"),
    );
    await expect(
      world.clone({
        name: "Copy",
        expectedRevision: 7,
        teams: [
          {
            kind: "user",
            targetId: "Mei",
            canRead: true,
            canEdit: right === "canEdit",
            canRun: right === "canRun",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "plan_user_team_read_only" });
    expect(world.saved).toEqual([]);
  },
);

it("rejects a non-admin owner override with forbidden", async () => {
  const world = new CloneWorld();
  await expect(
    world.clone({ name: "Copy", expectedRevision: 7, ownerId: "other" }),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(world.saved).toEqual([]);
});

it("reports a missing workspace, hidden source and credentials with their safe reason", async () => {
  const unavailable = new CloneWorld();
  unavailable.choices.mockResolvedValue([]);
  await expect(unavailable.clone()).rejects.toMatchObject({
    code: "workspace_unavailable",
  });
  const hidden = new CloneWorld();
  hidden.require.mockRejectedValueOnce(new AgentError("plan_access_denied"));
  await expect(hidden.clone()).rejects.toMatchObject({
    code: "source_not_visible",
  });
  const secrets = new CloneWorld();
  secrets.source = {
    ...secrets.source,
    globals: { note: "Bearer abcdefghijklmnop" },
  };
  await expect(secrets.clone()).rejects.toMatchObject({
    code: "credentials_in_text",
  });
  expect(console.warn).toHaveBeenCalledWith("Plan clone refused", {
    planId: "source",
    code: "credentials_in_text",
  });
  expect(secrets.saved).toEqual([]);
});

it("clears a foreign model and connection while preserving its template and lets an authorized model survive", async () => {
  const model: PageAgentModel = {
    id: '["connection","model"]',
    connectionId: "connection",
    name: "Model",
    model: "model",
    provider: "codex_cli",
    reasoning: "none",
    reasoningEfforts: [],
    catalogDefaultReasoningEffort: null,
    reasoningEffort: null,
  };
  const configuration = planConfigurationForModel(model);
  const denied = new CloneWorld();
  denied.source = {
    ...denied.source,
    nodes: [
      {
        id: "node",
        type: "agent",
        x: 0,
        y: 0,
        agentId: "node",
        personalAgentId: null,
        instruction: "Keep",
        bindings: {},
        configuration,
      },
    ],
  };
  await denied.clone();
  expect(denied.saved[0]?.nodes[0]).toMatchObject({
    selectionRequired: "model",
    configuration: {
      model: "",
      modelProfileId: "",
      template: configuration.template,
    },
  });
  const node = denied.saved[0]?.nodes[0];
  expect(node?.type === "agent" && node.configuration).not.toHaveProperty(
    "connectionId",
  );
  const allowed = new CloneWorld();
  allowed.source = denied.source;
  allowed.planModels.mockResolvedValue([model]);
  await allowed.clone();
  expect(allowed.saved[0]?.nodes[0]).toMatchObject({ configuration });
  expect(
    allowed.receipts[0]?.adjustments.some(
      (entry) => entry.code === "reference_cleared",
    ),
  ).toBe(false);
});

it("cleans unknown legacy fields and exposes malformed structure as its own error", async () => {
  const world = new CloneWorld();
  world.cloneSource.mockResolvedValueOnce({
    ...world.source,
    obsolete: { retainedByEarlierVersion: true },
  });
  await world.clone();
  expect(world.saved[0]).not.toHaveProperty("obsolete");
  expect(world.receipts[0]?.adjustments).toContainEqual({
    code: "legacy_form_cleaned",
  });
  const invalid = new CloneWorld();
  invalid.cloneSource.mockResolvedValueOnce({ nodes: "invalid" });
  await expect(invalid.clone()).rejects.toMatchObject({
    code: "plan_schema_unsupported",
  });
});

it("allows an active administrator to choose the copy's owner", async () => {
  const world = new CloneWorld();
  world.source = {
    ...world.source,
    rights: {
      canRead: true,
      canEdit: true,
      canRun: true,
      canManageTeams: true,
      canChangeOwner: true,
      canDelete: true,
      isAdministrator: true,
      isAdminAccess: true,
    },
  };
  await world.clone({
    name: "Copy",
    expectedRevision: 7,
    ownerId: "new-owner",
    teams: [],
  });
  expect(world.saved[0]).toMatchObject({ ownerId: "new-owner", teams: [] });
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "owner_changed",
      details: { from: "copier", to: "new-owner" },
    }),
  );
});

it("retains authorized external parameters rather than clearing all references", async () => {
  const world = new CloneWorld();
  world.requireTicket.mockResolvedValue(undefined);
  world.source = {
    ...world.source,
    nodes: [
      {
        id: "ticket",
        type: "parameter",
        name: "ticket",
        format: "string",
        x: 0,
        y: 0,
        value: { type: "ticket", ticketId: "readable" },
      },
    ],
  };
  await world.clone();
  expect(world.saved[0]?.nodes[0]).toMatchObject({
    value: { type: "ticket", ticketId: "readable" },
  });
  expect(
    world.receipts[0]?.adjustments.some(
      (entry) => entry.code === "reference_cleared",
    ),
  ).toBe(false);
});
