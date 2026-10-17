import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { WIKI_SCOPE } from "@/definition/Wiki";
import { logCaughtError } from "@/backend/logging/Logger";

import { emptyContribution } from "./StructuredImportStepPreview";
import { structuredWikiApplyInput } from "./StructuredImportWiki";
import {
  wikiImportPackage,
  wikiImportSourceFingerprint,
  wikiImportSourceKey,
} from "./WikiImportPackage";

import type { StoredAgentImportSource } from "@/backend/database/repositories/agents/AgentImportRepository";
import type { AgentImportApplyInput } from "@/definition/AgentImportApply";
import type {
  AgentImportParent,
  AgentImportPage,
  AgentImportPlan,
} from "@/definition/AgentImportManifest";
import type {
  AgentStructuredAction,
  AgentStructuredIssue,
  AgentStructuredReason,
} from "@/definition/AgentStructuredImportManifest";
import type { StructuredImportEnvironment } from "./StructuredImportEnvironment";
import type { PreviewContribution } from "./StructuredImportStepPreview";
import type { StructuredWikiPackage } from "./StructuredImportWiki";
import type { WikiImportSource } from "./WikiImportPackage";

/** The A9.7 plan of the wiki part with the package it was planned from. */
export interface StructuredWikiPlan {
  readonly package: StructuredWikiPackage;
  readonly plan: AgentImportPlan;
}

interface PageConflict {
  readonly action: "conflict";
  readonly reason: AgentStructuredReason;
}

interface PageNonConflict {
  readonly action: Exclude<AgentStructuredAction, "conflict">;
  readonly reason: AgentStructuredReason | null;
}

type PageState = PageConflict | PageNonConflict;

interface WikiContext {
  readonly environment: StructuredImportEnvironment;
  readonly projectId: string;
  readonly input: AgentImportApplyInput;
  readonly sources: ReadonlyMap<string, WikiImportSource>;
  readonly mappings: ReadonlyMap<string, StoredAgentImportSource>;
  readonly parents: ReadonlyMap<string, AgentImportParent>;
  readonly issues: Pick<PreviewContribution, "errors" | "conflicts">;
}

function wikiIssues(
  plan: AgentImportPlan,
  mappedPages: ReadonlySet<string>,
): Pick<PreviewContribution, "errors" | "conflicts"> {
  const convert = (
    found: AgentImportPlan["errors"][number],
  ): AgentStructuredIssue => ({
    code: found.code,
    reason: found.reason,
    keys:
      found.targetKey === undefined ? [...found.sourceKeys] : [found.targetKey],
    ...(found.limit === undefined ? {} : { limit: found.limit }),
  });
  return {
    errors: plan.errors.map(convert),
    // A title the import created itself earlier is its own page, not a clash.
    conflicts: plan.conflicts
      .filter(
        (found) =>
          !(
            found.reason === "title_conflict" &&
            found.targetKey !== undefined &&
            mappedPages.has(found.targetKey)
          ),
      )
      .map(convert),
  };
}

function matches(found: AgentStructuredIssue, page: AgentImportPage): boolean {
  return (
    found.keys.includes(page.key) ||
    found.keys.some((key) => page.sourceKeys.includes(key))
  );
}

/** Mirrors the comparison of the A9.8 source service, without writing the outcome. */
async function compareWikiMapping(
  context: WikiContext,
  mapping: StoredAgentImportSource,
  expected: { readonly hash: string; readonly parentId: string | null },
): Promise<PageState> {
  const removed: PageState = { action: "conflict", reason: "target_removed" };
  if (mapping.targetKind !== "wiki") return removed;
  let page;
  try {
    page = await new WikiPageReader(context.environment.wiki).require(
      context.environment.viewer.scope,
      mapping.targetId,
    );
  } catch (error: unknown) {
    logCaughtError("StructuredImportWikiPreview", error);

    if (error instanceof WikiPageNotFoundError) return removed;
    throw error;
  }
  if (page.projectId !== context.projectId || page.scope !== WIKI_SCOPE.PROJECT)
    return removed;
  const isSourceChanged = mapping.contentHash !== expected.hash;
  const isTargetChanged =
    page.revision !== mapping.targetRevision ||
    page.parentId !== expected.parentId ||
    page.isTemplate;
  if (!isSourceChanged && !isTargetChanged)
    return { action: "unchanged", reason: null };
  return {
    action: "conflict",
    reason: isSourceChanged ? "source_changed" : "target_changed",
  };
}

/** What the plan itself says about a page: invalid input, or a conflict other than a title clash. */
function diagnosePage(
  context: WikiContext,
  page: AgentImportPage,
): PageState | null {
  const { errors, conflicts } = context.issues;
  if (errors.some((found) => matches(found, page)))
    return { action: "invalid", reason: null };
  if (
    conflicts.some(
      (found) => found.reason !== "title_conflict" && matches(found, page),
    )
  )
    return { action: "conflict", reason: "source_changed" };
  return null;
}

/** A page nothing is mapped to: a title clash, a parent that will not exist, or a creation. */
function planNewPage(
  context: WikiContext,
  page: AgentImportPage,
  actions: ReadonlyMap<string, AgentStructuredAction>,
): PageState {
  if (
    page.action === "conflict" ||
    context.issues.conflicts.some((found) => matches(found, page))
  )
    return { action: "conflict", reason: "title_conflict" };
  const parent = context.parents.get(page.key);
  if (parent?.kind === "planned") {
    const parentAction = actions.get(parent.key);
    if (parentAction !== "create" && parentAction !== "unchanged")
      return { action: "blocked", reason: "blocked" };
  }
  return { action: "create", reason: null };
}

/** Decides one page in the order the planner lists them: diagnoses first, then the mapping, then creation. */
async function previewPage(
  context: WikiContext,
  page: AgentImportPage,
  state: {
    readonly actions: ReadonlyMap<string, AgentStructuredAction>;
    readonly targets: ReadonlyMap<string, string | null>;
  },
): Promise<PageState> {
  const diagnosed = diagnosePage(context, page);
  if (diagnosed) return diagnosed;
  const mapping = context.mappings.get(page.key);
  if (!mapping) return planNewPage(context, page, state.actions);
  const source = context.sources.get(page.key);
  const parent = context.parents.get(page.key);
  return compareWikiMapping(context, mapping, {
    hash: source
      ? wikiImportSourceFingerprint(
          context.input,
          source,
          parent ?? { kind: "existing", pageId: null },
        )
      : "",
    parentId:
      parent?.kind === "planned"
        ? (state.targets.get(parent.key) ?? null)
        : (parent?.pageId ?? null),
  });
}

/**
 * Plans the pages: A9.7 diagnoses first, then each mapping is compared the way
 * the A9.8 source service compares it.
 *
 * @param environment - Account, rights and repositories of the call.
 * @param wiki - The A9.7 plan of the wiki package.
 * @returns One object and one edge per page, and the issues of the wiki plan.
 */
export async function previewWiki(
  environment: StructuredImportEnvironment,
  wiki: StructuredWikiPlan,
): Promise<PreviewContribution> {
  const { plan } = wiki;
  const projectId = wiki.package.projectId;
  const input = structuredWikiApplyInput(wiki.package, plan.fingerprint);
  const mappings = new Map<string, StoredAgentImportSource>();
  for (const page of plan.pages) {
    const mapping = await environment.imports.findSource(
      projectId,
      wikiImportSourceKey(page),
    );
    if (mapping) mappings.set(page.key, mapping);
  }
  const context: WikiContext = {
    environment,
    projectId,
    input,
    sources: new Map(
      wikiImportPackage(input, plan).map((source) => [
        source.targetKey,
        source,
      ]),
    ),
    mappings,
    parents: new Map(plan.edges.map((edge) => [edge.childKey, edge.parent])),
    issues: wikiIssues(plan, new Set(mappings.keys())),
  };
  const result: PreviewContribution = {
    ...emptyContribution(),
    ...context.issues,
  };
  const actions = new Map<string, AgentStructuredAction>();
  const targets = new Map<string, string | null>();
  for (const page of plan.pages) {
    const decided = await previewPage(context, page, { actions, targets });
    const parent = context.parents.get(page.key);
    const targetId =
      decided.reason === "target_removed"
        ? null
        : (mappings.get(page.key)?.targetId ?? null);
    actions.set(page.key, decided.action);
    targets.set(page.key, targetId);
    result.edges.push({
      type: "wiki_parent",
      from: page.key,
      to:
        parent?.kind === "planned"
          ? parent.key
          : `existing:${parent?.pageId ?? "root"}`,
    });
    result.objects.push({
      kind: "wiki",
      key: page.key,
      sourceKey: wikiImportSourceKey(page),
      label: page.title,
      project: wiki.package.projectKey,
      action: decided.action,
      reason: decided.reason,
      targetId,
    });
    if (decided.action === "conflict")
      result.conflicts.push({
        code: "CONFLICT",
        reason: decided.reason,
        keys: [page.key],
      });
  }
  return result;
}
