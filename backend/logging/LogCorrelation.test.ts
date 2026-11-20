import { expect, it, vi } from "vitest";

import { CORRELATION_ENVIRONMENT_VARIABLE } from "@/definition/RequestCorrelation";

import { correlationEnvironment, readCorrelationId } from "./LogCorrelation";
import type * as NodeCrypto from "node:crypto";

const state = vi.hoisted(() => ({
  correlationId: null as string | null,
  generatedId: "generated-trace-id",
}));

vi.mock("./Logger", () => ({
  currentLogContext: () => ({
    correlationId: state.correlationId ?? undefined,
  }),
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, randomUUID: () => state.generatedId };
});

it("accepts one bounded wire identifier and rejects everything else", () => {
  expect(readCorrelationId("req-1.2:3_ok")).toBe("req-1.2:3_ok");
  expect(readCorrelationId("a".repeat(128))).toBe("a".repeat(128));
  expect(readCorrelationId("a".repeat(129))).toBeUndefined();
  expect(readCorrelationId("has space")).toBeUndefined();
  expect(readCorrelationId("")).toBeUndefined();
  expect(readCorrelationId(42)).toBeUndefined();
  expect(readCorrelationId(undefined)).toBeUndefined();
});

it("passes the current correlation identifier to child processes", () => {
  state.correlationId = "parent-trace";

  expect(correlationEnvironment()).toEqual({
    [CORRELATION_ENVIRONMENT_VARIABLE]: "parent-trace",
  });
});

it("starts a new identifier when no trace is active", () => {
  state.correlationId = null;

  expect(correlationEnvironment()).toEqual({
    [CORRELATION_ENVIRONMENT_VARIABLE]: "generated-trace-id",
  });
});
