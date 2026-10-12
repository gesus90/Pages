import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { unified } from "unified";
import remarkParse from "remark-parse";

import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { extractWikiLinks } from "@/backend/service/wiki/WikiLinks";

import { pageAgentEntries } from "./AgentCursor";
import { readAgentDirectory } from "./AgentDirectoryService";
import { readIdentifier } from "./AgentParameterReader";
import { createAgentWikiAccess } from "./AgentWikiAccess";
import { readWikiPageReference } from "./AgentWikiFieldValidation";

import type {
  AgentExtensionReadOperation,
  AgentExtensionReadResult,
  AgentWikiHeading,
} from "@/definition/AgentExtensions";
import type { AgentTaskContext } from "./AgentTaskAccess";
import type { RootContent, PhrasingContent } from "mdast";

function headingText(node: PhrasingContent): string {
  if ("value" in node) return node.value;
  return "children" in node ? node.children.map(headingText).join("") : "";
}

function headingsOf(nodes: readonly RootContent[]): AgentWikiHeading[] {
  return nodes.flatMap((node) => {
    if (node.type === "heading")
      return [
        {
          id: String(node.position?.start.offset).padStart(10, "0"),
          level: node.depth,
          text: node.children.map(headingText).join(""),
        },
      ];
    if (node.type === "blockquote" || node.type === "listItem")
      return headingsOf(node.children);
    if (node.type === "list")
      return node.children.flatMap((item) => headingsOf(item.children));
    return [];
  });
}

/** Projects additional visible directory, wiki and project data into explicit wire contracts. */
export async function readAgentExtension(
  context: AgentTaskContext,
  operation: AgentExtensionReadOperation,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentExtensionReadResult> {
  const window = {
    cursor: parameters.cursor,
    limit: parameters.limit,
    context: JSON.stringify([
      context.actor.id,
      operation,
      parameters.projectId,
      parameters.pageId,
    ]),
  };
  if (operation === "wiki.outline.read" || operation === "wiki.links.read")
    return readWikiStructure(context, operation, parameters);
  if (operation === "tags.list") {
    // The catalog is one for the whole instance; it carries no visibility of its own.
    const catalog = await context.tasks.findLabels();
    const page = pageAgentEntries(
      catalog.map(({ id, name, color }) => ({ id, name, color })),
      { ...window, preserveOrder: true },
    );
    return {
      tags: page.entries,
      total: page.total,
      nextCursor: page.nextCursor,
    };
  }
  const directory = await readAgentDirectory(context);
  if (operation === "people.visible.list") {
    const page = pageAgentEntries(directory.people, window);
    return {
      people: page.entries,
      total: page.total,
      nextCursor: page.nextCursor,
    };
  }
  if (operation === "departments.list" || operation === "groups.list") {
    const page = pageAgentEntries(
      operation === "departments.list"
        ? directory.departments
        : directory.groups.map(({ id, name }) => ({ id, name })),
      window,
    );
    return page;
  }
  const projectId = readIdentifier(parameters.projectId);
  const project = await context.projects.getById(context.actor, projectId);
  if (operation === "projects.activity.read") {
    const page = pageAgentEntries(
      (await context.projects.findActivity(context.actor, projectId)).map(
        (entry) => ({ id: `${entry.createdAt}:${entry.id}`, entry }),
      ),
      window,
    );
    return {
      projectId,
      entries: page.entries.map(({ entry }) => {
        const actor = directory.people.find(
          (person) => person.id === entry.userId,
        );
        return {
          id: entry.id,
          projectId: entry.projectId,
          category: entry.category,
          action: entry.action,
          message: entry.message,
          createdAt: entry.createdAt,
          source: entry.source,
          ...(actor ? { actor } : {}),
        };
      }),
      total: page.total,
      nextCursor: page.nextCursor,
    };
  }
  if (operation !== "projects.members.read")
    throw new AgentOperationError("INVALID_REQUEST");
  const members = await context.projects.findMembers(context.actor, projectId);
  const page = pageAgentEntries(
    directory.people.flatMap((person) => {
      const member = members.find(({ userId }) => userId === person.id);
      return member ? [{ ...person, role: member.projectRole }] : [];
    }),
    window,
  );
  return {
    projectId,
    members: page.entries,
    departments: project.departments.filter(({ id }) =>
      directory.departments.some((department) => department.id === id),
    ),
    total: page.total,
    nextCursor: page.nextCursor,
  };
}

async function readWikiStructure(
  context: AgentTaskContext,
  operation: "wiki.outline.read" | "wiki.links.read",
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentExtensionReadResult> {
  const source = agentChannelPolicy(context.channel).source;
  const wiki = new WikiRepository(context.database, source);
  const access = createAgentWikiAccess(
    new ProjectRepository(context.database, source),
    context.actor,
    context.channel,
  );
  const viewer = await access.resolve(context.actor);
  const page = await new WikiPageReader(wiki).require(
    viewer.scope,
    readWikiPageReference(parameters.pageId),
  );
  const window = {
    cursor: parameters.cursor,
    limit: parameters.limit,
    context: JSON.stringify([context.actor.id, operation, page.id]),
  };
  if (operation === "wiki.outline.read") {
    const result = pageAgentEntries(
      headingsOf(unified().use(remarkParse).parse(page.content).children),
      window,
    );
    return {
      pageId: page.id,
      revision: page.revision,
      headings: result.entries,
      total: result.total,
      nextCursor: result.nextCursor,
    };
  }
  const outgoing = [];
  for (const id of extractWikiLinks(page.content).pageIds) {
    const linked = await wiki.pages.findVisible(viewer.scope, id);
    if (linked) outgoing.push({ id, title: linked.title });
  }
  const incoming = (
    await wiki.links.findLinkingPages(viewer.scope, page.id)
  ).map(({ id, title }) => ({ id, title }));
  const selected = pageAgentEntries(
    [
      ...outgoing.map((link) => ({
        ...link,
        id: `out:${link.id}`,
        pageId: link.id,
      })),
      ...incoming.map((link) => ({
        ...link,
        id: `in:${link.id}`,
        pageId: link.id,
      })),
    ],
    window,
  );
  return {
    pageId: page.id,
    outgoing: selected.entries
      .filter(({ id }) => id.startsWith("out:"))
      .map(({ pageId: id, title }) => ({ id, title })),
    incoming: selected.entries
      .filter(({ id }) => id.startsWith("in:"))
      .map(({ pageId: id, title }) => ({ id, title })),
    total: selected.total,
    nextCursor: selected.nextCursor,
  };
}
