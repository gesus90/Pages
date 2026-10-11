import { createHash } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { CAPABILITY } from "@/definition/Authorization";

import { canonicalStructuredManifest } from "./StructuredImportManifestReader";
import { planStructuredImport, structuredKey } from "./StructuredImportPlanner";
import { previewSteps } from "./StructuredImportStepPreview";
import {
  buildStructuredWiki,
  readStructuredAssetMap,
} from "./StructuredImportWiki";
import { previewWiki } from "./StructuredImportWikiPreview";
import { WikiImportPlanner } from "./WikiImportPlanner";

import type {
  AgentStructuredEdge,
  AgentStructuredExternalEffect,
  AgentStructuredImportInput,
  AgentStructuredImportPlan,
  AgentStructuredIssue,
  AgentStructuredObject,
  AgentStructuredPlanAsset,
  AgentStructuredPlanProject,
} from "@/definition/AgentStructuredImportManifest";
import type { StructuredImportEnvironment } from "./StructuredImportEnvironment";
import type { StructuredImportGraph } from "./StructuredImportPlanner";
import type { StructuredWikiPlan } from "./StructuredImportWikiPreview";

export type { StructuredWikiPlan } from "./StructuredImportWikiPreview";

/** A preview with what applying it needs besides the public plan. */
export interface StructuredImportPreview {
  readonly plan: AgentStructuredImportPlan;
  readonly graph: StructuredImportGraph;
  readonly projectIds: ReadonlyMap<string, string>;
  readonly wiki: StructuredWikiPlan | null;
}

interface Rights {
  readonly canWriteTickets: boolean;
  readonly canManageProject: ReadonlyMap<string, boolean>;
}

/** Resolves the referenced projects; one the account cannot see is reported as missing. */
async function resolveProjects(
  environment: StructuredImportEnvironment,
  graph: StructuredImportGraph,
): Promise<{
  readonly projectIds: Map<string, string>;
  readonly rights: Rights;
}> {
  const projectIds = new Map<string, string>();
  const canManageProject = new Map<string, boolean>();
  for (const project of graph.sources.projects.values()) {
    if (!environment.viewer.scope.projectIds.includes(project.projectId))
      throw new AgentOperationError("NOT_FOUND");
    projectIds.set(project.key, project.projectId);
    canManageProject.set(
      project.key,
      await environment.tasks.projects.canWriteProject(
        environment.actor,
        project.projectId,
      ),
    );
  }
  const canWriteTickets = await environment.tasks.permissions.hasCapability(
    environment.actor,
    CAPABILITY.WRITE,
  );
  return { projectIds, rights: { canWriteTickets, canManageProject } };
}

/** Refuses at plan time what the services would refuse at apply time. */
function rightIssues(
  graph: StructuredImportGraph,
  rights: Rights,
): AgentStructuredIssue[] {
  return graph.steps
    .filter((step) =>
      step.kind === "ticket"
        ? !rights.canWriteTickets
        : rights.canManageProject.get(step.project) === false,
    )
    .map((step) => ({
      code: "FORBIDDEN",
      reason: "write_permission_required",
      keys: [step.key],
    }));
}

async function previewAssets(
  environment: StructuredImportEnvironment,
  context: {
    readonly assets: readonly { path: string; assetId: string }[];
    readonly usage: ReadonlyMap<string, readonly string[]>;
    readonly pages: ReadonlyMap<string, string | null>;
  },
): Promise<AgentStructuredPlanAsset[]> {
  const result: AgentStructuredPlanAsset[] = [];
  for (const asset of context.assets) {
    const stored = await environment.assets.find(asset.assetId);
    const usedBy = context.usage.get(asset.assetId) ?? [];
    let state: AgentStructuredPlanAsset["state"] = "unavailable";
    if (stored?.userId === environment.actor.id) {
      if (stored.status === "staged" && stored.expiresAt > Date.now())
        state = "staged";
      else if (
        stored.status === "linked" &&
        stored.pageId !== null &&
        usedBy.some((key) => context.pages.get(key) === stored.pageId)
      )
        state = "linked";
    }
    result.push({ path: asset.path, assetId: asset.assetId, state, usedBy });
  }
  return result;
}

async function externalEffects(
  environment: StructuredImportEnvironment,
  objects: readonly AgentStructuredObject[],
  projectIds: ReadonlyMap<string, string>,
): Promise<AgentStructuredExternalEffect[]> {
  const counts = new Map<string, number>();
  for (const planned of objects)
    if (
      planned.kind === "ticket" &&
      planned.action === "create" &&
      planned.project
    )
      counts.set(planned.project, (counts.get(planned.project) ?? 0) + 1);
  const effects: AgentStructuredExternalEffect[] = [];
  for (const [project, tickets] of [...counts].sort()) {
    const projectId = projectIds.get(project);
    if (projectId === undefined) continue;
    const integration = await environment.projects.findIntegration(projectId);
    effects.push({
      kind: "github_publication",
      project,
      projectId,
      syncEnabled: integration?.syncEnabled === true,
      tickets,
    });
  }
  return effects;
}

function projectObjects(graph: StructuredImportGraph): AgentStructuredObject[] {
  return [...graph.sources.projects.values()].map((project) => ({
    kind: "project",
    key: structuredKey("project", project.key),
    sourceKey: structuredKey("project", project.key),
    label: project.key,
    project: project.key,
    action: "reference",
    reason: null,
    targetId: project.projectId,
  }));
}

/** Plans the pages with the A9.7 planner and previews each of them against its mapping. */
async function previewWikiPart(
  environment: StructuredImportEnvironment,
  pack: NonNullable<ReturnType<typeof buildStructuredWiki>>,
): Promise<{
  readonly wiki: StructuredWikiPlan;
  readonly objects: AgentStructuredObject[];
  readonly edges: AgentStructuredEdge[];
  readonly errors: AgentStructuredIssue[];
  readonly conflicts: AgentStructuredIssue[];
  readonly pages: ReadonlyMap<string, string | null>;
}> {
  const response = await new WikiImportPlanner(
    environment.wiki,
    environment.access,
  ).plan(environment.actor, pack.request);
  if (!("fingerprint" in response.result) || !("pages" in response.result))
    throw new Error("Import plan unavailable.");
  const wiki = { package: pack, plan: response.result };
  const preview = await previewWiki(environment, wiki);
  const pages = new Map<string, string | null>();
  for (const planned of preview.objects)
    for (const key of wiki.plan.pages.find((page) => page.key === planned.key)
      ?.sourceKeys ?? [])
      pages.set(key, planned.targetId);
  const edges = [...preview.edges];
  for (const binding of pack.bindings) {
    const page = wiki.plan.pages.find((entry) =>
      entry.sourceKeys.includes(binding.sourceKey),
    );
    for (const assetId of binding.assetIds)
      edges.push({
        type: "asset",
        from: page?.key ?? binding.sourceKey,
        to: `asset:${assetId}`,
      });
  }
  return { ...preview, wiki, edges, pages };
}

/**
 * Previews a structured import without writing anything.
 *
 * @param environment - Account, rights and repositories of this call.
 * @param input - The manifest to preview.
 * @returns The public plan and what applying it needs.
 * @throws {AgentOperationError} `NOT_FOUND` for a project, parent or page the account cannot see.
 *
 * @remarks
 * The wiki part is planned by the A9.7 planner and compared with the stored
 * mappings the way the A9.8 source service compares them, so a plan never
 * promises what the apply would refuse.
 */
export async function previewStructuredImport(
  environment: StructuredImportEnvironment,
  input: AgentStructuredImportInput,
): Promise<StructuredImportPreview> {
  const graph = planStructuredImport(input.manifest);
  const { projectIds, rights } = await resolveProjects(environment, graph);
  const { assets: assetMap, errors: assetErrors } = readStructuredAssetMap(
    input.manifest,
  );
  const pack = buildStructuredWiki(input.manifest, assetMap, projectIds);
  const errors: AgentStructuredIssue[] = [
    ...graph.errors,
    ...assetErrors,
    ...rightIssues(graph, rights),
    ...(pack?.errors ?? []),
  ];
  const steps = await previewSteps(environment, { graph, projectIds, errors });
  const objects = [...projectObjects(graph), ...steps.objects];
  const edges = [...graph.edges];
  const conflicts = [...steps.conflicts];
  let wiki: StructuredWikiPlan | null = null;
  let pages: ReadonlyMap<string, string | null> = new Map();
  // Without a resolved project there is nothing to plan against; the graph already names why.
  if (pack && pack.projectId !== "") {
    const part = await previewWikiPart(environment, pack);
    wiki = part.wiki;
    pages = part.pages;
    objects.push(...part.objects);
    edges.push(...part.edges);
    errors.push(...part.errors);
    conflicts.push(...part.conflicts);
  }
  const assets = await previewAssets(environment, {
    assets: input.manifest.assets,
    usage: pack?.usage ?? new Map(),
    pages,
  });
  for (const asset of assets)
    if (asset.state === "unavailable")
      errors.push({
        code: "NOT_FOUND",
        reason: "asset_unavailable",
        keys: [`asset:${asset.assetId}`],
      });
  const effects = await externalEffects(environment, objects, projectIds);
  const projects: AgentStructuredPlanProject[] = [
    ...graph.sources.projects.values(),
  ].map((project) => ({
    key: project.key,
    projectId: project.projectId,
    canWriteTickets: rights.canWriteTickets,
    canManageMilestones: rights.canManageProject.get(project.key) === true,
  }));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        manifest: canonicalStructuredManifest(input.manifest),
        projects,
        objects: objects.map((entry) => [
          entry.key,
          entry.action,
          entry.reason,
          entry.targetId,
        ]),
        errors,
        conflicts,
        wiki: wiki?.plan.fingerprint ?? null,
        assets: assets.map((asset) => [asset.assetId, asset.state]),
        effects,
      }),
    )
    .digest("hex");
  return {
    graph,
    projectIds,
    wiki,
    plan: {
      fingerprint,
      projects,
      objects,
      edges,
      errors,
      conflicts,
      assets,
      links: pack?.links ?? [],
      valid: errors.length === 0 && conflicts.length === 0,
      externalEffects: effects,
    },
  };
}
