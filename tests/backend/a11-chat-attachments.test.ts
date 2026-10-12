import { Readable } from "node:stream";
import { crc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";
import { DEFAULT_CHAT_INSTRUCTION } from "@/backend/service/chat/ChatSystemInstruction";
import { CHAT_MEBIBYTE } from "@/definition/Chat";

import { useChatHarness } from "../helpers/chat-harness";

import type { ChatHarness } from "../helpers/chat-harness";

const setup = useChatHarness();

/** A stored ZIP archive, enough for the central directory the server reads. */
function zip(entries: Readonly<Record<string, string>>): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const fileName = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    directory.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}

const OFFICE = {
  "[Content_Types].xml": "<Types/>",
  "_rels/.rels": "<Relationships/>",
};
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);

const ACCEPTED: readonly (readonly [string, Buffer, string])[] = [
  ["photo.png", PNG, "image/png"],
  ["photo.JPG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), "image/jpeg"],
  ["anim.gif", Buffer.from("GIF89a\u0001\u0000"), "image/gif"],
  [
    "pic.webp",
    Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.alloc(4),
      Buffer.from("WEBPVP8 "),
    ]),
    "image/webp",
  ],
  [
    "logo.svg",
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
    ),
    "image/svg+xml",
  ],
  ["report.pdf", Buffer.from("%PDF-1.7\n%%EOF\n"), "application/pdf"],
  ["notes.txt", Buffer.from("Erste Zeile\nZweite Zeile\n"), "text/plain"],
  [
    "readme.md",
    Buffer.from("# Titel\n\n```ts\nconst a = 1;\n```\n"),
    "text/markdown",
  ],
  ["table.csv", Buffer.from("name;wert\nMZ;1\n"), "text/csv"],
  ["data.json", Buffer.from('{"ok": true}'), "application/json"],
  [
    "script.py",
    Buffer.from("#!/usr/bin/env python3\nprint('hi')\n"),
    "text/plain",
  ],
  ["query.sql", Buffer.from("SELECT 1;"), "text/plain"],
  [
    "brief.docx",
    zip({ ...OFFICE, "word/document.xml": "<w:document/>" }),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  [
    "zahlen.xlsx",
    zip({
      ...OFFICE,
      "xl/workbook.xml": "<workbook/>",
      "xl/printerSettings/printerSettings1.bin": "printer",
    }),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [
    "folien.pptx",
    zip({ ...OFFICE, "ppt/presentation.xml": "<p:presentation/>" }),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
];

const REJECTED: readonly (readonly [string, Buffer])[] = [
  ["setup.exe", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)])],
  ["harmless.txt", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)])],
  ["tool.txt", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])],
  ["Main.txt", Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0])],
  ["install.sh", Buffer.from("#!/bin/sh\nrm -rf /\n")],
  ["archive.zip", zip({ "a.txt": "a" })],
  ["fake.docx", zip({ "a.txt": "a" })],
  [
    "makro.docx",
    zip({
      ...OFFICE,
      "word/document.xml": "<d/>",
      "word/vbaProject.bin": "vba",
    }),
  ],
  [
    "ole.xlsx",
    zip({
      ...OFFICE,
      "xl/workbook.xml": "<w/>",
      "xl/embeddings/oleObject1.bin": "ole",
    }),
  ],
  [
    "tool.pptx",
    zip({
      ...OFFICE,
      "ppt/presentation.xml": "<p/>",
      "ppt/media/tool.exe": "MZ",
    }),
  ],
  ["word.docx", zip({ ...OFFICE, "xl/workbook.xml": "<w/>" })],
  ["report.pdf", PNG],
  ["photo.png", Buffer.from("%PDF-1.7\n")],
  ["binary.csv", Buffer.from("a;b\u0000c\n")],
  ["broken.md", Buffer.from([0x23, 0x20, 0xc3, 0x28])],
  [
    "evil.svg",
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ),
  ],
  [
    "remote.svg",
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x.invalid/a.png"/></svg>',
    ),
  ],
  ["noextension", Buffer.from("text")],
  ["movie.mp4", Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom")])],
];

function upload(
  run: ChatHarness,
  sessionId: string,
  fileName: string,
  content: Buffer,
  contentLength: number | null = null,
) {
  const chunks: Buffer[] = [];
  for (let start = 0; start < content.length; start += CHAT_MEBIBYTE)
    chunks.push(content.subarray(start, start + CHAT_MEBIBYTE));
  return run.chatAttachmentService.upload(run.people.writer, sessionId, {
    fileName,
    contentLength,
    body: Readable.from(chunks),
  });
}

async function storedFiles(run: ChatHarness): Promise<number> {
  const rows = await run.database.query(
    "SELECT COUNT(*) FROM chat_attachments;",
  );
  return Number(rows[0][0]);
}

describe("A11.4 AK-04: chat attachments", () => {
  it("accepts images, documents and source text by their content", async () => {
    const run = await setup();
    let sessionId = (await run.chatSessionService.open(run.people.writer))
      .session.id;
    for (const [index, [name, content, type]] of ACCEPTED.entries()) {
      if (index > 0 && index % 10 === 0)
        // Ten unsent files fill one message; a new session takes the next ones.
        sessionId = (await run.chatSessionService.create(run.people.writer))
          .session.id;
      await expect(
        upload(run, sessionId, name, content),
      ).resolves.toMatchObject({
        fileName: name,
        contentType: type,
        size: content.length,
      });
    }
  });

  it("refuses programs, archives with executable content and content that does not match its name", async () => {
    const run = await setup();
    const { session } = await run.chatSessionService.open(run.people.writer);
    for (const [name, content] of REJECTED)
      await expect(
        upload(run, session.id, name, content),
        name,
      ).rejects.toMatchObject({ code: "fileTypeNotAllowed" });
    await expect(
      upload(run, session.id, "empty.txt", Buffer.alloc(0)),
    ).rejects.toMatchObject({
      code: "fileEmpty",
    });
    expect(await storedFiles(run)).toBe(0);
  });

  it("limits files to 16 MB by default and up to 512 MB once an administrator raises the limit", async () => {
    const run = await setup();
    const { session } = await run.chatSessionService.open(run.people.writer);
    const limit = 16 * CHAT_MEBIBYTE;
    const exact = Buffer.alloc(limit, "a");
    const larger = Buffer.alloc(limit + 1, "a");
    await expect(
      upload(run, session.id, "exact.txt", exact),
    ).resolves.toMatchObject({
      size: limit,
    });
    await expect(
      upload(run, session.id, "larger.txt", larger),
    ).rejects.toMatchObject({
      code: "fileTooLarge",
    });
    await expect(
      upload(run, session.id, "announced.txt", Buffer.from("a"), limit + 1),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
    expect(await storedFiles(run)).toBe(1);

    for (const actor of [run.people.writer, run.people.roleAdmin])
      await expect(
        run.chatSettingsService.update(actor, {
          attachmentLimitMegabytes: 512,
          systemInstruction: null,
        }),
      ).rejects.toThrow(InstanceSettingsDeniedError);
    for (const megabytes of [0, 513, 1.5, Number.NaN])
      await expect(
        run.chatSettingsService.update(run.people.admin, {
          attachmentLimitMegabytes: megabytes,
          systemInstruction: null,
        }),
      ).rejects.toMatchObject({ code: "invalidSetting" });
    await run.chatSettingsService.update(run.people.admin, {
      attachmentLimitMegabytes: 512,
      systemInstruction: null,
    });
    expect(
      await run.chatSettingsService.administration(run.people.admin),
    ).toEqual({
      attachmentLimitMegabytes: 512,
      systemInstruction: DEFAULT_CHAT_INSTRUCTION,
      isDefaultInstruction: true,
    });
    expect(
      (await run.chatSessionService.open(run.people.writer))
        .attachmentLimitBytes,
    ).toBe(512 * CHAT_MEBIBYTE);
    await expect(
      upload(run, session.id, "larger.txt", larger),
    ).resolves.toMatchObject({
      size: limit + 1,
    });
    await expect(
      upload(
        run,
        session.id,
        "too-large.txt",
        Buffer.from("a"),
        512 * CHAT_MEBIBYTE + 1,
      ),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
  });

  it("keeps attachments at the own session, removes unsent ones and refuses foreign sessions", async () => {
    const run = await setup();
    const { session } = await run.chatSessionService.open(run.people.writer);
    const foreign = await run.chatSessionService.open(run.people.reader);
    const attachment = await upload(
      run,
      session.id,
      "../../etc/passwd.txt",
      Buffer.from("x"),
    );
    expect(attachment.fileName).toBe("passwd.txt");
    await expect(
      run.chatAttachmentService.upload(run.people.writer, foreign.session.id, {
        fileName: "a.txt",
        contentLength: null,
        body: Readable.from([Buffer.from("a")]),
      }),
    ).rejects.toMatchObject({ code: "sessionMissing" });
    await expect(
      run.chatAttachmentService.open(run.people.reader, attachment.id),
    ).rejects.toMatchObject({ code: "attachmentMissing" });
    const opened = await run.chatAttachmentService.open(
      run.people.writer,
      attachment.id,
    );
    opened.stream.destroy();
    expect(opened.attachment).toEqual(attachment);
    await expect(
      run.chatAttachmentService.discard(run.people.reader, attachment.id),
    ).rejects.toMatchObject({ code: "attachmentMissing" });
    await run.chatAttachmentService.discard(run.people.writer, attachment.id);
    expect(await storedFiles(run)).toBe(0);

    for (let index = 0; index < 10; index += 1)
      await upload(run, session.id, `file-${index}.txt`, Buffer.from("x"));
    await expect(
      upload(run, session.id, "eleven.txt", Buffer.from("x")),
    ).rejects.toMatchObject({
      code: "tooManyAttachments",
    });
    await expect(
      upload(run, session.id, `${"n".repeat(256)}.txt`, Buffer.from("x")),
    ).rejects.toMatchObject({ code: "fileNameTooLong" });
  });

  it("lets only administrators keep a credential-free system instruction", async () => {
    const run = await setup();
    await expect(
      run.chatSettingsService.administration(run.people.writer),
    ).rejects.toThrow(InstanceSettingsDeniedError);
    for (const systemInstruction of [
      "   ",
      "x".repeat(20_001),
      "api_key=sk-abcdefghijklmnop",
    ])
      await expect(
        run.chatSettingsService.update(run.people.admin, {
          attachmentLimitMegabytes: 16,
          systemInstruction,
        }),
      ).rejects.toMatchObject({
        code: systemInstruction.startsWith("api")
          ? "credentialsInText"
          : "invalidSetting",
      });
    await run.chatSettingsService.update(run.people.admin, {
      attachmentLimitMegabytes: 16,
      systemInstruction: "# Eigene Regeln\n\nAntworte knapp.",
    });
    expect(await run.chatSettingsService.instruction()).toBe(
      "# Eigene Regeln\n\nAntworte knapp.",
    );
    await run.chatSettingsService.update(run.people.admin, {
      attachmentLimitMegabytes: 16,
      systemInstruction: DEFAULT_CHAT_INSTRUCTION,
    });
    expect((await run.chatSettingsService.read()).systemInstruction).toBeNull();
  });
});
