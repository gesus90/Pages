import { createHash } from "node:crypto";

import type { AgentImportPlanInput } from "@/definition/AgentImportManifest";

/** Only visible state influencing placement/conflicts; no people or hidden sibling metadata. */
export interface WikiImportTargetState {
  readonly canWrite: boolean;
  readonly parents: readonly {
    readonly id: string;
    readonly revision: number;
    readonly parentId: string | null;
  }[];
  readonly children: readonly { readonly id: string; readonly title: string }[];
}

/** Hashes fixed fields and sorted collections, retaining exact Markdown bytes and duplicate entries. */
export function wikiImportFingerprint(
  input: AgentImportPlanInput,
  state: WikiImportTargetState,
): string {
  const canonical = {
    version: input.manifest.version,
    projectId: input.projectId,
    parentId: input.parentId,
    index: input.manifest.index
      .map(({ sourceKey, title, titleSource }) =>
        JSON.stringify([sourceKey, title, titleSource]),
      )
      .sort(),
    files: input.manifest.files
      .map(({ sourceKey, content, title }) =>
        JSON.stringify([sourceKey, content, title ?? null]),
      )
      .sort(),
    canWrite: state.canWrite,
    parents: state.parents
      .map(({ id, revision, parentId }) =>
        JSON.stringify([id, revision, parentId]),
      )
      .sort(),
    children: state.children
      .map(({ id, title }) => JSON.stringify([id, title]))
      .sort(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
