import type {
  Milestone,
  MilestoneColor,
  MilestoneIcon,
  MilestoneLinkType,
} from "@/definition/Task";

/** Granularity of the milestone timeline. */
export type PlanView = "weeks" | "months" | "quarter";

/** The fixed category lanes milestones are sorted into. */
export type GroupKey =
  "product" | "design" | "development" | "testing" | "deployment";

/** Lifecycle state of a milestone. */
export type MilestoneStatus = Milestone["status"];

/** What the milestone panel currently edits. */
export type PanelState =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly milestone: Milestone };

/** The editable fields of the milestone panel. */
export interface PanelDraft {
  readonly name: string;
  readonly start: string;
  readonly end: string;
  readonly description: string;
  readonly color: MilestoneColor;
  readonly custom: string | null;
  readonly icon: MilestoneIcon | null;
  readonly status: MilestoneStatus;
}

/** An outgoing dependency of the milestone shown in the panel. */
export interface WorkingLink {
  readonly id: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly targetIcon: MilestoneIcon | null;
  readonly targetHex: string;
  readonly linkType: MilestoneLinkType;
}

/** Dependency changes made in the panel, to be sent with the save. */
export interface LinkOperations {
  readonly added: readonly {
    readonly targetId: string;
    readonly linkType: MilestoneLinkType;
  }[];
  readonly removedIds: readonly string[];
}

/** Half-open visible time range of the timeline. */
export interface TimeWindow {
  readonly start: number;
  readonly end: number;
}

/** One column of the timeline header. */
export interface TimelineColumn {
  readonly key: string;
  readonly label: string;
  readonly width: number;
}

/** One group of columns above the timeline header, such as a month. */
export interface SuperSegment {
  readonly key: string;
  readonly label: string;
  readonly width: number;
}

/** How much content a milestone element has room for. */
export type CardDensity = "full" | "title" | "icon" | "marker";

/** A milestone element with its resolved position and look. */
export interface PlacedCard {
  readonly milestone: Milestone;
  readonly start: number;
  readonly end: number;
  readonly isRange: boolean;
  readonly left: number;
  readonly width: number;
  readonly level: number;
  readonly color: MilestoneColor;
  readonly hex: string;
  readonly isArchived: boolean;
  readonly isPending: boolean;
  readonly density: CardDensity;
  readonly chipSize: number;
}

/** One category lane with the cards inside the visible buffer. */
export interface LaneLayout {
  readonly key: GroupKey;
  readonly cards: readonly PlacedCard[];
  readonly top: number;
  readonly height: number;
}

/** A dependency line between two milestone elements. */
export interface DependencyLink {
  readonly key: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly fromColor: string;
  readonly toColor: string;
  readonly leftToRight: boolean;
  readonly opacity: number;
}

/** A milestone with the instant that positions it on the timeline. */
export interface DatedMilestone {
  readonly milestone: Milestone;
  readonly time: number;
}

/** Why the latest background save of a milestone failed. */
export type PlanSaveError = "saveFailed" | "linkSaveFailed";

/** The background save whose answer the editor is waiting for. */
export type PendingSave =
  | {
      readonly kind: "create";
      readonly tempId: string;
      readonly hadLinkOps: boolean;
    }
  | {
      readonly kind: "edit";
      readonly id: string;
      readonly hadLinkOps: boolean;
    };

/** Tells the panel that a save succeeded; a new token means a new success. */
export interface SavedToken {
  readonly token: number;
  readonly milestoneId: string | null;
}

/** Tells the panel to fall back to server links after a failed save. */
export interface RevertToken {
  readonly token: number;
  readonly milestoneId: string | null;
  readonly links: readonly WorkingLink[];
}

/** A change of the milestone icon and color shown before it is saved. */
export interface PreviewPatch {
  readonly iconKey: MilestoneIcon | null;
  readonly colorKey: MilestoneColor;
  readonly colorCustom: string | null;
}

/** A milestone a dependency can point to. */
export interface LinkCandidate {
  readonly id: string;
  readonly name: string;
  readonly icon: MilestoneIcon | null;
  readonly hex: string;
}
