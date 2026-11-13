import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import {
  acpRunOptions,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import { parameterRunFixture } from "./page55-run-fixture";

import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { ParameterRunFixture } from "./page55-run-fixture";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type {
  PlanExecution,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

/** An accepted report for a synthetic node without ticket dependencies. */
export const GROUP_REPORT =
  '```pages-report\n{"todos":[{"id":"T1","status":"done"}],"criteria":[{"id":"K1","met":true,"evidence":"synthetic observable result"}],"decisions":[],"summary":"done"}\n```';

export interface GroupFixture {
  readonly base: ParameterRunFixture;
  readonly source: AgentDefinitionChoice;
  readonly group: AgentPlanGroup;
  readonly plan: AgentPlan;
  readonly snapshot: AgentPlanSnapshot;
  readonly preparation: AgentPlanPreparation;
}

export interface GroupEngineFixture extends GroupFixture {
  readonly engine: AgentPlanRunEngine;
  readonly stored: Map<string, AgentPlanRun>;
  readonly runner: AgentPlanStepRunner;
}

/** Only the model boundary is synthetic; preparation, binding, scheduling and acceptance are real. */
export async function groupFixture(): Promise<GroupFixture> {
  const configuration = {
    ...emptyAgentConfiguration(),
    markdown: "Shared {{shared}}",
    parameters: [
      {
        name: "shared",
        type: "text" as const,
        description: "",
        isRequired: true,
        defaultValue: { type: "text" as const, text: "shared-text" },
      },
    ],
    run: acpRunOptions("read_only", 0),
  };
  const base = await parameterRunFixture(configuration, "codex_cli");
  const source: AgentDefinitionChoice = {
    id: "agent",
    name: "Test",
    model: base.step.model,
    reasoningEffort: null,
    provider: "codex_cli",
    purposes: ["agent"],
    configuration,
    revision: 1,
    availability: { isUsable: true, reason: null, personalChoices: [] },
  };
  const group: AgentPlanGroup = {
    id: "group",
    type: "group",
    name: "Two agents",
    x: 320,
    y: 0,
    steps: ["first", "second"].map((id) => ({
      ...base.step.step,
      id,
      instruction: `Instruction ${id}`,
      configuration: copyPlanConfiguration(source),
      bindings: { shared: { kind: "source", nodeId: "interface" } },
    })),
    parameters: [
      { ...configuration.parameters[0], defaultValue: null, id: "interface" },
    ],
    bindings: { shared: { kind: "source", nodeId: "external" } },
  };
  const plan: AgentPlan = {
    ...base.snapshot.plan,
    nodes: [
      { id: "start", type: "start", x: 0, y: 0 },
      group,
      { id: "end", type: "end", x: 640, y: 0 },
      {
        id: "external",
        type: "parameter",
        name: "shared",
        format: "string",
        value: { type: "text", text: "shared-text" },
        x: 0,
        y: 320,
      },
    ],
    edges: [
      { from: "start", to: "group", fromPort: "flow-out", toPort: "flow-in" },
      { from: "group", to: "end", fromPort: "flow-out", toPort: "flow-in" },
    ],
  };
  const prepared = await base.start.prepare(base.run, base.snapshot, base.step);
  const preparation = new AgentPlanPreparation({
    profiles: {
      catalog: async () => [source],
      resolveDefinition: async () => ({
        profile: {
          id: "agent",
          name: "Test",
          connectionId: "connection",
          model: source.model,
          reasoningEffort: null,
          isActive: true,
          purposes: ["agent"],
          targets: [],
          configuration,
        },
        assignment: prepared.input.agent,
        accessAgentId: "agent",
      }),
    },
    parameters: base.parameters,
    tasks: {
      snapshot: async () => {
        throw new Error("No ticket access in PAGE-73 fixture");
      },
    },
  });
  const snapshot = await preparation.prepare("owner", plan);
  return { base, source, group, plan, snapshot, preparation };
}

/** Builds a scheduler with an in-memory persistence boundary and no external MCP. */
export async function groupEngine(
  execution: PlanExecution,
  resources?: AcpResourceScheduler,
): Promise<GroupEngineFixture> {
  const fixture = await groupFixture();
  const stored = new Map<string, AgentPlanRun>();
  const runner = new AgentPlanStepRunner({
    start: fixture.base.start,
    execution,
    tasks: {
      checklist: async () => {
        throw new Error("No tickets");
      },
    },
    access: { grant: async () => null, revoke: async () => 0 },
  });
  const engine = new AgentPlanRunEngine({
    resources,
    runs: {
      create: async (run) => {
        stored.set(run.id, structuredClone(run));
      },
      insert: async () => {
        throw new Error("No transactions");
      },
      update: async (run) => {
        stored.set(run.id, structuredClone(run));
      },
      find: async (id) => stored.get(id) ?? null,
    },
    start: { control: async () => {} },
    steps: runner,
  });
  return { ...fixture, engine, stored, runner };
}

/** A single completed model turn; failures can be controlled without real credentials. */
export function groupTurn(
  changes: Partial<PlanSessionTurn> = {},
): PlanSessionTurn {
  return {
    output: GROUP_REPORT,
    sessionId: "native-synthetic",
    failure: null,
    errorCode: null,
    endedAt: "2026-10-15T00:00:00Z",
    permissionDenials: 0,
    effective: { model: "synthetic-free:free" },
    events: [],
    ...changes,
  };
}
