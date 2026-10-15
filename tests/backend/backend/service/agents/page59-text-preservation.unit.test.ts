import { beforeEach, describe, expect, it } from "vitest";

import { TEXT_TARGETS, TextWorld } from "./page59-text-world";

let world: TextWorld;
beforeEach(() => {
  world = new TextWorld();
});

describe.each(TEXT_TARGETS)("%s text-only changes", (target) => {
  it("preserves every field except text and the wiki revision", async () => {
    world.seed("  prefix\r\nTARGET\r\nsuffix  \n");
    const ticket = structuredClone(world.ticket);
    const page = structuredClone(world.page);
    const parameters = await world.patchParameters(target, {
      start: { line: 2, column: 1 },
      end: { line: 2, column: 7 },
      expectedText: "TARGET",
      replacementText: "Ä😀e\u0301",
    });
    await world.patch(target, parameters);
    const changedText = "  prefix\r\nÄ😀e\u0301\r\nsuffix  \n";
    expect(world.text(target)).toBe(changedText);
    expect(world.ticket).toEqual(
      target === "ticket" ? { ...ticket, description: changedText } : ticket,
    );
    expect(world.page).toEqual(
      target === "wiki"
        ? { ...page, content: changedText, revision: page.revision + 1 }
        : page,
    );
  });
});
