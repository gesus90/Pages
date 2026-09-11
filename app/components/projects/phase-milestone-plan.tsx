import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Award,
  Bell,
  Bookmark,
  Briefcase,
  Bug,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Cog,
  Cpu,
  Database,
  Diamond,
  FileText,
  Flag,
  FlaskConical,
  Folder,
  Globe,
  Heart,
  Info,
  KeyRound,
  Layers,
  Lightbulb,
  Link2,
  Lock,
  Megaphone,
  MessageSquare,
  Monitor,
  Package,
  Palette,
  PenTool,
  Plus,
  Puzzle,
  Rocket,
  RotateCcw,
  Search,
  Server,
  Shield,
  Sparkles,
  Star,
  Target,
  Trash2,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import {
  MILESTONE_COLOR,
  MILESTONE_ICON,
  MILESTONE_LINK_TYPE,
  normalizeHexColorCode,
} from "@/definition/Task";

import type { CSSProperties, ChangeEvent, KeyboardEvent } from "react";
import type {
  Milestone,
  MilestoneColor,
  MilestoneDependency,
  MilestoneIcon,
  MilestoneLinkType,
} from "@/definition/Task";

const DAY_IN_MS = 86_400_000;
const HEADER_HEIGHT = 64;
const CARD_HEIGHT = 68;
const CARD_LEVEL_STRIDE = 78;
const CARD_LEVEL_GAP = 10;
const LANE_PADDING = 16;
// Content breakpoints derived from the card typography: a 36px icon chip +
// 10px gap + ~140px date badge + ~20px padding needs roughly 210px for the
// full row; about 40px of readable title fit from roughly 110px; a 32px icon
// chip needs roughly 56px; below roughly 28px only a centered marker stays
// truthful to the underlying time span.
const FULL_ROW_MIN_WIDTH = 210;
const TITLE_ROW_MIN_WIDTH = 110;
const ICON_ROW_MIN_WIDTH = 56;
const MARKER_ROW_MIN_WIDTH = 28;
const POINT_MARKER_SIZE = 32;
const RANGE_MARKER_SIZE = 20;
const SCROLL_EXTEND_THRESHOLD = 240;
const SCROLL_EDGE_TOLERANCE = 2;
const MAX_COLUMNS: Readonly<Record<PlanView, number>> = {
  weeks: 56,
  months: 30,
  quarter: 20,
};
const INITIAL_OFFSET_COLUMNS: Readonly<Record<PlanView, number>> = {
  weeks: 2,
  months: 2,
  quarter: 1,
};

type PlanView = "weeks" | "months" | "quarter";
type GroupKey = "product" | "design" | "development" | "testing" | "deployment";
type PanelState =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly milestone: Milestone };
type MilestoneStatus = "open" | "completed" | "archived";

interface PanelDraft {
  readonly name: string;
  readonly start: string;
  readonly end: string;
  readonly description: string;
  readonly color: MilestoneColor;
  readonly custom: string | null;
  readonly icon: MilestoneIcon | null;
  readonly status: MilestoneStatus;
}

interface WorkingLink {
  readonly id: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly targetIcon: MilestoneIcon | null;
  readonly targetHex: string;
  readonly linkType: MilestoneLinkType;
}

interface LinkOperations {
  readonly added: readonly {
    readonly targetId: string;
    readonly linkType: MilestoneLinkType;
  }[];
  readonly removedIds: readonly string[];
}

interface TimeWindow {
  readonly start: number;
  readonly end: number;
}

interface TimelineColumn {
  readonly key: string;
  readonly label: string;
  readonly width: number;
}

interface SuperSegment {
  readonly key: string;
  readonly label: string;
  readonly width: number;
}

type CardDensity = "full" | "title" | "icon" | "marker";

interface PlacedCard {
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

interface LaneLayout {
  readonly key: GroupKey;
  readonly cards: readonly PlacedCard[];
  readonly top: number;
  readonly height: number;
}

interface DependencyLink {
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

const LANE_ORDER: readonly GroupKey[] = [
  "product",
  "design",
  "development",
  "testing",
  "deployment",
];

const LANE_DOT_COLORS: Readonly<Record<GroupKey, string>> = {
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

const TYPE_COLORS: Readonly<Record<MilestoneColor, string>> = {
  [MILESTONE_COLOR.STANDARD]: "#f97316",
  [MILESTONE_COLOR.RELEASE]: "#3b82f6",
  [MILESTONE_COLOR.REVIEW]: "#8b5cf6",
  [MILESTONE_COLOR.MARKETING]: "#22c55e",
  [MILESTONE_COLOR.TEAM]: "#64748b",
};

interface ColorPreset {
  readonly key: string;
  readonly hex: string;
}

/** Compact two-row preset palette in muted Pages-harmonized tones. */
const COLOR_PRESETS: readonly ColorPreset[] = [
  { hex: "#f97316", key: "orange" },
  { hex: "#ef4444", key: "red" },
  { hex: "#ec4899", key: "pink" },
  { hex: "#d946ef", key: "magenta" },
  { hex: "#8b5cf6", key: "violet" },
  { hex: "#6366f1", key: "indigo" },
  { hex: "#3b82f6", key: "blue" },
  { hex: "#14b8a6", key: "teal" },
  { hex: "#06b6d4", key: "cyan" },
  { hex: "#22c55e", key: "green" },
  { hex: "#84cc16", key: "lime" },
  { hex: "#eab308", key: "yellow" },
  { hex: "#f59e0b", key: "amber" },
  { hex: "#a16207", key: "brown" },
  { hex: "#6b7280", key: "gray" },
  { hex: "#334155", key: "slate" },
];

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
function getMilestoneDisplayColor(milestone: Milestone): string {
  return (
    normalizeHexColorCode(milestone.colorCustom) ??
    TYPE_COLORS[getMilestoneColor(milestone)]
  );
}

const ARCHIVED_LINK_COLOR = "#94a3b8";

const PIXELS_PER_DAY: Readonly<Record<PlanView, number>> = {
  weeks: 12,
  months: 4,
  quarter: 1.2,
};

function parsePlanDate(value: string | null): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");

  if (!match) {
    return null;
  }

  const time = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ).getTime();

  return Number.isNaN(time) ? null : time;
}

function toISODate(time: number): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDayMonth(time: number): string {
  return new Intl.DateTimeFormat("de", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(time));
}

function formatRangeLabel(start: number, end: number): string {
  const first = new Date(start);
  const second = new Date(end);

  if (first.getFullYear() === second.getFullYear()) {
    const dayMonth = new Intl.DateTimeFormat("de", {
      day: "2-digit",
      month: "2-digit",
    }).format(first);

    return `${dayMonth} – ${formatDayMonth(end)}`;
  }

  return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

function formatMonthYear(time: number): string {
  return new Intl.DateTimeFormat("de", {
    month: "short",
    year: "numeric",
  }).format(new Date(time));
}

function getIsoWeek(time: number): number {
  const date = new Date(time);
  const thursday = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - ((date.getDay() + 6) % 7) + 3,
  );
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const firstMonday = new Date(
    firstThursday.getFullYear(),
    firstThursday.getMonth(),
    firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7),
  );

  return (
    1 +
    Math.round((thursday.getTime() - firstMonday.getTime()) / (7 * DAY_IN_MS))
  );
}

function startOfWeekMonday(time: number): number {
  const date = new Date(time);

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - ((date.getDay() + 6) % 7),
  ).getTime();
}

function startOfMonth(time: number): number {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function addMonths(time: number, amount: number): number {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth() + amount, 1).getTime();
}

function startOfQuarter(time: number): number {
  const date = new Date(time);

  return new Date(
    date.getFullYear(),
    Math.floor(date.getMonth() / 3) * 3,
    1,
  ).getTime();
}

function addQuarters(time: number, amount: number): number {
  const date = new Date(time);

  return new Date(
    date.getFullYear(),
    Math.floor(date.getMonth() / 3) * 3 + amount * 3,
    1,
  ).getTime();
}

function getQuarterLabel(time: number): string {
  const date = new Date(time);

  return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
}

/**
 * Moves a view-aligned boundary by whole units, keeping the grid snapped.
 *
 * @param time - Snapped boundary instant.
 * @param view - Timeline granularity selecting the unit.
 * @param units - Signed number of units to move.
 * @returns The moved boundary, still aligned.
 */
function shiftBoundary(time: number, view: PlanView, units: number): number {
  if (view === "weeks") {
    return time + units * 7 * DAY_IN_MS;
  }

  if (view === "months") {
    return addMonths(time, units);
  }

  return addQuarters(time, units);
}

function getMilestoneColor(milestone: Milestone): MilestoneColor {
  return milestone.colorKey ?? MILESTONE_COLOR.STANDARD;
}

/**
 * Determines how much content a milestone element can show.
 *
 * @remarks
 * The width always mirrors the exact time span; only the content steps
 * down: date first, then title, then everything but a scaled marker.
 *
 * @param width - Rendered element width in pixels.
 * @returns The matching density level.
 */
function getCardDensity(width: number): CardDensity {
  if (width >= FULL_ROW_MIN_WIDTH) {
    return "full";
  }

  if (width >= TITLE_ROW_MIN_WIDTH) {
    return "title";
  }

  if (width >= ICON_ROW_MIN_WIDTH) {
    return "icon";
  }

  return "marker";
}

function isArchivedMilestone(milestone: Milestone): boolean {
  return milestone.status === "archived";
}

function isPendingMilestoneId(id: string): boolean {
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
function getMilestoneTime(milestone: Milestone): number | null {
  return parsePlanDate(milestone.startAt) ?? parsePlanDate(milestone.dueAt);
}

function assignGroup(name: string): GroupKey {
  const label = name.toLowerCase();
  let bestKey: GroupKey = "product";
  let bestLength = 0;

  // The longest matching keyword wins so specific terms (for example
  // "produktion" in "Produktions-Release") beat generic ones (like "produkt").
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

/** Default symbol per milestone color, used until a symbol is chosen. */
const COLOR_DEFAULT_ICON: Readonly<Record<MilestoneColor, MilestoneIcon>> = {
  [MILESTONE_COLOR.STANDARD]: MILESTONE_ICON.DIAMOND,
  [MILESTONE_COLOR.RELEASE]: MILESTONE_ICON.ROCKET,
  [MILESTONE_COLOR.REVIEW]: MILESTONE_ICON.FLAG,
  [MILESTONE_COLOR.MARKETING]: MILESTONE_ICON.MEGAPHONE,
  [MILESTONE_COLOR.TEAM]: MILESTONE_ICON.USERS,
};

/** Renders one selectable milestone symbol. */
function MilestoneSymbol({
  icon,
  className,
}: {
  readonly icon: MilestoneIcon;
  readonly className?: string;
}): React.ReactElement {
  const iconClassName = className ?? "size-4 shrink-0";

  switch (icon) {
    case MILESTONE_ICON.ROCKET:
      return <Rocket className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.FLAG:
      return <Flag className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.TARGET:
      return <Target className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.SPARKLES:
      return <Sparkles className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.CALENDAR:
      return <Calendar className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.PACKAGE:
      return <Package className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.COG:
      return <Cog className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.USERS:
      return <Users className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.LINK:
      return <Link2 className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.MEGAPHONE:
      return <Megaphone className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.SHIELD:
      return <Shield className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.BELL:
      return <Bell className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.BUG:
      return <Bug className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.FLASK:
      return <FlaskConical className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.STAR:
      return <Star className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.CHECK:
      return <CircleCheck className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.BOOKMARK:
      return <Bookmark className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.CLIPBOARD:
      return <ClipboardList className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.WRENCH:
      return <Wrench className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.LAYERS:
      return <Layers className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.GLOBE:
      return <Globe className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.LIGHTBULB:
      return <Lightbulb className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.MONITOR:
      return <Monitor className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.SERVER:
      return <Server className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.FOLDER:
      return <Folder className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.BRIEFCASE:
      return <Briefcase className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.PEN:
      return <PenTool className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.PALETTE:
      return <Palette className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.ZAP:
      return <Zap className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.HEART:
      return <Heart className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.AWARD:
      return <Award className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.PUZZLE:
      return <Puzzle className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.SEARCH:
      return <Search className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.LOCK:
      return <Lock className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.KEY:
      return <KeyRound className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.CPU:
      return <Cpu className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.DATABASE:
      return <Database className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.MESSAGE:
      return <MessageSquare className={iconClassName} aria-hidden="true" />;
    case MILESTONE_ICON.FILE:
      return <FileText className={iconClassName} aria-hidden="true" />;
    default:
      return <Diamond className={iconClassName} aria-hidden="true" />;
  }
}

/** Renders the chosen milestone symbol, falling back to the color default. */
function MilestoneMarkerIcon({
  icon,
  color,
  className,
}: {
  readonly icon: MilestoneIcon | null;
  readonly color: MilestoneColor;
  readonly className?: string;
}): React.ReactElement {
  return (
    <MilestoneSymbol
      icon={icon ?? COLOR_DEFAULT_ICON[color]}
      className={className}
    />
  );
}

function toPanelDraft(milestone: Milestone): PanelDraft {
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

function blankPanelDraft(today: number): PanelDraft {
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

function isFailedActionResult(value: unknown): value is { readonly ok: false } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { readonly ok: unknown }).ok === false
  );
}

function isOkActionResult(value: unknown): value is { readonly ok: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { readonly ok: unknown }).ok === true
  );
}

/**
 * Builds the default visible window for a view around an anchor instant.
 *
 * @param times - All usable milestone instants, unsorted.
 * @param view - Timeline granularity selecting span and snapping.
 * @param today - Anchor preferred when it lies near the data.
 * @returns Half-open window aligned to the view boundaries.
 */
function buildDefaultWindow(
  times: readonly number[],
  view: PlanView,
  today: number,
): TimeWindow {
  if (times.length === 0) {
    if (view === "weeks") {
      return {
        end: startOfWeekMonday(today) + 12 * 7 * DAY_IN_MS,
        start: startOfWeekMonday(today) - 7 * DAY_IN_MS,
      };
    }

    if (view === "months") {
      return {
        end: addMonths(startOfMonth(today), 4),
        start: addMonths(startOfMonth(today), -1),
      };
    }

    return {
      end: addQuarters(startOfQuarter(today), 3),
      start: addQuarters(startOfQuarter(today), -1),
    };
  }

  let minimum = times[0] ?? today;
  let maximum = times[0] ?? today;

  for (const time of times) {
    minimum = Math.min(minimum, time);
    maximum = Math.max(maximum, time);
  }

  const anchor =
    today >= minimum - 30 * DAY_IN_MS && today <= maximum + 30 * DAY_IN_MS
      ? today
      : minimum;

  if (view === "weeks") {
    const start = startOfWeekMonday(anchor) - 6 * 7 * DAY_IN_MS;
    return { end: start + 20 * 7 * DAY_IN_MS, start };
  }

  if (view === "months") {
    const start = addMonths(startOfMonth(anchor), -2);
    return { end: addMonths(start, 8), start };
  }

  const start = addQuarters(startOfQuarter(anchor), -2);
  return { end: addQuarters(start, 6), start };
}

/**
 * Extends a window by whole view units on one side.
 *
 * @param window - Currently visible window.
 * @param view - Timeline granularity selecting the unit size.
 * @param direction - Which side grows.
 * @returns The extended window, still aligned to view boundaries.
 */
function extendWindow(
  window: TimeWindow,
  view: PlanView,
  direction: "start" | "end",
): TimeWindow {
  if (view === "weeks") {
    return direction === "start"
      ? { end: window.end, start: window.start - 8 * 7 * DAY_IN_MS }
      : { end: window.end + 8 * 7 * DAY_IN_MS, start: window.start };
  }

  if (view === "months") {
    return direction === "start"
      ? { end: window.end, start: addMonths(window.start, -3) }
      : { end: addMonths(window.end, 3), start: window.start };
  }

  return direction === "start"
    ? { end: window.end, start: addQuarters(window.start, -2) }
    : { end: addQuarters(window.end, 2), start: window.start };
}

/**
 * Rebases a grown window back into its column budget.
 *
 * @remarks
 * The DOM never holds more than a fixed number of columns: when appending on
 * the right, the oldest columns on the left are dropped (the caller
 * compensates the scroll position by the dropped width); when prepending on
 * the left, the newest columns on the right are dropped, which needs no
 * compensation. Logical dates stay intact, so the rebase is invisible.
 *
 * @param window - Window after extending.
 * @param view - Timeline granularity selecting the budget.
 * @param keep - Which side triggered the extension.
 * @returns The capped window plus the dropped span on the left, if any.
 */
function capWindow(
  window: TimeWindow,
  view: PlanView,
  pixelsPerDay: number,
  keep: "start" | "end",
): { readonly window: TimeWindow; readonly droppedLeftMs: number } {
  const columns = buildColumns(window, view, pixelsPerDay);
  const excess = columns.length - MAX_COLUMNS[view];

  if (excess <= 0) {
    return { droppedLeftMs: 0, window };
  }

  if (keep === "end") {
    const start = shiftBoundary(window.start, view, excess);
    return {
      droppedLeftMs: start - window.start,
      window: { end: window.end, start },
    };
  }

  return {
    droppedLeftMs: 0,
    window: {
      end: shiftBoundary(window.end, view, -excess),
      start: window.start,
    },
  };
}

function buildColumns(
  window: TimeWindow,
  view: PlanView,
  pixelsPerDay: number,
): TimelineColumn[] {
  const columns: TimelineColumn[] = [];

  if (view === "weeks") {
    for (
      let time = startOfWeekMonday(window.start);
      time < window.end;
      time += 7 * DAY_IN_MS
    ) {
      columns.push({
        key: `week-${time}`,
        label: `KW ${getIsoWeek(time)}`,
        width: 7 * pixelsPerDay,
      });
    }

    return columns;
  }

  if (view === "months") {
    for (
      let time = startOfMonth(window.start);
      time < window.end;
      time = addMonths(time, 1)
    ) {
      const width =
        ((Math.min(addMonths(time, 1), window.end) -
          Math.max(time, window.start)) /
          DAY_IN_MS) *
        pixelsPerDay;
      columns.push({
        key: `month-${time}`,
        label: formatMonthYear(time),
        width,
      });
    }

    return columns;
  }

  for (
    let time = startOfQuarter(window.start);
    time < window.end;
    time = addQuarters(time, 1)
  ) {
    const width =
      ((Math.min(addQuarters(time, 1), window.end) -
        Math.max(time, window.start)) /
        DAY_IN_MS) *
      pixelsPerDay;
    columns.push({
      key: `quarter-${time}`,
      label: getQuarterLabel(time),
      width,
    });
  }

  return columns;
}

function buildSuperSegments(
  window: TimeWindow,
  view: PlanView,
  pixelsPerDay: number,
): SuperSegment[] {
  const segments: SuperSegment[] = [];

  if (view === "weeks") {
    for (
      let time = startOfMonth(window.start);
      time < window.end;
      time = addMonths(time, 1)
    ) {
      const label = new Intl.DateTimeFormat("de", {
        month: "long",
        year: "numeric",
      }).format(new Date(time));
      const width =
        ((Math.min(addMonths(time, 1), window.end) -
          Math.max(time, window.start)) /
          DAY_IN_MS) *
        pixelsPerDay;
      segments.push({ key: `month-${time}`, label, width });
    }

    return segments;
  }

  if (view === "months") {
    for (
      let time = startOfQuarter(window.start);
      time < window.end;
      time = addQuarters(time, 1)
    ) {
      const width =
        ((Math.min(addQuarters(time, 1), window.end) -
          Math.max(time, window.start)) /
          DAY_IN_MS) *
        pixelsPerDay;
      segments.push({
        key: `quarter-${time}`,
        label: getQuarterLabel(time),
        width,
      });
    }

    return segments;
  }

  const startYear = new Date(window.start).getFullYear();
  const endYear = new Date(window.end).getFullYear();

  for (let year = startYear; year <= endYear; year += 1) {
    const yearStart = new Date(year, 0, 1).getTime();
    const nextYearStart = new Date(year + 1, 0, 1).getTime();
    const width =
      ((Math.min(nextYearStart, window.end) -
        Math.max(yearStart, window.start)) /
        DAY_IN_MS) *
      pixelsPerDay;
    segments.push({ key: `year-${year}`, label: `${year}`, width });
  }

  return segments;
}

/**
 * Renders the interactive milestone timeline for the planning tab.
 *
 * @remarks
 * The outer timeline viewport keeps a stable size in every view mode while
 * only its inner scale changes. Milestones are grouped into fixed category
 * lanes; stored dependencies render as dashed directed lines, dimmed together
 * with archived endpoints. The visible window extends on demand while
 * scrolling and rebases distant columns away, which keeps the DOM bounded
 * while the axis feels endless in both directions at a constant scroll
 * speed. Saves apply optimistically through background actions, so the
 * timeline never performs a full reload.
 */
export function PhaseMilestonePlan({
  milestones,
  milestoneLinks,
  canWrite,
}: {
  readonly milestones: readonly Milestone[];
  readonly milestoneLinks: readonly MilestoneDependency[];
  readonly canWrite: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const saveFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const [view, setView] = useState<PlanView>("weeks");
  const [fillPpd, setFillPpd] = useState<number | null>(null);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [resetCounter, setResetCounter] = useState(0);
  const [patches, setPatches] = useState<ReadonlyMap<string, Milestone>>(
    new Map(),
  );
  const [pending, setPending] = useState<readonly Milestone[]>([]);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const [addedLinks, setAddedLinks] = useState<readonly MilestoneDependency[]>(
    [],
  );
  const [removedLinkIds, setRemovedLinkIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [saveError, setSaveError] = useState<
    "saveFailed" | "linkSaveFailed" | null
  >(null);
  const [savedToken, setSavedToken] = useState<{
    readonly token: number;
    readonly milestoneId: string | null;
  } | null>(null);
  const [hasStartFade, setHasStartFade] = useState(false);
  const [hasEndFade, setHasEndFade] = useState(true);
  const [revertToken, setRevertToken] = useState<{
    readonly token: number;
    readonly milestoneId: string | null;
    readonly links: readonly WorkingLink[];
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingShiftRef = useRef(0);
  const pendingSaveRef = useRef<
    | {
        readonly kind: "create";
        readonly tempId: string;
        readonly hadLinkOps: boolean;
      }
    | {
        readonly kind: "edit";
        readonly id: string;
        readonly hadLinkOps: boolean;
      }
    | null
  >(null);
  const pendingDeleteRef = useRef<string | null>(null);
  const tempIdRef = useRef(0);

  const today = Date.now();
  const effective = milestones
    .filter((milestone) => !removedIds.has(milestone.id))
    .map((milestone) => patches.get(milestone.id) ?? milestone)
    .concat(pending);
  const effectiveIds = new Set(effective.map((milestone) => milestone.id));
  const effectiveLinks = milestoneLinks
    .filter(
      (link) =>
        !removedLinkIds.has(link.id) &&
        effectiveIds.has(link.sourceId) &&
        effectiveIds.has(link.targetId),
    )
    .concat(
      addedLinks.filter(
        (link) =>
          effectiveIds.has(link.sourceId) && effectiveIds.has(link.targetId),
      ),
    );
  const dated = effective
    .map((milestone) => ({
      milestone,
      time: getMilestoneTime(milestone),
    }))
    .filter(
      (
        entry,
      ): entry is { readonly milestone: Milestone; readonly time: number } =>
        entry.time !== null,
    );
  const undated = effective.filter(
    (milestone) => getMilestoneTime(milestone) === null,
  );
  const times = dated.map((entry) => entry.time);

  const [window, setWindow] = useState<TimeWindow>(() =>
    buildDefaultWindow(times, "weeks", today),
  );

  // Server data always wins: once loaders revalidate, optimistic state resets.
  useEffect(() => {
    setPatches(new Map());
    setPending([]);
    setRemovedIds(new Set());
    setAddedLinks([]);
    setRemovedLinkIds(new Set());
  }, [milestones, milestoneLinks]);

  // Failed background saves revert the optimistic change and surface an error.
  useEffect(() => {
    const operation = pendingSaveRef.current;

    if (
      operation === null ||
      saveFetcher.state !== "idle" ||
      (!isOkActionResult(saveFetcher.data) &&
        !isFailedActionResult(saveFetcher.data))
    ) {
      return;
    }

    pendingSaveRef.current = null;

    if (isOkActionResult(saveFetcher.data)) {
      if (operation.hadLinkOps) {
        setPanel(null);
      } else {
        setSavedToken((current) => ({
          milestoneId: operation.kind === "edit" ? operation.id : null,
          token: (current?.token ?? 0) + 1,
        }));
      }

      return;
    }

    if (operation.kind === "edit") {
      setPatches((current) => {
        const next = new Map(current);
        next.delete(operation.id);
        return next;
      });
      const server = milestones.find(
        (milestone) => milestone.id === operation.id,
      );
      setRevertToken((current) => ({
        links: server
          ? toWorkingLinks(server.id, milestoneLinks, milestones)
          : [],
        milestoneId: operation.id,
        token: (current?.token ?? 0) + 1,
      }));
    } else {
      setPending((current) =>
        current.filter((milestone) => milestone.id !== operation.tempId),
      );
      setRevertToken((current) => ({
        links: [],
        milestoneId: null,
        token: (current?.token ?? 0) + 1,
      }));
    }

    setAddedLinks((current) =>
      current.filter(
        (link) =>
          operation.kind === "create" ||
          !link.id.startsWith(`pending-link-${operation.id}-`),
      ),
    );
    setRemovedLinkIds(new Set());
    setSaveError(operation.hadLinkOps ? "linkSaveFailed" : "saveFailed");
  }, [
    saveFetcher.data,
    saveFetcher.state,
    milestones,
    milestoneLinks,
    today,
    t,
  ]);

  // Failed deletes restore the milestone and keep the panel open for the error.
  useEffect(() => {
    const deletedId = pendingDeleteRef.current;

    if (
      deletedId === null ||
      deleteFetcher.state !== "idle" ||
      (!isOkActionResult(deleteFetcher.data) &&
        !isFailedActionResult(deleteFetcher.data))
    ) {
      return;
    }

    pendingDeleteRef.current = null;

    if (isOkActionResult(deleteFetcher.data)) {
      setPanel((current) =>
        current !== null &&
        current.mode === "edit" &&
        current.milestone.id === deletedId
          ? null
          : current,
      );
      return;
    }

    setRemovedIds((current) => {
      const next = new Set(current);
      next.delete(deletedId);
      return next;
    });
    setSaveError("saveFailed");
  }, [deleteFetcher.data, deleteFetcher.state]);

  const pixelsPerDay = fillPpd ?? PIXELS_PER_DAY[view];
  const trackWidth = Math.max(
    1,
    Math.round(((window.end - window.start) / DAY_IN_MS) * pixelsPerDay),
  );
  const columns = buildColumns(window, view, pixelsPerDay);
  const superSegments = buildSuperSegments(window, view, pixelsPerDay);

  function timeToX(time: number): number {
    return ((time - window.start) / DAY_IN_MS) * pixelsPerDay;
  }

  function handleViewChange(nextView: string): void {
    if (
      nextView !== "weeks" &&
      nextView !== "months" &&
      nextView !== "quarter"
    ) {
      return;
    }

    setView(nextView);
    setWindow(buildDefaultWindow(times, nextView, today));
    setResetCounter((counter) => counter + 1);
  }

  function handleReset(): void {
    setWindow(buildDefaultWindow(times, view, today));
    setResetCounter((counter) => counter + 1);
  }

  function handleShiftWindow(direction: "start" | "end"): void {
    const span = window.end - window.start;
    const sign = direction === "start" ? -1 : 1;
    let shiftedStart = window.start;

    if (view === "weeks") {
      const weeks = Math.max(1, Math.round(span / 2 / (7 * DAY_IN_MS)));
      shiftedStart = window.start + sign * weeks * 7 * DAY_IN_MS;
    } else if (view === "months") {
      const months = Math.max(1, Math.round(span / 2 / (30 * DAY_IN_MS)));
      shiftedStart = addMonths(window.start, sign * months);
    } else {
      const quarters = Math.max(1, Math.round(span / 2 / (90 * DAY_IN_MS)));
      shiftedStart = addQuarters(window.start, sign * quarters);
    }

    setWindow({ end: shiftedStart + span, start: shiftedStart });
  }

  function handleScroll(): void {
    const viewport = scrollRef.current;

    if (!viewport) {
      return;
    }

    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
    setHasStartFade(viewport.scrollLeft > SCROLL_EDGE_TOLERANCE);
    setHasEndFade(viewport.scrollLeft < maxScrollLeft - SCROLL_EDGE_TOLERANCE);

    if (maxScrollLeft <= 0) {
      return;
    }

    if (viewport.scrollLeft < SCROLL_EXTEND_THRESHOLD) {
      const extended = extendWindow(window, view, "start");
      const addedPixels =
        ((window.start - extended.start) / DAY_IN_MS) * pixelsPerDay;
      const capped = capWindow(extended, view, pixelsPerDay, "start");
      pendingShiftRef.current +=
        addedPixels - (capped.droppedLeftMs / DAY_IN_MS) * pixelsPerDay;
      setWindow(capped.window);
    } else if (viewport.scrollLeft > maxScrollLeft - SCROLL_EXTEND_THRESHOLD) {
      const extended = extendWindow(window, view, "end");
      const capped = capWindow(extended, view, pixelsPerDay, "end");
      pendingShiftRef.current -=
        (capped.droppedLeftMs / DAY_IN_MS) * pixelsPerDay;
      setWindow(capped.window);
    }
  }

  // Applies pending scroll compensation after the extended content rendered,
  // but before the browser paints, so the visible anchor never jumps or
  // flashes. Direct writes on stale content would clamp or misplace it.
  useLayoutEffect(() => {
    const viewport = scrollRef.current;

    if (!viewport || pendingShiftRef.current === 0) {
      return;
    }

    viewport.scrollLeft += pendingShiftRef.current;
    pendingShiftRef.current = 0;

    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
    setHasStartFade(viewport.scrollLeft > SCROLL_EDGE_TOLERANCE);
    setHasEndFade(viewport.scrollLeft < maxScrollLeft - SCROLL_EDGE_TOLERANCE);
  });

  function handleSaveDraft(
    draft: PanelDraft,
    milestoneId: string | null,
    linkOps: LinkOperations,
  ): void {
    setSaveError(null);
    const formData = new FormData();
    formData.set("intent", "save-milestone");
    formData.set("name", draft.name);
    formData.set("startAt", draft.start);
    formData.set("dueAt", draft.end);
    formData.set("description", draft.description);
    formData.set("colorKey", draft.color);
    formData.set("customColor", draft.custom ?? "");
    formData.set("iconKey", draft.icon ?? "");
    formData.set("status", draft.status);

    if (milestoneId) {
      const server = milestones.find(
        (milestone) => milestone.id === milestoneId,
      );

      if (!server) {
        setSaveError("saveFailed");
        return;
      }

      const hadLinkOps =
        linkOps.added.length > 0 || linkOps.removedIds.length > 0;
      pendingSaveRef.current = { hadLinkOps, id: milestoneId, kind: "edit" };
      const optimistic: Milestone = {
        ...server,
        colorCustom: draft.custom,
        colorKey: draft.color,
        description: draft.description.trim(),
        dueAt: draft.end || null,
        iconKey: draft.icon,
        name: draft.name.trim(),
        startAt: draft.start || null,
        status: draft.status,
      };
      setPatches((current) => new Map(current).set(milestoneId, optimistic));

      if (hadLinkOps) {
        tempIdRef.current += 1;
        const added = linkOps.added.map((addedLink, index) => ({
          createdAt: serverTimestamp(),
          id: `pending-link-${milestoneId}-${tempIdRef.current}-${index}`,
          linkType: addedLink.linkType,
          projectId: server.projectId,
          sourceId: milestoneId,
          targetId: addedLink.targetId,
        }));
        setAddedLinks((current) => [...current, ...added]);
        setRemovedLinkIds(
          (current) => new Set([...current, ...linkOps.removedIds]),
        );
        formData.set(
          "addLinks",
          JSON.stringify(
            linkOps.added.map((addedLink) => ({
              linkType: addedLink.linkType,
              targetId: addedLink.targetId,
            })),
          ),
        );
        formData.set("removeLinks", JSON.stringify(linkOps.removedIds));
      }

      formData.set("milestoneId", milestoneId);
    } else {
      tempIdRef.current += 1;
      const tempId = `pending-${tempIdRef.current}`;
      pendingSaveRef.current = { hadLinkOps: false, kind: "create", tempId };
      const optimistic: Milestone = {
        archivedAt: null,
        colorCustom: draft.custom,
        colorKey: draft.color,
        completedAt: null,
        createdAt: serverTimestamp(),
        description: draft.description.trim(),
        dueAt: draft.end || null,
        iconKey: draft.icon,
        id: tempId,
        name: draft.name.trim(),
        projectId: "",
        startAt: draft.start || null,
        status: draft.status,
        updatedAt: serverTimestamp(),
      };
      setPending((current) => [...current, optimistic]);
    }

    void saveFetcher.submit(formData, { method: "post" });
  }

  function handleDeleteMilestone(milestoneId: string): void {
    setSaveError(null);
    pendingDeleteRef.current = milestoneId;
    setRemovedIds((current) => new Set(current).add(milestoneId));
    const formData = new FormData();
    formData.set("intent", "delete-milestone");
    formData.set("milestoneId", milestoneId);
    void deleteFetcher.submit(formData, { method: "post" });
  }

  function handlePreviewPatch(
    milestoneId: string | null,
    patch: {
      readonly iconKey: MilestoneIcon | null;
      readonly colorKey: MilestoneColor;
      readonly colorCustom: string | null;
    } | null,
  ): void {
    if (milestoneId === null) {
      return;
    }

    const pendingSave = pendingSaveRef.current;

    if (
      pendingSave !== null &&
      pendingSave.kind === "edit" &&
      pendingSave.id === milestoneId
    ) {
      return;
    }

    setPatches((current) => {
      const next = new Map(current);

      if (patch === null) {
        next.delete(milestoneId);
      } else {
        const server = milestones.find(
          (milestone) => milestone.id === milestoneId,
        );

        if (server) {
          next.set(milestoneId, {
            ...server,
            colorCustom: patch.colorCustom,
            colorKey: patch.colorKey,
            iconKey: patch.iconKey,
          });
        }
      }

      return next;
    });
  }

  function handleClosePanel(): void {
    if (panel !== null && panel.mode === "edit") {
      handlePreviewPatch(panel.milestone.id, null);
    }

    setPanel(null);
    setSaveError(null);
  }

  function handleOpenMilestone(milestone: Milestone): void {
    setPanel({ milestone, mode: "edit" });
  }

  function handleBackgroundClick(): void {
    if (panel !== null) {
      handleClosePanel();
    }
  }

  // Resets and view changes fill the viewport width when the default scale
  // would leave it half empty, guarantee scrollable overflow on both sides,
  // then park near the left edge with a small buffer behind, so both
  // directions stay visibly scrollable. Runs as a layout effect so the first
  // paint already shows the final scale and position without flashing.
  useLayoutEffect(() => {
    const viewport = scrollRef.current;

    if (!viewport || viewport.clientWidth <= 0) {
      return;
    }

    let nextWindow = window;
    let spanDays = (nextWindow.end - nextWindow.start) / DAY_IN_MS;
    let nextPpd = Math.max(
      PIXELS_PER_DAY[view],
      viewport.clientWidth / spanDays,
    );

    for (
      let guard = 0;
      guard < 4 &&
      spanDays * nextPpd < viewport.clientWidth + 2 * SCROLL_EXTEND_THRESHOLD;
      guard += 1
    ) {
      nextWindow = extendWindow(
        extendWindow(nextWindow, view, "start"),
        view,
        "end",
      );
      spanDays = (nextWindow.end - nextWindow.start) / DAY_IN_MS;
      nextPpd = Math.max(PIXELS_PER_DAY[view], viewport.clientWidth / spanDays);
    }

    if (nextWindow !== window) {
      setWindow(nextWindow);
    }

    setFillPpd(nextPpd);

    const firstColumnDays = view === "weeks" ? 7 : view === "months" ? 30 : 91;
    const initialScrollLeft =
      INITIAL_OFFSET_COLUMNS[view] * firstColumnDays * nextPpd;
    viewport.scrollLeft = initialScrollLeft;

    const maxScrollLeft = spanDays * nextPpd - viewport.clientWidth;
    setHasStartFade(initialScrollLeft > SCROLL_EDGE_TOLERANCE);
    setHasEndFade(initialScrollLeft < maxScrollLeft - SCROLL_EDGE_TOLERANCE);
    // Only explicit navigation resets the virtual scroll position on purpose.
  }, [resetCounter]);

  const bufferMs =
    view === "weeks"
      ? 2 * 7 * DAY_IN_MS
      : view === "months"
        ? 31 * DAY_IN_MS
        : 92 * DAY_IN_MS;

  const lanes: LaneLayout[] = [];
  let laneTop = 0;

  for (const key of LANE_ORDER) {
    const items = dated
      .filter((entry) => assignGroup(entry.milestone.name) === key)
      .sort((first, second) => first.time - second.time);

    if (items.length === 0) {
      continue;
    }

    const levelEnds: number[] = [];
    const cards: PlacedCard[] = [];

    for (const item of items) {
      const start = item.time;
      const end = parsePlanDate(item.milestone.dueAt) ?? start;
      const isRange = end > start;
      const spanWidth = Math.max(0, timeToX(end) - timeToX(start));

      let left: number;
      let width: number;
      let density: CardDensity;
      let chipSize: number;

      if (!isRange) {
        density = "marker";
        chipSize = POINT_MARKER_SIZE;
        width = chipSize + 8;
        left = timeToX(start) - width / 2;
      } else if (spanWidth >= MARKER_ROW_MIN_WIDTH) {
        density = getCardDensity(spanWidth);
        chipSize =
          spanWidth >= TITLE_ROW_MIN_WIDTH
            ? 36
            : spanWidth >= ICON_ROW_MIN_WIDTH
              ? 32
              : 24;
        width = spanWidth;
        left = timeToX(start);
      } else {
        density = "marker";
        chipSize = RANGE_MARKER_SIZE;
        width = chipSize + 8;
        left = timeToX(start) + spanWidth / 2 - width / 2;
      }

      let level = levelEnds.findIndex((endX) => endX <= left - CARD_LEVEL_GAP);

      if (level === -1) {
        level = levelEnds.length;
        levelEnds.push(left + width);
      } else {
        levelEnds[level] = left + width;
      }

      cards.push({
        chipSize,
        color: getMilestoneColor(item.milestone),
        density,
        end,
        hex: getMilestoneDisplayColor(item.milestone),
        isArchived: isArchivedMilestone(item.milestone),
        isPending: isPendingMilestoneId(item.milestone.id),
        isRange,
        left,
        level,
        milestone: item.milestone,
        start,
        width,
      });
    }

    const bufferPx = bufferMs * pixelsPerDay;
    const visibleCards = cards.filter(
      (card) =>
        card.left + card.width >= -bufferPx &&
        card.left <= trackWidth + bufferPx,
    );
    const height =
      LANE_PADDING * 2 +
      levelEnds.length * CARD_HEIGHT +
      Math.max(0, levelEnds.length - 1) * (CARD_LEVEL_STRIDE - CARD_HEIGHT);
    lanes.push({ cards: visibleCards, height, key, top: laneTop });
    laneTop += height;
  }

  const bodyHeight = laneTop;
  const cardPositions = new Map<
    string,
    { x: number; w: number; y: number; color: string; dimmed: boolean }
  >();

  for (const lane of lanes) {
    for (const card of lane.cards) {
      cardPositions.set(card.milestone.id, {
        color: card.isArchived ? ARCHIVED_LINK_COLOR : card.hex,
        dimmed: card.isArchived,
        w: card.width,
        x: card.left,
        y:
          lane.top +
          LANE_PADDING +
          card.level * CARD_LEVEL_STRIDE +
          CARD_HEIGHT / 2,
      });
    }
  }

  const links: DependencyLink[] = [];

  for (const link of effectiveLinks) {
    const from = cardPositions.get(link.sourceId);
    const to = cardPositions.get(link.targetId);

    if (!from || !to) {
      continue;
    }

    // Links render in both directions: the curve starts at the source edge
    // facing the target and ends with an arrow at the target edge. Only
    // truly overlapping cards stay link-free, where the curve would hide
    // behind the cards.
    const rightGap = to.x - (from.x + from.w);
    const leftGap = from.x - (to.x + to.w);

    if (rightGap < 0 && leftGap < 0) {
      continue;
    }

    const isDimmed = from.dimmed || to.dimmed;
    const bothArchived = from.dimmed && to.dimmed;
    const leftToRight = rightGap >= leftGap;

    links.push({
      fromColor: isDimmed ? ARCHIVED_LINK_COLOR : from.color,
      fromX: leftToRight ? from.x + from.w : from.x,
      fromY: from.y,
      key: link.id,
      leftToRight,
      opacity: bothArchived ? 0.25 : isDimmed ? 0.45 : 0.9,
      toColor: isDimmed ? ARCHIVED_LINK_COLOR : to.color,
      toX: leftToRight ? to.x : to.x + to.w,
      toY: to.y,
    });
  }

  const todayX =
    today >= window.start && today <= window.end ? timeToX(today) : null;
  const panelMilestoneId =
    panel !== null && panel.mode === "edit" ? panel.milestone.id : null;

  return (
    <section className="rounded-2xl bg-muted/40 p-6">
      <div>
        <h2 className="font-semibold text-foreground">
          {t("projectDetail.planning.phasePlan.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("projectDetail.planning.phasePlan.subtitle")}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <SegmentedControl
          value={view}
          onValueChange={handleViewChange}
          ariaLabel={t("projectDetail.planning.phasePlan.title")}
          options={[
            {
              value: "weeks",
              label: t("projectDetail.planning.phasePlan.weeks"),
            },
            {
              value: "months",
              label: t("projectDetail.planning.phasePlan.months"),
            },
            {
              value: "quarter",
              label: t("projectDetail.planning.phasePlan.quarter"),
            },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-9 shrink-0 px-3 text-sm"
            type="button"
            onClick={handleReset}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("projectDetail.planning.phasePlan.reset")}
          </Button>
          {canWrite ? (
            <Button
              className="h-9 shrink-0 px-3 text-sm"
              type="button"
              onClick={() => setPanel({ mode: "create" })}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("projectDetail.planning.phasePlan.addMilestone")}
            </Button>
          ) : null}
        </div>
      </div>

      {dated.length === 0 ? (
        <div className="mt-4 flex flex-col items-center rounded-xl border border-border/60 bg-surface px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Diamond className="size-5" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-foreground">
            {t("projectDetail.planning.phasePlan.empty")}
          </p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            {t("projectDetail.planning.phasePlan.emptyHint")}
          </p>
        </div>
      ) : (
        <div
          className="mt-4 overflow-hidden rounded-xl border border-border/60 bg-surface shadow-xs"
          style={{ "--scroll-fade-channels": "255 255 255" } as CSSProperties}
        >
          <div className="flex">
            <div className="flex w-60 shrink-0 flex-col border-r border-border/60">
              <div
                className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2"
                style={{ height: `${HEADER_HEIGHT}px` }}
              >
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={t("projectDetail.planning.phasePlan.earlier")}
                  title={t("projectDetail.planning.phasePlan.earlier")}
                  onClick={() => handleShiftWindow("start")}
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={t("projectDetail.planning.phasePlan.later")}
                  title={t("projectDetail.planning.phasePlan.later")}
                  onClick={() => handleShiftWindow("end")}
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <div>
                  {lanes.map((lane) => (
                    <div
                      key={lane.key}
                      className="flex items-start gap-2.5 border-b border-border/40 px-4 py-3 last:border-b-0"
                      style={{ height: `${lane.height}px` }}
                    >
                      <span
                        className="mt-1.5 size-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: LANE_DOT_COLORS[lane.key],
                        }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {t(
                            `projectDetail.planning.phasePlan.groups.${lane.key}`,
                          )}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {t(
                            `projectDetail.planning.phasePlan.groups.${lane.key}Sub`,
                          )}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="relative min-w-0 flex-1">
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="pages-thin-scrollbar overflow-x-auto overscroll-contain"
              >
                <div
                  className="w-max min-w-full"
                  style={{ width: `${trackWidth}px` }}
                >
                  <div className="bg-surface">
                    <div className="flex h-9 border-b border-border/60">
                      {superSegments.map((segment) => (
                        <div
                          key={segment.key}
                          className="shrink-0 truncate border-l border-border/60 px-3 py-2 text-center text-xs font-semibold text-foreground first:border-l-0"
                          style={{ width: `${segment.width}px` }}
                        >
                          {segment.label}
                        </div>
                      ))}
                    </div>
                    <div className="flex h-7 border-b border-border/60">
                      {columns.map((column) => (
                        <div
                          key={column.key}
                          className="shrink-0 truncate border-l border-border/40 px-2 py-1 text-center text-[11px] font-medium text-muted-foreground first:border-l-0"
                          style={{ width: `${column.width}px` }}
                        >
                          {column.label}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="relative" onClick={handleBackgroundClick}>
                    {lanes.map((lane) => (
                      <div
                        key={lane.key}
                        className="relative border-b border-border/40 last:border-b-0"
                        style={{ height: `${lane.height}px` }}
                      >
                        <div
                          className="absolute inset-0 flex"
                          aria-hidden="true"
                        >
                          {columns.map((column) => (
                            <div
                              key={column.key}
                              className="h-full shrink-0 border-l border-border/40 first:border-l-0"
                              style={{ width: `${column.width}px` }}
                            />
                          ))}
                        </div>
                        {lane.cards.map((card) => (
                          <TimelineMilestone
                            key={card.milestone.id}
                            card={card}
                            // The lane container is positioned, so the offset
                            // stays relative to it; adding lane.top here
                            // would count the lane height twice.
                            top={LANE_PADDING + card.level * CARD_LEVEL_STRIDE}
                            isSelected={card.milestone.id === panelMilestoneId}
                            onSelect={handleOpenMilestone}
                          />
                        ))}
                      </div>
                    ))}
                    <svg
                      className="pointer-events-none absolute inset-0 z-[5]"
                      width={trackWidth}
                      height={bodyHeight}
                      aria-hidden="true"
                    >
                      <defs>
                        {links.map((link) => (
                          <linearGradient
                            key={`plan-grad-${link.key}`}
                            id={`plan-grad-${link.key}`}
                            gradientUnits="userSpaceOnUse"
                            x1={link.fromX}
                            y1={link.fromY}
                            x2={link.toX}
                            y2={link.toY}
                          >
                            <stop offset="0%" stopColor={link.fromColor} />
                            <stop
                              offset="50%"
                              stopColor={linkMidColor(
                                link.fromColor,
                                link.toColor,
                              )}
                            />
                            <stop offset="100%" stopColor={link.toColor} />
                          </linearGradient>
                        ))}
                      </defs>
                      {links.map((link) => (
                        <path
                          key={link.key}
                          d={dependencyPath(link)}
                          fill="none"
                          stroke={`url(#plan-grad-${link.key})`}
                          strokeWidth="1.5"
                          strokeDasharray="5 4"
                          strokeOpacity={link.opacity}
                        />
                      ))}
                    </svg>
                    {links.map((link) => (
                      <span
                        key={`${link.key}-origin`}
                        aria-hidden="true"
                        className="pointer-events-none absolute z-[7] size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{
                          backgroundColor: link.fromColor,
                          left: `${link.fromX}px`,
                          opacity: link.opacity,
                          top: `${link.fromY}px`,
                        }}
                      />
                    ))}
                    {links.map((link) => (
                      <span
                        key={`${link.key}-target`}
                        aria-hidden="true"
                        className="pointer-events-none absolute z-[7] size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{
                          backgroundColor: link.toColor,
                          left: `${link.toX}px`,
                          opacity: link.opacity,
                          top: `${link.toY}px`,
                        }}
                      />
                    ))}
                    {todayX !== null ? (
                      <div
                        className="pointer-events-none absolute top-0 bottom-0 z-10"
                        style={{ left: 0, width: `${trackWidth}px` }}
                        aria-hidden="true"
                      >
                        <div
                          className="absolute top-0 bottom-0 border-l-2 border-dashed border-primary"
                          style={{
                            left: `${(todayX / trackWidth) * 100}%`,
                          }}
                        >
                          <span className="absolute top-1 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-primary-foreground shadow-xs">
                            {t("projectDetail.planning.phasePlan.today")}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div
                aria-hidden="true"
                className={`pages-scroll-fade-start pointer-events-none absolute top-16 bottom-0 left-0 z-10 w-10 transition-opacity duration-200 ${
                  hasStartFade ? "opacity-100" : "opacity-0"
                }`}
              />
              <div
                aria-hidden="true"
                className={`pages-scroll-fade-end pointer-events-none absolute top-16 right-0 bottom-0 z-10 w-10 transition-opacity duration-200 ${
                  hasEndFade ? "opacity-100" : "opacity-0"
                }`}
              />
            </div>
          </div>
        </div>
      )}

      {undated.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border/60 bg-surface p-4">
          <p className="text-xs font-semibold text-muted-foreground select-none">
            {t("projectDetail.planning.phasePlan.undated")}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {undated.map((milestone) => (
              <li
                key={milestone.id}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1 text-sm ${
                  milestone.id === panelMilestoneId ? "bg-primary-subtle" : ""
                } ${isArchivedMilestone(milestone) ? "opacity-60" : ""}`}
              >
                <MilestoneMarkerIcon
                  icon={milestone.iconKey ?? null}
                  color={getMilestoneColor(milestone)}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <button
                  type="button"
                  disabled={isPendingMilestoneId(milestone.id)}
                  className="min-w-0 flex-1 truncate text-left text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait"
                  onClick={() => setPanel({ milestone, mode: "edit" })}
                >
                  {milestone.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {panel !== null && canWrite ? (
        <MilestonePanel
          key={panel.mode === "edit" ? panel.milestone.id : "new"}
          panel={panel}
          outgoingLinks={toWorkingLinks(
            panel.mode === "edit" ? panel.milestone.id : null,
            effectiveLinks,
            effective,
          )}
          incomingLinkSourceIds={effectiveLinks
            .filter(
              (link) =>
                panel.mode === "edit" && link.targetId === panel.milestone.id,
            )
            .map((link) => link.sourceId)}
          candidates={effective
            .filter(
              (milestone) =>
                panel.mode === "create" ||
                (milestone.id !== panel.milestone.id &&
                  !isPendingMilestoneId(milestone.id)),
            )
            .map((milestone) => ({
              hex: getMilestoneDisplayColor(milestone),
              icon: milestone.iconKey ?? null,
              id: milestone.id,
              name: milestone.name,
            }))}
          linkCount={
            effectiveLinks.filter(
              (link) =>
                link.sourceId === panelMilestoneIdFor(panel) ||
                link.targetId === panelMilestoneIdFor(panel),
            ).length
          }
          saveError={saveError}
          revertToken={revertToken}
          savedToken={savedToken}
          isSaving={saveFetcher.state !== "idle"}
          isDeleting={deleteFetcher.state !== "idle"}
          onSave={handleSaveDraft}
          onDelete={handleDeleteMilestone}
          onPreview={handlePreviewPatch}
          onClose={handleClosePanel}
        />
      ) : null}
    </section>
  );
}

function panelMilestoneIdFor(panel: PanelState): string | null {
  return panel.mode === "edit" ? panel.milestone.id : null;
}

function toWorkingLinks(
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
 * Parses a `#rrggbb` color into HSL components.
 *
 * @param hex - Hex color code with leading `#`.
 * @returns Hue in degrees with saturation and lightness, or `null` when invalid.
 */
function hexToHsl(hex: string): {
  readonly h: number;
  readonly s: number;
  readonly l: number;
} | null {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);

  if (!match) {
    return null;
  }

  const red = parseInt(match[1], 16) / 255;
  const green = parseInt(match[2], 16) / 255;
  const blue = parseInt(match[3], 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;

  if (maximum === minimum) {
    return { h: 0, l: lightness, s: 0 };
  }

  const delta = maximum - minimum;
  const saturation =
    lightness > 0.5
      ? delta / (2 - maximum - minimum)
      : delta / (maximum + minimum);
  let hue = 0;

  if (maximum === red) {
    hue = ((green - blue) / delta + (green < blue ? 6 : 0)) * 60;
  } else if (maximum === green) {
    hue = ((blue - red) / delta + 2) * 60;
  } else {
    hue = ((red - green) / delta + 4) * 60;
  }

  return { h: hue, l: lightness, s: saturation };
}

/**
 * Formats HSL components as a `#rrggbb` color code.
 *
 * @param hue - Hue in degrees.
 * @param saturation - Saturation between 0 and 1.
 * @param lightness - Lightness between 0 and 1.
 * @returns The lowercase hex color code.
 */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const wrapped = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = wrapped / 60;
  const mid = chroma * (1 - Math.abs((segment % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment < 1) {
    red = chroma;
    green = mid;
  } else if (segment < 2) {
    red = mid;
    green = chroma;
  } else if (segment < 3) {
    green = chroma;
    blue = mid;
  } else if (segment < 4) {
    green = mid;
    blue = chroma;
  } else if (segment < 5) {
    red = mid;
    blue = chroma;
  } else {
    red = chroma;
    blue = mid;
  }

  const lift = lightness - chroma / 2;
  const toByte = (value: number): string =>
    Math.round((value + lift) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toByte(red)}${toByte(green)}${toByte(blue)}`;
}

/**
 * Mixes two milestone colors through the hue circle.
 *
 * @remarks
 * Plain RGB gradients between complementary colors wash out into gray and
 * vanish on a white background. Interpolating the hue instead keeps the
 * middle of a dependency connection vivid.
 *
 * @param fromHex - Source milestone color.
 * @param toHex - Target milestone color.
 * @returns The vivid midpoint color, or the source color when invalid.
 */
function linkMidColor(fromHex: string, toHex: string): string {
  const from = hexToHsl(fromHex);
  const to = hexToHsl(toHex);

  if (!from || !to) {
    return fromHex;
  }

  let delta = to.h - from.h;

  if (delta > 180) {
    delta -= 360;
  }

  if (delta < -180) {
    delta += 360;
  }

  const hue = (from.h + delta / 2 + 360) % 360;

  return hslToHex(hue, Math.max(from.s, to.s), (from.l + to.l) / 2);
}

function serverTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Builds the cubic curve between two milestone edges.
 *
 * @remarks
 * The bend scales with the visible gap so adjacent milestones still get a
 * readable curve instead of no connection at all. Both ends run slightly
 * underneath the connected cards (which render above the lines), so the
 * visible line always touches the card edges regardless of the dash rhythm.
 *
 * @param link - Connection with resolved edge anchors.
 * @returns The SVG path description running into both card edges.
 */
function dependencyPath(link: DependencyLink): string {
  const gap = Math.abs(link.toX - link.fromX);
  const bend = Math.min(24, Math.max(6, gap / 2));

  if (link.leftToRight) {
    return `M ${link.fromX} ${link.fromY} C ${link.fromX + bend} ${link.fromY}, ${link.toX - bend} ${link.toY}, ${link.toX + 10} ${link.toY}`;
  }

  return `M ${link.fromX} ${link.fromY} C ${link.fromX - bend} ${link.fromY}, ${link.toX + bend} ${link.toY}, ${link.toX - 10} ${link.toY}`;
}

/** Renders one milestone element sized exactly by its time span. */
function TimelineMilestone({
  card,
  top,
  isSelected,
  onSelect,
}: {
  readonly card: PlacedCard;
  readonly top: number;
  readonly isSelected: boolean;
  readonly onSelect: (milestone: Milestone) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const dateText = card.isRange
    ? formatRangeLabel(card.start, card.end)
    : formatDayMonth(card.end);
  const statusText = t(
    `projectDetail.planning.phasePlan.${
      card.milestone.status === "completed"
        ? "statusCompleted"
        : card.milestone.status === "archived"
          ? "statusArchived"
          : "statusOpen"
    }`,
  );
  // The chip never exceeds its box, so content can never collide or spill.
  const chip = Math.min(card.chipSize, Math.max(16, card.width - 8));
  const tone = card.isArchived
    ? "opacity-60 saturate-50"
    : card.isPending
      ? "opacity-70"
      : "";
  // Selected milestones use the same orange tint as active menu entries.
  const selectedTone = isSelected
    ? "border-primary bg-primary-subtle shadow-md ring-2 ring-primary/25"
    : "border-border/60 bg-surface";
  const chipColor = card.isArchived ? ARCHIVED_LINK_COLOR : card.hex;

  function handleClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    onSelect(card.milestone);
  }

  if (card.density === "marker") {
    return (
      <button
        type="button"
        disabled={card.isPending}
        className={`absolute z-[6] flex items-center justify-center rounded-lg border shadow-md outline-none transition-shadow hover:shadow-lg focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait ${selectedTone} ${tone}`}
        style={{
          height: `${CARD_HEIGHT}px`,
          left: `${card.left}px`,
          top: `${top}px`,
          width: `${card.width}px`,
        }}
        title={`${card.milestone.name}\n${dateText}\n${statusText}`}
        onClick={handleClick}
      >
        <span
          className="flex shrink-0 items-center justify-center rounded-md text-white"
          style={{
            backgroundColor: chipColor,
            height: `${chip}px`,
            width: `${chip}px`,
          }}
          aria-hidden="true"
        >
          <MilestoneMarkerIcon
            icon={card.milestone.iconKey ?? null}
            color={card.color}
            className={
              chip >= POINT_MARKER_SIZE ? "size-4 shrink-0" : "size-3 shrink-0"
            }
          />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={card.isPending}
      className={`absolute z-[6] flex items-center rounded-xl border text-left shadow-md outline-none transition-shadow hover:shadow-lg focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait ${selectedTone} ${tone} ${
        card.density === "full" || card.density === "title"
          ? "justify-start gap-2.5 p-2.5"
          : "justify-center p-2"
      }`}
      style={{
        height: `${CARD_HEIGHT}px`,
        left: `${card.left}px`,
        top: `${top}px`,
        width: `${card.width}px`,
      }}
      title={`${card.milestone.name}\n${dateText}\n${statusText}`}
      onClick={handleClick}
    >
      <span
        className="flex shrink-0 items-center justify-center rounded-lg text-white"
        style={{
          backgroundColor: chipColor,
          height: `${chip}px`,
          width: `${chip}px`,
        }}
        aria-hidden="true"
      >
        <MilestoneMarkerIcon
          icon={card.milestone.iconKey ?? null}
          color={card.color}
          className={chip >= 32 ? "size-4 shrink-0" : "size-3.5 shrink-0"}
        />
      </span>
      {card.density === "icon" ? null : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-foreground">
            {card.milestone.name}
          </span>
          {card.density === "full" ? (
            <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
              <Calendar className="size-3 shrink-0" aria-hidden="true" />
              {dateText}
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
}

/** Renders a searchable milestone picker for dependency targets. */
function MilestoneSearchSelect({
  options,
  selectedId,
  onSelect,
  choosePlaceholder,
  searchPlaceholder,
}: {
  readonly options: readonly { readonly id: string; readonly name: string }[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly choosePlaceholder: string;
  readonly searchPlaceholder: string;
}): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.id === selectedId) ?? null;
  const matches = options.filter((option) =>
    option.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function handleOpen(): void {
    setQuery("");
    setIsOpen(true);
  }

  function handleClose(): void {
    setIsOpen(false);
  }

  function handleSelect(id: string): void {
    onSelect(id);
    setIsOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      handleClose();
    }
  }

  return (
    <div className="relative" onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg bg-card px-2.5 text-xs font-medium text-foreground shadow-xs outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary"
        onClick={handleOpen}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selected ? selected.name : choosePlaceholder}
        </span>
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <>
          <button
            type="button"
            aria-label={choosePlaceholder}
            className="fixed inset-0 z-[70] cursor-default"
            onClick={handleClose}
          />
          <div className="absolute inset-x-0 top-full z-[71] mt-1 rounded-xl border border-border/60 bg-surface p-1 shadow-panel">
            <Input
              value={query}
              maxLength={100}
              autoFocus
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <ul className="mt-1 max-h-48 overflow-y-auto">
              {matches.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className="flex min-h-8 w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-foreground outline-none select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => handleSelect(option.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.name}
                    </span>
                  </button>
                </li>
              ))}
              {matches.length === 0 ? (
                <li className="px-2.5 py-2 text-xs text-muted-foreground">
                  {searchPlaceholder}
                </li>
              ) : null}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

const SYMBOL_OPTIONS: readonly MilestoneIcon[] = [
  MILESTONE_ICON.DIAMOND,
  MILESTONE_ICON.ROCKET,
  MILESTONE_ICON.FLAG,
  MILESTONE_ICON.TARGET,
  MILESTONE_ICON.SPARKLES,
  MILESTONE_ICON.CALENDAR,
  MILESTONE_ICON.PACKAGE,
  MILESTONE_ICON.COG,
  MILESTONE_ICON.USERS,
  MILESTONE_ICON.LINK,
  MILESTONE_ICON.MEGAPHONE,
  MILESTONE_ICON.SHIELD,
  MILESTONE_ICON.BELL,
  MILESTONE_ICON.BUG,
  MILESTONE_ICON.FLASK,
  MILESTONE_ICON.STAR,
  MILESTONE_ICON.CHECK,
  MILESTONE_ICON.BOOKMARK,
  MILESTONE_ICON.CLIPBOARD,
  MILESTONE_ICON.WRENCH,
  MILESTONE_ICON.LAYERS,
  MILESTONE_ICON.GLOBE,
  MILESTONE_ICON.LIGHTBULB,
  MILESTONE_ICON.MONITOR,
  MILESTONE_ICON.SERVER,
  MILESTONE_ICON.FOLDER,
  MILESTONE_ICON.BRIEFCASE,
  MILESTONE_ICON.PEN,
  MILESTONE_ICON.PALETTE,
  MILESTONE_ICON.ZAP,
  MILESTONE_ICON.HEART,
  MILESTONE_ICON.AWARD,
  MILESTONE_ICON.PUZZLE,
  MILESTONE_ICON.SEARCH,
  MILESTONE_ICON.LOCK,
  MILESTONE_ICON.KEY,
  MILESTONE_ICON.CPU,
  MILESTONE_ICON.DATABASE,
  MILESTONE_ICON.MESSAGE,
  MILESTONE_ICON.FILE,
];

interface SymbolColorPickerProps {
  readonly selectedIcon: MilestoneIcon;
  readonly selectedHex: string;
  readonly initialCustom: string | null;
  readonly onIconChange: (icon: MilestoneIcon) => void;
  readonly onPresetChange: (hex: string) => void;
  readonly onCustomChange: (hex: string | null) => void;
  readonly onClose: () => void;
}

/**
 * Renders the floating symbol and color picker inside the panel header.
 *
 * @remarks
 * Only the symbol grid scrolls; the preset dots and the custom row stay
 * visible so the popover keeps a stable compact height. Every choice only
 * updates the panel draft and the timeline preview; nothing is persisted
 * until the panel is saved.
 */
function SymbolColorPicker({
  selectedIcon,
  selectedHex,
  initialCustom,
  onIconChange,
  onPresetChange,
  onCustomChange,
  onClose,
}: SymbolColorPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const [hexText, setHexText] = useState(
    normalizeHexColorCode(initialCustom) ?? "",
  );
  const effectiveHex = normalizeHexColorCode(selectedHex) ?? selectedHex;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      onClose();
    }
  }

  function handleHexTextChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextText = event.currentTarget.value;
    setHexText(nextText);

    const normalized = normalizeHexColorCode(nextText.trim());

    if (normalized !== null) {
      onCustomChange(normalized);
    }
  }

  function handleSpectrumChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextHex = event.currentTarget.value;
    setHexText(nextHex);
    onCustomChange(nextHex);
  }

  function handlePresetSelect(hex: string): void {
    setHexText(hex);
    onPresetChange(hex);
  }

  return (
    <>
      <button
        type="button"
        aria-label={t("projectDetail.planning.phasePlan.closePanel")}
        className="fixed inset-0 z-[70] cursor-default"
        onClick={onClose}
      />
      <div
        className="absolute top-full left-0 z-[71] mt-2 w-64 rounded-xl border border-border/60 bg-surface p-3 shadow-panel"
        onKeyDown={handleKeyDown}
      >
        <p className="text-xs font-semibold text-muted-foreground select-none">
          {t("projectDetail.planning.phasePlan.symbol")}
        </p>
        <VerticalScrollArea
          className="mt-2"
          viewportClassName="max-h-[14.5rem]"
          contentClassName="pr-1"
        >
          <div className="grid grid-cols-4 gap-1.5">
            {SYMBOL_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={t(
                  `projectDetail.planning.phasePlan.icons.${option}`,
                )}
                aria-pressed={option === selectedIcon}
                className={`flex aspect-square w-full items-center justify-center rounded-lg border outline-none transition focus-visible:ring-2 focus-visible:ring-primary ${
                  option === selectedIcon
                    ? "border-primary bg-primary-subtle ring-2 ring-primary/30"
                    : "border-transparent hover:bg-muted"
                }`}
                style={{ color: effectiveHex }}
                onClick={() => onIconChange(option)}
              >
                <MilestoneSymbol icon={option} className="size-4 shrink-0" />
              </button>
            ))}
          </div>
        </VerticalScrollArea>
        <p className="mt-3 text-xs font-semibold text-muted-foreground select-none">
          {t("projectDetail.planning.phasePlan.color")}
        </p>
        <div className="mt-2 grid grid-cols-8 gap-2">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              aria-label={t(
                `projectDetail.planning.phasePlan.presetColors.${preset.key}`,
              )}
              aria-pressed={preset.hex === effectiveHex}
              className={`size-4 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                preset.hex === effectiveHex
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-surface"
                  : "hover:scale-110"
              }`}
              style={{ backgroundColor: preset.hex }}
              onClick={() => handlePresetSelect(preset.hex)}
            />
          ))}
        </div>
        <p className="mt-3 text-xs font-semibold text-muted-foreground select-none">
          {t("projectDetail.planning.phasePlan.customColor")}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-full border border-border/60"
            style={{ backgroundColor: effectiveHex }}
          />
          <input
            type="color"
            value={effectiveHex}
            onChange={handleSpectrumChange}
            aria-label={t("projectDetail.planning.phasePlan.customColor")}
            className="h-7 w-9 shrink-0 cursor-pointer rounded-md border border-border/60 bg-transparent p-0.5"
          />
          <Input
            value={hexText}
            onChange={handleHexTextChange}
            placeholder="#f97316"
            maxLength={7}
            spellCheck={false}
            aria-label={t("projectDetail.planning.phasePlan.customColor")}
            className="h-7 font-mono text-xs"
          />
        </div>
      </div>
    </>
  );
}

/** Renders the floating milestone editor overlaying the timeline. */
function MilestonePanel({
  panel,
  outgoingLinks,
  incomingLinkSourceIds,
  candidates,
  linkCount,
  saveError,
  revertToken,
  savedToken,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
  onPreview,
  onClose,
}: {
  readonly panel: PanelState;
  readonly outgoingLinks: readonly WorkingLink[];
  readonly incomingLinkSourceIds: readonly string[];
  readonly candidates: readonly {
    readonly id: string;
    readonly name: string;
    readonly icon: MilestoneIcon | null;
    readonly hex: string;
  }[];
  readonly linkCount: number;
  readonly saveError: "saveFailed" | "linkSaveFailed" | null;
  readonly revertToken: {
    readonly token: number;
    readonly milestoneId: string | null;
    readonly links: readonly WorkingLink[];
  } | null;
  readonly savedToken: {
    readonly token: number;
    readonly milestoneId: string | null;
  } | null;
  readonly isSaving: boolean;
  readonly isDeleting: boolean;
  readonly onSave: (
    draft: PanelDraft,
    milestoneId: string | null,
    linkOps: LinkOperations,
  ) => void;
  readonly onDelete: (milestoneId: string) => void;
  readonly onPreview: (
    milestoneId: string | null,
    patch: {
      readonly iconKey: MilestoneIcon | null;
      readonly colorKey: MilestoneColor;
      readonly colorCustom: string | null;
    } | null,
  ) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const milestoneId = panel.mode === "edit" ? panel.milestone.id : null;
  const milestoneName = panel.mode === "edit" ? panel.milestone.name : "";
  const initial =
    panel.mode === "edit"
      ? toPanelDraft(panel.milestone)
      : blankPanelDraft(Date.now());

  const [baseline, setBaseline] = useState<PanelDraft>(initial);
  const [draft, setDraft] = useState<PanelDraft>(initial);
  const [baselineLinks, setBaselineLinks] =
    useState<readonly WorkingLink[]>(outgoingLinks);
  const [workingLinks, setWorkingLinks] =
    useState<readonly WorkingLink[]>(outgoingLinks);
  const [removedLinkIds, setRemovedLinkIds] = useState<readonly string[]>([]);
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const submittedRef = useRef<{
    readonly draft: PanelDraft;
    readonly links: readonly WorkingLink[];
  } | null>(null);

  useEffect(() => {
    if (revertToken !== null && revertToken.milestoneId === milestoneId) {
      setWorkingLinks(revertToken.links);
      setBaselineLinks(revertToken.links);
      setRemovedLinkIds([]);
    }
  }, [revertToken, milestoneId]);

  useEffect(() => {
    if (
      savedToken !== null &&
      savedToken.milestoneId === milestoneId &&
      submittedRef.current !== null
    ) {
      setBaseline(submittedRef.current.draft);
      setBaselineLinks(submittedRef.current.links);
      setRemovedLinkIds([]);
      submittedRef.current = null;
    }
  }, [savedToken, milestoneId]);

  const addedLinks = workingLinks.filter((link) =>
    link.id.startsWith("pending-link-"),
  );
  const keptLinks = workingLinks.filter(
    (link) => !link.id.startsWith("pending-link-"),
  );
  const baselineSignature = [
    ...baselineLinks.map((link) => link.id),
    ...removedLinkIds,
  ]
    .sort()
    .join("|");
  const workingSignature = [
    ...keptLinks.map((link) => link.id),
    ...addedLinks.map((link) => link.targetId),
  ]
    .sort()
    .join("|");
  const linksDirty = baselineSignature !== workingSignature;
  const isDirty =
    draft.name.trim() !== baseline.name.trim() ||
    draft.start !== baseline.start ||
    draft.end !== baseline.end ||
    draft.description.trim() !== baseline.description.trim() ||
    draft.color !== baseline.color ||
    draft.custom !== baseline.custom ||
    draft.icon !== baseline.icon ||
    draft.status !== baseline.status ||
    linksDirty;
  const hasRangeError =
    draft.start !== "" && draft.end !== "" && draft.end < draft.start;
  const isValid =
    draft.name.trim() !== "" && draft.start !== "" && !hasRangeError;

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextName = event.currentTarget.value;
    setDraft((current) => ({ ...current, name: nextName }));
  }

  function handleStartChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextStart = event.currentTarget.value;
    setDraft((current) => ({ ...current, start: nextStart }));
  }

  function handleEndChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextEnd = event.currentTarget.value;
    setDraft((current) => ({ ...current, end: nextEnd }));
  }

  function handleDescriptionChange(
    event: ChangeEvent<HTMLTextAreaElement>,
  ): void {
    const nextDescription = event.currentTarget.value;
    setDraft((current) => ({ ...current, description: nextDescription }));
  }

  function handleStatusChange(nextValue: string): void {
    if (
      nextValue !== "open" &&
      nextValue !== "completed" &&
      nextValue !== "archived"
    ) {
      return;
    }

    setDraft((current) => ({ ...current, status: nextValue }));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape") {
      return;
    }

    if (popoverOpen) {
      setPopoverOpen(false);
      return;
    }

    onClose();
  }

  function handleSave(): void {
    if (!isDirty || !isValid || isSaving) {
      return;
    }

    submittedRef.current = { draft, links: workingLinks };
    onSave(draft, milestoneId, {
      added: addedLinks.map((link) => ({
        linkType: link.linkType,
        targetId: link.targetId,
      })),
      removedIds: removedLinkIds,
    });
  }

  function handleSelectIcon(nextIcon: MilestoneIcon): void {
    const nextDraft = { ...draft, icon: nextIcon };
    setDraft(nextDraft);
    onPreview(milestoneId, {
      colorCustom: nextDraft.custom,
      colorKey: nextDraft.color,
      iconKey: nextIcon,
    });
  }

  function handleSelectPreset(nextHex: string): void {
    const nextDraft = { ...draft, custom: nextHex };
    setDraft(nextDraft);
    onPreview(milestoneId, {
      colorCustom: nextHex,
      colorKey: nextDraft.color,
      iconKey: nextDraft.icon,
    });
  }

  function handleCustomColor(nextHex: string | null): void {
    const nextDraft = { ...draft, custom: nextHex };
    setDraft(nextDraft);
    onPreview(milestoneId, {
      colorCustom: nextHex,
      colorKey: nextDraft.color,
      iconKey: nextDraft.icon,
    });
  }

  function handleAddLink(): void {
    if (linkTargetId === null || milestoneId === null) {
      return;
    }

    const target = candidates.find(
      (candidate) => candidate.id === linkTargetId,
    );

    if (!target) {
      return;
    }

    setWorkingLinks((current) => [
      ...current,
      {
        id: `pending-link-${milestoneId}-${target.id}`,
        linkType: MILESTONE_LINK_TYPE.PREREQUISITE,
        targetHex: target.hex,
        targetIcon: target.icon,
        targetId: target.id,
        targetName: target.name,
      },
    ]);
    setLinkTargetId(null);
  }

  function handleRemoveLink(id: string): void {
    setWorkingLinks((current) => current.filter((link) => link.id !== id));

    if (!id.startsWith("pending-link-")) {
      setRemovedLinkIds((current) => [...current, id]);
    }
  }

  function handleConfirmDelete(): void {
    if (milestoneId === null) {
      return;
    }

    setShowConfirm(false);
    onDelete(milestoneId);
  }

  const incomingIds = new Set(incomingLinkSourceIds);
  const draftHex =
    normalizeHexColorCode(draft.custom) ?? TYPE_COLORS[draft.color];
  const linkableCandidates = candidates.filter((candidate) => {
    if (incomingIds.has(candidate.id)) {
      return false;
    }

    if (workingLinks.some((link) => link.targetId === candidate.id)) {
      return false;
    }

    return true;
  });

  return (
    <aside
      className="fixed z-40 flex w-[min(28rem,calc(100vw-2.5rem))] flex-col rounded-2xl border border-border/60 bg-surface shadow-panel"
      style={
        {
          "--scroll-fade-channels": "255 255 255",
          bottom: 16,
          right: 20,
          top: "6rem",
        } as CSSProperties
      }
      aria-label={t("projectDetail.planning.phasePlan.panelTitle")}
      onKeyDown={handleKeyDown}
    >
      <div className="flex shrink-0 items-center gap-3 px-5 pt-5 pb-3">
        <div className="relative shrink-0">
          <button
            type="button"
            className="flex size-10 items-center justify-center rounded-xl outline-none transition focus-visible:ring-2 focus-visible:ring-primary"
            style={{
              backgroundColor: `${draftHex}26`,
              color: draftHex,
            }}
            aria-label={t("projectDetail.planning.phasePlan.symbol")}
            aria-expanded={popoverOpen}
            onClick={() => setPopoverOpen((isOpen) => !isOpen)}
          >
            <MilestoneMarkerIcon
              icon={draft.icon}
              color={draft.color}
              className="size-5 shrink-0"
            />
          </button>
          {popoverOpen ? (
            <SymbolColorPicker
              selectedIcon={draft.icon ?? COLOR_DEFAULT_ICON[draft.color]}
              selectedHex={draftHex}
              initialCustom={draft.custom}
              onIconChange={handleSelectIcon}
              onPresetChange={handleSelectPreset}
              onCustomChange={handleCustomColor}
              onClose={() => setPopoverOpen(false)}
            />
          ) : null}
        </div>
        <h3 className="min-w-0 flex-1 text-lg font-semibold text-foreground">
          {t("projectDetail.planning.phasePlan.panelTitle")}
        </h3>
        <button
          type="button"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t("projectDetail.planning.phasePlan.closePanel")}
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <VerticalScrollArea
        className="min-h-0 flex-1"
        contentClassName="gap-4 px-5 pt-1 pb-3"
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span className="select-none">
            {t("projectDetail.planning.phasePlan.name")}
          </span>
          <Input
            name="name"
            value={draft.name}
            maxLength={200}
            autoFocus
            onChange={handleNameChange}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            <span className="select-none">
              {t("projectDetail.planning.phasePlan.startDate")}
            </span>
            <Input
              name="startAt"
              type="date"
              value={draft.start}
              onChange={handleStartChange}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            <span className="select-none">
              {t("projectDetail.planning.phasePlan.endDate")}
            </span>
            <Input
              name="endAt"
              type="date"
              value={draft.end}
              min={draft.start || undefined}
              onChange={handleEndChange}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span className="select-none">
            {t("projectDetail.planning.phasePlan.description")}
          </span>
          <Textarea
            name="description"
            className="min-h-24 resize-y"
            value={draft.description}
            maxLength={2000}
            onChange={handleDescriptionChange}
          />
        </label>
        <div className="flex flex-col gap-1.5 text-sm font-medium">
          <span className="select-none">
            {t("projectDetail.planning.phasePlan.status")}
          </span>
          <Select
            id="milestone-panel-status"
            ariaLabel={t("projectDetail.planning.phasePlan.status")}
            value={draft.status}
            onValueChange={handleStatusChange}
            className="w-full"
            options={[
              {
                label: t("projectDetail.planning.phasePlan.statusOpen"),
                value: "open",
              },
              {
                label: t("projectDetail.planning.phasePlan.statusCompleted"),
                value: "completed",
              },
              {
                label: t("projectDetail.planning.phasePlan.statusArchived"),
                value: "archived",
              },
            ]}
          />
        </div>
        {milestoneId !== null ? (
          <div className="flex flex-col gap-2 text-sm font-medium">
            <span className="select-none">
              {t("projectDetail.planning.phasePlan.dependencies")}
            </span>
            <div className="flex flex-col gap-1.5">
              <span className="select-none text-xs font-medium text-muted-foreground">
                {t("projectDetail.planning.phasePlan.linkWith")}
              </span>
              <MilestoneSearchSelect
                options={linkableCandidates}
                selectedId={linkTargetId}
                onSelect={setLinkTargetId}
                choosePlaceholder={t(
                  "projectDetail.planning.phasePlan.linkChoose",
                )}
                searchPlaceholder={t(
                  "projectDetail.planning.phasePlan.linkSearch",
                )}
              />
            </div>
            <Button
              className="h-9 w-full bg-primary-subtle text-xs font-semibold text-primary hover:bg-primary-subtle hover:opacity-80"
              type="button"
              disabled={linkTargetId === null}
              onClick={handleAddLink}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {t("projectDetail.planning.phasePlan.addLink")}
            </Button>
            {workingLinks.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {workingLinks.map((link) => (
                  <li
                    key={link.id}
                    className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs"
                  >
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-md"
                      style={{
                        backgroundColor: `${link.targetHex}26`,
                        color: link.targetHex,
                      }}
                      aria-hidden="true"
                    >
                      <MilestoneSymbol
                        icon={link.targetIcon ?? MILESTONE_ICON.DIAMOND}
                        className="size-3.5 shrink-0"
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {link.targetName}
                    </span>
                    <button
                      type="button"
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={`${link.targetName}`}
                      onClick={() => handleRemoveLink(link.id)}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {hasRangeError ? (
          <p className="text-xs font-medium text-destructive" role="alert">
            {t("projectDetail.planning.phasePlan.invalidRange")}
          </p>
        ) : null}
        {saveError ? (
          <p className="text-xs font-medium text-destructive" role="alert">
            {t(`projectDetail.planning.phasePlan.${saveError}`)}
          </p>
        ) : null}
        {isDirty || saveError ? null : (
          <div className="flex items-start gap-2.5 rounded-xl bg-muted/60 px-4 py-3">
            <Info
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="block font-semibold text-foreground">
                {t("projectDetail.planning.phasePlan.noChangesTitle")}
              </span>
              {t("projectDetail.planning.phasePlan.noChangesHint")}
            </p>
          </div>
        )}
      </VerticalScrollArea>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 px-5 pt-3 pb-5">
        {milestoneId !== null ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setShowConfirm(true)}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t("projectDetail.planning.phasePlan.deleteMilestone")}
          </button>
        ) : (
          <span />
        )}
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            className="h-10"
            type="button"
            onClick={onClose}
          >
            {t("projects.actions.cancel")}
          </Button>
          <Button
            className="h-10"
            type="button"
            disabled={!isDirty || !isValid || isSaving}
            onClick={handleSave}
          >
            {t("projects.edit.submit")}
          </Button>
        </div>
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="w-[min(26rem,92vw)]">
          <DialogTitle className="select-none text-lg font-semibold text-foreground">
            {t("projectDetail.planning.phasePlan.deleteTitle")}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t("projectDetail.planning.phasePlan.deleteDescription", {
              name: milestoneName,
            })}
            {linkCount > 0
              ? ` ${t("projectDetail.planning.phasePlan.deleteLinksHint")}`
              : ""}
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setShowConfirm(false)}
            >
              {t("projects.actions.cancel")}
            </Button>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              type="button"
              disabled={isDeleting}
              onClick={handleConfirmDelete}
            >
              {t("projectDetail.planning.phasePlan.deleteConfirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
