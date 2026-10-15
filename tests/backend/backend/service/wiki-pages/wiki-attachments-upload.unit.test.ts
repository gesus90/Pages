import { beforeEach, describe, expect, it, vi } from "vitest";

import { WikiAttachmentRepository } from "@/backend/database/repositories/wiki/WikiAttachmentRepository";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";

import { bodyOf, plainBody, pngBody, PNG_SIGNATURE } from "./upload-bodies";
import { createPeopleWorld } from "./wiki-people";

import type { UploadedFile } from "@/backend/service/wiki/WikiAttachmentService";

const MIB = 1024 * 1024;

let world = createPeopleWorld();

function upload(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    body: bodyOf(Buffer.from("hello")),
    contentLength: null,
    fileName: "hello.txt",
    ...overrides,
  };
}

beforeEach(async () => {
  world = createPeopleWorld();
  world.addPage({ id: "page", ownerId: "owner" });
  world.addPage({ id: "secret", ownerId: "other", scope: "private" });
  await world.settingsService().update(world.actor("admin"), {
    fileLimitBytes: MIB,
    mediaLimitBytes: 2 * MIB,
    trashRetentionDays: 30,
    versionKeepLast: 50,
    versionRetentionDays: 90,
  });
});

describe("what an upload becomes", () => {
  it("stores a PNG as embeddable media with the content type of its bytes", async () => {
    const attachment = await world
      .attachmentService()
      .upload(
        world.actor("owner"),
        "page",
        upload({ body: pngBody(1000), fileName: "photo.png" }),
      );
    expect(attachment).toMatchObject({
      contentType: "image/png",
      fileName: "photo.png",
      isEmbeddable: true,
      kind: "media",
      pageId: "page",
      size: 1000,
      uploadedBy: "owner",
      uploadedByName: "Owner",
    });
    const stored = world.state.data.attachments.get(attachment.id);
    expect(world.files.files.get(stored?.storageName ?? "")).toHaveLength(1000);
  });

  it("does not trust the name: text named .png is a plain download", async () => {
    const attachment = await world
      .attachmentService()
      .upload(world.actor("owner"), "page", upload({ fileName: "fake.png" }));
    expect(attachment).toMatchObject({
      contentType: "application/octet-stream",
      isEmbeddable: false,
      kind: "file",
    });
  });

  it("serves SVG and executables only as generic files", async () => {
    for (const markup of ["<svg xmlns='x'><script/></svg>", "MZ\u0090\u0000"]) {
      const attachment = await world
        .attachmentService()
        .upload(
          world.actor("owner"),
          "page",
          upload({ body: bodyOf(Buffer.from(markup)), fileName: "a.svg" }),
        );
      expect(attachment).toMatchObject({
        contentType: "application/octet-stream",
        isEmbeddable: false,
      });
    }
  });

  it("marks audio and video as media that is not embeddable", async () => {
    const attachment = await world
      .attachmentService()
      .upload(
        world.actor("owner"),
        "page",
        upload({ body: bodyOf(Buffer.from("OggS....")), fileName: "a.ogg" }),
      );
    expect(attachment).toMatchObject({
      contentType: "audio/ogg",
      isEmbeddable: false,
      kind: "media",
    });
  });
});

describe("file names", () => {
  it.each([
    { sent: "../../etc/passwd", stored: "passwd" },
    { sent: "C:\\Users\\me\\report.docx", stored: "report.docx" },
    { sent: 'a:b*c?"d<e>f|g.txt', stored: "a_b_c__d_e_f_g.txt" },
    { sent: "..hidden", stored: "hidden" },
    { sent: "  two   spaces.txt ", stored: "two spaces.txt" },
    { sent: "", stored: "file" },
    { sent: "dir/", stored: "file" },
  ])("cleans $sent to $stored", async ({ sent, stored }) => {
    const attachment = await world
      .attachmentService()
      .upload(world.actor("owner"), "page", upload({ fileName: sent }));
    expect(attachment.fileName).toBe(stored);
  });

  it("never lets a name choose the storage location", async () => {
    await world
      .attachmentService()
      .upload(
        world.actor("owner"),
        "page",
        upload({ fileName: "../../../root/.ssh/authorized_keys" }),
      );
    const [row] = [...world.state.data.attachments.values()];
    expect(row?.storageName).toMatch(/^stored-\d+$/);
    expect(row?.fileName).toBe("authorized_keys");
  });

  it("accepts 255 characters and rejects 256 before reading the body", async () => {
    await expect(
      world
        .attachmentService()
        .upload(
          world.actor("owner"),
          "page",
          upload({ fileName: `${"n".repeat(251)}.txt` }),
        ),
    ).resolves.toMatchObject({ size: 5 });
    await expect(
      world
        .attachmentService()
        .upload(
          world.actor("owner"),
          "page",
          upload({ fileName: `${"n".repeat(252)}.txt` }),
        ),
    ).rejects.toMatchObject({ code: "fileNameTooLong" });
    expect(world.files.consumed).toHaveLength(1);
  });
});

describe("size limits", () => {
  it("applies the file limit to unknown content", async () => {
    await expect(
      world
        .attachmentService()
        .upload(
          world.actor("owner"),
          "page",
          upload({ body: plainBody(MIB + 1) }),
        ),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
    expect(world.files.files.size).toBe(0);
    expect(world.state.data.attachments.size).toBe(0);
  });

  it("applies the larger media limit to recognized media", async () => {
    await expect(
      world
        .attachmentService()
        .upload(
          world.actor("owner"),
          "page",
          upload({ body: pngBody(MIB + 1), fileName: "big.png" }),
        ),
    ).resolves.toMatchObject({ kind: "media", size: MIB + 1 });
    await expect(
      world
        .attachmentService()
        .upload(
          world.actor("owner"),
          "page",
          upload({ body: pngBody(2 * MIB + 1), fileName: "huge.png" }),
        ),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
  });

  it("allows exactly the limit", async () => {
    await expect(
      world
        .attachmentService()
        .upload(world.actor("owner"), "page", upload({ body: plainBody(MIB) })),
    ).resolves.toMatchObject({ size: MIB });
  });

  it("refuses an announced size above every limit without reading", async () => {
    await expect(
      world
        .attachmentService()
        .upload(
          world.actor("owner"),
          "page",
          upload({ contentLength: 2 * MIB + 1 }),
        ),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
    expect(world.files.consumed).toEqual([]);
  });

  it("does not trust an announced size that is too small", async () => {
    await expect(
      world
        .attachmentService()
        .upload(
          world.actor("owner"),
          "page",
          upload({ body: plainBody(MIB + 1), contentLength: 10 }),
        ),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
  });

  it("stops reading at the absolute limit", async () => {
    await expect(
      world
        .attachmentService()
        .upload(
          world.actor("owner"),
          "page",
          upload({ body: bodyOf(PNG_SIGNATURE, Buffer.alloc(3 * MIB)) }),
        ),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
    expect(world.files.files.size).toBe(0);
  });
});

describe("refusals and failures", () => {
  it("removes an empty file and reports it", async () => {
    await expect(
      world
        .attachmentService()
        .upload(world.actor("owner"), "page", upload({ body: bodyOf() })),
    ).rejects.toMatchObject({ code: "fileEmpty" });
    expect(world.files.files.size).toBe(0);
    expect(world.files.removals).toEqual([["stored-1"]]);
  });

  it("needs write and a visible page, and reads nothing otherwise", async () => {
    await expect(
      world.attachmentService().upload(world.actor("reader"), "page", upload()),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    await expect(
      world
        .attachmentService()
        .upload(world.actor("owner"), "secret", upload()),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    expect(world.files.consumed).toEqual([]);
  });

  it("removes the stored file when the metadata cannot be saved", async () => {
    vi.spyOn(
      WikiAttachmentRepository.prototype,
      "insert",
    ).mockRejectedValueOnce(new Error("constraint"));
    await expect(
      world.attachmentService().upload(world.actor("owner"), "page", upload()),
    ).rejects.toThrow("constraint");
    expect(world.files.files.size).toBe(0);
    expect(world.files.removals).toEqual([["stored-1"]]);
  });

  it("passes on unexpected storage errors unchanged", async () => {
    world.files.failNextWrite = new Error("disk offline");
    await expect(
      world.attachmentService().upload(world.actor("owner"), "page", upload()),
    ).rejects.toThrow("disk offline");
    expect(world.state.data.attachments.size).toBe(0);
  });
});
