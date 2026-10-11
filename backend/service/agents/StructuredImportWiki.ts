import { readImportTitle } from "./ImportMarkdownTitle";
import { rewriteRelativeLinks } from "./RelativeLinkRewriter";

import type {
  AgentImportApplyInput,
  AgentImportAssetBinding,
} from "@/definition/AgentImportApply";
import type {
  AgentImportFile,
  AgentImportPlanInput,
} from "@/definition/AgentImportManifest";
import type {
  AgentStructuredIssue,
  AgentStructuredLinkOutcome,
  AgentStructuredManifest,
} from "@/definition/AgentStructuredImportManifest";

/** The wiki part of a structured manifest, as the A9.7 planner and the A9.8 source service take it. */
export interface StructuredWikiPackage {
  /** Key of the project source the pages go to. */
  readonly projectKey: string;
  readonly projectId: string;
  /** Request for `WikiImportPlanner`, with the rewritten Markdown and the index derived from it. */
  readonly request: AgentImportPlanInput;
  /** The assets each page links to, bound to its source key. */
  readonly bindings: readonly AgentImportAssetBinding[];
  /** Every relative link of every page and what the import makes of it. */
  readonly links: readonly AgentStructuredLinkOutcome[];
  /** The source keys that use each asset ID. */
  readonly usage: ReadonlyMap<string, readonly string[]>;
  readonly errors: readonly AgentStructuredIssue[];
}

/** Tells whether a path of the asset map is a clean relative path below the manifest root. */
function isAssetPath(path: string): boolean {
  if (
    !path ||
    /[\\\u0000-\u001f\u007f]/u.test(path) ||
    path !== path.normalize("NFC")
  )
    return false;
  return path
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..");
}

/** The asset IDs of a manifest by path, and the entries whose path cannot be used. */
export function readStructuredAssetMap(manifest: AgentStructuredManifest): {
  readonly assets: ReadonlyMap<string, string>;
  readonly errors: readonly AgentStructuredIssue[];
} {
  const errors: AgentStructuredIssue[] = [];
  const assets = new Map<string, string>();
  for (const asset of manifest.assets) {
    if (!isAssetPath(asset.path))
      errors.push({
        code: "INVALID_REQUEST",
        reason: "invalid_asset_path",
        keys: [`asset:${asset.assetId}`],
      });
    else if (assets.has(asset.path))
      errors.push({
        code: "INVALID_REQUEST",
        reason: "duplicate_asset_path",
        keys: [`asset:${asset.assetId}`],
      });
    else assets.set(asset.path, asset.assetId);
  }
  return { assets, errors };
}

/**
 * Derives the wiki package from the Markdown sources of a manifest.
 *
 * @param manifest - The validated manifest.
 * @param assets - Asset IDs by path, from {@link readStructuredAssetMap}.
 * @param projectIds - Project IDs by project key.
 * @returns The package, or `null` when the manifest holds no wiki source.
 *
 * @remarks
 * Relative links are rewritten here, before anything is planned or hashed, so
 * the plan, the source hash and the stored page all describe the same text.
 * The index is derived from that text with the rules of A9.7, which makes the
 * planner's title check hold by construction.
 */
export function buildStructuredWiki(
  manifest: AgentStructuredManifest,
  assets: ReadonlyMap<string, string>,
  projectIds: ReadonlyMap<string, string>,
): StructuredWikiPackage | null {
  const sources = manifest.sources.filter((source) => source.kind === "wiki");
  if (sources.length === 0 || manifest.wiki === null) return null;
  const errors: AgentStructuredIssue[] = [];
  const files: AgentImportFile[] = [];
  const links: AgentStructuredLinkOutcome[] = [];
  const bindings: AgentImportAssetBinding[] = [];
  const usage = new Map<string, string[]>();
  for (const source of sources) {
    const rewritten = rewriteRelativeLinks(source.key, source.content, assets);
    files.push({
      sourceKey: source.key,
      content: rewritten.content,
      ...(source.title === undefined ? {} : { title: source.title }),
    });
    links.push(...rewritten.links);
    const assetIds = [
      ...new Set(
        rewritten.links.flatMap((link) =>
          link.assetId === null ? [] : [link.assetId],
        ),
      ),
    ].sort();
    if (assetIds.length > 0) bindings.push({ sourceKey: source.key, assetIds });
    for (const assetId of assetIds)
      usage.set(assetId, [...(usage.get(assetId) ?? []), source.key]);
  }
  for (const [assetId, users] of usage)
    if (users.length > 1)
      errors.push({
        code: "INVALID_REQUEST",
        reason: "asset_shared",
        keys: [`asset:${assetId}`, ...users],
      });
  return {
    projectKey: manifest.wiki.project,
    projectId: projectIds.get(manifest.wiki.project) ?? "",
    request: {
      projectId: projectIds.get(manifest.wiki.project) ?? "",
      parentId: manifest.wiki.parentId,
      manifest: {
        version: "1",
        index: files.map(readImportTitle),
        files,
      },
    },
    bindings,
    links,
    usage,
    errors,
  };
}

/**
 * Builds the input the A9.8 source service applies for the wiki package.
 *
 * @param pack - The package of the manifest.
 * @param fingerprint - The fingerprint of the A9.7 plan of that package.
 * @returns The explicit project, parent, Markdown and asset bindings.
 */
export function structuredWikiApplyInput(
  pack: StructuredWikiPackage,
  fingerprint: string,
): AgentImportApplyInput {
  return {
    operationId: "structured",
    fingerprint,
    projectId: pack.request.projectId,
    parentId: pack.request.parentId,
    manifest: pack.request.manifest,
    assets: pack.bindings,
  };
}
