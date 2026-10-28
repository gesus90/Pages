import { expect, it } from "vitest";

import {
  EMOJI_CATEGORIES,
  EMOJI_ENTRIES,
  searchEmoji,
} from "@/app/lib/editor/emoji-catalog";

it("lists every emoji grouped in picker order", () => {
  const order = EMOJI_ENTRIES.map((entry) =>
    EMOJI_CATEGORIES.indexOf(entry.category),
  );

  expect(EMOJI_ENTRIES.length).toBeGreaterThan(100);
  expect(order).toEqual(order.toSorted((first, second) => first - second));
});

it("returns every emoji for an empty query", () => {
  expect(searchEmoji("  ")).toEqual(EMOJI_ENTRIES);
});

it("finds emoji by English and German words, ignoring case and accents", () => {
  expect(searchEmoji("TENT").map((entry) => entry.emoji)).toEqual(["⛺"]);
  expect(searchEmoji("zelt").map((entry) => entry.emoji)).toEqual(["⛺"]);
  expect(searchEmoji("insel urlaub").map((entry) => entry.emoji)).toEqual([
    "🏝️",
  ]);
  expect(searchEmoji("Kärte").map((entry) => entry.emoji)).toContain("🗺️");
});

it("requires every word to match and respects the limit", () => {
  expect(searchEmoji("tent island")).toEqual([]);
  expect(searchEmoji("", 3)).toEqual(EMOJI_ENTRIES.slice(0, 3));
});
