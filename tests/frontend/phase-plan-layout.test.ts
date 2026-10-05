import { describe, expect, it } from "vitest";

import {
  CARD_HEIGHT,
  CARD_LEVEL_STRIDE,
  LANE_PADDING,
  buildDependencyLinks,
  dependencyPath,
  getCardDensity,
  layoutLanes,
} from "@/app/lib/phase-plan/plan-layout";
import { splitDated } from "@/app/lib/phase-plan/plan-optimistic";

import { createLink, createMilestone } from "../helpers/plan-fixtures";

import type { DependencyLink } from "@/app/lib/phase-plan/plan-types";

const DAY = 86_400_000;
const ORIGIN = new Date(2026, 8, 1).getTime();

function timeToX(time: number): number {
  return ((time - ORIGIN) / DAY) * 10;
}

function layout(
  milestones: Parameters<typeof splitDated>[0],
  overrides: { bufferMs?: number; trackWidth?: number } = {},
): ReturnType<typeof layoutLanes> {
  return layoutLanes({
    bufferMs: overrides.bufferMs ?? 0,
    dated: splitDated(milestones).dated,
    pixelsPerDay: 10,
    timeToX,
    trackWidth: overrides.trackWidth ?? 10_000,
  });
}

describe("getCardDensity", () => {
  it.each([
    [300, "full"],
    [210, "full"],
    [150, "title"],
    [110, "title"],
    [80, "icon"],
    [56, "icon"],
    [20, "marker"],
  ])("maps %dpx to %s", (width, density) => {
    expect(getCardDensity(width)).toBe(density);
  });
});

describe("layoutLanes", () => {
  it("has no lanes without milestones", () => {
    expect(layout([])).toEqual({ bodyHeight: 0, lanes: [] });
  });

  it("places a single day as a centered marker", () => {
    const { lanes, bodyHeight } = layout([
      createMilestone({ id: "a", startAt: "2026-09-11" }),
    ]);
    const card = lanes[0]?.cards[0];

    expect(lanes).toHaveLength(1);
    expect(lanes[0]?.key).toBe("product");
    expect(card).toMatchObject({
      chipSize: 32,
      density: "marker",
      isRange: false,
      left: 100 - 20,
      level: 0,
      width: 40,
    });
    expect(bodyHeight).toBe(LANE_PADDING * 2 + CARD_HEIGHT);
  });

  it.each([
    ["a wide range", "2026-10-05", "full", 36, 250],
    ["a medium range", "2026-09-22", "title", 36, 120],
    ["a narrow range", "2026-09-17", "icon", 32, 70],
    ["a very narrow range", "2026-09-15", "marker", 24, 50],
  ])("sizes %s", (_label, dueAt, density, chipSize, width) => {
    const { lanes } = layout([
      createMilestone({ dueAt, id: "a", startAt: "2026-09-10" }),
    ]);
    const card = lanes[0]?.cards[0];

    expect(card?.isRange).toBe(true);
    expect(card?.density).toBe(density);
    expect(card?.chipSize).toBe(chipSize);
    expect(card?.width).toBe(width);
  });

  it("shrinks a range thinner than a marker to a centered marker", () => {
    const { lanes } = layout([
      createMilestone({ dueAt: "2026-09-12", id: "a", startAt: "2026-09-10" }),
    ]);
    const card = lanes[0]?.cards[0];

    expect(card).toMatchObject({
      chipSize: 20,
      density: "marker",
      isRange: true,
      width: 28,
    });
    expect(card?.left).toBe(90 + 10 - 14);
  });

  it("stacks overlapping cards on separate levels and reuses free ones", () => {
    const { lanes } = layout([
      createMilestone({ dueAt: "2026-09-30", id: "a", startAt: "2026-09-10" }),
      createMilestone({ dueAt: "2026-09-30", id: "b", startAt: "2026-09-12" }),
      createMilestone({ id: "c", startAt: "2026-10-20" }),
    ]);
    const cards = lanes[0]?.cards ?? [];

    expect(cards.map((card) => card.level)).toEqual([0, 1, 0]);
    expect(lanes[0]?.height).toBe(
      LANE_PADDING * 2 + 2 * CARD_HEIGHT + (CARD_LEVEL_STRIDE - CARD_HEIGHT),
    );
  });

  it("sorts milestones into lanes by name and stacks the lanes", () => {
    const { lanes, bodyHeight } = layout([
      createMilestone({ id: "a", name: "Deploy", startAt: "2026-09-10" }),
      createMilestone({ id: "b", name: "Design", startAt: "2026-09-10" }),
    ]);

    expect(lanes.map((lane) => lane.key)).toEqual(["design", "deployment"]);
    expect(lanes[1]?.top).toBe(lanes[0]?.height);
    expect(bodyHeight).toBe((lanes[0]?.height ?? 0) + (lanes[1]?.height ?? 0));
  });

  it("keeps only cards inside the visible buffer", () => {
    const milestones = [
      createMilestone({ id: "near", startAt: "2026-09-05" }),
      createMilestone({ id: "left", startAt: "2026-08-01" }),
      createMilestone({ id: "right", startAt: "2027-09-01" }),
    ];
    const strict = layout(milestones, { trackWidth: 1000 });
    const buffered = layout(milestones, {
      bufferMs: 400 * DAY,
      trackWidth: 1000,
    });

    expect(strict.lanes[0]?.cards.map((card) => card.milestone.id)).toEqual([
      "near",
    ]);
    expect(buffered.lanes[0]?.cards.map((card) => card.milestone.id)).toEqual([
      "left",
      "near",
      "right",
    ]);
  });

  it("flags archived and pending cards and resolves their colors", () => {
    const { lanes } = layout([
      createMilestone({ colorKey: "release", id: "a", status: "archived" }),
      createMilestone({ id: "pending-1", startAt: "2026-09-20" }),
    ]);
    const [archived, pending] = lanes[0]?.cards ?? [];

    expect(archived).toMatchObject({
      color: "release",
      hex: "#3b82f6",
      isArchived: true,
      isPending: false,
    });
    expect(pending).toMatchObject({ isArchived: false, isPending: true });
  });
});

describe("buildDependencyLinks", () => {
  function lanesFor(
    milestones: Parameters<typeof splitDated>[0],
  ): ReturnType<typeof layoutLanes>["lanes"] {
    return layout(milestones, { bufferMs: 1000 * DAY }).lanes;
  }

  const spread = [
    createMilestone({ id: "m1", startAt: "2026-09-05" }),
    createMilestone({ id: "m2", startAt: "2026-10-20" }),
  ];

  it("links left to right with the edges facing each other", () => {
    const [link] = buildDependencyLinks([createLink()], lanesFor(spread));

    expect(link).toMatchObject({ key: "l1", leftToRight: true, opacity: 0.9 });
    expect(link?.fromX).toBeLessThan(link?.toX ?? 0);
    expect(link?.fromColor).toBe("#f97316");
  });

  it("links right to left when the target lies before the source", () => {
    const [link] = buildDependencyLinks(
      [createLink({ sourceId: "m2", targetId: "m1" })],
      lanesFor(spread),
    );

    expect(link?.leftToRight).toBe(false);
    expect(link?.fromX).toBeGreaterThan(link?.toX ?? 0);
  });

  it("skips links to unknown milestones and overlapping cards", () => {
    expect(
      buildDependencyLinks(
        [createLink({ targetId: "gone" })],
        lanesFor(spread),
      ),
    ).toEqual([]);
    expect(
      buildDependencyLinks(
        [createLink({ sourceId: "gone" })],
        lanesFor(spread),
      ),
    ).toEqual([]);

    const overlapping = [
      createMilestone({ dueAt: "2026-09-30", id: "m1", startAt: "2026-09-10" }),
      createMilestone({ dueAt: "2026-09-30", id: "m2", startAt: "2026-09-12" }),
    ];

    expect(buildDependencyLinks([createLink()], lanesFor(overlapping))).toEqual(
      [],
    );
  });

  it("dims links of archived milestones", () => {
    const one = buildDependencyLinks(
      [createLink()],
      lanesFor([
        createMilestone({
          id: "m1",
          startAt: "2026-09-05",
          status: "archived",
        }),
        createMilestone({ id: "m2", startAt: "2026-10-20" }),
      ]),
    );
    const both = buildDependencyLinks(
      [createLink()],
      lanesFor([
        createMilestone({
          id: "m1",
          startAt: "2026-09-05",
          status: "archived",
        }),
        createMilestone({
          id: "m2",
          startAt: "2026-10-20",
          status: "archived",
        }),
      ]),
    );

    expect(one[0]).toMatchObject({
      fromColor: "#94a3b8",
      opacity: 0.45,
      toColor: "#94a3b8",
    });
    expect(both[0]?.opacity).toBe(0.25);
  });
});

describe("dependencyPath", () => {
  const base: DependencyLink = {
    fromColor: "#000000",
    fromX: 100,
    fromY: 20,
    key: "k",
    leftToRight: true,
    opacity: 1,
    toColor: "#000000",
    toX: 300,
    toY: 80,
  };

  it("bends rightwards for a left to right link", () => {
    expect(dependencyPath(base)).toBe("M 100 20 C 124 20, 276 80, 310 80");
  });

  it("bends leftwards for a right to left link", () => {
    expect(
      dependencyPath({ ...base, fromX: 300, leftToRight: false, toX: 100 }),
    ).toBe("M 300 20 C 276 20, 124 80, 90 80");
  });

  it("keeps a readable bend for adjacent cards", () => {
    expect(dependencyPath({ ...base, toX: 102 })).toContain("C 106 20, 96 80");
  });
});
