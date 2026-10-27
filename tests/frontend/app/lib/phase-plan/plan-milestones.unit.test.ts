import { describe, expect, it } from "vitest";

import { TYPE_COLORS } from "@/app/lib/phase-plan/plan-colors";
import {
  COLOR_DEFAULT_ICON,
  LANE_DOT_COLORS,
  LANE_ORDER,
  assignGroup,
  blankPanelDraft,
  describePanelLinks,
  getActionOutcome,
  getMilestoneColor,
  getMilestoneDisplayColor,
  getMilestoneTime,
  isArchivedMilestone,
  isPendingMilestoneId,
  panelMilestoneIdFor,
  toPanelDraft,
  toWorkingLinks,
} from "@/app/lib/phase-plan/plan-milestones";
import { MILESTONE_COLOR } from "@/definition/Task";

import type { Milestone, MilestoneDependency } from "@/definition/Task";

function milestone(id: string, overrides: Partial<Milestone> = {}): Milestone {
  return {
    id,
    projectId: "project",
    name: `Milestone ${id}`,
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

function link(
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

describe("lanes and colors", () => {
  it("gives every lane one dot color and every color type a default icon", () => {
    expect(Object.keys(LANE_DOT_COLORS)).toEqual([...LANE_ORDER]);
    expect(Object.keys(COLOR_DEFAULT_ICON).sort()).toEqual(
      Object.values(MILESTONE_COLOR).sort(),
    );
  });

  it("falls back to the standard color and to the type color without a custom one", () => {
    const plain = milestone("a");
    const typed = milestone("b", { colorKey: MILESTONE_COLOR.RELEASE });
    const custom = milestone("c", { colorCustom: "#ABCDEF" });
    const broken = milestone("d", { colorCustom: "not-a-color" });

    expect(getMilestoneColor(plain)).toBe(MILESTONE_COLOR.STANDARD);
    expect(getMilestoneColor(typed)).toBe(MILESTONE_COLOR.RELEASE);
    expect(getMilestoneDisplayColor(plain)).toBe(
      TYPE_COLORS[MILESTONE_COLOR.STANDARD],
    );
    expect(getMilestoneDisplayColor(typed)).toBe(
      TYPE_COLORS[MILESTONE_COLOR.RELEASE],
    );
    expect(getMilestoneDisplayColor(custom).toLowerCase()).toBe("#abcdef");
    expect(getMilestoneDisplayColor(broken)).toBe(
      TYPE_COLORS[MILESTONE_COLOR.STANDARD],
    );
  });
});

describe("milestone state", () => {
  it("recognizes archived milestones and the temporary ids of unsaved ones", () => {
    expect(isArchivedMilestone(milestone("a", { status: "archived" }))).toBe(
      true,
    );
    expect(isArchivedMilestone(milestone("a", { status: "completed" }))).toBe(
      false,
    );
    expect(isPendingMilestoneId("pending-1")).toBe(true);
    expect(isPendingMilestoneId("milestone-1")).toBe(false);
  });

  it("places a milestone at its start date, else at its due date, else nowhere", () => {
    const start = new Date(2026, 5, 10).getTime();
    const due = new Date(2026, 6, 1).getTime();

    expect(
      getMilestoneTime(
        milestone("a", { startAt: "2026-06-10", dueAt: "2026-07-01" }),
      ),
    ).toBe(start);
    expect(getMilestoneTime(milestone("a", { dueAt: "2026-07-01" }))).toBe(due);
    expect(getMilestoneTime(milestone("a"))).toBeNull();
    expect(
      getMilestoneTime(milestone("a", { startAt: "10.06.2026" })),
    ).toBeNull();
  });
});

describe("sorting into lanes", () => {
  it.each([
    { name: "Beta Release", lane: "product" },
    { name: "UX Mockups", lane: "design" },
    { name: "Backend API", lane: "development" },
    { name: "QA Abnahme", lane: "testing" },
    { name: "Go-Live", lane: "deployment" },
    { name: "Something unrelated", lane: "product" },
    { name: "", lane: "product" },
  ])("sorts “$name” into $lane", ({ name, lane }) => {
    expect(assignGroup(name)).toBe(lane);
  });

  it("lets the longest matching keyword win", () => {
    // “produktion” (deployment) is longer than “produkt” (product).
    expect(assignGroup("Produktions-Release")).toBe("deployment");
    expect(assignGroup("PRODUKTION")).toBe("deployment");
  });
});

describe("the milestone panel", () => {
  it("turns a milestone with a range into a draft and drops a due date equal to the start", () => {
    const ranged = toPanelDraft(
      milestone("a", {
        startAt: "2026-06-01",
        dueAt: "2026-06-30",
        colorKey: MILESTONE_COLOR.TEAM,
        colorCustom: "#112233",
        iconKey: "flag",
        description: "Plan",
        status: "completed",
      }),
    );
    const single = toPanelDraft(
      milestone("b", { startAt: "2026-06-01", dueAt: "2026-06-01" }),
    );
    const dueOnly = toPanelDraft(milestone("c", { dueAt: "2026-06-05" }));
    const undated = toPanelDraft(milestone("d"));

    expect(ranged).toEqual({
      name: "Milestone a",
      start: "2026-06-01",
      end: "2026-06-30",
      description: "Plan",
      color: MILESTONE_COLOR.TEAM,
      custom: "#112233",
      icon: "flag",
      status: "completed",
    });
    expect(single).toMatchObject({ start: "2026-06-01", end: "" });
    expect(dueOnly).toMatchObject({ start: "2026-06-05", end: "" });
    expect(undated).toMatchObject({
      start: "",
      end: "",
      custom: null,
      icon: null,
      color: MILESTONE_COLOR.STANDARD,
    });
  });

  it("starts a new milestone today with the standard look", () => {
    expect(blankPanelDraft(new Date(2026, 5, 10).getTime())).toEqual({
      name: "",
      start: "2026-06-10",
      end: "",
      description: "",
      color: MILESTONE_COLOR.STANDARD,
      custom: null,
      icon: null,
      status: "open",
    });
  });

  it("names the milestone only when the panel edits one", () => {
    expect(panelMilestoneIdFor(null)).toBeNull();
    expect(panelMilestoneIdFor({ mode: "create" })).toBeNull();
    expect(
      panelMilestoneIdFor({ mode: "edit", milestone: milestone("a") }),
    ).toBe("a");
  });

  it("reads the action outcome only from an object with a boolean ok", () => {
    expect(getActionOutcome({ ok: true })).toBe("ok");
    expect(getActionOutcome({ ok: false })).toBe("failed");
    expect(getActionOutcome({ ok: "yes" })).toBeNull();
    expect(getActionOutcome({})).toBeNull();
    expect(getActionOutcome(null)).toBeNull();
    expect(getActionOutcome("ok")).toBeNull();
  });
});

describe("links in the panel", () => {
  const milestones = [
    milestone("a", { iconKey: "flag", colorCustom: "#112233" }),
    milestone("b"),
    milestone("pending-c"),
  ];
  const links = [
    link("ab", "a", "b"),
    link("ba", "b", "a"),
    link("ax", "a", "gone"),
    link("bc", "b", "pending-c"),
  ];

  it("lists the outgoing links of a milestone with the look of their targets", () => {
    expect(toWorkingLinks("a", links, milestones)).toEqual([
      {
        id: "ab",
        linkType: "follows",
        targetHex: TYPE_COLORS[MILESTONE_COLOR.STANDARD],
        targetIcon: null,
        targetId: "b",
        targetName: "Milestone b",
      },
      {
        id: "ax",
        linkType: "follows",
        targetHex: TYPE_COLORS[MILESTONE_COLOR.STANDARD],
        targetIcon: null,
        targetId: "gone",
        targetName: "gone",
      },
    ]);
    expect(toWorkingLinks(null, links, milestones)).toEqual([]);
    expect(toWorkingLinks("b", links, milestones)[1]?.targetIcon).toBeNull();
  });

  it("describes the links of an edited milestone and excludes itself and pending ones as candidates", () => {
    const context = describePanelLinks(
      { mode: "edit", milestone: milestones[0] ?? milestone("a") },
      milestones,
      links,
    );

    expect(context.candidates.map((candidate) => candidate.id)).toEqual(["b"]);
    expect(context.incomingLinkSourceIds).toEqual(["b"]);
    expect(context.linkCount).toBe(3);
    expect(context.outgoingLinks.map((entry) => entry.id)).toEqual([
      "ab",
      "ax",
    ]);
  });

  it("offers every milestone for a new one and counts no links", () => {
    const context = describePanelLinks({ mode: "create" }, milestones, links);

    expect(context.candidates.map((candidate) => candidate.id)).toEqual([
      "a",
      "b",
      "pending-c",
    ]);
    expect(context.candidates[0]).toEqual({
      id: "a",
      name: "Milestone a",
      icon: "flag",
      hex: "#112233",
    });
    expect(context.incomingLinkSourceIds).toEqual([]);
    expect(context.linkCount).toBe(0);
    expect(context.outgoingLinks).toEqual([]);
  });
});
