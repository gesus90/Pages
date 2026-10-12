import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";

import { createAgentWikiAccess } from "./AgentWikiAccess";

import type {
  AgentMilestoneReference,
  AgentTag,
  AgentWikiPageReference,
} from "@/definition/AgentExtensions";
import type { WorkItemDetail } from "@/definition/Task";
import type { AgentTaskContext } from "./AgentTaskAccess";

/**
 * Reads the tags of tickets the caller already may see.
 *
 * @param context - The services of the call.
 * @param ticketIds - Visible tickets.
 * @returns The tags of each ticket; a ticket without tags is absent.
 */
export async function readAgentTicketTags(
  context: AgentTaskContext,
  ticketIds: readonly string[],
): Promise<ReadonlyMap<string, readonly AgentTag[]>> {
  const labels = await context.tasks.findLabelsForWorkItems(ticketIds);
  return new Map(
    [...labels].map(([id, entries]) => [
      id,
      entries.map(({ id: tagId, name, color }) => ({ id: tagId, name, color })),
    ]),
  );
}

/**
 * Reads the milestones each visible initiative of a project is linked with.
 *
 * @param context - The services of the call.
 * @param projectId - A project the account may see.
 * @returns The milestones by initiative, and the visible initiatives by milestone.
 */
export async function readAgentInitiativeLinks(
  context: AgentTaskContext,
  projectId: string,
): Promise<{
  readonly milestonesByInitiative: ReadonlyMap<
    string,
    readonly AgentMilestoneReference[]
  >;
  readonly initiativesByMilestone: ReadonlyMap<string, readonly string[]>;
}> {
  const [links, milestones] = await Promise.all([
    context.tasks.findMilestoneInitiatives(context.actor, [projectId]),
    context.tasks.findMilestones(context.actor, [projectId]),
  ]);
  const milestonesByInitiative = new Map<string, AgentMilestoneReference[]>();
  const initiativesByMilestone = new Map<string, string[]>();
  for (const link of links) {
    const milestone = milestones.find(({ id }) => id === link.milestoneId);
    if (!milestone) continue;
    milestonesByInitiative.set(link.initiativeId, [
      ...(milestonesByInitiative.get(link.initiativeId) ?? []),
      { id: milestone.id, name: milestone.name },
    ]);
    initiativesByMilestone.set(link.milestoneId, [
      ...(initiativesByMilestone.get(link.milestoneId) ?? []),
      link.initiativeId,
    ]);
  }
  return { milestonesByInitiative, initiativesByMilestone };
}

/**
 * Reads the wiki pages tied to milestones or epics, as far as the account sees them.
 *
 * @param context - The services of the call.
 * @param kind - Whether the targets are milestones or epics.
 * @param targetIds - Targets the account may see.
 * @returns The visible pages by target; a target without visible pages is absent.
 */
export async function readAgentAnchoredPages(
  context: AgentTaskContext,
  kind: "milestone" | "epic",
  targetIds: readonly string[],
): Promise<ReadonlyMap<string, readonly AgentWikiPageReference[]>> {
  const source = agentChannelPolicy(context.channel).source;
  const wiki = new WikiRepository(context.database, source);
  const viewer = await createAgentWikiAccess(
    new ProjectRepository(context.database, source),
    context.actor,
    context.channel,
  ).resolve(context.actor);
  const found = await wiki.anchors.findPageIdsByTargets(kind, targetIds);
  const pages = new Map<string, readonly AgentWikiPageReference[]>();
  for (const [targetId, pageIds] of found) {
    const visible: AgentWikiPageReference[] = [];
    for (const pageId of pageIds) {
      const page = await wiki.pages.findVisible(viewer.scope, pageId);
      if (page) visible.push({ id: page.id, title: page.title });
    }
    if (visible.length > 0) pages.set(targetId, visible);
  }
  return pages;
}

/**
 * Reads what one ticket is linked with beyond its parent and milestone.
 *
 * @param context - The services of the call.
 * @param ticket - A ticket the account may see.
 * @returns The milestones of an initiative, the wiki pages of an epic, nothing else.
 */
export async function readAgentTicketLinks(
  context: AgentTaskContext,
  ticket: WorkItemDetail,
): Promise<{
  readonly linkedMilestones?: readonly AgentMilestoneReference[];
  readonly wikiPages?: readonly AgentWikiPageReference[];
}> {
  if (ticket.type === "initiative") {
    const links = await readAgentInitiativeLinks(context, ticket.projectId);
    return {
      linkedMilestones: links.milestonesByInitiative.get(ticket.id) ?? [],
    };
  }
  if (ticket.type === "epic") {
    const pages = await readAgentAnchoredPages(context, "epic", [ticket.id]);
    return { wikiPages: pages.get(ticket.id) ?? [] };
  }
  return {};
}

/**
 * Counts the visible active epics, tasks and subtasks below a ticket.
 *
 * @param context - The services of the call.
 * @param ticket - A ticket the account may see.
 * @returns The number a deletion moves to the archive together with the ticket.
 */
export async function countAgentDescendants(
  context: AgentTaskContext,
  ticket: WorkItemDetail,
): Promise<number> {
  if (ticket.type === "subtask") return 0;
  const tickets = await context.tasks.findAll(context.actor, {
    projectIds: [ticket.projectId],
  });
  const children = new Map<string, string[]>();
  for (const { id, parentId } of tickets)
    if (parentId !== null)
      children.set(parentId, [...(children.get(parentId) ?? []), id]);
  let count = 0;
  const queue = [ticket.id];
  for (let id = queue.pop(); id !== undefined; id = queue.pop())
    for (const child of children.get(id) ?? []) {
      count += 1;
      queue.push(child);
    }
  return count;
}
