import { afterEach, expect, it, vi } from "vitest";

import { loggingFailureCode, writeLogFallback } from "./LogFallback";
import type * as NodeFs from "node:fs";

const stderr = vi.hoisted(() => ({ writeSync: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return { ...actual, writeSync: stderr.writeSync };
});

afterEach(() => {
  stderr.writeSync.mockReset();
});

it("writes an already sanitized line to stderr", () => {
  writeLogFallback('{"event":"x"}\n');

  expect(stderr.writeSync).toHaveBeenCalledWith(2, '{"event":"x"}\n');
});

it("does not throw when stderr itself is unavailable", () => {
  stderr.writeSync.mockImplementationOnce(() => {
    throw Object.assign(new Error("broken pipe"), { code: "EPIPE" });
  });

  expect(() => {
    writeLogFallback("line\n");
  }).not.toThrow();
});

it("reports only an operating-system style error code", () => {
  const failure = Object.assign(new Error("/secret/path with payload"), {
    code: "EACCES",
  });

  expect(loggingFailureCode(failure)).toBe("EACCES");
});

it.each([
  ["a lower-case code", Object.assign(new Error("x"), { code: "enoent" })],
  ["a numeric code", Object.assign(new Error("x"), { code: 13 })],
  ["an error without code", new Error("x")],
  ["a thrown string", "EACCES"],
  ["null", null],
])("maps %s to the generic I/O code", (description, failure: unknown) => {
  expect(loggingFailureCode(failure)).toBe("LOG_IO_ERROR");
});

it("maps a hostile error whose code getter throws to the generic I/O code", () => {
  const hostile = {
    get code(): string {
      throw new Error("getter failed");
    },
  };

  expect(loggingFailureCode(hostile)).toBe("LOG_IO_ERROR");
});
