import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

let world = createPeopleWorld();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:30:00Z"));
  world = createPeopleWorld();
  world.addPage({ id: "page", ownerId: "owner" });
  world.addPage({ id: "mine", ownerId: "owner", scope: "private" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the area for me", () => {
  it("marks items newer than the last read time as unread", async () => {
    world.reading.feedReadAt = "2026-10-14 08:00:00";
    world.reading.feed = [
      {
        actorName: "Bob",
        at: "2026-10-14 09:00:00",
        excerpt: "newer",
        pageId: "page",
        pageTitle: "Page",
        reason: "mention",
      },
      {
        actorName: "Bob",
        at: "2026-10-14 08:00:00",
        excerpt: "same instant",
        pageId: "page",
        pageTitle: "Page",
        reason: "mention",
      },
    ];
    const items = await world.facade().forMe(world.actor("owner"));
    expect(items.map((item) => item.isUnread)).toEqual([true, false]);
    expect(world.reading.feedToday).toBe("2026-10-15");
  });

  it("marks everything as read for the account", async () => {
    await world.facade().markFeedRead(world.actor("owner"));
    expect(world.reading.feedMarkedRead).toEqual(["owner"]);
  });
});

describe("versions", () => {
  beforeEach(() => {
    world.state.data.versions.push({
      authorId: "owner",
      authorName: "Owner",
      content: "Old text",
      createdAt: "2026-10-15 10:00:00",
      id: "v1",
      pageId: "page",
      revision: 1,
      title: "Old",
      updatedAt: "2026-10-15 10:00:00",
    });
  });

  it("lists and reads the versions of a visible page", async () => {
    await expect(
      world.facade().listVersions(world.actor("reader"), "page"),
    ).resolves.toMatchObject([{ id: "v1", revision: 1 }]);
    await expect(
      world.facade().getVersion(world.actor("reader"), "page", "v1"),
    ).resolves.toMatchObject({ content: "Old text", title: "Old" });
  });

  it("refuses an unknown version and a hidden page", async () => {
    await expect(
      world.facade().getVersion(world.actor("owner"), "page", "nope"),
    ).rejects.toMatchObject({ code: "versionMissing" });
    for (const action of [
      world.facade().listVersions(world.actor("other"), "mine"),
      world.facade().getVersion(world.actor("other"), "mine", "v1"),
    ]) {
      await expect(action).rejects.toBeInstanceOf(WikiPageNotFoundError);
    }
  });
});
