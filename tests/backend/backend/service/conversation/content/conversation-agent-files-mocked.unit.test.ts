import { beforeEach, expect, it, vi } from "vitest";

import { ConversationAgentFiles } from "@/backend/service/conversation/content/ConversationAgentFiles";

vi.mock("node:fs/promises", () => ({
  realpath: vi.fn((target: string) => Promise.resolve(target)),
  stat: vi.fn(() => Promise.resolve({ isFile: () => true, size: 7 })),
  access: vi.fn(() => Promise.resolve()),
}));

import { access, realpath } from "node:fs/promises";

beforeEach(() => {
  vi.clearAllMocks();
});

it("keeps fenced file lines as text and decodes a permitted file path", async () => {
  const files = new ConversationAgentFiles({ home: "/synthetic" });
  const selection = await files.select(
    "```\n![x](file:/synthetic/Results/hidden.txt)\n```\n![x](file:/synthetic/Results/a%20b.txt)",
  );
  expect(selection.text).toBe(
    "```\n![x](file:/synthetic/Results/hidden.txt)\n```",
  );
  expect(selection.files).toEqual([
    {
      path: "/synthetic/Results/a b.txt",
      name: "a b.txt",
      mimeType: "text/plain",
      sizeBytes: 7,
      lineIndex: 3,
    },
  ]);
});

it("reports missing and unreadable files", async () => {
  const files = new ConversationAgentFiles({ home: "/synthetic" });
  vi.mocked(realpath).mockRejectedValueOnce(new Error("missing"));
  expect(
    (await files.select("![x](file:/synthetic/Results/missing)")).text,
  ).toContain("Datei nicht gefunden");
  vi.mocked(access).mockRejectedValueOnce(new Error("denied"));
  expect(
    (await files.select("![x](file:/synthetic/Results/file)")).text,
  ).toContain("Datei nicht lesbar");
});
