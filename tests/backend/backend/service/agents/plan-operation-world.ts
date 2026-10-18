import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanOperationService } from "@/backend/service/agents/AgentPlanOperationService";
import { validatePlanGraph } from "@/backend/service/agents/AgentPlanGraph";
import { requireCredentialFreeText } from "@/backend/security/AgentTextSafety";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRunEntry } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentPlanOperationDependencies } from "@/backend/service/agents/AgentPlanOperationService";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlan,
  AgentPlanRun,
  AgentPlanStepResult,
  AgentPlanTask,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentParameter } from "@/definition/AgentParameters";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** The workspace of the synthetic project; every plan here lives in it. */
export const WORKSPACE = "workspace-1";
/** An agent with a required directory and a text input without default. */
export const REVIEWER = "agent-reviewer";

const FLOW = { fromPort: "flow-out", toPort: "flow-in" } as const;

const REVIEWER_PARAMETERS: readonly AgentParameter[] = [
  {
    name: "repository",
    type: "workspace",
    description: "Working copy",
    isRequired: true,
    defaultValue: null,
  },
  {
    name: "notes",
    type: "text",
    description: "Notes",
    isRequired: false,
    defaultValue: null,
  },
  {
    name: "ticket",
    type: "ticket",
    description: "Ticket",
    isRequired: false,
    defaultValue: null,
  },
];

function agent(id: string, name: string): AgentDefinitionChoice {
  return {
    id,
    name,
    model: "synthetic-model",
    reasoningEffort: null,
    provider: "codex_cli",
    purposes: [],
    revision: 1,
    configuration: {
      ...emptyAgentConfiguration(),
      parameters: REVIEWER_PARAMETERS,
      directoryParameter: "repository",
    },
    availability: { isUsable: true, reason: null, personalChoices: [] },
  };
}

/** A runnable synthetic plan: start → review → end, with a ticket and a value node. */
export function runnablePlan(
  id: string,
  options: { readonly name?: string; readonly ownerId?: string } = {},
): AgentPlan {
  return {
    id,
    name: options.name ?? "Review plan",
    ownerId: options.ownerId ?? "owner",
    workspaceId: WORKSPACE,
    projectId: "project-1",
    usage: "workspace",
    sharing: { isGlobal: true, targets: [], operator: "or" },
    globals: {},
    revision: 1,
    nodes: [
      { id: "start", type: "start", x: 0, y: 0 },
      {
        id: "review",
        type: "agent",
        x: 320,
        y: 0,
        agentId: REVIEWER,
        personalAgentId: null,
        instruction: "Review the ticket.",
        bindings: {
          repository: { kind: "source", nodeId: "directory" },
          ticket: { kind: "source", nodeId: "ticket" },
        },
      },
      { id: "end", type: "end", x: 640, y: 0 },
      { id: "ticket", type: "task", x: 0, y: 340, taskId: "task-1" },
      {
        id: "directory",
        type: "parameter",
        name: "repository",
        format: "string",
        value: { type: "workspace", workspaceId: WORKSPACE },
        x: 0,
        y: 680,
      },
    ],
    edges: [
      { from: "start", to: "review", ...FLOW },
      { from: "review", to: "end", ...FLOW },
    ],
  };
}

function step(
  id: string,
  status: AgentPlanStepResult["status"],
  output: string | null = null,
): AgentPlanStepResult {
  return {
    id,
    name: id,
    status,
    isBlocked: false,
    cancellation: "none",
    output,
    error: null,
  };
}

/**
 * Synthetic plans, runs and people behind the production plan operations.
 *
 * @remarks
 * The plan service is replaced by an in-memory model of its rules: a plan is
 * visible to its owner, and to members of its project when it is shared; only
 * the owner changes it; a run belongs to the person who started it. Saving
 * parses and checks a plan with the production reader and graph check.
 */
export class PlanWorld {
  public readonly plans = new Map<string, AgentPlan>();
  public readonly runs: AgentPlanRun[] = [];
  public readonly keys = new Map<string, StoredAgentOperation>();
  public readonly members = new Set(["owner", "reader"]);
  public readonly catalog = [agent(REVIEWER, "Reviewer")];
  public readonly tasks: AgentPlanTask[] = [
    {
      id: "task-1",
      key: "PAGE-1",
      title: "Synthetic ticket",
      type: "task",
      parentId: null,
      statusKey: "open",
      statusName: "Open",
      isDone: false,
      createdAt: "2026-01-01 08:00:00",
      updatedAt: "2026-01-02 09:00:00",
    },
  ];
  public saves = 0;
  public readonly operations: AgentPlanOperationService;

  public constructor() {
    this.operations = new AgentPlanOperationService({
      database: { transaction: (work) => this.transaction(work) },
      plans: this.service(),
    });
  }

  /** Stores a plan as a save on the plan page would have left it. */
  public seed(plan: AgentPlan): void {
    this.plans.set(plan.id, structuredClone(plan));
  }

  /** Stores a run of the plan, started by the person at the given time. */
  public addRun(input: {
    readonly id: string;
    readonly planId: string;
    readonly userId?: string;
    readonly startedAt: string;
    readonly status?: AgentPlanRun["status"];
    readonly steps?: readonly AgentPlanStepResult[];
  }): void {
    this.runs.push({
      id: input.id,
      planId: input.planId,
      planName: this.plans.get(input.planId)?.name ?? "Gone",
      planRevision: 1,
      userId: input.userId ?? "owner",
      startedAt: input.startedAt,
      status: input.status ?? "succeeded",
      stopRequested: false,
      steps: input.steps ?? [
        step("start", "succeeded"),
        step("review", "succeeded", "Synthetic result"),
        step("end", "succeeded"),
      ],
    });
  }

  /** The identity a verified credential of the person carries. */
  public identity(userId: string): AgentIdentity {
    return { userId, isAdmin: false, permissions: [] };
  }

  /** Runs one operation as the person and returns its result. */
  public async call(
    userId: string,
    operation: string,
    parameters: Readonly<Record<string, unknown>> = {},
  ): Promise<unknown> {
    const response = await this.operations.handle(
      this.identity(userId),
      operation,
      parameters,
    );
    if (response === null)
      throw new Error(`Not a plan operation: ${operation}`);
    return response.result;
  }

  private workspaces(userId: string): readonly AgentWorkspaceChoice[] {
    if (!this.members.has(userId)) return [];
    return [
      {
        id: WORKSPACE,
        name: "Repository",
        path: "/work/repository",
        projectId: "project-1",
        projectName: "Project One",
        github: null,
        isUsable: true,
        reason: null,
      },
    ];
  }

  private visible(userId: string): readonly AgentPlanView[] {
    return [...this.plans.values()]
      .filter(
        (plan) =>
          plan.ownerId === userId ||
          (plan.usage === "workspace" && this.members.has(userId)),
      )
      .filter((plan) =>
        this.workspaces(userId).some((entry) => entry.id === plan.workspaceId),
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((plan) => ({
        ...structuredClone(plan),
        canEdit: plan.ownerId === userId,
        projectName: "Project One",
        github: null,
      }));
  }

  private view(userId: string, id: string): AgentPlanView {
    const plan = this.visible(userId).find((entry) => entry.id === id);
    if (!plan) throw new AgentError("plan_access_denied");
    return plan;
  }

  private entries(
    userId: string,
    planId: string,
    order: "newest" | "oldest",
  ): readonly AgentPlanRunEntry[] {
    const entries = this.runs
      .filter((run) => run.userId === userId && run.planId === planId)
      .map((run) => ({
        id: run.id,
        startedAt: run.startedAt,
        status: run.status,
      }))
      .sort((left, right) =>
        left.startedAt === right.startedAt
          ? left.id.localeCompare(right.id)
          : left.startedAt.localeCompare(right.startedAt),
      );
    return order === "newest" ? entries.reverse() : entries;
  }

  private service(): AgentPlanOperationDependencies["plans"] {
    return {
      visible: async (userId) => this.visible(userId),
      view: async (userId, id) => this.view(userId, id),
      directory: async () => ({ persons: [], departments: [], groups: [] }),
      workspaces: async (userId) => this.workspaces(userId),
      sources: async (userId, workspaceId) => {
        this.requireWorkspace(userId, workspaceId);
        return { agents: this.catalog, tasks: this.tasks };
      },
      agents: async (userId, workspaceId) => {
        this.requireWorkspace(userId, workspaceId);
        return this.catalog;
      },
      runEntries: async (userId, planId, order) => {
        this.view(userId, planId);
        return this.entries(userId, planId, order);
      },
      runOverview: async (userId, planIds) =>
        new Map(
          planIds.map((planId) => [
            planId,
            this.entries(userId, planId, "newest"),
          ]),
        ),
      run: async (userId, id) => {
        const run = this.runs.find((entry) => entry.id === id);
        if (!run || run.userId !== userId)
          throw new AgentError("plan_access_denied");
        this.view(userId, run.planId);
        return structuredClone(run);
      },
      save: async (userId, id, input, journal) =>
        this.save(userId, id, input, journal),
    };
  }

  private requireWorkspace(userId: string, workspaceId: string): void {
    if (!this.workspaces(userId).some((entry) => entry.id === workspaceId))
      throw new AgentError("plan_access_denied");
  }

  private async save(
    userId: string,
    id: string | null,
    input: unknown,
    journal?: (
      transaction: DatabaseTransaction,
      planId: string,
    ) => Promise<void>,
  ): Promise<string> {
    const proposed = readPlanInput(input);
    requireCredentialFreeText(JSON.stringify(proposed));
    const previous = id === null ? null : this.view(userId, id);
    if (previous && !previous.canEdit)
      throw new AgentError("plan_access_denied");
    if (!this.workspaces(userId).some((w) => w.id === proposed.workspaceId))
      throw new AgentError("workspace_access_denied");
    validatePlanGraph(proposed, this.catalog);
    for (const node of proposed.nodes)
      if (
        node.type === "task" &&
        !this.tasks.some((task) => task.id === node.taskId)
      )
        throw new AgentError("plan_binding_invalid");
    const planId = id ?? `plan-${this.plans.size + 1}`;
    return this.transaction(async (transaction) => {
      const stored = this.plans.get(planId);
      if (stored && stored.revision !== proposed.revision)
        throw new AgentError("plan_conflict");
      this.plans.set(planId, {
        ...proposed,
        id: planId,
        ownerId: userId,
        projectId: "project-1",
        revision: (stored?.revision ?? 0) + 1,
      });
      this.saves += 1;
      await journal?.(transaction, planId);
      return planId;
    });
  }

  private async transaction<T>(
    work: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    const keys = this.keys;
    const plans = new Map(this.plans);
    const stored = new Map(keys);
    const transaction: DatabaseTransaction = {
      query: async (statement, parameters = {}) => {
        if (!statement.includes("FROM agent_operation_keys"))
          throw new Error("Unexpected query");
        const entry = keys.get(
          `${parameters.user_id}/${parameters.operation_id}`,
        );
        return entry
          ? [[entry.fingerprint, entry.operation, entry.resultJson]]
          : [];
      },
      execute: async (statement, parameters = {}) => {
        if (!statement.includes("INSERT INTO agent_operation_keys"))
          throw new Error("Unexpected statement");
        keys.set(`${parameters.user_id}/${parameters.operation_id}`, {
          operation: String(parameters.operation),
          fingerprint: String(parameters.fingerprint),
          resultJson: String(parameters.result_json),
        });
      },
    };
    try {
      return await work(transaction);
    } catch (error: unknown) {
      // A failed transaction leaves neither the plan nor its key.
      this.plans.clear();
      plans.forEach((plan, key) => this.plans.set(key, plan));
      keys.clear();
      stored.forEach((entry, key) => keys.set(key, entry));
      throw error;
    }
  }
}
