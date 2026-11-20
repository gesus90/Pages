import { expect, it } from "vitest";

import { DatabaseOverloadedError } from "@/backend/database/executor/DatabaseExecutorErrors";

import { databaseFailureFacts, serializeLogError } from "./LogError";

class NamedFailure extends Error {
  public override readonly name = "NamedFailure";
}

it("serializes non-object rejections without their payload", () => {
  expect(serializeLogError("secret payload")).toEqual({
    type: "NonError",
    message: "Non-Error rejection (payload omitted)",
    code: null,
    stack: "",
  });
});

it("keeps the error type and a safe code while omitting the free-form message", () => {
  const failure = Object.assign(new NamedFailure("row 42 contains email"), {
    code: "ERR_PAGES.7",
  });

  const serialized = serializeLogError(failure);

  expect(serialized).toMatchObject({
    type: "NamedFailure",
    message:
      "Error reported; free-form diagnostic text omitted to protect user content",
    code: "ERR_PAGES.7",
  });
  expect(JSON.stringify(serialized)).not.toContain("row 42");
});

it("drops unsafe code values and keeps only stack frames", () => {
  const failure = new Error("message");
  failure.stack = [
    "Error: message with SELECT secret",
    "    at first (file.ts:1:1)",
    "not a frame",
    "    at second (file.ts:2:2)",
  ].join("\n");
  Object.assign(failure, { code: "has spaces" });

  const serialized = serializeLogError(failure);

  expect(serialized.code).toBeNull();
  expect(serialized.stack).toBe(
    "    at first (file.ts:1:1)\n    at second (file.ts:2:2)",
  );
  expect(serialized).not.toHaveProperty("truncated");
});

it("bounds the stack to 24 frames and 1200 characters and marks the cut", () => {
  const frames = Array.from(
    { length: 40 },
    (frame, index) => `    at frame${index} (${"f".repeat(60)}.ts:1:1)`,
  );
  const failure = new Error("long");
  failure.stack = frames.join("\n");

  const serialized = serializeLogError(failure);

  expect(serialized.stack.length).toBeLessThanOrEqual(1_200);
  expect(serialized.stack.split("\n").length).toBeLessThanOrEqual(24);
  expect(serialized).toMatchObject({ truncated: true });
});

it("marks a stack that exceeds 16 KiB as truncated", () => {
  const failure = new Error("huge");
  failure.stack = `${"x".repeat(16_500)}`;

  const serialized = serializeLogError(failure);

  expect(serialized.stack).toBe("");
  expect(serialized).toMatchObject({ truncated: true });
});

it("serializes a cause chain and stops at the depth limit", () => {
  let chained = new Error("c5");
  for (let depth = 4; depth >= 0; depth -= 1) {
    chained = new Error(`c${depth}`, { cause: chained });
  }

  const serialized = serializeLogError(chained);

  let level: unknown = serialized;
  let depthSeen = 0;
  while (typeof level === "object" && level !== null && "cause" in level) {
    level = level.cause;
    depthSeen += 1;
  }
  expect(depthSeen).toBe(5);
  expect(level).toMatchObject({
    type: "TruncatedError",
    message: "Circular or deep cause omitted",
    truncated: true,
  });
});

it("omits a circular cause instead of recursing", () => {
  const failure = new Error("loop");
  Object.assign(failure, { cause: failure });

  const serialized = serializeLogError(failure);

  expect(serialized).toMatchObject({
    cause: { type: "TruncatedError", truncated: true },
  });
});

it("finds the name on a prototype and falls back to ErrorObject", () => {
  class PrototypeNamed {}
  Object.defineProperty(PrototypeNamed.prototype, "name", {
    value: "PrototypeFailure",
  });
  class WithoutName {}
  const withPrototypeName = new PrototypeNamed();
  const withoutName = new WithoutName();

  expect(serializeLogError(withPrototypeName)).toMatchObject({
    type: "PrototypeFailure",
  });
  expect(serializeLogError(withoutName)).toMatchObject({
    type: "ErrorObject",
  });
});

it("reads a native stack getter and ignores a non-native one", () => {
  const nativeStackError = new Error("native");
  const customStack = Object.defineProperty({}, "stack", {
    get: () => "    at custom (file.ts:1:1)",
    enumerable: true,
  });

  expect(serializeLogError(nativeStackError).stack).toMatch(/^\s+at /mu);
  expect(serializeLogError(customStack).stack).toBe("");
});

it("reports executor failures with their reason and no SQL", () => {
  const executorFailure = new DatabaseOverloadedError("queue_timeout");

  expect(databaseFailureFacts(executorFailure)).toEqual({
    failure: "queue_timeout",
    notStarted: true,
  });
  expect(serializeLogError(executorFailure)).toMatchObject({
    type: "DatabaseOverloadedError",
    failure: "queue_timeout",
    notStarted: true,
  });
  expect(databaseFailureFacts(new Error("plain"))).toEqual({});
});

it("reports a hostile error whose inspection throws as a serialization failure", () => {
  const hostile = new Proxy<object>(
    {},
    {
      getPrototypeOf(): never {
        throw new Error("proxy trap failed");
      },
    },
  );

  expect(serializeLogError(hostile)).toEqual({
    type: "SerializationError",
    message: "Error serialization failed; payload omitted",
    code: null,
    stack: "",
    truncated: true,
  });
});
