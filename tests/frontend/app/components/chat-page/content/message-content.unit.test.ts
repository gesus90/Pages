import { expect, it } from "vitest";

import {
  parseMessageContent,
  textAttachmentKind,
} from "@/app/components/chat-page/content/message-content";

import type { ConversationAttachment } from "@/definition/ConversationContent";

const attachment: ConversationAttachment = {
  id: "file",
  name: "sample.ts",
  mimeType: "text/plain",
  sizeBytes: 12,
  kind: "file",
  url: "/file",
};

it("keeps text and cards in order and reads fence titles", () => {
  expect(
    parseMessageContent(
      "Before\n```ts title=src/a.ts\nconst a = 1;\n```\nhttps://example.com\nAfter",
    ),
  ).toEqual([
    { kind: "text", text: "Before" },
    {
      kind: "code",
      name: "src/a.ts",
      languageHint: "ts",
      source: "const a = 1;",
    },
    { kind: "link", url: "https://example.com/" },
    { kind: "text", text: "After" },
  ]);
});

it("recognizes diff and markdown fences and retains an unclosed fence", () => {
  expect(
    parseMessageContent(
      "~~~patch\n-old\n+new\n~~~\n```md\n# Title\n```\n```app.js\nrun()",
    ),
  ).toEqual([
    { kind: "diff", source: "-old\n+new" },
    { kind: "markdown", source: "# Title" },
    { kind: "code", name: "app.js", languageHint: "app.js", source: "run()" },
  ]);
});

it("leaves credentials, invalid URLs and inline links as text", () => {
  const text =
    "https://user:pass@example.com\nhttps://\nVisit https://example.com";
  expect(parseMessageContent(text)).toEqual([{ kind: "text", text }]);
  expect(parseMessageContent("<https://example.com/path>")).toEqual([
    { kind: "link", url: "https://example.com/path" },
  ]);
});

it("selects text cards only for supported small files", () => {
  expect(textAttachmentKind(attachment)).toBe("code");
  expect(textAttachmentKind({ ...attachment, name: "change.diff" })).toBe(
    "diff",
  );
  expect(textAttachmentKind({ ...attachment, name: "readme.md" })).toBe(
    "markdown",
  );
  expect(
    textAttachmentKind({ ...attachment, name: "unknown.xyzxyz" }),
  ).toBeNull();
  expect(textAttachmentKind({ ...attachment, kind: "image" })).toBeNull();
  expect(
    textAttachmentKind({ ...attachment, sizeBytes: 1024 * 1024 + 1 }),
  ).toBeNull();
});
