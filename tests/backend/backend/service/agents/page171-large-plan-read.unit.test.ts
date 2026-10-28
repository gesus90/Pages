import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import { chunkAgentRead } from "@/backend/service/agents/AgentReadChunking";
import { createAgentCursor } from "@/backend/service/agents/AgentCursor";

import { PlanWorld, runnablePlan } from "./plan-operation-world";

function stringField(entry: object, name: string): string {
  const field: unknown = Reflect.get(entry, name);
  if (typeof field !== "string") throw new Error(`Invalid ${name}`);
  return field;
}

function numberField(entry: object, name: string): number {
  const field: unknown = Reflect.get(entry, name);
  if (typeof field !== "number") throw new Error(`Invalid ${name}`);
  return field;
}

function chunkOf(input: unknown): {
  readonly text: string;
  readonly offsetBytes: number;
  readonly byteLength: number;
  readonly totalBytes: number;
  readonly sha256: string;
  readonly nextCursor: string | null;
} {
  if (typeof input !== "object" || input === null || !("chunk" in input))
    throw new Error("Expected a chunk");
  const { chunk } = input;
  if (typeof chunk !== "object" || chunk === null || !("nextCursor" in chunk))
    throw new Error("Malformed chunk");
  if (chunk.nextCursor !== null && typeof chunk.nextCursor !== "string")
    throw new Error("Malformed cursor");
  return {
    text: stringField(chunk, "text"),
    offsetBytes: numberField(chunk, "offsetBytes"),
    byteLength: numberField(chunk, "byteLength"),
    totalBytes: numberField(chunk, "totalBytes"),
    sha256: stringField(chunk, "sha256"),
    nextCursor: chunk.nextCursor,
  };
}

it("reads a plan larger than one MiB in bounded, consistent UTF-8 chunks", async () => {
  const world = new PlanWorld();
  const value = `${"x".repeat(169_990)}😀\n\\\u0000`;
  const globals = Object.fromEntries(
    Array.from({ length: 7 }, (_, index) => [`value${index}`, value]),
  );
  world.seed({ ...runnablePlan("large"), globals });
  let cursor: string | null = null;
  let reconstructed = "";
  let digest = "";
  let totalBytes = 0;
  let count = 0;
  do {
    const result = await world.call("owner", "plans.read", {
      planId: "large",
      maxBytes: 65_536,
      ...(cursor ? { cursor } : {}),
    });
    expect(
      Buffer.byteLength(JSON.stringify({ apiVersion: "1", result })),
    ).toBeLessThanOrEqual(65_536);
    const chunk = chunkOf(result);
    expect(chunk.offsetBytes).toBe(Buffer.byteLength(reconstructed));
    expect(chunk.byteLength).toBe(Buffer.byteLength(chunk.text));
    if (count === 0) {
      digest = chunk.sha256;
      totalBytes = chunk.totalBytes;
    }
    expect(chunk.sha256).toBe(digest);
    expect(chunk.totalBytes).toBe(totalBytes);
    reconstructed += chunk.text;
    cursor = chunk.nextCursor;
    count += 1;
  } while (cursor);
  expect(totalBytes).toBeGreaterThan(1_048_576);
  expect(count).toBeGreaterThan(1);
  expect(Buffer.byteLength(reconstructed)).toBe(totalBytes);
  expect(createHash("sha256").update(reconstructed).digest("hex")).toBe(digest);
  const parsed: unknown = JSON.parse(reconstructed);
  expect(parsed).toMatchObject({ plan: { id: "large", globals } });
});

it("rejects a continuation when the saved plan changes", async () => {
  const world = new PlanWorld();
  const plan = runnablePlan("large", { name: "Before" });
  world.seed(plan);
  const first = chunkOf(
    await world.call("owner", "plans.read", {
      planId: "large",
      maxBytes: 1_024,
    }),
  );
  expect(first.nextCursor).not.toBeNull();
  world.seed({ ...plan, revision: plan.revision + 1, name: "After" });
  await expect(
    world.call("owner", "plans.read", {
      planId: "large",
      maxBytes: 1_024,
      cursor: first.nextCursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

it("continues an earlier cursor and reconstructs the same small plan JSON", async () => {
  const world = new PlanWorld();
  const plan = runnablePlan("compatible", {
    name: 'Quotes " and emoji 😀',
  });
  world.seed(plan);
  const original = await world.call("owner", "plans.read", {
    planId: plan.id,
  });
  const context = JSON.stringify([
    "owner",
    "plans.read",
    plan.id,
    plan.revision,
  ]);
  const first = chunkOf(chunkAgentRead(original, { context, maxBytes: 1_024 }));
  let cursor = first.nextCursor;
  let reconstructed = first.text;
  while (cursor) {
    const next = chunkOf(
      await world.call("owner", "plans.read", {
        planId: plan.id,
        maxBytes: 1_024,
        cursor,
      }),
    );
    expect(next.offsetBytes).toBe(Buffer.byteLength(reconstructed));
    expect(next.sha256).toBe(first.sha256);
    reconstructed += next.text;
    cursor = next.nextCursor;
  }
  expect(reconstructed).toBe(JSON.stringify(original));
  expect(JSON.parse(reconstructed)).toEqual(original);
});

it("rejects a cursor for another reader, changed status or a split UTF-8 character", async () => {
  const world = new PlanWorld();
  const plan = runnablePlan("cursors", { name: "Plan 😀" });
  world.seed(plan);
  const original = await world.call("owner", "plans.read", { planId: plan.id });
  const context = JSON.stringify([
    "owner",
    "plans.read",
    plan.id,
    plan.revision,
  ]);
  const first = chunkOf(chunkAgentRead(original, { context, maxBytes: 1_024 }));
  await expect(
    world.call("reader", "plans.read", {
      planId: plan.id,
      maxBytes: 1_024,
      cursor: first.nextCursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  const serialized = JSON.stringify(original);
  const emoji = serialized.indexOf("😀");
  expect(emoji).toBeGreaterThanOrEqual(0);
  const middle = Buffer.byteLength(serialized.slice(0, emoji)) + 1;
  const cursorContext = JSON.stringify([context, 1_024, first.sha256]);
  await expect(
    world.call("owner", "plans.read", {
      planId: plan.id,
      maxBytes: 1_024,
      cursor: createAgentCursor(cursorContext, String(middle)),
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  world.addRun({
    id: "run-after-read",
    planId: plan.id,
    startedAt: "2026-10-28T10:00:00.000Z",
    status: "running",
  });
  await expect(
    world.call("owner", "plans.read", {
      planId: plan.id,
      maxBytes: 1_024,
      cursor: first.nextCursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});
