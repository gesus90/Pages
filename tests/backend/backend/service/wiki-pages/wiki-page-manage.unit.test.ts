import { beforeEach, describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";

import { createPeopleWorld } from "./wiki-people";

let world = createPeopleWorld();

beforeEach(() => {
  world = createPeopleWorld();
  world.addTarget("department", "sales");
  world.addTarget("milestone", "m1", { projectId: "alpha" });
  world.addTarget("milestone", "m2", { projectId: "beta" });
  world.addPage({ id: "wide", ownerId: "owner" });
  world.addPage({
    id: "team",
    ownerId: "owner",
    projectId: "alpha",
    scope: "project",
  });
  world.addPage({ id: "mine", ownerId: "owner", scope: "private" });
});

describe("who manages a page", () => {
  it.each([
    { label: "the owner", actor: "owner", pageId: "wide", isAllowed: true },
    {
      label: "an administrator on an instance page",
      actor: "admin",
      pageId: "wide",
      isAllowed: true,
    },
    {
      label: "another writer on an instance page",
      actor: "other",
      pageId: "wide",
      isAllowed: false,
    },
    {
      label: "a project manager on an instance page",
      actor: "manager",
      pageId: "wide",
      isAllowed: false,
    },
    {
      label: "a project manager on a project page",
      actor: "manager",
      pageId: "team",
      isAllowed: true,
    },
    {
      label: "another writer on a project page",
      actor: "other",
      pageId: "team",
      isAllowed: false,
    },
  ])("decides for $label", async ({ actor, pageId, isAllowed }) => {
    const attempt = world
      .pageService()
      .setCurrentUntil(world.actor(actor), pageId, "2027-01-31");
    if (isAllowed) {
      await expect(attempt).resolves.toBeUndefined();
      expect(world.page(pageId).currentUntil).toBe("2027-01-31");
    } else {
      await expect(attempt).rejects.toBeInstanceOf(WikiAccessDeniedError);
      expect(world.page(pageId).currentUntil).toBeNull();
    }
  });

  it("hides a private page of somebody else even from an administrator", async () => {
    await expect(
      world.pageService().setCurrentUntil(world.actor("admin"), "mine", null),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });
});

describe("current until", () => {
  it.each(["2026-02-30", "2026-13-01", "26-01-01", "tomorrow", "2026-1-1"])(
    "rejects %s",
    async (date) => {
      await expect(
        world.pageService().setCurrentUntil(world.actor("owner"), "wide", date),
      ).rejects.toMatchObject({ code: "invalidDate" });
      expect(world.page("wide").currentUntil).toBeNull();
    },
  );

  it("accepts a leap day and clears with null or blanks", async () => {
    const service = world.pageService();
    await service.setCurrentUntil(world.actor("owner"), "wide", "2028-02-29");
    expect(world.page("wide").currentUntil).toBe("2028-02-29");
    await service.setCurrentUntil(world.actor("owner"), "wide", "  ");
    expect(world.page("wide").currentUntil).toBeNull();
    await service.setCurrentUntil(world.actor("owner"), "wide", "2027-01-01");
    await service.setCurrentUntil(world.actor("owner"), "wide", null);
    expect(world.page("wide").currentUntil).toBeNull();
  });
});

describe("handing a page over", () => {
  it("hands a shared page to an active account", async () => {
    await world.pageService().setOwner(world.actor("owner"), "wide", "other");
    expect(world.page("wide").ownerId).toBe("other");
  });

  it.each([
    { label: "an unknown account", ownerId: "nobody", pageId: "wide" },
    { label: "a private page", ownerId: "other", pageId: "mine" },
  ])("rejects $label", async ({ ownerId, pageId }) => {
    await expect(
      world.pageService().setOwner(world.actor("owner"), pageId, ownerId),
    ).rejects.toMatchObject({ code: "invalidScope" });
    expect(world.page(pageId).ownerId).toBe("owner");
  });

  it("rejects a deactivated account", async () => {
    world.addPerson("retired", { isActive: false });
    await expect(
      world.pageService().setOwner(world.actor("owner"), "wide", "retired"),
    ).rejects.toMatchObject({ code: "invalidScope" });
  });

  it("is reserved to whoever manages the page", async () => {
    await expect(
      world.pageService().setOwner(world.actor("other"), "wide", "other"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    expect(world.page("wide").ownerId).toBe("owner");
  });
});

describe("anchors", () => {
  it("replaces the anchors with the validated list", async () => {
    world.addAnchor("team", "department", "sales");
    await world.pageService().setAnchors(world.actor("owner"), "team", [
      { kind: "milestone", targetId: "m1" },
      { kind: "milestone", targetId: "m1" },
    ]);
    expect(world.anchorKeys("team")).toEqual(["milestone:m1"]);
    await world.pageService().setAnchors(world.actor("owner"), "team", []);
    expect(world.anchorKeys("team")).toEqual([]);
  });

  it("ties a project page only to targets of its own project", async () => {
    await expect(
      world
        .pageService()
        .setAnchors(world.actor("admin"), "team", [
          { kind: "milestone", targetId: "m2" },
        ]),
    ).rejects.toMatchObject({ code: "invalidAnchor" });
    expect(world.anchorKeys("team")).toEqual([]);
  });

  it("refuses targets the actor cannot read and anchors on private pages", async () => {
    await expect(
      world
        .pageService()
        .setAnchors(world.actor("owner"), "wide", [
          { kind: "milestone", targetId: "m2" },
        ]),
    ).rejects.toMatchObject({ code: "invalidAnchor" });
    await expect(
      world
        .pageService()
        .setAnchors(world.actor("owner"), "mine", [
          { kind: "department", targetId: "sales" },
        ]),
    ).rejects.toMatchObject({ code: "invalidAnchor" });
  });

  it("is reserved to whoever manages the page", async () => {
    await expect(
      world
        .pageService()
        .setAnchors(world.actor("other"), "wide", [
          { kind: "department", targetId: "sales" },
        ]),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    expect(world.anchorKeys("wide")).toEqual([]);
  });

  it("keeps the old anchors when a later one is invalid", async () => {
    world.addAnchor("wide", "department", "sales");
    await expect(
      world.pageService().setAnchors(world.actor("owner"), "wide", [
        { kind: "department", targetId: "sales" },
        { kind: "milestone", targetId: "gone" },
      ]),
    ).rejects.toMatchObject({ code: "invalidAnchor" });
    expect(world.anchorKeys("wide")).toEqual(["department:sales"]);
  });
});

describe("settings", () => {
  it("reads defaults until settings were saved", async () => {
    await expect(world.settingsService().get()).resolves.toMatchObject({
      fileLimitBytes: 100 * 1024 * 1024,
      trashRetentionDays: 30,
    });
  });

  it("lets only an administrator change them, inside the ranges", async () => {
    const service = world.settingsService();
    const next = {
      fileLimitBytes: 2 * 1024 * 1024,
      mediaLimitBytes: 3 * 1024 * 1024,
      trashRetentionDays: 7,
      versionKeepLast: 5,
      versionRetentionDays: 14,
    };
    await expect(
      service.update(world.actor("owner"), next),
    ).rejects.toBeInstanceOf(InstanceSettingsDeniedError);
    await service.update(world.actor("admin"), next);
    await expect(service.get()).resolves.toEqual(next);
    for (const broken of [
      { ...next, trashRetentionDays: 0 },
      { ...next, versionKeepLast: 1001 },
      { ...next, fileLimitBytes: 1024 },
      { ...next, mediaLimitBytes: 1_048_576.5 },
    ]) {
      await expect(
        service.update(world.actor("admin"), broken),
      ).rejects.toMatchObject({ code: "invalidSetting" });
    }
    await expect(service.get()).resolves.toEqual(next);
  });
});
