import { describe, expect, it } from "vitest";

import {
  requireManagementPlanAccess,
  requireManagementScriptExecution,
} from "./ManagementPlanAccess";

describe("requireManagementPlanAccess", () => {
  it("ignores callers outside management", () => {
    expect(() =>
      requireManagementPlanAccess(false, { access: "yolo" }, {}),
    ).not.toThrow();
  });

  it("refuses new yolo selections", () => {
    expect(() =>
      requireManagementPlanAccess(true, { access: "yolo" }, {}),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("allows existing selections, also with reordered identified nodes", () => {
    const previous = {
      steps: [
        { id: "a", access: "yolo" },
        { id: "b", access: "read" },
      ],
      note: null,
      count: 3,
    };
    const proposed = {
      steps: [
        { id: "b", access: "read" },
        { id: "a", access: "yolo" },
      ],
    };
    expect(() =>
      requireManagementPlanAccess(true, proposed, previous),
    ).not.toThrow();
  });

  it("ignores non-object input", () => {
    expect(() => requireManagementPlanAccess(true, "yolo", 5)).not.toThrow();
  });
});

describe("requireManagementScriptExecution", () => {
  it("ignores callers outside management", () => {
    expect(() =>
      requireManagementScriptExecution(false, { type: "script" }),
    ).not.toThrow();
  });

  it("refuses nested enabled scripts", () => {
    expect(() =>
      requireManagementScriptExecution(true, {
        steps: [{ type: "script" }],
      }),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("allows disabled scripts, other types and primitives", () => {
    expect(() =>
      requireManagementScriptExecution(true, [
        { type: "script", disabled: true },
        { type: "agent", disabled: false },
        { name: "x" },
        null,
        "text",
      ]),
    ).not.toThrow();
  });

  it("ignores a primitive input", () => {
    expect(() =>
      requireManagementScriptExecution(true, "script"),
    ).not.toThrow();
  });

  it("refuses a script whose disabled flag is not true", () => {
    expect(() =>
      requireManagementScriptExecution(true, {
        type: "script",
        disabled: "yes",
      }),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});
