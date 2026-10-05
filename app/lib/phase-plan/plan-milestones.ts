import { TYPE_COLORS } from "@/app/lib/phase-plan/plan-colors";
import { parsePlanDate, toISODate } from "@/app/lib/phase-plan/plan-dates";
import {
  MILESTONE_COLOR,
  MILESTONE_ICON,
  normalizeHexColorCode,
} from "@/definition/Task";

import type {
  GroupKey,
  LinkCandidate,
  PanelDraft,
  PanelState,
  WorkingLink,
} from "@/app/lib/phase-plan/plan-types";
import type {
  Milestone,
  MilestoneColor,
  MilestoneDependency,
  MilestoneIcon,
} from "@/definition/Task";

/** The category lanes from top to bottom. */
export const LANE_ORDER: readonly GroupKey[] = [
  "product",
  "design",
  "development",
  "testing",
  "deployment",
];

/** Accent color of every category lane. */
export const LANE_DOT_COLORS: Readonly<Record<GroupKey, string>> = {
  product: "#f97316",
  design: "#3b82f6",
  development: "#22c55e",
  testing: "#8b5cf6",
  deployment: "#ec4899",
};

const GROUP_KEYWORDS: Readonly<Record<GroupKey, readonly string[]>> = {
  product: ["produkt", "product", "version", "release", "beta", "launch"],
  design: [
    "design",
    "ui",
    "ux",
    "brand",
    "freigabe",
    "mockup",
    "prototyp",
    "layout",
  ],
  development: [
    "entwickl",
    "develop",
    "implementierung",
    "implementation",
    "technik",
    "technical",
    "api",
    "backend",
    "frontend",
    "architektur",
    "code",
    "freeze",
    "system",
  ],
  testing: [
    "test",
    "tests",
    "qa",
    "qualität",
    "quality",
    "prüfung",
    "abnahme",
    "sicherung",
  ],
  deployment: [
    "deploy",
    "produktion",
    "production",
    "rollout",
    "go-live",
    "golive",
    "betrieb",
    "operations",
  ],
};

/** Default symbol per milestone color, used until a symbol is chosen. */
export const COLOR_DEFAULT_ICON: Readonly<
  Record<MilestoneColor, MilestoneIcon>
> = {
  [MILESTONE_COLOR.STANDARD]: MILESTONE_ICON.DIAMOND,
  [MILESTONE_COLOR.RELEASE]: MILESTONE_ICON.ROCKET,
  [MILESTONE_COLOR.REVIEW]: MILESTONE_ICON.FLAG,
  [MILESTONE_COLOR.MARKETING]: MILESTONE_ICON.MEGAPHONE,
  [MILESTONE_COLOR.TEAM]: MILESTONE_ICON.USERS,
};

/** Returns the palette color of a milestone, standard when none is stored. */
export function getMilestoneColor(milestone: Milestone): MilestoneColor {
  return milestone.colorKey ?? MILESTONE_COLOR.STANDARD;
}

/**
 * Resolves the effectively displayed marker color.
 *
 * @remarks
 * Custom colors win over the palette color; shorthand codes are expanded so
 * callers always receive a `#rrggbb` value usable in styles and inputs.
 *
 * @param milestone - Milestone carrying an optional custom color.
 * @returns The custom hex value, falling back to the palette color.
 */
export function getMilestoneDisplayColor(milestone: Milestone): string {
  return (
    normalizeHexColorCode(milestone.colorCustom) ??
    TYPE_COLORS[getMilestoneColor(milestone)]
  );
}

/** Tells whether a milestone was archived. */
export function isArchivedMilestone(milestone: Milestone): boolean {
  return milestone.status === "archived";
}

/** Tells whether a milestone only exists locally until the server answers. */
export function isPendingMilestoneId(id: string): boolean {
  return id.startsWith("pending-");
}

/**
 * Returns the leading instant of a milestone for timeline positioning.
 *
 * @remarks
 * The start date is the leading value; the due date only extends a range.
 * Legacy milestones storing their single date in the due field resolve to
 * that date, so editing the start field always moves the marker.
 */
export function getMilestoneTime(milestone: Milestone): number | null {
  return parsePlanDate(milestone.startAt) ?? parsePlanDate(milestone.dueAt);
}

/**
 * Sorts a milestone into a category lane by keywords in its name.
 *
 * @remarks
 * The longest matching keyword wins so specific terms (for example
 * "produktion" in "Produktions-Release") beat generic ones (like "produkt").
 */
export function assignGroup(name: string): GroupKey {
  const label = name.toLowerCase();
  let bestKey: GroupKey = "product";
  let bestLength = 0;

  for (const key of LANE_ORDER) {
    for (const keyword of GROUP_KEYWORDS[key]) {
      if (keyword.length > bestLength && label.includes(keyword)) {
        bestKey = key;
        bestLength = keyword.length;
      }
    }
  }

  return bestKey;
}

/** Creates the panel draft that edits an existing milestone. */
export function toPanelDraft(milestone: Milestone): PanelDraft {
  const start = milestone.startAt ?? milestone.dueAt ?? "";
  const end =
    milestone.dueAt && milestone.dueAt !== start ? milestone.dueAt : "";

  return {
    color: getMilestoneColor(milestone),
    custom: milestone.colorCustom ?? null,
    description: milestone.description,
    end,
    icon: milestone.iconKey ?? null,
    name: milestone.name,
    start,
    status: milestone.status,
  };
}

/** Creates the panel draft for a new milestone starting on the given day. */
export function blankPanelDraft(today: number): PanelDraft {
  return {
    color: MILESTONE_COLOR.STANDARD,
    custom: null,
    description: "",
    end: "",
    icon: null,
    name: "",
    start: toISODate(today),
    status: "open",
  };
}

/** Returns the id of the milestone a panel edits, `null` when it creates one. */
export function panelMilestoneIdFor(panel: PanelState | null): string | null {
  return panel !== null && panel.mode === "edit" ? panel.milestone.id : null;
}

/**
 * Lists the outgoing dependencies of a milestone with their targets resolved.
 *
 * @param milestoneId - The milestone the panel edits, `null` when creating.
 * @param links - Every dependency of the project.
 * @param milestones - Every milestone of the project.
 */
export function toWorkingLinks(
  milestoneId: string | null,
  links: readonly MilestoneDependency[],
  milestones: readonly Milestone[],
): WorkingLink[] {
  if (milestoneId === null) {
    return [];
  }

  const milestonesById = new Map(
    milestones.map((milestone) => [milestone.id, milestone]),
  );

  return links
    .filter((link) => link.sourceId === milestoneId)
    .map((link) => {
      const target = milestonesById.get(link.targetId);

      return {
        id: link.id,
        linkType: link.linkType,
        targetHex: target
          ? getMilestoneDisplayColor(target)
          : TYPE_COLORS[MILESTONE_COLOR.STANDARD],
        targetIcon: target?.iconKey ?? null,
        targetId: link.targetId,
        targetName: target?.name ?? link.targetId,
      };
    });
}

/**
 * Reads the outcome a background request reported.
 *
 * @param value - The data of a fetcher.
 * @returns `"ok"` or `"failed"` for a result carrying a boolean `ok` flag,
 * `null` for anything else, such as no answer yet.
 */
export function getActionOutcome(value: unknown): "ok" | "failed" | null {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return null;
  }

  if (value.ok === true) {
    return "ok";
  }

  return value.ok === false ? "failed" : null;
}

/** What the milestone panel needs to know about dependencies. */
export interface PanelLinkContext {
  readonly outgoingLinks: readonly WorkingLink[];
  readonly incomingLinkSourceIds: readonly string[];
  readonly candidates: readonly LinkCandidate[];
  readonly linkCount: number;
}

/**
 * Collects the dependency information the panel shows for its milestone.
 *
 * @param panel - What the panel edits.
 * @param milestones - Every milestone as currently shown.
 * @param links - Every dependency as currently shown.
 * @returns The outgoing dependencies, the milestones that depend on this one,
 * the milestones a new dependency could point to and how many dependencies
 * touch this milestone.
 */
export function describePanelLinks(
  panel: PanelState,
  milestones: readonly Milestone[],
  links: readonly MilestoneDependency[],
): PanelLinkContext {
  const milestoneId = panelMilestoneIdFor(panel);

  return {
    candidates: milestones
      .filter(
        (milestone) =>
          panel.mode === "create" ||
          (milestone.id !== milestoneId && !isPendingMilestoneId(milestone.id)),
      )
      .map((milestone) => ({
        hex: getMilestoneDisplayColor(milestone),
        icon: milestone.iconKey ?? null,
        id: milestone.id,
        name: milestone.name,
      })),
    incomingLinkSourceIds: links
      .filter((link) => milestoneId !== null && link.targetId === milestoneId)
      .map((link) => link.sourceId),
    linkCount: links.filter(
      (link) => link.sourceId === milestoneId || link.targetId === milestoneId,
    ).length,
    outgoingLinks: toWorkingLinks(milestoneId, links, milestones),
  };
}
