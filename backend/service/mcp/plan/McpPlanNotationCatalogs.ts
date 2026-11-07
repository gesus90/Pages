import { AgentError } from "@/backend/error/AgentErrors";
import {
  PlanLayoutOverflowError,
  layoutPlan,
} from "@/definition/AgentPlanAutoLayout";

import { McpPlanNotationError } from "./McpPlanNotationError";
import { PlanNotationError, planNotationIssue } from "./PlanNotationIssue";
import { PlanNotationNames } from "./PlanNotationNames";
import { readPlanNotationDocument } from "./PlanNotationParser";
import { PlanNotationReader, readPlanNotationHead } from "./PlanNotationReader";

import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { WikiService } from "@/backend/service/WikiService";
import type {
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { User } from "@/definition/User";
import type { PlanNotationCatalog } from "./PlanNotationNames";
import type {
  PlanNotationIssue,
  PlanNotationLocation,
} from "./PlanNotationIssue";
import type { PlanNotationDocument } from "./PlanNotationParser";
import type { PlanNotationBuild, PlanNotationHead } from "./PlanNotationReader";
import type { PlanNotationResolution } from "./PlanNotationNames";

/** The services of the interface the plan notation API calls; it adds no right of its own. */
export interface McpPlanNotationDependencies {
  readonly plans: Pick<
    AgentPlanService,
    "view" | "save" | "sources" | "workspaces"
  >;
  readonly wiki: Pick<WikiService, "navigation">;
}

/** A notation read into a plan with its positions, or the findings that keep it from being stored. */
export interface McpPlanNotationPrepared {
  /** The laid out plan, or `null` when the notation could not be read that far. */
  readonly plan: AgentPlanInput | null;
  readonly issues: readonly PlanNotationIssue[];
  /** Where each node stands in the notation, to place the findings of the save. */
  readonly locations: ReadonlyMap<string, PlanNotationLocation>;
}

/** Sources of a workspace whose catalog cannot be read: names then stay identifiers. */
const NO_SOURCES: AgentPlanSources = { agents: [], tasks: [] };

function failed(issues: readonly PlanNotationIssue[]): McpPlanNotationPrepared {
  return { plan: null, issues, locations: new Map() };
}

/**
 * Lays out a read plan; a plan too large for the grid becomes a `plan_invalid` finding.
 *
 * @remarks
 * The finding names the frame whose members do not fit, or the plan. The
 * plan then keeps no positions of the layout, so it is never stored, but it
 * still serves the preview of a check.
 */
function laidOut(
  build: PlanNotationBuild,
  input: {
    readonly document: PlanNotationDocument;
    readonly sources: AgentPlanSources;
    readonly previous: AgentPlanView | null;
  },
): McpPlanNotationPrepared {
  const { issues, locations } = build;
  try {
    const options = { rankdir: build.rankdir, previous: input.previous };
    return {
      plan: layoutPlan(build.plan, input.sources, options),
      issues,
      locations,
    };
  } catch (error: unknown) {
    if (!(error instanceof PlanLayoutOverflowError)) throw error;
    const nodeId = error.containerId;
    const location =
      (nodeId === null ? undefined : locations.get(nodeId)) ?? input.document;
    return {
      plan: build.plan,
      issues: [...issues, planNotationIssue(location, "plan_invalid", nodeId)],
      locations,
    };
  }
}

/** The target a remote workspace imposes on its plans, as the save of the editor does. */
function workspaceTarget(
  workspace: AgentWorkspaceChoice,
): AgentPlanExecutionTarget {
  return workspace.kind === "remote"
    ? { kind: "remote", workspaceId: workspace.id }
    : { kind: "local" };
}

/** Resolves `workspace` by name or identifier, and `workspaceId` by identifier alone. */
function resolveWorkspace(
  written: NonNullable<PlanNotationHead["workspace"]>,
  workspaces: readonly AgentWorkspaceChoice[],
): PlanNotationResolution {
  if (!written.isIdentifier)
    return new PlanNotationNames({
      workspaces,
      sources: NO_SOURCES,
      wikiPages: [],
    }).workspace(written.value);
  if (workspaces.some((entry) => entry.id === written.value))
    return { id: written.value };
  return {
    code: "name_not_found",
    candidates: workspaces.map(({ id, name }) => ({ id, name })),
  };
}

/**
 * Loads what names in a notation resolve against and reads notations with it.
 *
 * @remarks
 * The catalog is that of the plan page for the person: the workspaces they
 * may use for plans, the sources of the plan's workspace and the wiki pages
 * of its project they see.
 */
export class McpPlanNotationCatalogs {
  private readonly dependencies: McpPlanNotationDependencies;

  /**
   * Creates the loader.
   *
   * @param dependencies - The plan service of the `mcp` channel and the wiki.
   */
  public constructor(dependencies: McpPlanNotationDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads a notation into a laid out plan, without storing it.
   *
   * @param actor - The paired account.
   * @param notation - The notation.
   * @param previous - The stored plan when it is replaced; its workspace is the default and its places are kept.
   */
  public async prepare(
    actor: User,
    notation: string,
    previous: AgentPlanView | null,
  ): Promise<McpPlanNotationPrepared> {
    let document: PlanNotationDocument;
    try {
      document = readPlanNotationDocument(notation);
    } catch (error: unknown) {
      if (error instanceof PlanNotationError) return failed(error.issues);
      throw error;
    }
    const workspaces = await this.dependencies.plans.workspaces(actor.id);
    const workspace = this.workspace(document, workspaces, previous);
    if ("issue" in workspace) return failed([workspace.issue]);
    const catalog = await this.usableCatalog(
      actor,
      workspace.choice,
      workspaces,
    );
    const context = {
      names: new PlanNotationNames(catalog),
      sources: catalog.sources,
      previous,
      planTarget: workspaceTarget(workspace.choice),
      findings: { issues: [] },
    };
    const reader = new PlanNotationReader(context);
    const build = reader.read(document, workspace.choice.id);
    return laidOut(build, { document, sources: catalog.sources, previous });
  }

  /** The catalog that names the identifiers of a stored plan; empty sources when its workspace is gone. */
  public async forPlan(
    actor: User,
    plan: AgentPlanView,
  ): Promise<PlanNotationCatalog> {
    const workspaces = await this.dependencies.plans.workspaces(actor.id);
    const choice = workspaces.find((entry) => entry.id === plan.workspaceId);
    if (!choice) return { workspaces, sources: NO_SOURCES, wikiPages: [] };
    try {
      return await this.catalog(actor, choice, workspaces);
    } catch (error: unknown) {
      if (error instanceof AgentError)
        return { workspaces, sources: NO_SOURCES, wikiPages: [] };
      throw error;
    }
  }

  /** The catalog of a workspace the plan is about to use; one the person cannot use refuses the request. */
  private async usableCatalog(
    actor: User,
    choice: AgentWorkspaceChoice,
    workspaces: readonly AgentWorkspaceChoice[],
  ): Promise<PlanNotationCatalog> {
    try {
      return await this.catalog(actor, choice, workspaces);
    } catch (error: unknown) {
      if (error instanceof AgentError)
        throw new McpPlanNotationError("forbidden");
      throw error;
    }
  }

  private async catalog(
    actor: User,
    choice: AgentWorkspaceChoice,
    workspaces: readonly AgentWorkspaceChoice[],
  ): Promise<PlanNotationCatalog> {
    const [sources, navigation] = await Promise.all([
      this.dependencies.plans.sources(actor.id, choice.id),
      this.dependencies.wiki.navigation(actor),
    ]);
    return {
      workspaces,
      sources,
      wikiPages: navigation.nodes
        .filter((page) => page.projectId === choice.projectId)
        .map((page) => ({ id: page.id, title: page.title })),
    };
  }

  /** The workspace the notation names, else that of the replaced plan. */
  private workspace(
    document: PlanNotationDocument,
    workspaces: readonly AgentWorkspaceChoice[],
    previous: AgentPlanView | null,
  ):
    | { readonly choice: AgentWorkspaceChoice }
    | { readonly issue: PlanNotationIssue } {
    const head: PlanNotationHead = readPlanNotationHead(document);
    const written = head.workspace;
    if (written === null) {
      const stored = workspaces.find(
        (entry) => entry.id === previous?.workspaceId,
      );
      return stored
        ? { choice: stored }
        : { issue: planNotationIssue(document, "invalid_value") };
    }
    const resolution = resolveWorkspace(written, workspaces);
    if (!("id" in resolution))
      return {
        issue: planNotationIssue(
          written.location,
          resolution.code,
          null,
          resolution.candidates,
        ),
      };
    const choice = workspaces.find((entry) => entry.id === resolution.id);
    return choice
      ? { choice }
      : { issue: planNotationIssue(written.location, "name_not_found") };
  }
}
