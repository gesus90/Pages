import type {
  AgentStructuredLink,
  AgentStructuredManifest,
  AgentStructuredMilestone,
  AgentStructuredProject,
  AgentStructuredSource,
  AgentStructuredTicket,
  AgentStructuredWikiSource,
  AgentStructuredWikiTarget,
} from "@/definition/AgentStructuredImportManifest";

/** The project source every synthetic manifest hangs its objects on. */
export function projectSource(
  key = "main",
  projectId = "project-1",
): AgentStructuredProject {
  return { kind: "project", key, projectId };
}

/** A ticket source with a valid title in the given project. */
export function ticketSource(
  key: string,
  type: AgentStructuredTicket["type"] = "task",
  fields: Partial<AgentStructuredTicket> = {},
): AgentStructuredTicket {
  return {
    kind: "ticket",
    key,
    project: "main",
    type,
    title: `Ticket ${key}`,
    description: "",
    ...fields,
  };
}

/** A milestone source with a valid name in the given project. */
export function milestoneSource(
  key: string,
  fields: Partial<AgentStructuredMilestone> = {},
): AgentStructuredMilestone {
  return {
    kind: "milestone",
    key,
    project: "main",
    name: `Milestone ${key}`,
    description: "",
    startAt: null,
    dueAt: null,
    ...fields,
  };
}

/** A Markdown page source. */
export function wikiSource(
  key: string,
  content = `# ${key}\n`,
  title?: string,
): AgentStructuredWikiSource {
  return {
    kind: "wiki",
    key,
    content,
    ...(title === undefined ? {} : { title }),
  };
}

/** Assembles a validated manifest from its parts. */
export function manifestOf(
  sources: readonly AgentStructuredSource[],
  parts: {
    readonly links?: readonly AgentStructuredLink[];
    readonly assets?: AgentStructuredManifest["assets"];
    readonly wiki?: AgentStructuredWikiTarget | null;
  } = {},
): AgentStructuredManifest {
  return {
    version: "1",
    sources,
    links: parts.links ?? [],
    assets: parts.assets ?? [],
    wiki: parts.wiki ?? null,
  };
}
