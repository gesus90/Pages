import { describe, expect, it } from "vitest";

import { ARCHIVED_LINK_COLOR } from "@/app/lib/phase-plan/plan-colors";
import {
  CARD_HEIGHT,
  CARD_LEVEL_STRIDE,
  HEADER_HEIGHT,
  LANE_PADDING,
  POINT_MARKER_SIZE,
  buildDependencyLinks,
  dependencyPath,
  getCardDensity,
  layoutLanes,
} from "@/app/lib/phase-plan/plan-layout";

import type { LaneLayoutInput } from "@/app/lib/phase-plan/plan-layout";
import type {
  DatedMilestone,
  DependencyLink,
  LaneLayout,
} from "@/app/lib/phase-plan/plan-types";
import type { Milestone, MilestoneDependency } from "@/definition/Task";

const DAY = 86_400_000;
const ORIGIN = new Date(2026, 0, 1).getTime();

function milestone(id: string, overrides: Partial<Milestone> = {}): Milestone {
  return {
    id,
    projectId: "project",
    name: "Beta release",
    description: "",
    status: "open",
    startAt: null,
    dueAt: null,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

/** A dated milestone starting `day` days after the origin of the track. */
function dated(
  id: string,
  startDay: number,
  overrides: Partial<Milestone> = {},
): DatedMilestone {
  const start = new Date(2026, 0, 1 + startDay);
  return {
    milestone: milestone(id, {
      startAt: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
      ...overrides,
    }),
    time: start.getTime(),
  };
}

const timeToX = (time: number): number => ((time - ORIGIN) / DAY) * 10;
const input = (
  items: DatedMilestone[],
  trackWidth = 2000,
): LaneLayoutInput => ({
  dated: items,
  timeToX,
  bufferMs: 0,
  pixelsPerDay: 10,
  trackWidth,
});

describe("card density", () => {
  it.each([
    { width: 400, density: "full" },
    { width: 210, density: "full" },
    { width: 209, density: "title" },
    { width: 110, density: "title" },
    { width: 109, density: "icon" },
    { width: 56, density: "icon" },
    { width: 55, density: "marker" },
    { width: 0, density: "marker" },
  ])("shows a card of $width px as $density", ({ width, density }) => {
    expect(getCardDensity(width)).toBe(density);
  });
});

describe("laying out lanes", () => {
  it("places a single-day milestone as a centered marker", () => {
    const { lanes } = layoutLanes(input([dated("a", 10)]));
    const [card] = lanes[0]?.cards ?? [];

    expect(card).toMatchObject({
      isRange: false,
      density: "marker",
      chipSize: POINT_MARKER_SIZE,
      width: POINT_MARKER_SIZE + 8,
      left: 100 - (POINT_MARKER_SIZE + 8) / 2,
      level: 0,
      isArchived: false,
      isPending: false,
      color: "standard",
    });
  });

  it.each([
    { days: 30, density: "full", chip: 36 },
    { days: 12, density: "title", chip: 36 },
    { days: 6, density: "icon", chip: 32 },
    { days: 3, density: "marker", chip: 24 },
  ])(
    "sizes a range of $days days as a $density card",
    ({ days, density, chip }) => {
      const { lanes } = layoutLanes(
        input([dated("a", 10, { dueAt: isoDay(10 + days) })]),
      );
      const [card] = lanes[0]?.cards ?? [];

      expect(card?.isRange).toBe(true);
      expect(card?.density).toBe(density);
      expect(card?.chipSize).toBe(chip);
    },
  );

  it("centers a range too narrow for a card as a small marker on its middle", () => {
    const { lanes } = layoutLanes(
      input([dated("a", 10, { dueAt: isoDay(12) })]),
    );
    const [card] = lanes[0]?.cards ?? [];

    expect(card?.width).toBe(28);
    expect(card?.left).toBe(100 + 10 - 14);
  });
});

describe("stacking and ordering cards", () => {
  it("stacks overlapping cards on new levels and reuses a level once it is free", () => {
    const { lanes, bodyHeight } = layoutLanes(
      input([
        dated("a", 0, { dueAt: isoDay(30) }),
        dated("b", 5, { dueAt: isoDay(35) }),
        dated("c", 40, { dueAt: isoDay(70) }),
      ]),
    );
    const cards = lanes[0]?.cards ?? [];

    expect(cards.map((card) => card.level)).toEqual([0, 1, 0]);
    const height =
      LANE_PADDING * 2 + 2 * CARD_HEIGHT + (CARD_LEVEL_STRIDE - CARD_HEIGHT);
    expect(lanes[0]?.height).toBe(height);
    expect(bodyHeight).toBe(height);
  });

  it("orders cards by their time and sorts milestones into their lanes below each other", () => {
    const { lanes, bodyHeight } = layoutLanes(
      input([
        dated("late", 50, { name: "Deploy to production" }),
        dated("early", 5, { name: "Design review" }),
        dated("product", 20),
      ]),
    );

    expect(lanes.map((lane) => lane.key)).toEqual([
      "product",
      "design",
      "deployment",
    ]);
    expect(lanes[1]?.top).toBe(lanes[0]?.height);
    expect(lanes[2]?.top).toBe(
      (lanes[0]?.height ?? 0) + (lanes[1]?.height ?? 0),
    );
    expect(bodyHeight).toBe(
      lanes.reduce((total, lane) => total + lane.height, 0),
    );
  });

  it("flags archived and unsaved milestones", () => {
    const { lanes } = layoutLanes(
      input([dated("a", 0, { status: "archived" }), dated("pending-b", 100)]),
    );
    const cards = lanes[0]?.cards ?? [];

    expect(cards.map((card) => card.isArchived)).toEqual([true, false]);
    expect(cards.map((card) => card.isPending)).toEqual([false, true]);
  });

  it("renders only the cards within the track plus the buffer", () => {
    const items = [
      dated("far-left", -100),
      dated("in", 10),
      dated("far-right", 400),
    ];

    const tight = layoutLanes(input(items, 500)).lanes[0]?.cards ?? [];
    const buffered =
      layoutLanes({ ...input(items, 500), bufferMs: 100 * DAY }).lanes[0]
        ?.cards ?? [];

    expect(tight.map((card) => card.milestone.id)).toEqual(["in"]);
    expect(buffered.map((card) => card.milestone.id)).toEqual([
      "far-left",
      "in",
    ]);
  });

  it("returns no lane and no height for no milestones", () => {
    expect(layoutLanes(input([]))).toEqual({ lanes: [], bodyHeight: 0 });
    expect(HEADER_HEIGHT).toBeGreaterThan(0);
  });
});

function isoDay(day: number): string {
  const date = new Date(2026, 0, 1 + day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("dependency links", () => {
  function lanesOf(items: DatedMilestone[]): readonly LaneLayout[] {
    return layoutLanes(input(items)).lanes;
  }
  function dependency(
    id: string,
    sourceId: string,
    targetId: string,
  ): MilestoneDependency {
    return {
      id,
      projectId: "project",
      sourceId,
      targetId,
      linkType: "follows",
      createdAt: "2026-01-01 00:00:00",
    };
  }

  it("connects the right edge of the earlier card to the left edge of the later one", () => {
    const lanes = lanesOf([
      dated("a", 0, { dueAt: isoDay(30), colorKey: "release" }),
      dated("b", 60, { dueAt: isoDay(90), colorKey: "review" }),
    ]);

    const [link] = buildDependencyLinks([dependency("ab", "a", "b")], lanes);

    expect(link).toMatchObject({
      key: "ab",
      leftToRight: true,
      fromX: 300,
      toX: 600,
      opacity: 0.9,
      fromColor: "#3b82f6",
      toColor: "#8b5cf6",
    });
    expect(link?.fromY).toBe(LANE_PADDING + CARD_HEIGHT / 2);
  });

  it("runs from the left edge of the later card back to the right edge of the earlier one", () => {
    const lanes = lanesOf([
      dated("a", 0, { dueAt: isoDay(30) }),
      dated("b", 60, { dueAt: isoDay(90) }),
    ]);

    const [link] = buildDependencyLinks([dependency("ba", "b", "a")], lanes);

    expect(link).toMatchObject({ leftToRight: false, fromX: 600, toX: 300 });
  });

  it("dims links to archived milestones and uses the neutral color", () => {
    const lanes = lanesOf([
      dated("a", 0, { dueAt: isoDay(30), status: "archived" }),
      dated("b", 60, { dueAt: isoDay(90) }),
      dated("c", 100, { dueAt: isoDay(120), status: "archived" }),
    ]);

    const links = buildDependencyLinks(
      [dependency("ab", "a", "b"), dependency("ac", "a", "c")],
      lanes,
    );

    expect(links.map((link) => link.opacity)).toEqual([0.45, 0.25]);
    expect(links[0]?.fromColor).toBe(ARCHIVED_LINK_COLOR);
    expect(links[0]?.toColor).toBe(ARCHIVED_LINK_COLOR);
  });

  it("skips links with a missing end and links between overlapping cards", () => {
    const lanes = lanesOf([
      dated("a", 0, { dueAt: isoDay(30) }),
      dated("b", 10, { dueAt: isoDay(40) }),
    ]);

    expect(
      buildDependencyLinks(
        [
          dependency("ghost", "a", "nowhere"),
          dependency("lost", "nowhere", "a"),
        ],
        lanes,
      ),
    ).toEqual([]);
    expect(buildDependencyLinks([dependency("ab", "a", "b")], lanes)).toEqual(
      [],
    );
  });

  it("draws a curve that leaves and enters horizontally, bending at most 24 px", () => {
    const forward: DependencyLink = {
      key: "f",
      fromX: 0,
      fromY: 5,
      toX: 200,
      toY: 50,
      fromColor: "#000000",
      toColor: "#ffffff",
      leftToRight: true,
      opacity: 1,
    };
    const backward: DependencyLink = {
      ...forward,
      fromX: 200,
      toX: 190,
      leftToRight: false,
    };

    expect(dependencyPath(forward)).toBe("M 0 5 C 24 5, 176 50, 210 50");
    expect(dependencyPath(backward)).toBe("M 200 5 C 194 5, 196 50, 180 50");
    expect(dependencyPath({ ...forward, toX: 2 })).toBe(
      "M 0 5 C 6 5, -4 50, 12 50",
    );
  });
});
