import { beforeEach, describe, expect, it } from "vitest";

import { TEXT_TARGETS, TextWorld } from "./page59-text-world";

const PATCH_CASES = [
  {
    name: "exact replacement",
    end: { line: 1, column: 8 },
    expectedText: "cde",
    replacementText: "X",
    text: "  abXf  \r\nnext\n",
    replacementEnd: { line: 1, column: 6 },
  },
  {
    name: "insertion",
    end: { line: 1, column: 5 },
    expectedText: "",
    replacementText: "X",
    text: "  abXcdef  \r\nnext\n",
    replacementEnd: { line: 1, column: 6 },
  },
  {
    name: "deletion",
    end: { line: 1, column: 8 },
    expectedText: "cde",
    replacementText: "",
    text: "  abf  \r\nnext\n",
    replacementEnd: { line: 1, column: 5 },
  },
  {
    name: "multiline replacement",
    end: { line: 2, column: 3 },
    expectedText: "cdef  \r\nne",
    replacementText: "Ä😀\nQ",
    text: "  abÄ😀\nQxt\n",
    replacementEnd: { line: 2, column: 2 },
  },
];

let world: TextWorld;
beforeEach(() => {
  world = new TextWorld();
});

describe.each(TEXT_TARGETS)("%s range patches", (target) => {
  it.each(PATCH_CASES)(
    "applies $name verbatim",
    async ({ end, expectedText, replacementText, text, replacementEnd }) => {
      world.seed("  abcdef  \r\nnext\n");
      const start = { line: 1, column: 5 };
      const parameters = await world.patchParameters(target, {
        start,
        end,
        expectedText,
        replacementText,
        includeAfter: true,
      });
      expect(await world.patch(target, parameters)).toMatchObject({
        changed: true,
        start,
        end: replacementEnd,
        after: {
          text: replacementText,
          start,
          end: replacementEnd,
          truncated: false,
          next: null,
        },
      });
      expect(world.text(target)).toBe(text);
    },
  );

  it("uses code point columns for patches without normalizing combining characters", async () => {
    world.seed("ä😀e\u0301\r\nÖ");
    const parameters = await world.patchParameters(target, {
      start: { line: 1, column: 2 },
      end: { line: 1, column: 4 },
      expectedText: "😀e",
      replacementText: "🚀ü",
      includeAfter: true,
    });
    expect(await world.patch(target, parameters)).toMatchObject({
      start: { line: 1, column: 2 },
      end: { line: 1, column: 4 },
      after: { text: "🚀ü" },
    });
    expect(world.text(target)).toBe("ä🚀ü\u0301\r\nÖ");
  });

  it("inserts at EOF, including an empty document", async () => {
    world.seed("");
    const parameters = await world.patchParameters(target, {
      end: { line: 1, column: 1 },
      expectedText: "",
      replacementText: "ä\n😀",
    });
    const result = await world.patch(target, parameters);
    expect(result).toMatchObject({
      changed: true,
      start: { line: 1, column: 1 },
      end: { line: 2, column: 2 },
    });
    expect(result).not.toHaveProperty("after");
    expect(world.text(target)).toBe("ä\n😀");
  });
});
