import type { TFunction } from "i18next";
import type {
  AgentPlanAssetFile,
  AgentPlanAssetKind,
} from "@/definition/AgentPlanAsset";

/** What the browser learned about a file while it showed its preview. */
export interface PlanAssetFacts {
  /** Width and height of an image or video, in pixels. */
  readonly dimensions?: { readonly width: number; readonly height: number };
  /** Length of a video or audio file, in seconds. */
  readonly duration?: number;
  /** Pages of a PDF. */
  readonly pages?: number;
}

/**
 * A file size in binary units, such as `2,4 MiB`.
 *
 * @remarks
 * The unit is the one of the limit for plan files, 512 MiB = 512 × 1024 × 1024
 * bytes, so a file at the limit reads `512 MiB`.
 */
export function formatPlanAssetSize(size: number, language: string): string {
  const units = ["B", "KiB", "MiB", "GiB"] as const;
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

/** A media length as `m:ss`, such as `3:05`. */
export function formatPlanAssetDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The family's name for the meta line, such as `Bild`. */
export function planAssetKindLabel(
  kind: AgentPlanAssetKind,
  translate: TFunction,
): string {
  return translate(`plans.asset.kind.${kind}`);
}

/**
 * The meta line below the file name: family, size and what the preview learned.
 *
 * @remarks
 * Video and audio say that they start only on a click; archives and other
 * files that they are never run.
 */
export function planAssetMeta(
  file: AgentPlanAssetFile,
  facts: PlanAssetFacts,
  context: { readonly translate: TFunction; readonly language: string },
): string {
  const { translate, language } = context;
  const parts = [
    planAssetKindLabel(file.kind, translate),
    formatPlanAssetSize(file.size, language),
  ];
  if (facts.dimensions)
    parts.push(`${facts.dimensions.width} × ${facts.dimensions.height}`);
  if (facts.pages !== undefined)
    parts.splice(1, 0, translate("plans.asset.pages", { count: facts.pages }));
  if (file.kind === "video" || file.kind === "audio")
    parts.push(translate("plans.asset.startsOnClick"));
  if (file.kind === "archive" || file.kind === "other")
    parts.push(translate("plans.asset.notExecuted"));
  return parts.join(" · ");
}
