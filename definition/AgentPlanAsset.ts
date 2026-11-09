import type { AgentPlanInput, AgentPlanPosition } from "./AgentPlan";

/** The longest title of an asset node, as long as a stack name. */
export const PLAN_ASSET_NAME_LENGTH = 120;

/** The data output of an asset node, on the right edge of the card. */
export const PLAN_ASSET_PORT = { dataOut: "value-out" } as const;

/**
 * The families a plan asset belongs to, decided by its content.
 *
 * @remarks
 * The family only chooses the preview and the wording. It never permits
 * executing a file: every family, `other` included, is data.
 */
export const PLAN_ASSET_KINDS = [
  "image",
  "video",
  "audio",
  "document",
  "archive",
  "other",
] as const;
export type AgentPlanAssetKind = (typeof PLAN_ASSET_KINDS)[number];

/**
 * The stored file a node or stack entry names, as the server detected it.
 *
 * @remarks
 * The plan keeps this copy so a saved plan shows its file without a request,
 * and so a run can refuse a file whose content changed since it was chosen:
 * the digest pins the snapshot. Whether the person may read the file is
 * checked again on every read, preview and handover; the copy grants nothing.
 */
export interface AgentPlanAssetFile {
  readonly assetId: string;
  readonly fileName: string;
  /** The media type the server detected from the content, never the browser's claim. */
  readonly mediaType: string;
  readonly kind: AgentPlanAssetKind;
  readonly size: number;
  /** Hex SHA-256 of the content. */
  readonly digest: string;
}

/** A stack entry that hands over a file (PAGE-268), with its own type. */
export interface AgentPlanAssetEntry {
  readonly id: string;
  readonly type: "asset";
  readonly file: AgentPlanAssetFile;
}

/**
 * An asset source: one file that the plan hands to the inputs it is connected to.
 *
 * @remarks
 * Like every source it never runs and creates no execution dependency. A node
 * without a file is a draft; the plan check names it before a run starts.
 */
export interface AgentPlanAsset extends AgentPlanPosition {
  readonly id: string;
  readonly type: "asset";
  readonly name: string;
  readonly file: AgentPlanAssetFile | null;
}

/** An uploaded plan asset as the server describes it to the plan editor. */
export interface AgentPlanAssetRecord extends AgentPlanAssetFile {
  readonly projectId: string;
  readonly createdAt: string;
  /** Where a result file came from: the run and node that wrote it. */
  readonly origin: {
    readonly runId: string;
    readonly stepId: string;
    /** The asset the node received when it wrote this result. */
    readonly sourceAssetId: string | null;
  } | null;
}

const EXTENSION = /\.([a-z0-9]{1,8})$/iu;

/** Creates an empty asset node. */
export function emptyPlanAsset(
  id: string,
  name: string,
  position: AgentPlanPosition,
): AgentPlanAsset {
  return { id, type: "asset", name, ...position, file: null };
}

/** The asset nodes of a plan. */
export function planAssets(
  plan: Pick<AgentPlanInput, "nodes">,
): readonly AgentPlanAsset[] {
  return plan.nodes.filter((node) => node.type === "asset");
}

/** Narrows an untrusted family name. */
export function isPlanAssetKind(input: unknown): input is AgentPlanAssetKind {
  return PLAN_ASSET_KINDS.some((kind) => kind === input);
}

/**
 * The short type mark of a file, such as `PNG`, from its name.
 *
 * @remarks
 * Only a label: the family and the media type come from the content.
 */
export function planAssetTypeMark(
  file: Pick<AgentPlanAssetFile, "fileName">,
): string {
  return EXTENSION.exec(file.fileName)?.[1]?.toUpperCase() ?? "";
}

/**
 * Whether the browser may show the file inline as a preview.
 *
 * @remarks
 * Raster images, SVG drawn through an image element, video and audio. The
 * server serves every other type only as a download, and even a previewed
 * file never runs: scripts in an SVG image do not execute.
 */
export function isPlanAssetPreviewable(
  file: Pick<AgentPlanAssetFile, "mediaType">,
): boolean {
  return (
    /^image\/(?:png|jpeg|gif|webp|svg\+xml)$/u.test(file.mediaType) ||
    /^video\/(?:mp4|webm|quicktime)$/u.test(file.mediaType) ||
    /^audio\/(?:mpeg|wav|ogg|flac|mp4)$/u.test(file.mediaType) ||
    file.mediaType === "application/pdf"
  );
}

/** Whether a stored file still is the file a node chose: same identity and content. */
export function isSamePlanAssetFile(
  chosen: Pick<AgentPlanAssetFile, "assetId" | "digest">,
  stored: Pick<AgentPlanAssetFile, "assetId" | "digest">,
): boolean {
  return chosen.assetId === stored.assetId && chosen.digest === stored.digest;
}
