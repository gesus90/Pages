import { expect, it, vi } from "vitest";

import { storedFormOfText } from "./TaskStoredText";

it("returns a text without U+0000 unchanged", async () => {
  const storedTextForm = vi.fn(async (text: string) => text);

  await expect(storedFormOfText({ storedTextForm }, "plain")).resolves.toBe(
    "plain",
  );
  expect(storedTextForm).not.toHaveBeenCalled();
});

it("asks the database for the stored form of a text with U+0000", async () => {
  const storedTextForm = vi.fn(async (text: string) =>
    text.replaceAll("\u0000", ""),
  );

  await expect(storedFormOfText({ storedTextForm }, "a\u0000b")).resolves.toBe(
    "ab",
  );
  expect(storedTextForm).toHaveBeenCalledWith("a\u0000b");
});
