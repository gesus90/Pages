import { describe, expect, it } from "vitest";

import {
  EMPTY_OPTIMISTIC_STATE,
  applyOptimisticState,
  buildSaveFormData,
  createPendingLinks,
  createPendingMilestone,
  optimisticReducer,
  splitDated,
  withDraft,
} from "@/app/lib/phase-plan/plan-optimistic";

import { createLink, createMilestone } from "../helpers/plan-fixtures";

import type { PanelDraft } from "@/app/lib/phase-plan/plan-types";

const DRAFT: PanelDraft = {
  color: "release",
  custom: "#112233",
  description: "  Text  ",
  end: "2026-09-20",
  icon: "flag",
  name: "  Name  ",
  start: "2026-09-10",
  status: "completed",
};

describe("optimisticReducer", () => {
  const one = createMilestone({ id: "m1" });
  const two = createMilestone({ id: "m2" });

  it("starts empty and resets to empty", () => {
    const changed = optimisticReducer(EMPTY_OPTIMISTIC_STATE, {
      milestone: one,
      type: "addPending",
    });

    expect(optimisticReducer(changed, { type: "reset" })).toBe(
      EMPTY_OPTIMISTIC_STATE,
    );
  });

  it("patches and unpatches milestones", () => {
    const patched = optimisticReducer(EMPTY_OPTIMISTIC_STATE, {
      milestone: two,
      milestoneId: "m1",
      type: "patch",
    });

    expect(patched.patches.get("m1")).toBe(two);
    expect(
      optimisticReducer(patched, { milestoneId: "m1", type: "unpatch" }).patches
        .size,
    ).toBe(0);
    expect(patched.patches.size).toBe(1);
  });

  it("adds and drops pending milestones", () => {
    const added = optimisticReducer(EMPTY_OPTIMISTIC_STATE, {
      milestone: one,
      type: "addPending",
    });

    expect(added.pending).toEqual([one]);
    expect(
      optimisticReducer(added, { tempId: "m1", type: "dropPending" }).pending,
    ).toEqual([]);
    expect(
      optimisticReducer(added, { tempId: "other", type: "dropPending" })
        .pending,
    ).toEqual([one]);
  });

  it("removes and restores milestones", () => {
    const removed = optimisticReducer(EMPTY_OPTIMISTIC_STATE, {
      milestoneId: "m1",
      type: "remove",
    });

    expect(removed.removedIds.has("m1")).toBe(true);
    expect(
      optimisticReducer(removed, { milestoneId: "m1", type: "restore" })
        .removedIds.size,
    ).toBe(0);
  });

  it("adds links, drops pending links of one milestone and restores removed links", () => {
    const added = optimisticReducer(EMPTY_OPTIMISTIC_STATE, {
      links: [
        createLink({ id: "pending-link-m1-1-0" }),
        createLink({ id: "pending-link-m2-1-0" }),
      ],
      type: "addLinks",
    });
    const dropped = optimisticReducer(added, {
      milestoneId: "m1",
      type: "dropPendingLinks",
    });

    expect(dropped.addedLinks.map((link) => link.id)).toEqual([
      "pending-link-m2-1-0",
    ]);

    const removed = optimisticReducer(dropped, {
      linkIds: ["l1", "l2"],
      type: "removeLinks",
    });

    expect([...removed.removedLinkIds]).toEqual(["l1", "l2"]);
    expect(
      optimisticReducer(removed, { type: "restoreLinks" }).removedLinkIds.size,
    ).toBe(0);
  });
});

describe("applyOptimisticState", () => {
  const milestones = [
    createMilestone({ id: "m1" }),
    createMilestone({ id: "m2" }),
  ];
  const links = [createLink()];

  it("passes server data through without local changes", () => {
    const result = applyOptimisticState(
      milestones,
      links,
      EMPTY_OPTIMISTIC_STATE,
    );

    expect(result.milestones).toEqual(milestones);
    expect(result.links).toEqual(links);
  });

  it("overlays patches, pending milestones and removals", () => {
    const patched = createMilestone({ id: "m1", name: "Patched" });
    const pending = createMilestone({ id: "pending-1" });
    const result = applyOptimisticState(milestones, links, {
      ...EMPTY_OPTIMISTIC_STATE,
      patches: new Map([["m1", patched]]),
      pending: [pending],
      removedIds: new Set(["m2"]),
    });

    expect(result.milestones).toEqual([patched, pending]);
    expect(result.links).toEqual([]);
  });

  it("hides removed links and adds local ones between visible milestones", () => {
    const local = createLink({ id: "pending-link-m1-1-0", targetId: "m2" });
    const orphan = createLink({ id: "orphan", targetId: "gone" });
    const result = applyOptimisticState(milestones, links, {
      ...EMPTY_OPTIMISTIC_STATE,
      addedLinks: [local, orphan],
      removedLinkIds: new Set(["l1"]),
    });

    expect(result.links).toEqual([local]);
  });
});

describe("splitDated", () => {
  it("separates milestones the timeline can place", () => {
    const dated = createMilestone({ id: "dated" });
    const undated = createMilestone({
      dueAt: null,
      id: "undated",
      startAt: null,
    });
    const result = splitDated([undated, dated]);

    expect(result.dated.map((entry) => entry.milestone.id)).toEqual(["dated"]);
    expect(result.dated[0]?.time).toBe(new Date(2026, 8, 10).getTime());
    expect(result.undated).toEqual([undated]);
  });
});

describe("buildSaveFormData", () => {
  it("builds the form of a new milestone", () => {
    const formData = buildSaveFormData(DRAFT, null, null);

    expect(Object.fromEntries(formData.entries())).toEqual({
      colorKey: "release",
      customColor: "#112233",
      description: "  Text  ",
      dueAt: "2026-09-20",
      iconKey: "flag",
      intent: "save-milestone",
      name: "  Name  ",
      startAt: "2026-09-10",
      status: "completed",
    });
  });

  it("writes empty strings for a missing custom color and icon", () => {
    const formData = buildSaveFormData(
      { ...DRAFT, custom: null, icon: null },
      "m1",
      null,
    );

    expect(formData.get("customColor")).toBe("");
    expect(formData.get("iconKey")).toBe("");
    expect(formData.get("milestoneId")).toBe("m1");
    expect(formData.has("addLinks")).toBe(false);
  });

  it("adds the link changes", () => {
    const formData = buildSaveFormData(DRAFT, "m1", {
      added: [{ linkType: "prerequisite", targetId: "m2" }],
      removedIds: ["l9"],
    });

    expect(formData.get("addLinks")).toBe(
      JSON.stringify([{ linkType: "prerequisite", targetId: "m2" }]),
    );
    expect(formData.get("removeLinks")).toBe(JSON.stringify(["l9"]));
  });
});

describe("optimistic copies", () => {
  it("copies a draft onto a milestone with trimmed text and empty dates as null", () => {
    expect(withDraft(createMilestone(), DRAFT)).toMatchObject({
      colorCustom: "#112233",
      colorKey: "release",
      description: "Text",
      dueAt: "2026-09-20",
      iconKey: "flag",
      name: "Name",
      startAt: "2026-09-10",
      status: "completed",
    });
    expect(
      withDraft(createMilestone(), { ...DRAFT, end: "", start: "" }),
    ).toMatchObject({
      dueAt: null,
      startAt: null,
    });
  });

  it("creates a placeholder for a milestone the server has not stored", () => {
    expect(createPendingMilestone(DRAFT, "pending-1")).toMatchObject({
      archivedAt: null,
      completedAt: null,
      id: "pending-1",
      name: "Name",
      projectId: "",
    });
  });

  it("creates placeholders for new dependencies", () => {
    const links = createPendingLinks(
      createMilestone({ id: "m1", projectId: "p1" }),
      [
        { linkType: "prerequisite", targetId: "m2" },
        { linkType: "follows", targetId: "m3" },
      ],
      7,
    );

    expect(links.map((link) => link.id)).toEqual([
      "pending-link-m1-7-0",
      "pending-link-m1-7-1",
    ]);
    expect(links[1]).toMatchObject({
      linkType: "follows",
      projectId: "p1",
      sourceId: "m1",
      targetId: "m3",
    });
  });
});
