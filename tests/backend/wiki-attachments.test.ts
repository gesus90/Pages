import { existsSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { WikiMaintenanceScheduler } from "@/backend/service/wiki/WikiMaintenanceScheduler";
import {
  detectFileType,
  sanitizeFileName,
} from "@/backend/service/wiki/WikiFileTypes";
import {
  FileTooLargeError,
  WikiFileStore,
} from "@/backend/storage/WikiFileStore";
import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";

import { useMigratedDatabase } from "../helpers/test-database";
import { createWikiHarness, pageInput } from "../helpers/wiki-harness";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);

function bytes(...chunks: Buffer[]): AsyncIterable<Uint8Array> {
  return Readable.from(chunks);
}

describe("file types", () => {
  const head = (...values: number[]) => Buffer.from(values);

  it("recognizes media by content", () => {
    expect(detectFileType(head(0xff, 0xd8, 0xff, 0xe0))).toMatchObject({
      contentType: "image/jpeg",
      isEmbeddable: true,
      kind: "media",
    });
    expect(detectFileType(PNG).contentType).toBe("image/png");
    expect(detectFileType(Buffer.from("GIF89a....")).contentType).toBe(
      "image/gif",
    );
    expect(detectFileType(Buffer.from("GIF87a....")).contentType).toBe(
      "image/gif",
    );
    expect(
      detectFileType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")).contentType,
    ).toBe("image/webp");
    expect(
      detectFileType(Buffer.from("RIFF\0\0\0\0WAVEfmt ")).isEmbeddable,
    ).toBe(false);
    expect(
      detectFileType(Buffer.from("RIFF\0\0\0\0AVI LIST")).contentType,
    ).toBe("video/x-msvideo");
    expect(detectFileType(Buffer.from("OggS....")).contentType).toBe(
      "audio/ogg",
    );
    expect(detectFileType(Buffer.from("fLaC....")).contentType).toBe(
      "audio/flac",
    );
    expect(detectFileType(Buffer.from("ID3\x04....")).contentType).toBe(
      "audio/mpeg",
    );
    expect(detectFileType(head(0xff, 0xfb, 0x90)).contentType).toBe(
      "audio/mpeg",
    );
    expect(detectFileType(head(0x1a, 0x45, 0xdf, 0xa3)).contentType).toBe(
      "video/webm",
    );
    expect(detectFileType(Buffer.from("\0\0\0 ftypmp42")).contentType).toBe(
      "video/mp4",
    );
  });

  it("serves everything else, SVG and scripts included, as a plain file", () => {
    for (const content of [
      "<svg xmlns='http://www.w3.org/2000/svg'/>",
      "<html></html>",
      "%PDF-1.7",
      "",
    ]) {
      expect(detectFileType(Buffer.from(content))).toEqual({
        contentType: "application/octet-stream",
        isEmbeddable: false,
        kind: "file",
      });
    }

    expect(detectFileType(head(0xff))).toMatchObject({ kind: "file" });
  });

  it("cleans file names from browsers", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\dir\\report: v1?.pdf")).toBe(
      "report_ v1_.pdf",
    );
    expect(sanitizeFileName("  .hidden  name\t.txt ")).toBe("hidden name_.txt");
    expect(sanitizeFileName("a\u0000b\u007f.txt")).toBe("a_b_.txt");
    expect(sanitizeFileName("...")).toBe("file");
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName("dir/")).toBe("file");
  });
});

describe("WikiFileStore", () => {
  let directory: string;
  let store: WikiFileStore;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-store-"));
    store = new WikiFileStore(path.join(directory, "files"));
  });

  it("writes, hashes, reads and removes a file", async () => {
    const stored = await store.write(
      bytes(Buffer.from("hello "), Buffer.from("world")),
      {
        absoluteLimit: 100,
        limitFor: () => 100,
      },
    );

    expect(stored.size).toBe(11);
    expect(stored.checksum).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
    expect(await readChunks(store.open(stored.storageName))).toBe(
      "hello world",
    );

    await store.remove([stored.storageName, "missing"]);

    expect(readdirSync(path.join(directory, "files"))).toEqual([]);
  });

  it("asks for the limit once the start of the file is known", async () => {
    const limitFor = vi.fn<(head: Buffer) => number>(() => 50_000);
    const big = Buffer.alloc(5000, 7);

    await store.write(bytes(big, big), { absoluteLimit: 1_000_000, limitFor });

    expect(limitFor).toHaveBeenCalledTimes(1);
    expect(limitFor.mock.calls[0]?.[0]).toHaveLength(4096);
  });

  it("asks for the limit at the end of a short file", async () => {
    const limitFor = vi.fn(() => 10);

    await expect(
      store.write(bytes(Buffer.alloc(20)), { absoluteLimit: 100, limitFor }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    expect(limitFor).toHaveBeenCalledTimes(1);
    await expect(
      store.write(bytes(Buffer.alloc(5)), { absoluteLimit: 100, limitFor }),
    ).resolves.toMatchObject({ size: 5 });
  });

  it("stops at the limit and leaves nothing behind", async () => {
    await expect(
      store.write(bytes(Buffer.alloc(6000, 1), Buffer.alloc(6000, 1)), {
        absoluteLimit: 1_000_000,
        limitFor: () => 8000,
      }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    await expect(
      store.write(bytes(Buffer.alloc(200)), {
        absoluteLimit: 100,
        limitFor: () => 1_000_000,
      }),
    ).rejects.toBeInstanceOf(FileTooLargeError);

    expect(readdirSync(path.join(directory, "files"))).toEqual([]);
  });

  it("never reads outside its directory", async () => {
    writeFileSync(path.join(directory, "secret"), "secret");

    await expect(readChunks(store.open("../secret"))).rejects.toThrow();
    await store.remove(["../secret"]);

    expect(existsSync(path.join(directory, "secret"))).toBe(true);
  });

  it("sweeps only old files nobody refers to", async () => {
    const kept = await store.write(bytes(Buffer.from("a")), {
      absoluteLimit: 9,
      limitFor: () => 9,
    });
    const orphan = await store.write(bytes(Buffer.from("b")), {
      absoluteLimit: 9,
      limitFor: () => 9,
    });
    const young = await store.write(bytes(Buffer.from("c")), {
      absoluteLimit: 9,
      limitFor: () => 9,
    });
    const old = new Date(Date.now() - 2 * 3_600_000);

    for (const file of [kept, orphan]) {
      utimesSync(path.join(directory, "files", file.storageName), old, old);
    }

    expect(await store.sweep(new Set([kept.storageName]), 3_600_000)).toBe(1);
    expect(readdirSync(path.join(directory, "files")).sort()).toEqual(
      [kept.storageName, young.storageName].sort(),
    );
  });

  it("sweeps nothing when the directory does not exist", async () => {
    expect(
      await new WikiFileStore(path.join(directory, "none")).sweep(new Set(), 0),
    ).toBe(0);
  });
});

async function readChunks(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }

  return Buffer.concat(chunks).toString();
}

describe("wiki attachments", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const harness = createWikiHarness(getDatabase());
    const ada = await harness.addUser("ada", { displayName: "Ada" });
    const bob = await harness.addUser("bob");
    const reader = await harness.addUser("reader", { capabilities: [] });
    const admin = await harness.addUser("admin", {
      isAdmin: true,
      mode: "admin",
    });
    const page = await harness.service.create(ada, pageInput({ title: "Doc" }));

    return { ...harness, ada, admin, bob, page, reader };
  }

  it("stores a file with the type found in its bytes", async () => {
    const { ada, page, service, filesDirectory } = await setup();
    const image = await service.uploadAttachment(ada, page.id, {
      body: bytes(PNG),
      contentLength: PNG.length,
      fileName: "..\\evil/../logo.exe",
    });

    expect(image).toMatchObject({
      contentType: "image/png",
      fileName: "logo.exe",
      isEmbeddable: true,
      kind: "media",
      size: PNG.length,
      uploadedByName: "Ada",
    });

    const note = await service.uploadAttachment(ada, page.id, {
      body: bytes(Buffer.from("<script>alert(1)</script>")),
      contentLength: null,
      fileName: "page.html",
    });

    expect(note).toMatchObject({
      contentType: "application/octet-stream",
      isEmbeddable: false,
      kind: "file",
    });
    expect(readdirSync(filesDirectory)).toHaveLength(2);
    expect(
      (await service.listAttachments(ada, page.id)).map((a) => a.fileName),
    ).toEqual(["logo.exe", "page.html"]);
  });

  it("does not embed media that is not a raster image", async () => {
    const { ada, page, service } = await setup();
    const audio = await service.uploadAttachment(ada, page.id, {
      body: bytes(Buffer.from("OggS....")),
      contentLength: null,
      fileName: "song.ogg",
    });

    expect(audio).toMatchObject({ isEmbeddable: false, kind: "media" });
  });

  it("applies the limit of the kind and leaves nothing on the disk when it is exceeded", async () => {
    const { admin, ada, page, service, filesDirectory } = await setup();
    const megabyte = 1024 * 1024;

    await service.updateSettings(admin, {
      ...WIKI_SETTING_DEFAULTS,
      fileLimitBytes: megabyte,
      mediaLimitBytes: 3 * megabyte,
    });

    const text = Buffer.alloc(megabyte + 10, 0x41);
    const image = Buffer.concat([PNG, Buffer.alloc(2 * megabyte, 2)]);

    await expect(
      service.uploadAttachment(ada, page.id, {
        body: bytes(text),
        contentLength: null,
        fileName: "big.txt",
      }),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
    await expect(
      service.uploadAttachment(ada, page.id, {
        body: bytes(image),
        contentLength: image.length,
        fileName: "big.png",
      }),
    ).resolves.toMatchObject({ kind: "media" });
    await expect(
      service.uploadAttachment(ada, page.id, {
        body: bytes(Buffer.alloc(10)),
        contentLength: 4 * megabyte,
        fileName: "announced.bin",
      }),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
    expect(readdirSync(filesDirectory)).toHaveLength(1);
  });

  it("rejects empty files and long names, and unknown or forbidden uploads", async () => {
    const { ada, bob, page, reader, service, filesDirectory } = await setup();
    const upload = (
      actor = ada,
      fileName = "a.txt",
      content = "x",
      id = page.id,
    ) =>
      service.uploadAttachment(actor, id, {
        body: bytes(Buffer.from(content)),
        contentLength: null,
        fileName,
      });

    await expect(upload(ada, "a.txt", "")).rejects.toMatchObject({
      code: "fileEmpty",
    });
    await expect(upload(ada, `${"n".repeat(256)}.txt`)).rejects.toMatchObject({
      code: "fileNameTooLong",
    });
    await expect(upload(reader)).rejects.toBeInstanceOf(WikiAccessDeniedError);
    await expect(upload(ada, "a.txt", "x", "missing")).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
    await expect(
      upload(
        bob,
        "a.txt",
        "x",
        (await service.create(ada, pageInput({ scope: "private" }))).id,
      ),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    expect(readdirSync(filesDirectory)).toEqual([]);
  });

  it("passes on a failure of the upload stream itself", async () => {
    const { ada, page, service, filesDirectory } = await setup();

    async function* broken(): AsyncGenerator<Uint8Array> {
      yield Buffer.from("partial");
      throw new Error("connection lost");
    }

    await expect(
      service.uploadAttachment(ada, page.id, {
        body: broken(),
        contentLength: null,
        fileName: "a.txt",
      }),
    ).rejects.toThrow("connection lost");
    expect(readdirSync(filesDirectory)).toEqual([]);
  });

  it("names an uploader that no longer exists as empty text", async () => {
    const { ada, page, service, database } = await setup();

    await service.uploadAttachment(ada, page.id, {
      body: bytes(Buffer.from("x")),
      contentLength: null,
      fileName: "a.txt",
    });
    await database.execute(
      "UPDATE wiki_attachments SET uploaded_by = 'ghost';",
    );

    expect(
      (await service.listAttachments(ada, page.id))[0]?.uploadedByName,
    ).toBe("");
  });

  it("removes the file again when the database refuses the row", async () => {
    const { ada, page, service, database, filesDirectory } = await setup();

    await database.execute("DROP TABLE wiki_attachments;");

    await expect(
      service.uploadAttachment(ada, page.id, {
        body: bytes(Buffer.from("x")),
        contentLength: null,
        fileName: "a.txt",
      }),
    ).rejects.toThrow();
    expect(readdirSync(filesDirectory)).toEqual([]);
  });

  it("lists the stored file names the database refers to", async () => {
    const { ada, page, service, repository } = await setup();

    await service.uploadAttachment(ada, page.id, {
      body: bytes(Buffer.from("x")),
      contentLength: null,
      fileName: "a.txt",
    });

    expect(await repository.attachments.listStorageNames()).toHaveLength(1);
  });

  it("serves a file only to people who see its page", async () => {
    const { ada, bob, page, service } = await setup();
    const secret = await service.create(ada, pageInput({ scope: "private" }));
    const open = await service.uploadAttachment(ada, page.id, {
      body: bytes(Buffer.from("public bytes")),
      contentLength: null,
      fileName: "a.txt",
    });
    const hidden = await service.uploadAttachment(ada, secret.id, {
      body: bytes(Buffer.from("hidden bytes")),
      contentLength: null,
      fileName: "b.txt",
    });
    const opened = await service.openAttachment(bob, open.id);

    expect(opened.attachment.fileName).toBe("a.txt");
    expect(await readChunks(opened.stream)).toBe("public bytes");
    await expect(service.openAttachment(bob, hidden.id)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
    await expect(service.openAttachment(bob, "missing")).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
    await expect(
      service.listAttachments(bob, secret.id),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });

  it("lets the uploader and managers remove an attachment", async () => {
    const { ada, bob, admin, page, service, filesDirectory } = await setup();
    const upload = (actor = ada) =>
      service.uploadAttachment(actor, page.id, {
        body: bytes(Buffer.from("x")),
        contentLength: null,
        fileName: "a.txt",
      });
    const mine = await upload(bob);
    const theirs = await upload(ada);

    await expect(
      service.removeAttachment(bob, theirs.id),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    await service.removeAttachment(bob, mine.id);
    await service.removeAttachment(admin, theirs.id);
    await expect(
      service.removeAttachment(ada, "missing"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    expect(readdirSync(filesDirectory)).toEqual([]);
  });

  it("deletes the files of a page that goes for good, even when the project goes", async () => {
    const { ada, service, database, filesDirectory, addProject } =
      await setup();

    await addProject("p1");

    const projectPage = await service.create(
      ada,
      pageInput({ projectId: "p1", scope: "project" }),
    );

    await service.uploadAttachment(ada, projectPage.id, {
      body: bytes(Buffer.from("x")),
      contentLength: null,
      fileName: "a.txt",
    });
    await database.execute("DELETE FROM wiki_attachments;");

    const [orphan] = readdirSync(filesDirectory);

    utimesSync(
      path.join(filesDirectory, orphan ?? ""),
      new Date(0),
      new Date(0),
    );
    await service.runMaintenance();

    expect(readdirSync(filesDirectory)).toEqual([]);
  });
});

describe("wiki covers", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const harness = createWikiHarness(getDatabase());
    const ada = await harness.addUser("ada");
    const reader = await harness.addUser("reader", { capabilities: [] });
    const page = await harness.service.create(ada, pageInput({ title: "Doc" }));
    const other = await harness.service.create(
      ada,
      pageInput({ title: "Other" }),
    );
    const upload = (fileName: string, body: Buffer, pageId = page.id) =>
      harness.service.uploadAttachment(ada, pageId, {
        body: bytes(body),
        contentLength: null,
        fileName,
      });
    const coverOf = async (id = page.id) => {
      const result = await harness.service.read(ada, id);

      return result.kind === "page" ? result.view.page : null;
    };

    return { ...harness, ada, coverOf, other, page, reader, upload };
  }

  async function expectInvalid(promise: Promise<unknown>): Promise<void> {
    await expect(promise).rejects.toBeInstanceOf(WikiValidationError);
    await expect(promise).rejects.toMatchObject({ code: "invalidCover" });
  }

  it("sets and removes a prepared cover without a new revision", async () => {
    const { ada, coverOf, page, service } = await setup();

    expect((await coverOf())?.cover).toBeNull();
    expect(await service.setCover(ada, page.id, "preset:ocean")).toEqual({
      kind: "preset",
      preset: "ocean",
    });
    expect(await coverOf()).toMatchObject({
      cover: { kind: "preset", preset: "ocean" },
      revision: page.revision,
    });
    expect(await service.setCover(ada, page.id, null)).toBeNull();
    expect((await coverOf())?.cover).toBeNull();
  });

  it("accepts only raster images of the same page", async () => {
    const { ada, coverOf, other, page, service, upload } = await setup();
    const image = await upload("logo.png", PNG);
    const note = await upload("note.txt", Buffer.from("x"));
    const song = await upload("song.ogg", Buffer.from("OggS...."));
    const foreign = await upload("other.png", PNG, other.id);

    await service.setCover(ada, page.id, `attachment:${image.id}`);
    expect((await coverOf())?.cover).toEqual({
      attachmentId: image.id,
      kind: "attachment",
    });

    await expectInvalid(
      service.setCover(ada, page.id, `attachment:${note.id}`),
    );
    await expectInvalid(
      service.setCover(ada, page.id, `attachment:${song.id}`),
    );
    await expectInvalid(
      service.setCover(ada, page.id, `attachment:${foreign.id}`),
    );
    await expectInvalid(service.setCover(ada, page.id, "attachment:missing"));
    await expectInvalid(service.setCover(ada, page.id, "preset:neon"));
    await expectInvalid(service.setCover(ada, page.id, "red"));
  });

  it("needs the right to write and a visible page", async () => {
    const { ada, page, reader, service } = await setup();

    await expect(
      service.setCover(reader, page.id, "preset:sand"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    await expect(
      service.setCover(ada, "missing", "preset:sand"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });

  it("drops the cover when its image is removed, and only then", async () => {
    const { ada, coverOf, page, service, upload } = await setup();
    const image = await upload("logo.png", PNG);
    const spare = await upload("spare.png", PNG);

    await service.setCover(ada, page.id, `attachment:${image.id}`);
    await service.removeAttachment(ada, spare.id);
    expect((await coverOf())?.cover).toMatchObject({ attachmentId: image.id });

    await service.removeAttachment(ada, image.id);
    expect((await coverOf())?.cover).toBeNull();
  });
});

describe("WikiMaintenanceScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cleans once at the start and then at the interval", async () => {
    const runMaintenance = vi.fn().mockResolvedValue(undefined);
    const scheduler = new WikiMaintenanceScheduler({ runMaintenance }, 1000);

    scheduler.start();
    scheduler.start();
    expect(runMaintenance).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2500);

    expect(runMaintenance).toHaveBeenCalledTimes(3);

    scheduler.stop();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(runMaintenance).toHaveBeenCalledTimes(3);
  });

  it("reports a failed cleanup without throwing", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const scheduler = new WikiMaintenanceScheduler({
      runMaintenance: vi.fn().mockRejectedValue(new Error("boom")),
    });

    expect(await scheduler.runOnce()).toBe(false);
    expect(error).toHaveBeenCalled();
  });

  it("uses an hourly interval by default", async () => {
    const runMaintenance = vi.fn().mockResolvedValue(undefined);
    const scheduler = new WikiMaintenanceScheduler({ runMaintenance });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(3_600_000);
    scheduler.stop();

    expect(runMaintenance).toHaveBeenCalledTimes(2);
  });
});
