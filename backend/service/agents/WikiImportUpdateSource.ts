import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { WikiPageService } from "@/backend/service/wiki/WikiPageService";
import {
  normalizeTitle,
  validateContent,
} from "@/backend/service/wiki/WikiValidation";
import { WIKI_SCOPE } from "@/definition/Wiki";

import { wikiImportSourceFingerprint } from "./WikiImportPackage";
import {
  diagnoseWikiImportSource,
  wikiImportErrorCode,
} from "./WikiImportSourceService";

import type { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import type { StoredAgentImportSource } from "@/backend/database/repositories/agents/AgentImportRepository";
import type { WikiPageRecord } from "@/backend/database/repositories/WikiRepository";
import type { AgentImportPlan } from "@/definition/AgentImportManifest";
import type {
  AgentImportUpdateEntry,
  AgentImportUpdateInput,
  AgentImportUpdateItem,
  AgentImportUpdateReason,
} from "@/definition/AgentImportUpdate";
import type { PagesAgentApiErrorCode } from "@/definition/PagesAgentApi";
import type { AgentWikiCreated } from "@/definition/PagesAgentWrites";
import type { WikiImportContext } from "./WikiImportContext";
import type { WikiImportSource } from "./WikiImportPackage";

/** What every source of one update package shares, on the package's single transaction. */
export interface WikiImportUpdateScope {
  readonly context: WikiImportContext;
  readonly repository: AgentImportRepository;
  readonly plan: AgentImportPlan;
  readonly input: AgentImportUpdateInput;
  /** Stored as the source's last operation; update packages create no import run. */
  readonly marker: string;
}

/** Everything compared for one source and its mapped page. */
interface UpdateTarget {
  readonly source: WikiImportSource;
  readonly entry: AgentImportUpdateEntry;
  readonly mapping: StoredAgentImportSource;
  readonly page: WikiPageRecord;
  readonly title: string;
  readonly content: string;
  readonly hash: string;
}

type ItemFields = Pick<AgentImportUpdateItem, "action" | "reason"> &
  Partial<
    Pick<AgentImportUpdateItem, "pageId" | "link" | "revision" | "errorCode">
  >;

function item(
  source: WikiImportSource,
  fields: ItemFields,
): AgentImportUpdateItem {
  return {
    sourceKey: source.sourceKey,
    targetKey: source.targetKey,
    pageId: null,
    link: null,
    revision: null,
    errorCode: null,
    ...fields,
  };
}

function pageItem(
  source: WikiImportSource,
  page: { readonly id: string; readonly revision: number },
  fields: ItemFields,
): AgentImportUpdateItem {
  return item(source, {
    pageId: page.id,
    link: `/wiki/${page.id}`,
    revision: page.revision,
    ...fields,
  });
}

function conflict(
  target: UpdateTarget,
  reason: AgentImportUpdateReason,
): AgentImportUpdateItem {
  return pageItem(target.source, target.page, {
    action: "conflict",
    reason,
    errorCode: "CONFLICT",
  });
}

function rejection(
  source: WikiImportSource,
  code: PagesAgentApiErrorCode,
): AgentImportUpdateItem {
  const reasons: Partial<
    Record<PagesAgentApiErrorCode, AgentImportUpdateReason>
  > = {
    NOT_FOUND: "page_unavailable",
    FORBIDDEN: "not_permitted",
    CONFLICT: "plan_conflict",
  };
  return item(source, {
    action: code === "CONFLICT" ? "conflict" : "failed",
    reason: reasons[code] ?? "invalid_source",
    errorCode: code,
  });
}

/**
 * Compares text without line-ending and byte-order-mark differences, so a source read on another
 * platform is not reported as changed. The stored page text is never rewritten for this alone.
 */
function comparableMarkdown(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function linkedAssetIds(mapping: StoredAgentImportSource): string[] {
  // This JSON is written by the creating import with the A9.6 result schema.
  const created = JSON.parse(mapping.resultJson) as AgentWikiCreated;
  return created.assets.map((asset) => asset.assetId).sort();
}

async function locate(
  scope: WikiImportUpdateScope,
  source: WikiImportSource,
): Promise<UpdateTarget | AgentImportUpdateItem> {
  const { context, repository, plan, input } = scope;
  const entry = input.updates.find(
    (update) => update.sourceKey === source.sourceKey,
  );
  const file = input.manifest.files.find(
    (candidate) => candidate.sourceKey === source.sourceKey,
  );
  const parent = plan.edges.find(
    (edge) => edge.childKey === source.targetKey,
  )?.parent;
  if (!entry || !file || !parent || !source.page)
    throw new AgentOperationError("INVALID_REQUEST");
  diagnoseWikiImportSource(plan, source);
  const mapping = await repository.findSource(
    input.projectId,
    source.sourceKey,
  );
  // An unmapped page with the same title is never adopted: only the stored mapping identifies a target.
  if (!mapping)
    return item(source, {
      action: "failed",
      reason: "not_imported",
      errorCode: "NOT_FOUND",
    });
  if (mapping.targetKind !== "wiki") throw new AgentOperationError("CONFLICT");
  const page = await new WikiPageReader(context.wiki).require(
    context.viewer.scope,
    mapping.targetId,
  );
  if (page.projectId !== input.projectId || page.scope !== WIKI_SCOPE.PROJECT)
    throw new AgentOperationError("NOT_FOUND");
  return {
    source,
    entry,
    mapping,
    page,
    title: normalizeTitle(source.page.title),
    content: validateContent(file.content),
    hash: wikiImportSourceFingerprint(
      {
        ...input,
        assets: [
          { sourceKey: source.sourceKey, assetIds: linkedAssetIds(mapping) },
        ],
      },
      source,
      parent,
    ),
  };
}

async function hasSiblingTitle(
  scope: WikiImportUpdateScope,
  target: UpdateTarget,
): Promise<boolean> {
  if (target.title === target.page.title) return false;
  const siblings = await scope.context.wiki.pages.listProjectChildren(
    scope.context.viewer.scope,
    scope.input.projectId,
    target.page.parentId,
  );
  return siblings.some(
    (sibling) =>
      sibling.id !== target.page.id && sibling.title === target.title,
  );
}

async function refresh(
  scope: WikiImportUpdateScope,
  target: UpdateTarget,
  targetRevision: number,
): Promise<void> {
  await scope.repository.refreshSource({
    projectId: scope.input.projectId,
    sourceKey: target.source.sourceKey,
    contentHash: target.hash,
    targetRevision,
    lastRunId: scope.marker,
  });
}

async function decide(
  scope: WikiImportUpdateScope,
  target: UpdateTarget,
): Promise<AgentImportUpdateItem> {
  const { context } = scope;
  const { source, entry, mapping, page } = target;
  if (page.isTemplate) return conflict(target, "template");
  if (entry.expectedRevision !== page.revision)
    return conflict(target, "stale_revision");
  const hasManualChange = page.revision !== mapping.targetRevision;
  if (
    page.title === target.title &&
    comparableMarkdown(page.content) === comparableMarkdown(target.content)
  ) {
    // Nothing to write. A baseline left behind by a manual edit that equals the source moves up.
    if (hasManualChange || mapping.contentHash !== target.hash)
      await refresh(scope, target, page.revision);
    return pageItem(source, page, { action: "skipped", reason: "unchanged" });
  }
  if (hasManualChange && !entry.overwrite)
    return conflict(target, "manual_change");
  if (await hasSiblingTitle(scope, target))
    return conflict(target, "title_conflict");
  // Placement and icon stay as they are; every save keeps the previous text as its own version.
  const written = await new WikiPageService(
    context.wiki,
    context.access,
  ).update(context.actor, page.id, {
    title: target.title,
    content: target.content,
    icon: page.icon,
    expectedRevision: page.revision,
    coalesceVersions: false,
  });
  await refresh(scope, target, written.revision);
  return pageItem(source, written, {
    action: "updated",
    reason: hasManualChange ? "overwritten" : "source_changed",
  });
}

/**
 * Brings one imported page up to date with its source, or reports why it was left alone.
 *
 * @param scope - Package state on its transaction connection.
 * @param source - A loaded Markdown source of the confirmed package.
 * @returns The outcome. A conflict or failure never writes; infrastructure errors propagate and roll the package back.
 *
 * @remarks
 * The page is found only through the stored source mapping. Text changed in Pages after the
 * import is replaced only when the entry explicitly asks to overwrite; the replaced text stays
 * available in the page versions.
 */
export async function updateWikiImportSource(
  scope: WikiImportUpdateScope,
  source: WikiImportSource,
): Promise<AgentImportUpdateItem> {
  try {
    const target = await locate(scope, source);
    return "action" in target ? target : await decide(scope, target);
  } catch (error: unknown) {
    const code = wikiImportErrorCode(error);
    if (!code || code === "AUTH_INVALID" || code === "AUTH_UNAVAILABLE")
      throw error;
    return rejection(source, code);
  }
}
