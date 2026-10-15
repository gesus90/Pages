import { beforeEach, describe, expect, it } from "vitest";

import { TEXT_TARGETS, TextWorld } from "./page59-text-world";

let world: TextWorld;
beforeEach(() => {
  world = new TextWorld();
  world.seed("abc\ndef");
});

describe.each(TEXT_TARGETS)("%s operation ID replay", (target) => {
  it("returns the identical stored response after another save without applying the patch again", async () => {
    const parameters = await world.patchParameters(target, {
      replacementText: "Ä😀\nQ",
      includeAfter: true,
    });
    const first = await world.patch(target, parameters);
    await world.patch(
      target,
      await world.patchParameters(target, { replacementText: "Z" }),
    );
    const before = world.stored();
    expect(await world.patch(target, parameters)).toEqual(first);
    expect(world.stored()).toEqual(before);
  });

  it.each([
    { replacementText: "different" },
    { expectedText: "different" },
    { start: { line: 1, column: 2 } },
    { end: { line: 1, column: 3 } },
    { includeAfter: true },
  ])("refuses reuse with changed parameters %j", async (changes) => {
    const parameters = await world.patchParameters(target);
    await world.patch(target, parameters);
    const before = world.stored();
    await expect(
      world.patch(target, { ...parameters, ...changes }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(world.stored()).toEqual(before);
  });

  it("also replays a no-op without a new operation record or history", async () => {
    const parameters = await world.patchParameters(target, {
      replacementText: "a",
    });
    const first = await world.patch(target, parameters);
    const before = world.stored();
    expect(first).toMatchObject({ changed: false });
    expect(await world.patch(target, parameters)).toEqual(first);
    expect(world.stored()).toEqual(before);
  });
});
