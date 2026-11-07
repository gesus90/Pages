import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import {
  PlanLayoutOverflowError,
  layoutPlan,
} from "@/definition/AgentPlanAutoLayout";

import { McpPlanNotationError } from "./McpPlanNotationError";
import { McpPlanNotationCatalogs } from "./McpPlanNotationCatalogs";
import { isPlanReaderRefusal, planNotationIssue } from "./PlanNotationIssue";
import { previewPlanNotation } from "./PlanNotationPreview";
import { writePlanNotation } from "./PlanNotationWriter";

import type {
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { User } from "@/definition/User";
import type {
  McpPlanNotationDependencies,
  McpPlanNotationPrepared,
} from "./McpPlanNotationCatalogs";
import type {
  McpPlanNotationCheckRequest,
  McpPlanNotationLayoutRequest,
  McpPlanNotationReplaceRequest,
} from "./McpPlanNotationRequest";
import type {
  PlanNotationIssue,
  PlanNotationLocation,
} from "./PlanNotationIssue";
import type { PlanNotationPreview } from "./PlanNotationPreview";

/** Where a finding of the save stands when the notation has no place for it. */
const START: PlanNotationLocation = { line: 1, column: 1 };

/** The answer of a check. */
export interface McpPlanNotationCheck {
  readonly ok: boolean;
  readonly issues: readonly PlanNotationIssue[];
  readonly preview: PlanNotationPreview | null;
}

/** A plan with its revision and its notation, the answer of reading, creating and laying out. */
export interface McpPlanNotationResult {
  readonly planId: string;
  readonly revision: number;
  readonly notation: string;
}

/** The answer of a replacement: the saved plan and what changed. */
export interface McpPlanNotationReplacement extends McpPlanNotationResult {
  readonly preview: PlanNotationPreview;
}

/** The fields of a stored plan that a save takes, without what the read adds. */
function planInput(view: AgentPlanView): AgentPlanInput {
  return {
    name: view.name,
    workspaceId: view.workspaceId,
    usage: view.usage,
    ...(view.sharing === undefined ? {} : { sharing: view.sharing }),
    projectId: view.projectId,
    ...(view.executionTarget === undefined
      ? {}
      : { executionTarget: view.executionTarget }),
    globals: view.globals,
    nodes: view.nodes,
    edges: view.edges,
    revision: view.revision,
  };
}

/**
 * Lays out every node of a stored plan; a plan too large for the grid is refused before the save.
 *
 * @throws McpPlanNotationError `notation_invalid` with a `plan_invalid`
 * finding for the frame that does not fit, or for the plan.
 */
function laidOutAnew(
  plan: AgentPlanInput,
  sources: AgentPlanSources,
  rankdir: McpPlanNotationLayoutRequest["rankdir"],
): AgentPlanInput {
  try {
    return layoutPlan(plan, sources, { rankdir: rankdir ?? "TB" });
  } catch (error: unknown) {
    if (!(error instanceof PlanLayoutOverflowError)) throw error;
    throw new McpPlanNotationError("notation_invalid", {
      issues: [planNotationIssue(START, "plan_invalid", error.containerId)],
    });
  }
}

/** A notation with findings is never stored; its findings are the answer. */
function requireValid(prepared: McpPlanNotationPrepared): AgentPlanInput {
  if (prepared.plan === null || prepared.issues.length > 0)
    throw new McpPlanNotationError("notation_invalid", {
      issues: prepared.issues,
    });
  return prepared.plan;
}

/**
 * The operations of the plan notation API (PAGE-250).
 *
 * @remarks
 * Every plan is read and saved through the plan service of the editor with
 * the paired account: the same rights, the same revision guard and the same
 * checks as `save-plan`. There is no second save logic. A plan the account
 * cannot read answers like a missing one.
 */
export class McpPlanNotationService {
  private readonly dependencies: McpPlanNotationDependencies;
  private readonly catalogs: McpPlanNotationCatalogs;

  /**
   * Creates the service.
   *
   * @param dependencies - The plan service of the `mcp` channel and the wiki.
   */
  public constructor(dependencies: McpPlanNotationDependencies) {
    this.dependencies = dependencies;
    this.catalogs = new McpPlanNotationCatalogs(dependencies);
  }

  /** Checks a notation without storing anything; with a plan, it previews the replacement. */
  public async check(
    actor: User,
    request: McpPlanNotationCheckRequest,
  ): Promise<McpPlanNotationCheck> {
    const previous =
      request.planId === undefined
        ? null
        : await this.visible(actor, request.planId);
    const prepared = await this.catalogs.prepare(
      actor,
      request.notation,
      previous,
    );
    return {
      ok: prepared.plan !== null && prepared.issues.length === 0,
      issues: prepared.issues,
      preview:
        previous && prepared.plan
          ? previewPlanNotation(previous, prepared.plan)
          : null,
    };
  }

  /** Reads a visible plan as notation. */
  public async read(
    actor: User,
    planId: string,
  ): Promise<McpPlanNotationResult> {
    return this.result(actor, await this.visible(actor, planId));
  }

  /** Creates a plan from a notation, every node laid out. */
  public async create(
    actor: User,
    notation: string,
  ): Promise<McpPlanNotationResult> {
    const prepared = await this.catalogs.prepare(actor, notation, null);
    const plan = requireValid(prepared);
    const planId = await this.save(actor, { id: null, plan, prepared });
    return this.result(actor, await this.visible(actor, planId));
  }

  /** Replaces a plan by a notation; nodes that keep their identifier keep their place. */
  public async replace(
    actor: User,
    planId: string,
    request: McpPlanNotationReplaceRequest,
  ): Promise<McpPlanNotationReplacement> {
    const stored = await this.editable(actor, planId, request.expectedRevision);
    const prepared = await this.catalogs.prepare(
      actor,
      request.notation,
      stored,
    );
    const plan = requireValid(prepared);
    const preview = previewPlanNotation(stored, plan);
    await this.save(actor, {
      id: planId,
      plan: { ...plan, revision: request.expectedRevision },
      prepared,
    });
    return {
      ...(await this.result(actor, await this.visible(actor, planId))),
      preview,
    };
  }

  /** Lays out every node of a plan anew and saves it. */
  public async layout(
    actor: User,
    planId: string,
    request: McpPlanNotationLayoutRequest,
  ): Promise<McpPlanNotationResult> {
    const stored = await this.editable(actor, planId, request.expectedRevision);
    const sources = await this.sources(actor, stored);
    const plan = laidOutAnew(planInput(stored), sources, request.rankdir);
    await this.save(actor, {
      id: planId,
      plan: { ...plan, revision: request.expectedRevision },
      prepared: null,
    });
    return this.result(actor, await this.visible(actor, planId));
  }

  /** The sources that size the cards; a workspace the account can no longer use refuses the change. */
  private async sources(
    actor: User,
    plan: AgentPlanView,
  ): Promise<AgentPlanSources> {
    try {
      return await this.dependencies.plans.sources(actor.id, plan.workspaceId);
    } catch (error: unknown) {
      if (error instanceof AgentError)
        throw new McpPlanNotationError("forbidden");
      throw error;
    }
  }

  private async result(
    actor: User,
    view: AgentPlanView,
  ): Promise<McpPlanNotationResult> {
    const catalog = await this.catalogs.forPlan(actor, view);
    return {
      planId: view.id,
      revision: view.revision,
      notation: writePlanNotation(view, catalog),
    };
  }

  /** A plan the account may read; a hidden one is `not_found`, like a missing one. */
  private async visible(actor: User, planId: string): Promise<AgentPlanView> {
    try {
      return await this.dependencies.plans.view(actor.id, planId);
    } catch (error: unknown) {
      if (error instanceof AgentError && error.code === "plan_access_denied")
        throw new McpPlanNotationError("not_found");
      throw error;
    }
  }

  /** A plan the account may change, still at the expected revision. */
  private async editable(
    actor: User,
    planId: string,
    expectedRevision: number,
  ): Promise<AgentPlanView> {
    const view = await this.visible(actor, planId);
    if (!view.canEdit) throw new McpPlanNotationError("forbidden");
    if (view.revision !== expectedRevision)
      throw new McpPlanNotationError("conflict", {
        currentRevision: view.revision,
      });
    return view;
  }

  /** Saves through the plan service and turns its refusals into the codes of the interface. */
  private async save(
    actor: User,
    input: {
      readonly id: string | null;
      readonly plan: AgentPlanInput;
      readonly prepared: McpPlanNotationPrepared | null;
    },
  ): Promise<string> {
    try {
      return await this.dependencies.plans.save(actor.id, input.id, input.plan);
    } catch (error: unknown) {
      throw await this.saveFailure(actor, error, input);
    }
  }

  private async saveFailure(
    actor: User,
    error: unknown,
    input: {
      readonly id: string | null;
      readonly prepared: McpPlanNotationPrepared | null;
    },
  ): Promise<unknown> {
    if (
      error instanceof AgentError &&
      error.code === "plan_conflict" &&
      input.id
    )
      return new McpPlanNotationError("conflict", {
        currentRevision: (await this.visible(actor, input.id)).revision,
      });
    if (error instanceof AgentError && error.code === "plan_access_denied")
      return new McpPlanNotationError("forbidden");
    const locations =
      input.prepared?.locations ?? new Map<string, PlanNotationLocation>();
    if (error instanceof AgentPlanValidationError)
      return new McpPlanNotationError("notation_invalid", {
        issues: error.issues.map((issue) =>
          planNotationIssue(
            (issue.nodeId === null ? undefined : locations.get(issue.nodeId)) ??
              START,
            "plan_invalid",
            issue.nodeId,
          ),
        ),
      });
    if (isPlanReaderRefusal(error) || error instanceof AgentExecutionError)
      return new McpPlanNotationError("notation_invalid", {
        issues: [planNotationIssue(START, "plan_invalid")],
      });
    return error;
  }
}
