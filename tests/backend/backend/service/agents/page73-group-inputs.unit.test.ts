import { expect, it, vi } from "vitest";

import { prepareGroupParameters } from "@/backend/service/agents/AgentPlanGroupParameters";
import { AgentPlanGroupSessions } from "@/backend/service/agents/AgentPlanGroupSessions";
import { AgentError } from "@/backend/error/AgentErrors";
import { acpRunOptions } from "@/definition/AgentConfiguration";

import { groupFixture, groupTurn } from "./page73-group-fixture";

import type {
  AgentPlanSessionInput,
  PlanExecution,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentParameterService } from "@/backend/service/agents/AgentParameterService";

it("resolves shared ticket content once at group entry and freezes it across later authorized turns", async () => {
  const fixture = await groupFixture();
  const parameter = {
    name: "shared",
    type: "ticket" as const,
    isRequired: true,
    description: "",
    defaultValue: null,
  };
  const group = {
    ...fixture.group,
    parameters: [{ ...parameter, id: "interface" }],
    bindings: {
      shared: {
        kind: "literal" as const,
        value: { type: "ticket" as const, ticketId: "ticket-id" },
      },
    },
  };
  const snapshot = {
    ...fixture.snapshot,
    groups: [group],
    steps: fixture.snapshot.steps.map((step) => ({
      ...step,
      template: {
        ...step.template,
        markdown: "Shared {{shared.description}}",
        parameters: [parameter],
      },
      prepared: {
        ...step.prepared,
        parameters: {
          ...step.prepared.parameters,
          values: {
            shared: { type: "ticket" as const, ticketId: "ticket-id" },
          },
        },
      },
    })),
  };
  const ticket = {
    id: "ticket-id",
    key: "SYN-73",
    title: "Shared",
    description: "at-group-entry",
    markdown: "at-group-entry",
    version: "2",
    assets: [],
  };
  const baseline = snapshot.steps[0]?.prepared;
  if (!baseline) throw new Error("Missing step");
  const prepare = vi.fn<AgentParameterService["prepare"]>(async () => ({
    ...baseline,
    tickets: { "ticket-id": ticket },
  }));
  const frozen = await prepareGroupParameters(
    { parameters: { prepare }, tasks: { snapshot: vi.fn() } },
    fixture.base.run,
    snapshot,
    group.id,
  );
  expect(prepare).toHaveBeenCalledOnce();
  expect(frozen.steps.map((step) => step.prepared.parameters.markdown)).toEqual(
    ["Shared at-group-entry", "Shared at-group-entry"],
  );
  ticket.description = "changed-after-first-step";
  // Resource resolvers may return mutable objects; the frozen snapshot must own its content.
  const second = frozen.steps[1];
  if (!second) throw new Error("Missing second step");
  const started = await fixture.base.start.prepare(
    fixture.base.run,
    frozen,
    second,
  );
  expect(started.input.prompt).toContain("at-group-entry");
  expect(started.input.prompt).not.toContain("changed-after-first-step");
  vi.spyOn(fixture.base.parameters, "prepare").mockRejectedValue(
    new AgentError("parameter_ticket_unavailable"),
  );
  await expect(
    fixture.base.start.prepare(fixture.base.run, frozen, second),
  ).rejects.toMatchObject({ code: "parameter_ticket_unavailable" });
});

async function sessionInput(): Promise<AgentPlanSessionInput> {
  const fixture = await groupFixture();
  const prepared = await fixture.base.start.prepare(
    fixture.base.run,
    fixture.snapshot,
    fixture.snapshot.steps[0] ?? fixture.base.step,
  );
  return {
    ...prepared.input,
    directory: "/synthetic",
    options: acpRunOptions("read_only", 0),
    instanceId: "instance",
    mcp: null,
  };
}

it("refuses missing continuation support at the first group turn and closes the session", async () => {
  const close = vi.fn(async () => ({
    exit: { code: 0, signal: null },
    endedAt: "now",
    leftovers: 0,
    isConfirmed: true,
  }));
  const execution: PlanExecution = {
    run: vi.fn(),
    open: vi.fn(async () => ({ turn: Promise.resolve(groupTurn()), close })),
  };
  const sessions = new AgentPlanGroupSessions(execution);
  await expect(
    sessions.turn({
      key: "run/group",
      input: await sessionInput(),
      signal: new AbortController().signal,
      observer: { started: vi.fn(), identified: vi.fn() },
    }),
  ).rejects.toMatchObject({ code: "plan_group_session_unsupported" });
  expect(close).toHaveBeenCalledOnce();
  expect(sessions.instanceId("run/group")).toBeUndefined();
});

it("refuses an API provider before opening a group session", async () => {
  const input = await sessionInput();
  const execution: PlanExecution = { run: vi.fn(), open: vi.fn() };
  const sessions = new AgentPlanGroupSessions(execution);
  await expect(
    sessions.turn({
      key: "run/group",
      input: {
        ...input,
        agent: {
          ...input.agent,
          connection: { ...input.agent.connection, provider: "openrouter" },
        },
      },
      signal: new AbortController().signal,
      observer: { started: vi.fn(), identified: vi.fn() },
    }),
  ).rejects.toBeInstanceOf(AgentError);
  expect(execution.open).not.toHaveBeenCalled();
});

it("opens a group session over ACP for a claude_code connection", async () => {
  const input = await sessionInput();
  const close = vi.fn(async () => ({
    exit: { code: 0, signal: null },
    endedAt: "now",
    leftovers: 0,
    isConfirmed: true,
  }));
  const execution: PlanExecution = {
    run: vi.fn(),
    open: vi.fn(async () => ({ turn: Promise.resolve(groupTurn()), close })),
  };
  const sessions = new AgentPlanGroupSessions(execution);
  await sessions
    .turn({
      key: "run/group",
      input: {
        ...input,
        agent: {
          ...input.agent,
          connection: { ...input.agent.connection, provider: "claude_code" },
        },
      },
      signal: new AbortController().signal,
      observer: { started: vi.fn(), identified: vi.fn() },
    })
    .catch(() => undefined);
  expect(execution.open).toHaveBeenCalledOnce();
});

it("delivers a workspace boundary only to connected children without blocking an unconnected child", async () => {
  const fixture = await groupFixture();
  const location = {
    name: "location",
    type: "workspace" as const,
    isRequired: true,
    description: "",
    defaultValue: null,
    id: "location-port",
  };
  const reference = {
    ...fixture.base.step.prepared.workspace,
    id: "location-workspace",
    path: "/shared-reference",
    directoryIdentity: "reference-identity",
  };
  const group = {
    ...fixture.group,
    parameters: [...fixture.group.parameters, location],
    bindings: {
      ...fixture.group.bindings,
      location: {
        kind: "literal" as const,
        value: { type: "workspace" as const, workspaceId: reference.id },
      },
    },
    steps: fixture.group.steps.map((step, index) =>
      index === 0
        ? {
            ...step,
            bindings: {
              ...step.bindings,
              location: { kind: "source" as const, nodeId: location.id },
            },
          }
        : step,
    ),
  };
  const steps = fixture.snapshot.steps.map((step, index) =>
    index === 0
      ? {
          ...step,
          template: {
            ...step.template,
            markdown: "Shared {{shared}} at {{location.path}}",
            parameters: [...step.template.parameters, location],
          },
          prepared: {
            ...step.prepared,
            references: [reference],
            parameters: {
              ...step.prepared.parameters,
              values: {
                ...step.prepared.parameters.values,
                location: {
                  type: "workspace" as const,
                  workspaceId: reference.id,
                },
              },
            },
          },
        }
      : step,
  );
  const first = steps[0];
  if (!first) throw new Error("Missing first step");
  const prepare = vi.fn<AgentParameterService["prepare"]>(
    async () => first.prepared,
  );
  const frozen = await prepareGroupParameters(
    { parameters: { prepare }, tasks: { snapshot: vi.fn() } },
    fixture.base.run,
    { ...fixture.snapshot, groups: [group], steps },
    group.id,
  );
  expect(prepare).toHaveBeenCalledOnce();
  expect(frozen.steps[0]?.prepared.parameters.markdown).toBe(
    "Shared shared-text at /shared-reference",
  );
  const second = frozen.steps[1];
  if (!second) throw new Error("Missing second step");
  const prepared = await fixture.base.start.prepare(
    fixture.base.run,
    frozen,
    second,
  );
  expect(prepared.input.prompt).toContain("Shared shared-text");
  expect(prepared.input.prompt).not.toContain("/shared-reference");
});
