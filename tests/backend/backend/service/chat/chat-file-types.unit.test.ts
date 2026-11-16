import { expect, it } from "vitest";

import { classifyChatFile } from "@/backend/service/chat/ChatFileTypes";

import type { ChatFileFacts } from "@/backend/service/chat/ChatFileProbe";

function facts(bytes: Buffer, isText = false): ChatFileFacts {
  return {
    size: bytes.length,
    head: bytes,
    tail: bytes,
    isText,
    markup: isText ? bytes : null,
  };
}

function officeFile(names: readonly string[]): Buffer {
  const head = Buffer.from("504b0304", "hex");
  const entries = names.map((name) => {
    const nameBytes = Buffer.from(name);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(nameBytes.length, 28);
    return Buffer.concat([entry, nameBytes]);
  });
  const directory = Buffer.concat(entries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(head.length, 16);
  return Buffer.concat([head, directory, end]);
}

it.each([
  ["note.md", "text/markdown"],
  ["source.ts", "text/plain"],
  ["rows.csv", "text/csv"],
  ["object.json", "application/json"],
])("accepts UTF-8 text for %s", (name, contentType) => {
  expect(
    classifyChatFile(name, facts(Buffer.from("text"), true), () => false),
  ).toEqual({ contentType, isText: true });
  expect(() =>
    classifyChatFile(name, facts(Buffer.from("binary")), () => true),
  ).toThrow("fileTypeNotAllowed");
});

it("checks signatures for images, PDFs and safe SVG", () => {
  const png = facts(Buffer.from("89504e470d0a1a0a", "hex"));
  expect(classifyChatFile("image.PNG", png, () => false)).toEqual({
    contentType: "image/png",
    isText: false,
  });
  expect(() => classifyChatFile("image.jpg", png, () => true)).toThrow(
    "fileTypeNotAllowed",
  );
  expect(
    classifyChatFile("doc.pdf", facts(Buffer.from("%PDF-1.7")), () => false)
      .contentType,
  ).toBe("application/pdf");
  const svg = facts(Buffer.from("<svg/>"), true);
  expect(classifyChatFile("image.svg", svg, () => true).contentType).toBe(
    "image/svg+xml",
  );
  expect(() => classifyChatFile("image.svg", svg, () => false)).toThrow(
    "fileTypeNotAllowed",
  );
});

it("requires the expected Office package part and refuses embedded programs", () => {
  const names = ["[Content_Types].xml", "word/document.xml"];
  expect(
    classifyChatFile("document.docx", facts(officeFile(names)), () => false)
      .contentType,
  ).toContain("wordprocessingml");
  expect(() =>
    classifyChatFile("document.xlsx", facts(officeFile(names)), () => false),
  ).toThrow("fileTypeNotAllowed");
  expect(() =>
    classifyChatFile(
      "document.docx",
      facts(officeFile([...names, "word/vbaProject.bin"])),
      () => false,
    ),
  ).toThrow("fileTypeNotAllowed");
  expect(() =>
    classifyChatFile(
      "document.docx",
      facts(Buffer.from("504b0304", "hex")),
      () => false,
    ),
  ).toThrow("fileTypeNotAllowed");
});

it("rejects executable content and unknown extensions regardless of the filename", () => {
  expect(() =>
    classifyChatFile(
      "source.ts",
      facts(Buffer.from("7f454c46", "hex"), true),
      () => true,
    ),
  ).toThrow("fileTypeNotAllowed");
  expect(() =>
    classifyChatFile(
      "script.sh",
      facts(Buffer.from("echo hi"), true),
      () => true,
    ),
  ).toThrow("fileTypeNotAllowed");
});
