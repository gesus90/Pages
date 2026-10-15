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
  world.addPage({ id: "secret", ownerId: "other", scope: "private" });
  world.addAttachment(
    { id: "mine", pageId: "page", uploadedBy: "other" },
    Buffer.from("mine"),
  );
  world.addAttachment(
    { id: "image", kind: "media", contentType: "image/png", pageId: "page" },
    Buffer.from("png"),
  );
  world.addAttachment({ id: "hidden", pageId: "secret", uploadedBy: "other" });
});

describe("listing and opening", () => {
  it("lists the attachments of a visible page without storage names", async () => {
    const list = await world
      .attachmentService()
      .list(world.actor("reader"), "page");
    expect(list.map((attachment) => attachment.id)).toEqual(["mine", "image"]);
    expect(list.find((item) => item.id === "image")?.isEmbeddable).toBe(true);
    expect(list.find((item) => item.id === "mine")?.isEmbeddable).toBe(false);
    expect(JSON.stringify(list)).not.toContain("stored-");
  });

  it("hides the list of a page the person cannot see", async () => {
    await expect(
      world.attachmentService().list(world.actor("owner"), "secret"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });

  it("opens the bytes of a visible attachment", async () => {
    const opened = await world
      .attachmentService()
      .open(world.actor("reader"), "mine");
    expect(opened.attachment).toMatchObject({ id: "mine", pageId: "page" });
    expect(world.files.opened).toEqual(["stored-mine"]);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("mine");
  });

  it("answers a hidden and a missing attachment alike", async () => {
    for (const id of ["hidden", "missing"]) {
      await expect(
        world.attachmentService().open(world.actor("owner"), id),
      ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    }
    expect(world.files.opened).toEqual([]);
  });
});

describe("removing an attachment", () => {
  it("lets the uploader remove it together with its file", async () => {
    await world.attachmentService().remove(world.actor("other"), "mine");
    expect(world.state.data.attachments.has("mine")).toBe(false);
    expect(world.files.files.has("stored-mine")).toBe(false);
  });

  it("lets whoever manages the page remove it", async () => {
    await world.attachmentService().remove(world.actor("owner"), "mine");
    await world.attachmentService().remove(world.actor("admin"), "image");
    expect(world.state.data.attachments.size).toBe(1);
  });

  it("refuses another writer and keeps row and file", async () => {
    await expect(
      world.attachmentService().remove(world.actor("manager"), "mine"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    expect(world.state.data.attachments.has("mine")).toBe(true);
    expect(world.files.files.has("stored-mine")).toBe(true);
    expect(world.files.removals).toEqual([]);
  });

  it("answers a hidden or missing attachment with not found", async () => {
    for (const id of ["hidden", "missing"]) {
      await expect(
        world.attachmentService().remove(world.actor("owner"), id),
      ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    }
  });

  it("clears the cover that showed the removed image", async () => {
    await world
      .coverService()
      .setCover(world.actor("owner"), "page", "attachment:image");
    expect(world.page("page").cover).toEqual({
      attachmentId: "image",
      kind: "attachment",
    });
    await world.attachmentService().remove(world.actor("owner"), "image");
    expect(world.page("page").cover).toBeNull();
  });

  it("keeps a cover that shows another image", async () => {
    world.addAttachment({
      contentType: "image/png",
      id: "second",
      kind: "media",
      pageId: "page",
    });
    await world
      .coverService()
      .setCover(world.actor("owner"), "page", "attachment:second");
    await world.attachmentService().remove(world.actor("owner"), "image");
    expect(world.page("page").cover).toEqual({
      attachmentId: "second",
      kind: "attachment",
    });
  });
});

describe("files without a row", () => {
  it("removes named files for deleted pages", async () => {
    await world.attachmentService().removeFiles(["stored-mine", "unknown"]);
    expect(world.files.files.has("stored-mine")).toBe(false);
    expect(world.files.removals).toEqual([["stored-mine", "unknown"]]);
  });

  it("sweeps only files that no attachment names and are older than an hour", async () => {
    world.files.sweepResult = 3;
    await expect(world.attachmentService().sweep()).resolves.toBe(3);
    expect(world.files.sweeps).toHaveLength(1);
    expect(world.files.sweeps[0]?.olderThanMilliseconds).toBe(3_600_000);
    expect([...(world.files.sweeps[0]?.known ?? [])].sort()).toEqual([
      "stored-hidden",
      "stored-image",
      "stored-mine",
    ]);
  });
});
