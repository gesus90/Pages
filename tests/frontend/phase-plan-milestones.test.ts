import { describe, expect, it } from "vitest";

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

import { createLink, createMilestone } from "../helpers/plan-fixtures";

import type { Milestone } from "@/definition/Task";

describe("milestone basics", () => {
  it("defaults to the standard color and resolves the displayed one", () => {
    expect(getMilestoneColor(createMilestone())).toBe("standard");
    expect(getMilestoneColor(createMilestone({ colorKey: "release" }))).toBe(
      "release",
    );
    expect(getMilestoneDisplayColor(createMilestone())).toBe("#f97316");
    expect(
      getMilestoneDisplayColor(createMilestone({ colorKey: "release" })),
    ).toBe("#3b82f6");
    expect(
      getMilestoneDisplayColor(createMilestone({ colorCustom: "#ABC" })),
    ).toBe("#aabbcc");
  });

  it("detects archived and pending milestones", () => {
    expect(isArchivedMilestone(createMilestone({ status: "archived" }))).toBe(
      true,
    );
    expect(isArchivedMilestone(createMilestone())).toBe(false);
    expect(isPendingMilestoneId("pending-1")).toBe(true);
    expect(isPendingMilestoneId("m1")).toBe(false);
  });

  it("positions by the start date, falling back to the due date", () => {
    const start = new Date(2026, 8, 10).getTime();
    const due = new Date(2026, 8, 20).getTime();

    expect(getMilestoneTime(createMilestone({ dueAt: "2026-09-20" }))).toBe(
      start,
    );
    expect(
      getMilestoneTime(createMilestone({ dueAt: "2026-09-20", startAt: null })),
    ).toBe(due);
    expect(
      getMilestoneTime(createMilestone({ dueAt: null, startAt: null })),
    ).toBeNull();
  });

  it("defines a lane color and a default symbol for everything", () => {
    expect(LANE_ORDER).toHaveLength(5);
    expect(Object.keys(LANE_DOT_COLORS)).toHaveLength(5);
    expect(COLOR_DEFAULT_ICON.release).toBe("rocket");
  });
});

describe("assignGroup", () => {
  it.each([
    ["Kickoff", "product"],
    ["Beta Release", "product"],
    ["UI Mockup", "design"],
    ["Backend fertig", "development"],
    ["QA Abnahme", "testing"],
    ["Go-Live", "deployment"],
    ["Produktions-Release", "deployment"],
    ["Qualität sichern", "testing"],
  ])("sorts %s into %s", (name, group) => {
    expect(assignGroup(name)).toBe(group);
  });
});

describe("panel drafts", () => {
  it("starts a draft from an existing milestone", () => {
    expect(
      toPanelDraft(
        createMilestone({
          colorCustom: "#112233",
          colorKey: "team",
          description: "Text",
          dueAt: "2026-09-20",
          iconKey: "flag",
          status: "completed",
        }),
      ),
    ).toEqual({
      color: "team",
      custom: "#112233",
      description: "Text",
      end: "2026-09-20",
      icon: "flag",
      name: "Milestone",
      start: "2026-09-10",
      status: "completed",
    });
  });

  it("treats a due date equal to the start as no range", () => {
    expect(toPanelDraft(createMilestone({ dueAt: "2026-09-10" })).end).toBe("");
  });

  it("falls back to the due date as start and handles missing values", () => {
    const draft = toPanelDraft(
      createMilestone({ dueAt: "2026-09-20", startAt: null }),
    );

    expect(draft.start).toBe("2026-09-20");
    expect(draft.end).toBe("");
    expect(draft.custom).toBeNull();
    expect(draft.icon).toBeNull();
    expect(
      toPanelDraft(createMilestone({ dueAt: null, startAt: null })).start,
    ).toBe("");
  });

  it("starts an empty draft today", () => {
    expect(blankPanelDraft(new Date(2026, 8, 5).getTime())).toEqual({
      color: "standard",
      custom: null,
      description: "",
      end: "",
      icon: null,
      name: "",
      start: "2026-09-05",
      status: "open",
    });
  });

  it("names the edited milestone", () => {
    expect(panelMilestoneIdFor(null)).toBeNull();
    expect(panelMilestoneIdFor({ mode: "create" })).toBeNull();
    expect(
      panelMilestoneIdFor({ milestone: createMilestone(), mode: "edit" }),
    ).toBe("m1");
  });
});

describe("toWorkingLinks", () => {
  const milestones = [
    createMilestone({ colorCustom: "#112233", iconKey: "bug", id: "m2" }),
    createMilestone({ id: "m1" }),
  ];

  it("has nothing for a milestone that is being created", () => {
    expect(toWorkingLinks(null, [createLink()], milestones)).toEqual([]);
  });

  it("resolves outgoing links with their targets", () => {
    expect(
      toWorkingLinks(
        "m1",
        [createLink(), createLink({ id: "l2", sourceId: "m2" })],
        milestones,
      ),
    ).toEqual([
      {
        id: "l1",
        linkType: "prerequisite",
        targetHex: "#112233",
        targetIcon: "bug",
        targetId: "m2",
        targetName: "Milestone",
      },
    ]);
  });

  it("falls back for a target that is gone", () => {
    expect(
      toWorkingLinks("m1", [createLink({ targetId: "gone" })], milestones),
    ).toEqual([
      {
        id: "l1",
        linkType: "prerequisite",
        targetHex: "#f97316",
        targetIcon: null,
        targetId: "gone",
        targetName: "gone",
      },
    ]);
  });
});

describe("describePanelLinks", () => {
  const milestones = [
    createMilestone({ id: "m1", name: "One" }),
    createMilestone({ id: "m2", name: "Two" }),
    createMilestone({ id: "pending-3", name: "Pending" }),
  ];
  const links = [
    createLink({ id: "out", sourceId: "m1", targetId: "m2" }),
    createLink({ id: "in", sourceId: "m2", targetId: "m1" }),
  ];

  it("describes the links of an edited milestone", () => {
    const context = describePanelLinks(
      { milestone: milestones[0] as Milestone, mode: "edit" },
      milestones,
      links,
    );

    expect(context.outgoingLinks.map((link) => link.id)).toEqual(["out"]);
    expect(context.incomingLinkSourceIds).toEqual(["m2"]);
    expect(context.candidates.map((candidate) => candidate.id)).toEqual(["m2"]);
    expect(context.linkCount).toBe(2);
  });

  it("offers every milestone while creating", () => {
    const context = describePanelLinks({ mode: "create" }, milestones, links);

    expect(context.outgoingLinks).toEqual([]);
    expect(context.incomingLinkSourceIds).toEqual([]);
    expect(context.candidates).toHaveLength(3);
    expect(context.linkCount).toBe(0);
  });
});

describe("getActionOutcome", () => {
  it.each([
    [{ ok: true }, "ok"],
    [{ ok: false }, "failed"],
    [{ ok: "yes" }, null],
    [{ other: 1 }, null],
    [null, null],
    [undefined, null],
    ["ok", null],
  ])("reads %j as %j", (value, expected) => {
    expect(getActionOutcome(value)).toBe(expected);
  });
});
