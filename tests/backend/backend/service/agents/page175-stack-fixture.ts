import { vi } from "vitest";

import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import { materializeTicketChecklist } from "@/backend/service/task/TicketChecklist";
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
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanScriptRunner } from "@/backend/service/agents/AgentPlanScriptRunner";
import type { AgentPlanScriptSnapshot } from "@/backend/service/agents/AgentPlanScriptPreparation";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { AgentTicketParameterText } from "@/backend/service/agents/AgentTicketParameterService";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type {
  AgentPlan,
  AgentPlanEdge,
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/** Three synthetic tickets with a real description, one task and one criterion each. */
export const STACK_TICKETS = [
  {
    id: "ticket-1",
    key: "SYN-1",
    title: "Anmeldung verbessern",
    description:
      "Das Login-Formular zeigt Fehler zu spät an.\n\n- [ ] Fehlermeldung direkt am Feld anzeigen",
  },
  {
    id: "ticket-2",
    key: "SYN-2",
    title: "Navigation vereinheitlichen",
    description:
      "Die Seitenleiste nutzt zwei Symbolsätze.\n\n- [ ] Einheitliche Symbole verwenden",
  },
  {
    id: "ticket-3",
    key: "SYN-3",
    title: "Speicherübersicht ergänzen",
    description:
      "Die Einstellungen zeigen keinen Speicherverbrauch.\n\n- [ ] Speicherverbrauch anzeigen",
  },
] as const;

function ticketOf(id: string): (typeof STACK_TICKETS)[number] {
  const ticket = STACK_TICKETS.find((entry) => entry.id === id);
  if (!ticket) throw new Error(`Unknown synthetic ticket ${id}`);
  return ticket;
}

/** The ticket text an agent receives, as the real ticket parameter service builds it. */
function ticketText(id: string): AgentTicketParameterText {
  const ticket = ticketOf(id);
  return {
    id: ticket.id,
    key: ticket.key,
    title: ticket.title,
    description: ticket.description,
    assets: [],
    markdown: `# ${ticket.key}: ${ticket.title}\n\n${ticket.description}\n\n## Acceptance criteria\n\n- [ ] Kriterium ${ticket.key} erfüllt`,
    version: "1",
  };
}

/** Ticket reads with the executor's rights, over the synthetic tickets. */
const STACK_TASKS = {
  snapshot: async (userId: string, projectId: string, taskId: string) => ({
    id: taskId,
    markdown: ticketText(taskId).markdown,
    version: "1",
  }),
};

/** A closing report for the description TODO and ticket criterion, which is also a TODO. */
export function stackReport(text = "Erledigt."): string {
  return `${text}\n\`\`\`pages-report\n{"todos":[{"id":"T1","status":"done"},{"id":"T2","status":"done"}],"criteria":[{"id":"K1","met":true,"evidence":"synthetic observable result"}],"decisions":[],"summary":"done"}\n\`\`\``;
}

/** One call the synthetic model boundary received. */
export interface StackCall {
  readonly kind: "open" | "next";
  /** The node whose instruction the prompt carries. */
  readonly nodeId: string;
  /** The session the call belongs to, as Pages named it. */
  readonly session: string;
  readonly prompt: string;
}

/** The scripted model boundary: the only synthetic part of a run. */
export interface StackRuntime {
  readonly execution: PlanExecution;
  readonly calls: StackCall[];
  readonly closed: string[];
  /** Lets the held turn of a node answer. */
  readonly release: (nodeId: string) => void;
}

function turn(output: string, session: string): PlanSessionTurn {
  return {
    output,
    sessionId: `native-${session}`,
    failure: null,
    errorCode: null,
    endedAt: "2026-11-02T00:00:00Z",
    permissionDenials: 0,
    effective: { model: "synthetic-free:free" },
    events: [],
  };
}

/** Finds the node a prompt was written for, by its unique instruction. */
function nodeOfPrompt(prompt: string, ids: readonly string[]): string {
  const matches = ids.filter((id) => prompt.includes(`Instruction ${id}.`));
  if (matches.length !== 1)
    throw new Error(`The prompt names ${matches.length} nodes`);
  return matches[0] ?? "";
}

/**
 * A scripted ACP boundary: each node answers from its queue, a group continues its session with `next`.
 *
 * @param answers - The answers per node, in the order the node is asked; a
 * function answers from the prompt.
 * @param held - Nodes whose first turn waits until {@link StackRuntime.release}.
 */
export function stackRuntime(
  answers: Readonly<
    Record<string, readonly (string | ((prompt: string) => string))[]>
  >,
  held: readonly string[] = [],
): StackRuntime {
  const ids = Object.keys(answers);
  const queues = new Map(ids.map((id) => [id, [...(answers[id] ?? [])]]));
  const calls: StackCall[] = [];
  const closed: string[] = [];
  const gates = new Map<string, () => void>();
  const holds = new Map(
    held.map((id) => [
      id,
      new Promise<void>((resolve) => {
        gates.set(id, resolve);
      }),
    ]),
  );
  function answer(prompt: string, session: string): PlanSessionTurn {
    const nodeId = nodeOfPrompt(prompt, ids);
    const next = queues.get(nodeId)?.shift();
    if (next === undefined) throw new Error(`No scripted answer for ${nodeId}`);
    return turn(typeof next === "string" ? next : next(prompt), session);
  }
  const execution: PlanExecution = {
    run: async () => {
      throw new Error("No API requests");
    },
    open: vi.fn<PlanExecution["open"]>(async (input, signal, observer) => {
      signal.throwIfAborted();
      const session = input.resourceContext?.sessionScopeId ?? "";
      const nodeId = nodeOfPrompt(input.prompt, ids);
      calls.push({ kind: "open", nodeId, session, prompt: input.prompt });
      observer.identified(`native-${session}`);
      const opened: PlanSession = {
        turn: (holds.get(nodeId) ?? Promise.resolve()).then(() =>
          answer(input.prompt, session),
        ),
        next: async (next) => {
          calls.push({
            kind: "next",
            nodeId: nodeOfPrompt(next.prompt, ids),
            session,
            prompt: next.prompt,
          });
          return answer(next.prompt, session);
        },
        close: async () => {
          closed.push(session);
          return {
            exit: { code: 0, signal: null },
            endedAt: "2026-11-02T00:00:00Z",
            leftovers: 0,
            isConfirmed: true,
          };
        },
      };
      return opened;
    }),
  };
  return {
    execution,
    calls,
    closed,
    release: (nodeId) => gates.get(nodeId)?.(),
  };
}

/** The agent of every node: an instruction with a ticket input and a text input for the count. */
function stackConfiguration(): AgentConfiguration {
  return {
    ...emptyAgentConfiguration(),
    markdown:
      "Main instruction (AGENT.md).\n\nTask:\n{{aufgabe}}\n\nTotal: {{anzahl}}",
    parameters: [
      {
        name: "aufgabe",
        type: "ticket" as const,
        description: "",
        isRequired: false,
        defaultValue: null,
      },
      {
        name: "anzahl",
        type: "text" as const,
        description: "",
        isRequired: false,
        defaultValue: { type: "text" as const, text: "none" },
      },
    ],
    run: acpRunOptions("read_only", 0),
  };
}

/** A synthetic script process: answers from the JSON input it would have read on stdin. */
export type ScriptAnswer = (
  script: AgentPlanScriptSnapshot,
  input: Readonly<Record<string, string>>,
) => string;

export interface StackEngine {
  readonly database: RecoveryDatabase;
  readonly engine: AgentPlanRunEngine;
  readonly snapshot: AgentPlanSnapshot;
  readonly read: (id: string) => AgentPlanRun;
  readonly plan: AgentPlan;
  /** Every script process the synthetic runner started, with its input. */
  readonly scriptCalls: { readonly id: string; readonly input: string }[];
}

/** Builds nodes of the example plans. */
export interface StackNodes {
  /** An agent whose instruction names a ticket input and a text input. */
  readonly agent: (id: string, x?: number) => AgentPlanStep;
  /** An agent whose instruction names no input. */
  readonly plain: (id: string, x?: number) => AgentPlanStep;
  readonly script: (id: string, inputs?: readonly string[]) => AgentPlanScript;
}

function scriptNode(
  id: string,
  inputs: readonly string[] = [],
): AgentPlanScript {
  return {
    id,
    type: "script",
    x: 0,
    y: 0,
    name: `Script ${id}`,
    interpreterProfileId: "python",
    content: "import json,sys\nprint(json.load(sys.stdin))",
    inputs: inputs.map((name) => ({ name, type: "text", isRequired: false })),
    outputs: [{ name: "result", type: "text" }],
    timeoutSeconds: 30,
    bindings: {},
  };
}

/** A synthetic script runner over the real script snapshot and the real input contract. */
function scriptRunner(
  answer: ScriptAnswer,
  calls: { readonly id: string; readonly input: string }[],
): Pick<AgentPlanScriptRunner, "run"> {
  return {
    run: async (run, snapshot, script) => {
      // The real runner resolves the stack contents the same way before it serializes the inputs.
      const { planStackScriptInput } =
        await import("@/backend/service/agents/stack/AgentPlanStackInputs");
      const { scriptInputJson } =
        await import("@/backend/service/agents/AgentPlanScriptInputs");
      const resolved = await planStackScriptInput(script, {
        plan: snapshot.plan,
        run,
        readTask: async (taskId) => ({
          id: taskId,
          markdown: ticketText(taskId).markdown,
          version: "1",
        }),
      });
      const input = scriptInputJson(run, resolved);
      calls.push({ id: script.step.id, input });
      const parsed: Record<string, string> = JSON.parse(input) as Record<
        string,
        string
      >;
      return {
        status: "succeeded",
        output: answer(resolved, parsed),
        error: null,
      };
    },
  };
}

/** Builds a real, validated snapshot of a plan and a real scheduler around a scripted model. */
export async function stackEngine(
  execution: PlanExecution,
  shape: {
    readonly nodes: (build: StackNodes) => readonly AgentPlanNode[];
    readonly edges: readonly AgentPlanEdge[];
    readonly script?: ScriptAnswer;
  },
): Promise<StackEngine> {
  const configuration = stackConfiguration();
  // The base node only supplies the runtime; it names no input that would need a value.
  const base = await parameterRunFixture(
    { ...configuration, markdown: "Base instruction." },
    "codex_cli",
    {
      readAssets: async () => [],
      resolve: async (userId, id) => ticketText(id),
    },
    STACK_TASKS,
  );
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
  const agent = (id: string, x = 0): AgentPlanStep => ({
    ...base.step.step,
    id,
    x,
    instruction: `Instruction ${id}.`,
    configuration: copyPlanConfiguration(source),
    bindings: {},
  });
  const plainSource: AgentDefinitionChoice = {
    ...source,
    configuration: {
      ...configuration,
      markdown: "Main instruction (AGENT.md).",
      parameters: [],
    },
  };
  const plain = (id: string, x = 0): AgentPlanStep => ({
    ...agent(id, x),
    configuration: copyPlanConfiguration(plainSource),
  });
  const plan: AgentPlan = {
    ...base.snapshot.plan,
    nodes: shape.nodes({ agent, plain, script: scriptNode }),
    edges: shape.edges,
  };
  const prepared = await base.start.prepare(base.run, base.snapshot, base.step);
  const preparation = stackPreparation({
    base,
    source,
    assignment: prepared.input.agent,
  });
  const snapshot = await preparation.prepare("owner", plan);
  const database = new RecoveryDatabase(snapshot);
  const scriptCalls: { readonly id: string; readonly input: string }[] = [];
  const engine = new AgentPlanRunEngine({
    runs: new AgentPlanRunRepository(database.asDatabase()),
    start: { control: async () => {} },
    steps: stackStepRunner(base, execution),
    scripts: scriptRunner(shape.script ?? (() => "{}"), scriptCalls),
  });
  return {
    database,
    engine,
    snapshot,
    read: (id) => database.run(id),
    plan,
    scriptCalls,
  };
}

/** The real preparation over the synthetic agent, tickets and script profile. */
function stackPreparation(context: {
  readonly base: Awaited<ReturnType<typeof parameterRunFixture>>;
  readonly source: AgentDefinitionChoice;
  readonly assignment: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof parameterRunFixture>>["start"]["prepare"]
    >
  >["input"]["agent"];
}): AgentPlanPreparation {
  const { base, source, assignment } = context;
  const configuration = stackConfiguration();
  return new AgentPlanPreparation({
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
        assignment,
        accessAgentId: "agent",
      }),
    },
    parameters: base.parameters,
    tasks: STACK_TASKS,
    scripts: {
      validate: async () => {},
      prepare: async (userId, flat) =>
        flat.nodes.flatMap((node): AgentPlanScriptSnapshot[] =>
          node.type === "script"
            ? [
                {
                  step: node,
                  interpreter: {
                    id: "python",
                    name: "Python",
                    path: "/usr/bin/python3",
                  },
                  workspace: base.step.prepared.workspace,
                  inputs: {},
                  taskIds: [],
                },
              ]
            : [],
        ),
    },
  });
}

/** The real step runner over the synthetic model boundary and ticket checklists. */
function stackStepRunner(
  base: Awaited<ReturnType<typeof parameterRunFixture>>,
  execution: PlanExecution,
): AgentPlanStepRunner {
  return new AgentPlanStepRunner({
    start: base.start,
    execution,
    tasks: {
      ...STACK_TASKS,
      checklist: async (userId, projectId, taskId) => {
        const ticket = ticketOf(taskId);
        return {
          id: ticket.id,
          key: ticket.key,
          title: ticket.title,
          checklist: materializeTicketChecklist(ticket.description, [
            {
              id: `${ticket.id}-criterion`,
              workItemId: ticket.id,
              title: `Kriterium ${ticket.key} erfüllt`,
              isDone: false,
              sortOrder: 0,
              createdAt: "2026-11-02",
              updatedAt: "2026-11-02",
            },
          ]),
        };
      },
    },
    access: { grant: async () => null, revoke: async () => 0 },
  });
}

/** Waits until the run ended and returns its stored view. */
export async function finishedRun(
  world: { readonly read: (id: string) => AgentPlanRun },
  id: string,
): Promise<AgentPlanRun> {
  const { expect } = await import("vitest");
  await expect
    .poll(() => world.read(id).status, { timeout: 8000 })
    .toMatch(/^(succeeded|failed|cancelled)$/u);
  return world.read(id);
}

/** A flow edge. */
export function flow(from: string, to: string): AgentPlanEdge {
  return { from, to, fromPort: "flow-out", toPort: "flow-in" };
}
