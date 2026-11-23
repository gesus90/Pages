import { describe, expect, it } from "vitest";

import { describeError } from "./ErrorDescription";

describe("describeError", () => {
  it("reports the type of non-error values without exposing their contents", () => {
    expect(describeError("private text")).toBe("string");
    expect(describeError(null)).toBe("object");
  });

  it("redacts quoted values and omits subsequent lines", () => {
    const error = new Error(
      "Failed 'secret' and \"token\" and `query`\nprivate",
    );
    expect(describeError(error)).toBe("Error | Failed … and … and …");
  });

  it("includes a code once and includes paths only for system errors", () => {
    const error = Object.assign(new Error("ENOENT"), {
      code: "ENOENT",
      path: "/safe/path",
      syscall: "open",
    });
    expect(describeError(error)).toBe("Error | ENOENT | /safe/path");
    expect(
      describeError(
        Object.assign(new Error("bad"), { code: 42, path: "/hidden" }),
      ),
    ).toBe("Error | 42 | bad");
  });

  it("limits the first line to 160 characters", () => {
    expect(describeError(new Error("x".repeat(200)))).toBe(
      `Error | ${"x".repeat(160)}`,
    );
  });
});
