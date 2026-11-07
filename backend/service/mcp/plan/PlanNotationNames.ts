import { planTargetModels } from "@/definition/AgentPlanConfiguration";

import type { AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { PlanNotationCandidate } from "./PlanNotationIssue";

/** A wiki page of the plan's project, by its title. */
export interface PlanNotationWikiPage {
  readonly id: string;
  readonly title: string;
}

/**
 * What names in a notation resolve against: the choices of the plan page.
 *
 * @remarks
 * The workspaces are those the person may use for plans, the sources those
 * of the plan's workspace, the wiki pages those of its project the person
 * sees. Nothing else is ever offered as a candidate.
 */
export interface PlanNotationCatalog {
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly sources: AgentPlanSources;
  readonly wikiPages: readonly PlanNotationWikiPage[];
}

/** One object a name may mean, with the further names it answers to. */
interface NamedEntry extends PlanNotationCandidate {
  readonly aliases?: readonly string[];
}

/** What a name resolved to: an identifier, or the finding with its candidates. */
export type PlanNotationResolution =
  | { readonly id: string }
  | {
      readonly code: "name_not_found" | "name_ambiguous";
      readonly candidates: readonly PlanNotationCandidate[];
    };

function candidate(entry: NamedEntry): PlanNotationCandidate {
  return { id: entry.id, name: entry.name };
}

function names(entry: NamedEntry): readonly string[] {
  return [entry.name, ...(entry.aliases ?? [])];
}

/** Matches by name: exactly first, then ignoring case. */
function matches(
  entries: readonly NamedEntry[],
  name: string,
): readonly NamedEntry[] {
  const exact = entries.filter((entry) => names(entry).includes(name));
  if (exact.length > 0) return exact;
  const folded = name.toLocaleLowerCase();
  return entries.filter((entry) =>
    names(entry).some((entryName) => entryName.toLocaleLowerCase() === folded),
  );
}

/**
 * Resolves a name or identifier among entries.
 *
 * @remarks
 * An identifier always wins. Several entries of one identifier, such as one
 * model behind several names, count once.
 */
function resolve(
  entries: readonly NamedEntry[],
  value: string,
): PlanNotationResolution {
  if (entries.some((entry) => entry.id === value)) return { id: value };
  const found = matches(entries, value);
  const ids = [...new Set(found.map((entry) => entry.id))];
  const [only] = ids;
  if (ids.length === 1 && only !== undefined) return { id: only };
  return found.length === 0
    ? { code: "name_not_found", candidates: entries.map(candidate) }
    : { code: "name_ambiguous", candidates: found.map(candidate) };
}

/** Whether an identifier is the only thing its name means, so the name may stand for it. */
function isUnique(
  entries: readonly NamedEntry[],
  id: string,
  name: string,
): boolean {
  const resolved = resolve(entries, name);
  return "id" in resolved && resolved.id === id && name !== "";
}

/**
 * Resolves names of a notation to identifiers and back (PAGE-250).
 *
 * @remarks
 * The reader resolves names to identifiers; the writer asks for the name of
 * an identifier only where that name resolves back to it alone.
 */
export class PlanNotationNames {
  private readonly catalog: PlanNotationCatalog;

  /**
   * Creates the resolver.
   *
   * @param catalog - The choices of the plan page for the plan's workspace.
   */
  public constructor(catalog: PlanNotationCatalog) {
    this.catalog = catalog;
  }

  /** Resolves a workspace the person may use for plans. */
  public workspace(value: string): PlanNotationResolution {
    return resolve(this.workspaceEntries(), value);
  }

  /** Resolves an agent of the workspace's project. */
  public agent(value: string): PlanNotationResolution {
    return resolve(this.catalog.sources.agents, value);
  }

  /** Resolves a personal agent among the personal choices of an agent. */
  public personalAgent(agentId: string, value: string): PlanNotationResolution {
    return resolve(this.personalEntries(agentId), value);
  }

  /** Resolves an interpreter profile offered for the node's target. */
  public interpreter(
    target: AgentPlanExecutionTarget,
    value: string,
  ): PlanNotationResolution {
    return resolve(this.interpreterEntries(target), value);
  }

  /** Resolves a remote workspace of the project as an execution target. */
  public remoteTarget(value: string): PlanNotationResolution {
    return resolve(this.remoteEntries(), value);
  }

  /** Resolves a ticket of the project by its key. */
  public ticket(value: string): PlanNotationResolution {
    return resolve(this.ticketEntries(), value);
  }

  /** Resolves a wiki page of the project by its title. */
  public wiki(value: string): PlanNotationResolution {
    return resolve(this.wikiEntries(), value);
  }

  /**
   * Resolves a model offered for the node's target, by its key or model name.
   *
   * @param target - The effective target of the node.
   * @param value - The key, the model name or the display name.
   * @param provider - Narrows the choice to one provider, or `null`.
   */
  public model(
    target: AgentPlanExecutionTarget,
    value: string,
    provider: string | null,
  ): PlanNotationResolution {
    return resolve(this.modelEntries(target, provider), value);
  }

  /** The model behind a key offered for the target, or `undefined`. */
  public findModel(
    target: AgentPlanExecutionTarget,
    id: string,
  ): PageAgentModel | undefined {
    return this.targetModels(target).find((model) => model.id === id);
  }

  /** The name of a workspace, where it is unique; otherwise its identifier. */
  public workspaceName(id: string): string {
    return this.nameOf(this.workspaceEntries(), id);
  }

  /** The name of an agent, where it is unique; otherwise `null`. */
  public agentName(id: string): string | null {
    return this.uniqueName(this.catalog.sources.agents, id);
  }

  /** The name of a personal agent, where it is unique; otherwise `null`. */
  public personalAgentName(agentId: string, id: string): string | null {
    return this.uniqueName(this.personalEntries(agentId), id);
  }

  /** The name of an interpreter, where it is unique for the target; otherwise `null`. */
  public interpreterName(
    target: AgentPlanExecutionTarget,
    id: string,
  ): string | null {
    return this.uniqueName(this.interpreterEntries(target), id);
  }

  /** The name of a remote target, where it is unique; otherwise its identifier. */
  public remoteTargetName(id: string): string {
    return this.nameOf(this.remoteEntries(), id);
  }

  /** The key of a ticket, where it is unique; otherwise its identifier. */
  public ticketKey(id: string): string {
    return this.nameOf(this.ticketEntries(), id);
  }

  /** The title of a wiki page, where it is unique; otherwise its identifier. */
  public wikiTitle(id: string): string {
    return this.nameOf(this.wikiEntries(), id);
  }

  /**
   * The model name and, when needed, the provider that resolve back to a model key.
   *
   * @returns `null` when no short form resolves back to exactly that key.
   */
  public modelName(
    target: AgentPlanExecutionTarget,
    id: string,
  ): { readonly model: string; readonly provider: string | null } | null {
    const model = this.findModel(target, id);
    if (!model) return null;
    if (isUnique(this.modelEntries(target, null), id, model.model))
      return { model: model.model, provider: null };
    const provider = model.provider;
    if (isUnique(this.modelEntries(target, provider), id, model.model))
      return { model: model.model, provider };
    return { model: id, provider: null };
  }

  private nameOf(entries: readonly NamedEntry[], id: string): string {
    return this.uniqueName(entries, id) ?? id;
  }

  private uniqueName(
    entries: readonly NamedEntry[],
    id: string,
  ): string | null {
    const entry = entries.find((item) => item.id === id);
    return entry && isUnique(entries, id, entry.name) ? entry.name : null;
  }

  private workspaceEntries(): readonly NamedEntry[] {
    return this.catalog.workspaces;
  }

  private personalEntries(agentId: string): readonly NamedEntry[] {
    return (
      this.catalog.sources.agents.find((agent) => agent.id === agentId)
        ?.availability.personalChoices ?? []
    );
  }

  private interpreterEntries(
    target: AgentPlanExecutionTarget,
  ): readonly NamedEntry[] {
    return (this.catalog.sources.interpreters ?? []).filter((profile) =>
      target.kind === "remote"
        ? profile.runnerWorkspaceId === target.workspaceId
        : !profile.runnerWorkspaceId,
    );
  }

  private remoteEntries(): readonly NamedEntry[] {
    return (this.catalog.sources.remoteTargets ?? []).map((target) => ({
      id: target.workspaceId,
      name: target.workspaceName,
    }));
  }

  private ticketEntries(): readonly NamedEntry[] {
    return this.catalog.sources.tasks.map((task) => ({
      id: task.id,
      name: task.key,
    }));
  }

  private wikiEntries(): readonly NamedEntry[] {
    return this.catalog.wikiPages.map((page) => ({
      id: page.id,
      name: page.title,
    }));
  }

  private targetModels(
    target: AgentPlanExecutionTarget,
  ): readonly PageAgentModel[] {
    return planTargetModels(this.catalog.sources.models ?? [], target);
  }

  private modelEntries(
    target: AgentPlanExecutionTarget,
    provider: string | null,
  ): readonly NamedEntry[] {
    return this.targetModels(target)
      .filter((model) => provider === null || model.provider === provider)
      .map((model) => ({
        id: model.id,
        name: model.model,
        aliases: [model.name, ...(model.modelName ? [model.modelName] : [])],
      }));
  }
}
