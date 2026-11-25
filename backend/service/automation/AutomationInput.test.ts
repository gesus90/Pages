import { expect, it } from "vitest";
import { z } from "zod";

import { AutomationError } from "@/backend/error/AutomationError";

import {
  createInputSchema,
  decodeAutomationCursor,
  deleteInputSchema,
  encodeAutomationCursor,
  listInputSchema,
  optionsInputSchema,
  readAutomationInput,
  readInputSchema,
  runInputSchema,
  runReadInputSchema,
  runsListInputSchema,
  setActiveInputSchema,
  updateInputSchema,
} from "./AutomationInput";

const OPERATION_ID = "0b1f7a52-6a3c-4d5e-8f10-2a9b3c4d5e6f";

function problemsOf(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof AutomationError) return error.problems;
  }
  return [];
}

it("accepts the inputs of the operations", () => {
  expect(optionsInputSchema.safeParse({}).success).toBe(true);
  expect(listInputSchema.safeParse({ limit: 5, text: "a" }).success).toBe(true);
  expect(readInputSchema.safeParse({ automationId: "a" }).success).toBe(true);
  expect(
    runsListInputSchema.safeParse({ automationId: "a", cursor: null }).success,
  ).toBe(true);
  expect(
    runReadInputSchema.safeParse({ automationId: "a", runId: "r" }).success,
  ).toBe(true);
  const base = { operationId: OPERATION_ID, automationId: "a" };
  expect(
    setActiveInputSchema.safeParse({
      ...base,
      expectedRevision: 1,
      isActive: true,
    }).success,
  ).toBe(true);
  expect(
    runInputSchema.safeParse({ ...base, expectedRevision: 2 }).success,
  ).toBe(true);
  expect(
    deleteInputSchema.safeParse({ ...base, expectedRevision: 2 }).success,
  ).toBe(true);
});

it("requires fields in a creation", () => {
  expect(createInputSchema.safeParse({}).success).toBe(false);
});

it("requires a change in a patch", () => {
  const base = {
    operationId: OPERATION_ID,
    automationId: "a",
    expectedRevision: 1,
  };
  expect(updateInputSchema.safeParse(base).success).toBe(false);
  expect(
    updateInputSchema.safeParse({ ...base, isActive: false }).success,
  ).toBe(true);
});

it("returns valid input and treats undefined as empty", () => {
  expect(readAutomationInput(z.object({ a: z.number() }), { a: 1 })).toEqual({
    a: 1,
  });
  expect(readAutomationInput(z.object({}), undefined)).toEqual({});
});

it("names the paths of every problem without values", () => {
  const schema = z.object({ a: z.object({ b: z.number() }) });
  expect(
    problemsOf(() => readAutomationInput(schema, { a: { b: "x" } })),
  ).toEqual([expect.stringMatching(/^a\.b: /u)]);
  expect(problemsOf(() => readAutomationInput(schema, 5))[0]).toMatch(/^\$: /u);
});

it("limits the problems to twenty", () => {
  const schema = z.array(z.number());
  const input = Array.from({ length: 30 }, () => "x");
  expect(problemsOf(() => readAutomationInput(schema, input))).toHaveLength(20);
});

it("round-trips a cursor", () => {
  const cursor = { createdAt: "2026-01-01T00:00:00Z", id: "x", sequence: 3 };
  expect(decodeAutomationCursor(encodeAutomationCursor(cursor))).toEqual(
    cursor,
  );
});

it("reads no cursor from an empty value", () => {
  expect(decodeAutomationCursor(null)).toBeNull();
  expect(decodeAutomationCursor(undefined)).toBeNull();
  expect(decodeAutomationCursor("")).toBeNull();
});

it("refuses a cursor Pages did not issue", () => {
  expect(() => decodeAutomationCursor("***")).toThrow(AutomationError);
  expect(() =>
    decodeAutomationCursor(encodeAutomationCursor({ sequence: 0 })),
  ).toThrow(AutomationError);
});
