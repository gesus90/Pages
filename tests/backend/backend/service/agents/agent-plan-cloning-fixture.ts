import { vi } from "vitest";

import { AgentPlanCloning } from "@/backend/service/agents/AgentPlanCloning";
import { AgentError } from "@/backend/error/AgentErrors";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PageAgentModel } from "@/definition/PageAgent";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlan, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanCloneReceipt } from "@/definition/AgentPlanClone";

/** Saved source and mocked external boundaries; no database, filesystem or runner is started. */
export class CloneWorld {
  public source: AgentPlanView = {
    id: "source",
    name: "Original",
    ownerId: "other",
    projectId: "project",
    workspaceId: "foreign",
    revision: 7,
    usage: "workspace",
    sharing: { isGlobal: true, targets: [], operator: "or" },
    canEdit: false,
    projectName: "Pages",
    github: null,
    globals: {},
    nodes: [
      {
        id: "agent",
        type: "agent",
        x: 0,
        y: 0,
        agentId: "private",
        personalAgentId: null,
        instruction: "Keep instructions",
        bindings: {},
      },
    ],
    edges: [],
  };
  public readonly saved: AgentPlan[] = [];
  public readonly receipts: AgentPlanCloneReceipt[] = [];
  public readonly transaction: DatabaseTransaction = partial({});
  public readonly require = vi.fn(async () => this.source);
  public readonly validateTeams = vi.fn(async () => undefined);
  public readonly cloneSource = vi.fn(async (): Promise<unknown> =>
    Object.fromEntries(
      Object.entries(this.source).filter(
        ([key]) =>
          !["canEdit", "projectName", "github", "rights"].includes(key),
      ),
    ),
  );
  public readonly save = vi.fn(
    async (
      plan: AgentPlan,
      _: boolean,
      journal?: (transaction: DatabaseTransaction) => Promise<void>,
    ): Promise<void> => {
      await journal?.(this.transaction);
      this.saved.push(plan);
    },
  );
  public readonly choices = vi.fn(async () => [
    {
      id: "own",
      name: "Pages",
      projectId: "project",
      projectName: "Pages",
      path: "/synthetic",
      isUsable: true,
      github: null,
      reason: null,
    },
  ]);
  public readonly resolve = vi.fn(async () => ({ projectId: "project" }));
  public readonly catalog = vi.fn(async () => []);
  public readonly planModels = vi.fn(
    async (): Promise<readonly PageAgentModel[]> => [],
  );
  public readonly requireTicket = vi.fn(async (): Promise<void> => {
    throw new AgentError("parameter_ticket_unavailable");
  });
  public readonly requireWiki = vi.fn(async (): Promise<void> => {
    throw new AgentError("parameter_reference_unavailable");
  });
  public readonly service = new AgentPlanCloning({
    plans: partial({ cloneSource: this.cloneSource, save: this.save }),
    access: partial({
      require: this.require,
      validateTeams: this.validateTeams,
      team: async () => ({ departmentId: "development" }),
    }),
    workspaces: partial({ choices: this.choices, resolve: this.resolve }),
    profiles: partial({
      catalog: this.catalog,
      planModels: this.planModels,
      isVisible: async () => false,
      resolveDefinition: async () => ({}),
    }),
    parameters: partial({
      requireTicket: this.requireTicket,
      requireWiki: this.requireWiki,
    }),
    tasks: partial({
      snapshot: async () => {
        throw new AgentError("plan_binding_invalid");
      },
    }),
  });

  /** Clones and collects the receipt passed to the operation journal. */
  public async clone(
    input: Parameters<AgentPlanCloning["clone"]>[2] = {
      expectedRevision: 1,
      name: "",
    },
  ): Promise<string> {
    return this.service.clone(
      "copier",
      "source",
      input,
      async (transaction, planId, receipt) => {
        void transaction;
        void planId;
        this.receipts.push(receipt);
      },
    );
  }
}
