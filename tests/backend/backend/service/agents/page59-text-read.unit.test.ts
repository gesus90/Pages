import { beforeEach, describe, expect, it } from "vitest";

import { TEXT_TARGETS, TextWorld } from "./page59-text-world";

let world: TextWorld;

beforeEach(() => {
  world = new TextWorld();
});

describe.each(TEXT_TARGETS)("%s passage reads", (target) => {
  it("uses one-based inclusive start and exclusive end, defaulting columns to one", async () => {
    world.seed("first\nsecond\nthird");
    const before = world.stored();
    expect(
      await world.read(target, {
        start: { line: 1, column: 2 },
        end: { line: 2, column: 4 },
      }),
    ).toMatchObject({
      text: "irst\nsec",
      start: { line: 1, column: 2 },
      end: { line: 2, column: 4 },
      truncated: false,
      next: null,
      lineCount: 3,
      characterCount: 18,
      byteCount: 18,
    });
    expect(
      await world.read(target, { start: { line: 2 }, end: { line: 3 } }),
    ).toMatchObject({
      text: "second\n",
      start: { line: 2, column: 1 },
      end: { line: 3, column: 1 },
    });
    expect(world.stored()).toEqual(before);
  });

  it("continues at next without skipping or duplicating characters", async () => {
    world.seed("ab\ncdef");
    const first = await world.read(target, { maxCharacters: 3 });
    expect(first).toMatchObject({
      text: "ab\n",
      truncated: true,
      end: { line: 2, column: 1 },
      next: { line: 2, column: 1 },
    });
    const second = await world.read(target, {
      start: first.next,
      maxCharacters: 4,
    });
    expect(second).toMatchObject({
      text: "cdef",
      truncated: false,
      next: null,
      end: { line: 2, column: 5 },
    });
    expect(first.text + second.text).toBe(world.text(target));
  });
});

describe.each(TEXT_TARGETS)("%s passage boundaries", (target) => {
  it("uses the default and maximum character budgets", async () => {
    world.seed("a".repeat(16_385));
    expect(await world.read(target)).toMatchObject({
      text: "a".repeat(4096),
      truncated: true,
      next: { line: 1, column: 4097 },
    });
    expect(await world.read(target, { maxCharacters: 16_384 })).toMatchObject({
      text: "a".repeat(16_384),
      truncated: true,
      next: { line: 1, column: 16_385 },
    });
  });

  it("refuses an explicit range exceeding its budget without silently truncating", async () => {
    world.seed("abcd");
    const before = world.stored();
    await expect(
      world.read(target, { end: { line: 1, column: 5 }, maxCharacters: 3 }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(
      await world.read(target, {
        end: { line: 1, column: 5 },
        maxCharacters: 4,
      }),
    ).toMatchObject({ text: "abcd", truncated: false, next: null });
    expect(world.stored()).toEqual(before);
  });

  it.each([{ end: { line: 2, column: 1 } }, { end: { line: 1, column: 6 } }])(
    "rejects an end beyond the text: %j",
    async (parameters) => {
      world.seed("abcd");
      const before = world.stored();
      await expect(world.read(target, parameters)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
      expect(world.stored()).toEqual(before);
    },
  );

  it.each(["", "abc", "abc\n"])(
    "allows an empty range at EOF for %j",
    async (text) => {
      world.seed(text);
      const start = text.endsWith("\n")
        ? { line: 2, column: 1 }
        : { line: 1, column: text.length + 1 };
      expect(await world.read(target, { start, end: start })).toMatchObject({
        text: "",
        start,
        end: start,
        truncated: false,
        next: null,
      });
    },
  );
});
