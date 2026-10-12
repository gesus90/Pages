import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { recordWikiActivity } from "@/backend/service/wiki/WikiActivity";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { WikiPageService } from "@/backend/service/wiki/WikiPageService";
import { isWikiAnchorKind } from "@/definition/Wiki";

import { readIdentifier, readParameterRecord } from "./AgentParameterReader";
import { createAgentWikiAccess } from "./AgentWikiAccess";
import { readWikiPageReference } from "./AgentWikiFieldValidation";

import type { AgentExtensionChanged } from "@/definition/AgentExtensions";
import type { WikiAnchor } from "@/definition/Wiki";
import type { AgentTaskContext } from "./AgentTaskAccess";

/** Most anchors a page carries after one call. */
const MAXIMUM_ANCHORS = 50;

function anchorKey(anchor: WikiAnchor): string {
  return `${anchor.kind}:${anchor.targetId}`;
}

/** Reads a list of `{kind, targetId}` anchors without duplicates. */
function readAnchors(input: unknown): WikiAnchor[] {
  if (!Array.isArray(input) || input.length > MAXIMUM_ANCHORS)
    throw new AgentOperationError("INVALID_REQUEST");
  const anchors = input.map((item): WikiAnchor => {
    const fields = readParameterRecord(item);
    if (
      Object.keys(fields).length !== 2 ||
      !isWikiAnchorKind(fields.kind) ||
      !("targetId" in fields)
    )
      throw new AgentOperationError("INVALID_REQUEST");
    return { kind: fields.kind, targetId: readIdentifier(fields.targetId) };
  });
  if (new Set(anchors.map(anchorKey)).size !== anchors.length)
    throw new AgentOperationError("INVALID_REQUEST");
  return anchors;
}

function isSameAnchors(
  left: readonly WikiAnchor[],
  right: readonly WikiAnchor[],
): boolean {
  const keys = new Set(right.map(anchorKey));
  return (
    left.length === right.length && left.every((a) => keys.has(anchorKey(a)))
  );
}

/**
 * Replaces the departments, milestones and epics a wiki page is tied to.
 *
 * @param context - The services of the call, bound to its transaction.
 * @param parameters - `pageId`, the new `anchors` and the `expectedAnchors` read before.
 * @returns The page and whether its anchors changed.
 * @throws {AgentOperationError} `NOT_FOUND` for a hidden page, `CONFLICT` when
 * the anchors changed since they were read.
 *
 * @remarks
 * The page service of the interface decides who may tie a page and to which
 * targets, so the same people can do it here and nobody else.
 */
export async function applyAgentWikiAnchors(
  context: AgentTaskContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentExtensionChanged> {
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
  const anchors = readAnchors(parameters.anchors);
  const expected = readAnchors(parameters.expectedAnchors);
  const current = await wiki.anchors.findAnchors(page.id);

  // The stored anchors count as the new ones when someone saved them meanwhile.
  if (!isSameAnchors(expected, current) && !isSameAnchors(anchors, current))
    throw new AgentOperationError("CONFLICT");
  const result = { id: page.id, projectId: page.projectId };
  if (isSameAnchors(anchors, current)) return { ...result, changed: false };
  await new WikiPageService(wiki, access).setAnchors(
    context.actor,
    page.id,
    anchors,
  );
  await recordWikiActivity(
    wiki,
    page,
    context.actor.id,
    "wiki_page_anchors_changed",
  );
  return { ...result, changed: true };
}
