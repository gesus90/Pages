import { createHash } from "node:crypto";

import { wikiImportFingerprint } from "./WikiImportFingerprint";

import type { AgentImportApplyInput } from "@/definition/AgentImportApply";
import type {
  AgentImportPage,
  AgentImportPlan,
  AgentImportParent,
} from "@/definition/AgentImportManifest";

/** A package source or a required empty directory, in deterministic parent-first order. */
export interface WikiImportSource {
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly ordinal: number;
  readonly page: AgentImportPage | null;
}

/** Uses actual Markdown paths; generated directories have a namespace forbidden in user paths. */
export function wikiImportSourceKey(page: AgentImportPage): string {
  return page.sourceKeys[0] ?? page.key;
}

/** Binds an operation to its complete canonical package, confirmed plan and asset handles. */
export function wikiImportOperationFingerprint(
  input: AgentImportApplyInput,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        manifest: wikiImportFingerprint(input, {
          canWrite: false,
          parents: [],
          children: [],
        }),
        fingerprint: input.fingerprint,
        assets: input.assets,
      }),
    )
    .digest("hex");
}

/** Hashes exact source text plus its declared title, placement and attachments. */
export function wikiImportSourceFingerprint(
  input: AgentImportApplyInput,
  source: WikiImportSource,
  parent: AgentImportParent,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceKey: source.sourceKey,
        title: source.page?.title,
        content:
          input.manifest.files.find(
            (file) => file.sourceKey === source.sourceKey,
          )?.content ?? "",
        parent,
        assetIds:
          input.assets.find((entry) => entry.sourceKey === source.sourceKey)
            ?.assetIds ?? [],
      }),
    )
    .digest("hex");
}

/** Selects only loaded sources and their empty directory ancestors, retaining source diagnostics. */
export function wikiImportPackage(
  input: AgentImportApplyInput,
  plan: AgentImportPlan,
): WikiImportSource[] {
  const loaded = new Set(input.manifest.files.map((file) => file.sourceKey));
  const selected = new Set(
    plan.pages
      .filter((page) => page.sourceKeys.some((key) => loaded.has(key)))
      .map((page) => page.key),
  );
  const pages = new Map(plan.pages.map((page) => [page.key, page]));
  const edges = new Map(plan.edges.map((edge) => [edge.childKey, edge.parent]));
  for (const key of selected) {
    let parent = edges.get(key);
    while (parent?.kind === "planned") {
      const page = pages.get(parent.key);
      if (page?.sourceKeys.length === 0) selected.add(page.key);
      parent = edges.get(parent.key);
    }
  }
  const sources: WikiImportSource[] = [];
  for (const page of plan.pages) {
    if (!selected.has(page.key)) continue;
    const keys = page.sourceKeys.length
      ? page.sourceKeys.filter((key) => loaded.has(key))
      : [page.key];
    for (const sourceKey of keys) {
      if (sources.some((source) => source.sourceKey === sourceKey)) continue;
      sources.push({
        sourceKey,
        targetKey: page.key,
        page,
        ordinal: sources.length,
      });
    }
  }
  for (const sourceKey of [...loaded].sort()) {
    if (!sources.some((source) => source.sourceKey === sourceKey))
      sources.push({
        sourceKey,
        targetKey: `file:${sourceKey}`,
        page: null,
        ordinal: sources.length,
      });
  }
  return sources;
}
