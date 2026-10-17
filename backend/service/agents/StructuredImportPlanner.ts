import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { validateMilestoneInput } from "@/backend/service/MilestoneValidation";
import { validateWorkItemText } from "@/backend/service/task/WorkItemValidation";
import { WORK_ITEM_PARENT_TYPE } from "@/definition/Task";
import { logCaughtError } from "@/backend/logging/Logger";

import { isStructuredKey } from "./StructuredImportManifestReader";

import type {
  AgentStructuredEdge,
  AgentStructuredIssue,
  AgentStructuredLink,
  AgentStructuredManifest,
  AgentStructuredMilestone,
  AgentStructuredProject,
  AgentStructuredReason,
  AgentStructuredSource,
  AgentStructuredTicket,
} from "@/definition/AgentStructuredImportManifest";
import type { AgentMilestoneLinkType } from "@/definition/AgentTickets";

/** The parts every step shares. */
interface StepBase {
  /** Plan key and mapping key at once: `milestone:<key>`, `ticket:<key>` or `dependency:<…>`. */
  readonly key: string;
  /** The key of the source in the manifest. */
  readonly name: string;
  /** Key of the project source the object belongs to. */
  readonly project: string;
  readonly label: string;
}

/** A milestone to create. */
export interface StructuredMilestoneStep extends StepBase {
  readonly kind: "milestone";
}

/** A ticket to create. */
export interface StructuredTicketStep extends StepBase {
  readonly kind: "ticket";
}

/** A milestone or a ticket to create. */
export type StructuredObjectStep =
  StructuredMilestoneStep | StructuredTicketStep;

/** A dependency between two milestones of the manifest. */
export interface StructuredDependencyStep extends StepBase {
  readonly kind: "dependency";
  readonly from: string;
  readonly to: string;
  readonly linkType: AgentMilestoneLinkType;
}

/** One object that is not a wiki page, in the order the import applies it. */
export type StructuredStep = StructuredObjectStep | StructuredDependencyStep;

/** The graph of a manifest: what to apply in which order, and why a manifest cannot be applied. */
export interface StructuredImportGraph {
  readonly sources: StructuredSources;
  readonly errors: readonly AgentStructuredIssue[];
  readonly edges: readonly AgentStructuredEdge[];
  readonly steps: readonly StructuredStep[];
  /** Child ticket key to parent ticket key. */
  readonly parents: ReadonlyMap<string, string>;
  /** Ticket key to milestone key. */
  readonly milestones: ReadonlyMap<string, string>;
}

/** The plan and mapping key of a source that is not a wiki page. */
export function structuredKey(
  kind: "project" | "milestone" | "ticket",
  key: string,
): string {
  return `${kind}:${key}`;
}

/** The plan and mapping key of a dependency between two milestone sources. */
export function dependencyKey(
  from: string,
  to: string,
  linkType: AgentMilestoneLinkType,
): string {
  return `dependency:${from}>${to}:${linkType}`;
}

function issue(
  reason: AgentStructuredReason,
  keys: readonly string[],
  code: AgentStructuredIssue["code"] = "INVALID_REQUEST",
): AgentStructuredIssue {
  return { code, reason, keys };
}

/** The project, milestone and ticket sources of a manifest by key. */
export interface StructuredSources {
  readonly projects: ReadonlyMap<string, AgentStructuredProject>;
  readonly milestones: ReadonlyMap<string, AgentStructuredMilestone>;
  readonly tickets: ReadonlyMap<string, AgentStructuredTicket>;
}

type Index = StructuredSources;

function addSource<Source extends { readonly key: string }>(
  group: Map<string, Source>,
  source: Source,
  planKey: string,
  errors: AgentStructuredIssue[],
): void {
  if (group.has(source.key)) errors.push(issue("duplicate_key", [planKey]));
  else group.set(source.key, source);
}

/** Collects the three non-wiki kinds by key and reports invalid and repeated keys. */
function indexSources(
  sources: readonly AgentStructuredSource[],
  errors: AgentStructuredIssue[],
): Index {
  const index = {
    projects: new Map<string, AgentStructuredProject>(),
    milestones: new Map<string, AgentStructuredMilestone>(),
    tickets: new Map<string, AgentStructuredTicket>(),
  };
  for (const source of sources) {
    if (source.kind === "wiki") continue;
    const planKey = structuredKey(source.kind, source.key);
    if (!isStructuredKey(source.key))
      errors.push(issue("invalid_key", [planKey]));
    else if (source.kind === "project")
      addSource(index.projects, source, planKey, errors);
    else if (source.kind === "milestone")
      addSource(index.milestones, source, planKey, errors);
    else addSource(index.tickets, source, planKey, errors);
  }
  return index;
}

function checkProject(
  source: AgentStructuredMilestone | AgentStructuredTicket,
  index: Index,
  errors: AgentStructuredIssue[],
): void {
  const planKey = structuredKey(source.kind, source.key);
  if (source.project === "") errors.push(issue("project_required", [planKey]));
  else if (!index.projects.has(source.project))
    errors.push(issue("unknown_project", [planKey]));
}

/** Runs the field rules of the ticket and milestone services, so a dry-run fails where an import would. */
function checkFields(index: Index, errors: AgentStructuredIssue[]): void {
  for (const ticket of index.tickets.values()) {
    checkProject(ticket, index, errors);
    try {
      validateWorkItemText(ticket.title.trim(), ticket.description.trim());
    } catch (error: unknown) {
      logCaughtError("StructuredImportPlanner", error);

      if (!(error instanceof WorkItemValidationError)) throw error;
      errors.push(
        issue("invalid_field", [structuredKey("ticket", ticket.key)]),
      );
    }
  }
  for (const milestone of index.milestones.values()) {
    checkProject(milestone, index, errors);
    try {
      validateMilestoneInput({
        name: milestone.name,
        startAt: milestone.startAt,
        dueAt: milestone.dueAt,
      });
    } catch (error: unknown) {
      logCaughtError("StructuredImportPlanner", error);

      if (!(error instanceof WorkItemValidationError)) throw error;
      errors.push(
        issue("invalid_field", [structuredKey("milestone", milestone.key)]),
      );
    }
  }
}

type Ticket = AgentStructuredTicket;
type Milestone = AgentStructuredMilestone;
type Dependency = Extract<AgentStructuredLink, { type: "dependency" }> & {
  readonly project: string;
};

interface Links {
  readonly parents: Map<string, string>;
  readonly milestones: Map<string, string>;
  readonly dependencies: Dependency[];
  readonly edges: AgentStructuredEdge[];
}

function dependencyEdge(
  link: Extract<AgentStructuredLink, { type: "dependency" }>,
): AgentStructuredEdge {
  return {
    type: "dependency",
    from: structuredKey("milestone", link.from),
    to: structuredKey("milestone", link.to),
    linkType: link.linkType,
  };
}

/** Looks up the two ends of a link in the kinds the link type connects. */
function linkEnds(
  link: AgentStructuredLink,
  index: Index,
): {
  readonly from: Ticket | Milestone | undefined;
  readonly to: Ticket | Milestone | undefined;
  readonly keys: readonly [string, string];
} {
  const fromKind = link.type === "dependency" ? "milestone" : "ticket";
  const toKind = link.type === "parent" ? "ticket" : "milestone";
  return {
    from: (fromKind === "ticket" ? index.tickets : index.milestones).get(
      link.from,
    ),
    to: (toKind === "ticket" ? index.tickets : index.milestones).get(link.to),
    keys: [structuredKey(fromKind, link.from), structuredKey(toKind, link.to)],
  };
}

/** Resolves every link to two existing sources of the right kind and applies the link rules. */
function readLinks(
  manifest: AgentStructuredManifest,
  index: Index,
  errors: AgentStructuredIssue[],
): Links {
  const links: Links = {
    parents: new Map(),
    milestones: new Map(),
    dependencies: [],
    edges: [],
  };
  const pairs = new Set<string>();
  for (const link of manifest.links) {
    const { from, to, keys } = linkEnds(link, index);
    if (!from || !to) errors.push(issue("missing_reference", keys));
    else if (link.from === link.to && from.kind === to.kind)
      errors.push(issue("self_reference", keys));
    else if (from.project !== to.project) {
      if (from.project !== "" && to.project !== "")
        errors.push(issue("project_mismatch", keys));
    } else if (link.type === "dependency") {
      const pair = [link.from, link.to].sort().join(">");
      if (pairs.has(pair)) errors.push(issue("duplicate_link", keys));
      else {
        pairs.add(pair);
        links.dependencies.push({ ...link, project: from.project });
        links.edges.push(dependencyEdge(link));
      }
    } else {
      const target = link.type === "parent" ? links.parents : links.milestones;
      if (target.has(link.from)) errors.push(issue("duplicate_link", keys));
      else {
        target.set(link.from, link.to);
        links.edges.push({ type: link.type, from: keys[0], to: keys[1] });
      }
    }
  }
  return links;
}

/** A child may only hang below the type its own type allows; a subtask needs a parent at all. */
function checkHierarchy(
  index: Index,
  links: Links,
  errors: AgentStructuredIssue[],
): void {
  for (const ticket of index.tickets.values()) {
    const parentKey = links.parents.get(ticket.key);
    const planKey = structuredKey("ticket", ticket.key);
    if (parentKey === undefined) {
      if (ticket.type === "subtask")
        errors.push(issue("parent_required", [planKey]));
      continue;
    }
    const parent = index.tickets.get(parentKey);
    if (parent && WORK_ITEM_PARENT_TYPE[ticket.type] !== parent.type)
      errors.push(
        issue("parent_type", [planKey, structuredKey("ticket", parentKey)]),
      );
  }
}

/** Finds the keys of every cycle of a directed graph; each one is reported once. */
function findCycles(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const visit = (node: string): void => {
    state.set(node, "open");
    path.push(node);
    for (const next of edges.get(node) ?? []) {
      const seen = state.get(next);
      if (seen === "open") cycles.push(path.slice(path.indexOf(next)));
      else if (seen === undefined) visit(next);
    }
    path.pop();
    state.set(node, "done");
  };
  for (const node of [...edges.keys()].sort())
    if (!state.has(node)) visit(node);
  return cycles;
}

function checkCycles(links: Links, errors: AgentStructuredIssue[]): void {
  const hierarchy = new Map<string, string[]>();
  for (const [child, parent] of links.parents) hierarchy.set(child, [parent]);
  for (const cycle of findCycles(hierarchy))
    errors.push(
      issue(
        "cycle",
        cycle.map((key) => structuredKey("ticket", key)),
      ),
    );
  for (const linkType of ["prerequisite", "follows", "blocks"] as const) {
    const graph = new Map<string, string[]>();
    for (const dependency of links.dependencies)
      if (dependency.linkType === linkType)
        graph.set(dependency.from, [
          ...(graph.get(dependency.from) ?? []),
          dependency.to,
        ]);
    for (const cycle of findCycles(graph))
      errors.push(
        issue(
          "cycle",
          cycle.map((key) => structuredKey("milestone", key)),
        ),
      );
  }
}

/** Distance of a ticket from the top of its hierarchy; a cycle gets a depth that never loops. */
function depthOf(key: string, parents: ReadonlyMap<string, string>): number {
  let depth = 0;
  let current = parents.get(key);
  const seen = new Set<string>([key]);
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = parents.get(current);
  }
  return depth;
}

function buildSteps(index: Index, links: Links): readonly StructuredStep[] {
  const steps: StructuredStep[] = [];
  for (const milestone of index.milestones.values())
    steps.push({
      kind: "milestone",
      key: structuredKey("milestone", milestone.key),
      name: milestone.key,
      project: milestone.project,
      label: milestone.name.trim(),
    });
  const tickets = [...index.tickets.values()]
    .map((ticket, position) => ({
      ticket,
      position,
      depth: depthOf(ticket.key, links.parents),
    }))
    // Parents first; within one depth the manifest order stays.
    .sort(
      (left, right) =>
        left.depth - right.depth || left.position - right.position,
    );
  for (const { ticket } of tickets)
    steps.push({
      kind: "ticket",
      key: structuredKey("ticket", ticket.key),
      name: ticket.key,
      project: ticket.project,
      label: ticket.title.trim(),
    });
  for (const dependency of links.dependencies) {
    steps.push({
      kind: "dependency",
      key: dependencyKey(dependency.from, dependency.to, dependency.linkType),
      name: dependency.from,
      from: dependency.from,
      to: dependency.to,
      linkType: dependency.linkType,
      project: dependency.project,
      label: `${dependency.from} ${dependency.linkType} ${dependency.to}`,
    });
  }
  return steps;
}

/**
 * Orders a structured manifest and finds what makes it unusable, without
 * reading a single target.
 *
 * @param manifest - The validated manifest.
 * @returns Milestones first, then tickets with parents before children, then
 * dependencies, plus every missing reference, cycle and rule violation.
 *
 * @remarks
 * Nothing here depends on the database, so the same manifest always yields the
 * same order and the same errors. Wiki pages and assets are planned elsewhere.
 */
export function planStructuredImport(
  manifest: AgentStructuredManifest,
): StructuredImportGraph {
  const errors: AgentStructuredIssue[] = [];
  const index = indexSources(manifest.sources, errors);
  checkFields(index, errors);
  const links = readLinks(manifest, index, errors);
  checkHierarchy(index, links, errors);
  checkCycles(links, errors);
  if (manifest.wiki !== null && !index.projects.has(manifest.wiki.project))
    errors.push(
      issue(
        manifest.wiki.project === "" ? "project_required" : "unknown_project",
        ["wiki"],
      ),
    );
  if (
    manifest.wiki === null &&
    manifest.sources.some((source) => source.kind === "wiki")
  )
    errors.push(issue("wiki_target_required", ["wiki"]));
  return {
    sources: index,
    errors,
    edges: links.edges,
    steps: buildSteps(index, links),
    parents: links.parents,
    milestones: links.milestones,
  };
}
