import { beforeEach, describe, expect, it } from "vitest";

import { TEXT_TARGETS, TextWorld } from "./page59-text-world";

const INVALID_POSITIONS = [
  { start: { line: 0, column: 1 } },
  { start: { line: -1, column: 1 } },
  { start: { line: 1.5, column: 1 } },
  { start: { line: "1", column: 1 } },
  { start: { line: 1, column: 0 } },
  { start: { line: 1, column: 1.5 } },
  { start: { line: 1, column: Number.MAX_SAFE_INTEGER + 1 } },
  { end: { line: 0, column: 1 } },
  { end: { line: 1, column: 0 } },
  { end: { line: 3, column: 1 } },
  { end: { line: 2, column: 5 } },
  { start: { line: 1, column: 3 }, end: { line: 1, column: 2 } },
  { start: { line: 2, column: 1 }, end: { line: 1, column: 2 } },
];

let world: TextWorld;
beforeEach(() => {
  world = new TextWorld();
  world.seed("abc\ndef");
});

describe.each(TEXT_TARGETS)("%s patch refusals", (target) => {
  it("rejects a stale version after another successful save", async () => {
    const stale = await world.patchParameters(target);
    await world.patch(
      target,
      await world.patchParameters(target, { replacementText: "Y" }),
    );
    const before = world.stored();
    await expect(world.patch(target, stale)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(world.stored()).toEqual(before);
  });

  it("rejects different expectedText even if the replacement already matches", async () => {
    const parameters = await world.patchParameters(target, {
      expectedText: "b",
      replacementText: "a",
    });
    const before = world.stored();
    await expect(world.patch(target, parameters)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "range_text_mismatch" },
    });
    expect(world.stored()).toEqual(before);
  });

  it.each(INVALID_POSITIONS)(
    "rejects invalid or reversed positions %j atomically",
    async (overrides) => {
      const parameters = await world.patchParameters(target, overrides);
      const before = world.stored();
      await expect(world.patch(target, parameters)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
      expect(world.stored()).toEqual(before);
      await expect(world.read(target, overrides)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
      expect(world.stored()).toEqual(before);
    },
  );

  it("requires explicit columns for both patch positions", async () => {
    for (const position of ["start", "end"]) {
      const parameters = await world.patchParameters(target, {
        [position]: { line: 1 },
      });
      const before = world.stored();
      await expect(world.patch(target, parameters)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
      expect(world.stored()).toEqual(before);
    }
  });

  it("rolls back a storage failure after the text write and emits no event", async () => {
    const parameters = await world.patchParameters(target);
    world.isHistoryFailing = true;
    const before = world.stored();
    await expect(world.patch(target, parameters)).rejects.toThrow(
      "Synthetic history failure",
    );
    expect(world.stored()).toEqual(before);
  });
});

describe.each(TEXT_TARGETS)("%s size limits", (target) => {
  it.each([0, -1, 1.5, "4"])(
    "rejects malformed maxCharacters %j",
    async (maxCharacters) => {
      const before = world.stored();
      await expect(world.read(target, { maxCharacters })).rejects.toMatchObject(
        { code: "INVALID_REQUEST" },
      );
      expect(world.stored()).toEqual(before);
    },
  );

  it("rejects budgets above 16384 without changing stored state", async () => {
    const before = world.stored();
    await expect(
      world.read(target, { maxCharacters: 16_385 }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(world.stored()).toEqual(before);
  });

  it("enforces the composed result limit in UTF-8 bytes for wiki and UTF-16 units for tickets", async () => {
    const limit = target === "wiki" ? 1_048_576 : 65_536;
    const character = target === "wiki" ? "ä" : "😀";
    world.seed(character.repeat(limit / 2));
    const parameters = await world.patchParameters(target, {
      start: { line: 1, column: 1 },
      end: { line: 1, column: 1 },
      expectedText: "",
      replacementText: character,
    });
    const before = world.stored();
    await expect(world.patch(target, parameters)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      details: { limit },
    });
    expect(world.stored()).toEqual(before);
  });

  it("accepts a result exactly at the size limit", async () => {
    const limit = target === "wiki" ? 1_048_576 : 65_536;
    const character = target === "wiki" ? "ä" : "😀";
    world.seed(character.repeat(limit / 2 - 1));
    const parameters = await world.patchParameters(target, {
      end: { line: 1, column: 1 },
      expectedText: "",
      replacementText: character,
    });
    await expect(world.patch(target, parameters)).resolves.toMatchObject({
      changed: true,
    });
    expect(world.text(target)).toBe(character.repeat(limit / 2));
  });
});

it("rejects the ticket persistence compare-and-swap race without history or publication", async () => {
  const parameters = await world.patchParameters("ticket");
  world.isDescriptionRacing = true;
  const before = world.stored();
  await expect(world.patch("ticket", parameters)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(world.stored()).toEqual(before);
});
