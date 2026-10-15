import { beforeEach, describe, expect, it } from "vitest";

import { TEXT_TARGETS, TextWorld } from "./page59-text-world";

let world: TextWorld;

beforeEach(() => {
  world = new TextWorld();
});

describe.each(TEXT_TARGETS)("%s Unicode positions", (target) => {
  it.each(["\n", "\r\n", "\r"])(
    "counts code points and treats %j as one line break",
    async (separator) => {
      world.seed(`ä😀e\u0301${separator}Ö\n🚀`);
      expect(
        await world.read(target, { end: { line: 1, column: 5 } }),
      ).toMatchObject({
        text: "ä😀e\u0301",
        characterCount: 8,
        lineCount: 3,
        byteCount: 16 + separator.length,
      });
      expect(
        await world.read(target, {
          start: { line: 1, column: 2 },
          end: { line: 1, column: 4 },
        }),
      ).toMatchObject({ text: "😀e", end: { line: 1, column: 4 } });
      expect(
        await world.read(target, {
          start: { line: 1, column: 4 },
          end: { line: 1, column: 5 },
        }),
      ).toMatchObject({ text: "\u0301" });
      expect(
        await world.read(target, {
          start: { line: 1, column: 5 },
          maxCharacters: 1,
        }),
      ).toMatchObject({
        text: separator,
        end: { line: 2, column: 1 },
        next: { line: 2, column: 1 },
        truncated: true,
      });
      expect(
        await world.read(target, {
          start: { line: 2 },
          end: { line: 3, column: 2 },
        }),
      ).toMatchObject({ text: "Ö\n🚀", truncated: false, next: null });
    },
  );

  it("never splits an emoji or CRLF at the character budget", async () => {
    world.seed("ä😀\r\ne\u0301");
    const first = await world.read(target, { maxCharacters: 3 });
    expect(first).toMatchObject({
      text: "ä😀\r\n",
      next: { line: 2, column: 1 },
      characterCount: 5,
      byteCount: 11,
    });
    const second = await world.read(target, {
      start: first.next,
      maxCharacters: 1,
    });
    expect(second).toMatchObject({ text: "e", next: { line: 2, column: 2 } });
    const third = await world.read(target, {
      start: second.next,
      maxCharacters: 1,
    });
    expect(third).toMatchObject({
      text: "\u0301",
      truncated: false,
      next: null,
    });
    expect(first.text + second.text + third.text).toBe(world.text(target));
  });
});
