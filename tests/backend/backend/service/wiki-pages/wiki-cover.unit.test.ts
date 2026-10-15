import { beforeEach, describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

let world = createPeopleWorld();

beforeEach(() => {
  world = createPeopleWorld();
  world.addPage({ id: "page", ownerId: "owner" });
  world.addPage({ id: "elsewhere", ownerId: "owner" });
  world.addPage({ id: "secret", ownerId: "other", scope: "private" });
  world.addAttachment({
    contentType: "image/webp",
    id: "photo",
    kind: "media",
    pageId: "page",
  });
  world.addAttachment({
    contentType: "image/png",
    id: "foreign",
    kind: "media",
    pageId: "elsewhere",
  });
  world.addAttachment({ id: "document", pageId: "page" });
  world.addAttachment({
    contentType: "audio/ogg",
    id: "sound",
    kind: "media",
    pageId: "page",
  });
});

describe("setting a cover", () => {
  it("stores a prepared cover without touching revision or versions", async () => {
    const cover = await world
      .coverService()
      .setCover(world.actor("owner"), "page", "preset:ocean");
    expect(cover).toEqual({ kind: "preset", preset: "ocean" });
    expect(world.page("page")).toMatchObject({ cover, revision: 1 });
    expect(world.state.data.versions).toEqual([]);
  });

  it("accepts an image of the page and removes the cover with null", async () => {
    await expect(
      world
        .coverService()
        .setCover(world.actor("owner"), "page", "attachment:photo"),
    ).resolves.toEqual({ attachmentId: "photo", kind: "attachment" });
    await expect(
      world.coverService().setCover(world.actor("owner"), "page", null),
    ).resolves.toBeNull();
    expect(world.page("page").cover).toBeNull();
  });

  it.each([
    "preset:unknown",
    "attachment:foreign",
    "attachment:document",
    "attachment:sound",
    "attachment:missing",
    "photo",
    "attachment:",
    "attachment:../x",
  ])("rejects %s", async (value) => {
    await expect(
      world.coverService().setCover(world.actor("owner"), "page", value),
    ).rejects.toMatchObject({ code: "invalidCover" });
    expect(world.page("page").cover).toBeNull();
  });

  it("needs write, and a page the person sees", async () => {
    await expect(
      world
        .coverService()
        .setCover(world.actor("reader"), "page", "preset:sand"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    await expect(
      world
        .coverService()
        .setCover(world.actor("owner"), "secret", "preset:sand"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });

  it("lets any writer who sees the page set the cover", async () => {
    await expect(
      world
        .coverService()
        .setCover(world.actor("other"), "page", "preset:dusk"),
    ).resolves.toEqual({ kind: "preset", preset: "dusk" });
  });
});
