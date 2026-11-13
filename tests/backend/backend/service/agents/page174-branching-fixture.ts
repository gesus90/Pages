import { vi } from "vitest";

import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import {
  acpRunOptions,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import { RecoveryDatabase } from "./page84-recovery-database";
import { parameterRunFixture } from "./page55-run-fixture";

import type {
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type {
  AgentPlan,
  AgentPlanEdge,
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";

/** A closing report for the default todo and criterion of a synthetic node. */
export function branchReport(isMet: boolean): string {
  const met = isMet ? "true" : "false";
  return `Reviewed.\n\`\`\`pages-report\n{"todos":[{"id":"T1","status":"done"}],"criteria":[{"id":"K1","met":${met},"evidence":"synthetic observable result"}],"decisions":[],"summary":"reviewed"}\n\`\`\``;
}

/** A closing report and nothing else: no usable news for another node. */
export function reportOnly(isMet: boolean): string {
  return branchReport(isMet).replace(/^Reviewed\.\n/u, "");
}

/** One call a synthetic runner received. */
export interface BranchCall {
  readonly kind: "open" | "next";
  readonly stepId: string;
  readonly prompt: string;
}

/** What a synthetic model answers per node, in the order the node is asked. */
export type BranchScripts = Readonly<Record<string, string[]>>;

/** Observes and scripts the model boundary: the only synthetic part of a run. */
export interface BranchRuntime {
  readonly execution: PlanExecution;
  readonly calls: BranchCall[];
  /** Ends the open session of a node the way a crashed adapter would. */
  readonly retire: (stepId: string) => void;
  /** Lets the turn of a held node finish; the node answers only after this call. */
  readonly release: (stepId: string) => void;
  readonly closed: string[];
}

function turn(output: string, stepId: string): PlanSessionTurn {
  return {
    output,
    sessionId: `native-${stepId}`,
    failure: null,
    errorCode: null,
    endedAt: "2026-10-15T00:00:00Z",
    permissionDenials: 0,
    effective: { model: "synthetic-free:free" },
    events: [],
  };
}

/** A scripted ACP boundary: sessions answer from the scripts and continue with `next`. */
export function branchRuntime(
  scripts: BranchScripts,
  held: readonly string[] = [],
): BranchRuntime {
  const queues = new Map(
    Object.entries(scripts).map(([id, answers]) => [id, [...answers]]),
  );
  const calls: BranchCall[] = [];
  const closed: string[] = [];
  const observers = new Map<string, PlanSessionObserver>();
  const gates = new Map<string, () => void>();
  const holds = new Map(
    held.map((id) => [
      id,
      new Promise<void>((resolve) => {
        gates.set(id, resolve);
      }),
    ]),
  );
  function answer(stepId: string): PlanSessionTurn {
    const output = queues.get(stepId)?.shift();
    if (output === undefined)
      throw new Error(`No scripted answer for ${stepId}`);
    return turn(output, stepId);
  }
  const execution: PlanExecution = {
    run: async () => {
      throw new Error("No API requests");
    },
    open: vi.fn<PlanExecution["open"]>(async (input, signal, observer) => {
      signal.throwIfAborted();
      const stepId = input.resourceContext?.stepId ?? "";
      calls.push({ kind: "open", stepId, prompt: input.prompt });
      observers.set(stepId, observer);
      observer.identified(`native-${stepId}`);
      const session: PlanSession = {
        turn: (holds.get(stepId) ?? Promise.resolve()).then(() =>
          answer(stepId),
        ),
        next: async (next) => {
          calls.push({ kind: "next", stepId, prompt: next.prompt });
          return answer(stepId);
        },
        close: async () => {
          closed.push(stepId);
          return {
            exit: { code: 0, signal: null },
            endedAt: "2026-10-15T00:00:00Z",
            leftovers: 0,
            isConfirmed: true,
          };
        },
      };
      return session;
    }),
  };
  return {
    execution,
    calls,
    closed,
    release: (stepId) => gates.get(stepId)?.(),
    retire: (stepId) => {
      observers.get(stepId)?.retired?.(
        {
          exit: { code: 0, signal: null },
          endedAt: "2026-10-15T00:00:00Z",
          leftovers: 0,
          isConfirmed: true,
        },
        "process_exit",
      );
    },
  };
}

export interface BranchEngine {
  readonly engine: AgentPlanRunEngine;
  readonly snapshot: AgentPlanSnapshot;
  /** The stored view of a run, as the real run repository persisted it. */
  readonly read: (id: string) => AgentPlanRun;
  readonly database: RecoveryDatabase;
  readonly plan: AgentPlan;
}

/** The ports of the example plan: Start → check; check.bool → decision; true → end; false → fix → check.event. */
export function branchEdges(): readonly AgentPlanEdge[] {
  return [
    { from: "start", to: "check", fromPort: "flow-out", toPort: "flow-in" },
    {
      from: "check",
      to: "decision",
      fromPort: "passed-out",
      toPort: "condition-in",
    },
    { from: "decision", to: "end", fromPort: "true-out", toPort: "flow-in" },
    { from: "decision", to: "fix", fromPort: "false-out", toPort: "flow-in" },
    { from: "fix", to: "check", fromPort: "value-out", toPort: "event-in" },
  ];
}

/** The agent every node of the example plan is made of: a main instruction with one input that has a default. */
function branchConfiguration(): AgentConfiguration {
  return {
    ...emptyAgentConfiguration(),
    markdown: "Main instruction (AGENT.md) with {{shared}}",
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
}

/** Builds a real, validated snapshot of a plan and a real scheduler around a scripted model. */
export async function branchEngine(
  execution: PlanExecution,
  shape: {
    readonly edges?: readonly AgentPlanEdge[];
    readonly nodes?: (
      agent: (id: string, x: number) => AgentPlanStep,
    ) => readonly AgentPlanNode[];
    /** Runs before each preparation of a node, so a later attempt can be refused before its record. */
    readonly beforePrepare?: () => void | Promise<void>;
  } = {},
): Promise<BranchEngine> {
  const configuration = branchConfiguration();
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
  const agent = (id: string, x: number): AgentPlanStep => ({
    ...base.step.step,
    id,
    x,
    instruction: `Instruction ${id}\n- [ ] Carry out the work`,
    configuration: copyPlanConfiguration(source),
    bindings: {},
  });
  const nodes: readonly AgentPlanNode[] = shape.nodes?.(agent) ?? [
    { id: "start", type: "start", x: 0, y: 0 },
    agent("check", 300),
    { id: "decision", type: "decision", x: 600, y: 0 },
    agent("fix", 900),
    { id: "end", type: "end", x: 1200, y: 0 },
  ];
  const plan: AgentPlan = {
    ...base.snapshot.plan,
    nodes,
    edges: shape.edges ?? branchEdges(),
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
        throw new Error("No ticket access in the branching fixture");
      },
    },
  });
  const snapshot = await preparation.prepare("owner", plan);
  // The real repositories, with their rules for completed work and checkpoints, over an in-memory store.
  const database = new RecoveryDatabase(snapshot);
  const runner = new AgentPlanStepRunner({
    start: {
      ...base.start,
      prepare: async (...input) => {
        await shape.beforePrepare?.();
        return base.start.prepare(...input);
      },
    },
    execution,
    tasks: {
      checklist: async () => {
        throw new Error("No tickets");
      },
    },
    access: { grant: async () => null, revoke: async () => 0 },
  });
  const engine = new AgentPlanRunEngine({
    runs: new AgentPlanRunRepository(database.asDatabase()),
    start: { control: async () => {} },
    steps: runner,
  });
  return { engine, snapshot, read: (id) => database.run(id), database, plan };
}
