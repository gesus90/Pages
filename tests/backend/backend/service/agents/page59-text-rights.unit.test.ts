import { beforeEach, describe, expect, it } from "vitest";

import { CAPABILITY } from "@/definition/Authorization";

import { TEXT_TARGETS, TextWorld } from "./page59-text-world";

import type { TextTarget } from "./page59-text-world";

let world: TextWorld;
beforeEach(() => {
  world = new TextWorld();
  world.seed("abc\ndef");
});

async function failure(
  target: TextTarget,
  parameters: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  try {
    await world.patch(target, parameters);
    throw new Error("Expected refusal");
  } catch (error: unknown) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      !("details" in error) ||
      !("status" in error)
    )
      throw error;
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      status: error.status,
    };
  }
}

describe.each(TEXT_TARGETS)("%s current rights on every call", (target) => {
  it("allows a visible read without write capability but refuses patches", async () => {
    const parameters = await world.patchParameters(target);
    world.person = { capabilities: [] };
    const before = world.stored();
    expect(await world.read(target)).toMatchObject({ text: "abc\ndef" });
    await expect(world.patch(target, parameters)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(world.stored()).toEqual(before);
  });

  it("rechecks visibility after a successful call and tools/list", async () => {
    const parameters = await world.patchParameters(target);
    const listed = await world.api.handle("synthetic-personal-token", {
      operation: "verify",
    });
    expect(listed).toHaveProperty("tools");
    world.person = { capabilities: [CAPABILITY.WRITE], departments: ["other"] };
    const before = world.stored();
    await expect(world.read(target)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: undefined,
    });
    await expect(world.patch(target, parameters)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      details: undefined,
    });
    expect(world.stored()).toEqual(before);
  });

  it("does not distinguish hidden and missing write targets, even with a stale version", async () => {
    const parameters = await world.patchParameters(
      target,
      target === "wiki"
        ? { expectedRevision: 1 }
        : { expectedDescriptionVersion: "0".repeat(32) },
    );
    world.person = { capabilities: [CAPABILITY.WRITE], departments: ["other"] };
    const before = world.stored();
    const hidden = await failure(target, parameters);
    const missing = await failure(target, {
      ...parameters,
      ...world.target(target),
      [target === "wiki" ? "pageId" : "ticketId"]: "missing",
    });
    expect(hidden).toEqual({
      code: "NOT_FOUND",
      status: 404,
      message: "Not found or no access.",
      details: undefined,
    });
    expect(missing).toEqual(hidden);
    expect(world.stored()).toEqual(before);
  });

  it("rechecks write rights and visibility before replaying a stored response", async () => {
    const parameters = await world.patchParameters(target);
    await world.patch(target, parameters);
    const before = world.stored();
    world.person = { capabilities: [] };
    await expect(world.patch(target, parameters)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    world.person = { capabilities: [CAPABILITY.WRITE], departments: ["other"] };
    await expect(world.patch(target, parameters)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(world.stored()).toEqual(before);
  });

  it.each([{ isActive: false }, { mustChangePassword: true }])(
    "rejects a newly disabled account %j for reads, writes and replay",
    async (person) => {
      const parameters = await world.patchParameters(target);
      await world.patch(target, parameters);
      world.person = person;
      const before = world.stored();
      await expect(world.read(target)).rejects.toMatchObject({ status: 401 });
      await expect(world.patch(target, parameters)).rejects.toMatchObject({
        status: 401,
      });
      expect(world.stored()).toEqual(before);
    },
  );
});
