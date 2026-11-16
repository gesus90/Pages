import { expect, it } from "vitest";

import {
  chatDocumentText,
  isChatDocumentType,
  readChatDocument,
} from "@/backend/service/chat/ChatDocumentReader";

it("recognizes supported document types and reports unreadable content", async () => {
  expect(isChatDocumentType("application/pdf")).toBe(true);
  expect(isChatDocumentType("text/plain")).toBe(false);
  await expect(
    readChatDocument("text/plain", Buffer.from("text")),
  ).resolves.toEqual({ status: "unreadable" });
});

it("renders sections and sheets with headings and Unicode-aware limits", () => {
  const document = {
    sections: [
      { kind: "page" as const, number: 1, text: "Hello 😀" },
      { kind: "slide" as const, number: 2, text: "Slide" },
    ],
    sheets: [{ name: "Data", rows: [["a", "b"]] }],
    isTruncated: false,
  };
  const full = chatDocumentText(document, 1000);
  expect(full.text).toContain("Seite 1:\nHello 😀");
  expect(full.text).toContain('Tabelle "Data":\na\tb');
  expect(full.isTruncated).toBe(false);
  expect(chatDocumentText(document, 5)).toMatchObject({
    text: "Seite",
    isTruncated: true,
    characters: full.characters,
  });
});
