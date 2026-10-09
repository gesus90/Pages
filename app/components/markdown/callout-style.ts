import { Info, Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";

import { WIKI_CALLOUT_KINDS } from "@/app/lib/wiki-remark";

import type { LucideIcon } from "lucide-react";
import type { WikiCalloutKind } from "@/app/lib/wiki-remark";

/** Icon and colours of each callout kind, shared by renderer and editor. */
export const CALLOUT_STYLES: Readonly<
  Record<WikiCalloutKind, { icon: LucideIcon; className: string }>
> = {
  caution: {
    className: "border-destructive/50 bg-destructive/10",
    icon: OctagonAlert,
  },
  important: { className: "border-primary/50 bg-primary-subtle", icon: Info },
  note: { className: "border-border bg-muted", icon: Info },
  tip: { className: "border-success/50 bg-success/10", icon: Lightbulb },
  warning: {
    className: "border-warning/50 bg-warning/10",
    icon: TriangleAlert,
  },
};

/**
 * Narrows a value to a callout kind.
 *
 * @param value - A kind as read from markdown or a node attribute.
 * @returns Whether the value names a known kind.
 */
export function isCalloutKind(value: unknown): value is WikiCalloutKind {
  return WIKI_CALLOUT_KINDS.some((kind) => kind === value);
}
