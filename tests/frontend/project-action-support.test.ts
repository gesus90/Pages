import { describe, expect, it } from "vitest";

import { toActionError } from "@/app/lib/project-actions/project-action-support.server";
import {
  ProjectAccessDeniedError,
  ProjectDepartmentError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

function describeResponse(error: unknown): {
  body: unknown;
  status: number | undefined;
} {
  const response = toActionError(error) as unknown as {
    data: unknown;
    init?: { status?: number };
  };

  return { body: response.data, status: response.init?.status };
}

describe("toActionError", () => {
  it.each([
    "departmentRequired",
    "invalidDepartment",
    "departmentOutOfScope",
  ] as const)("preserves the department error %s", (code) => {
    expect(describeResponse(new ProjectDepartmentError(code))).toEqual({
      body: { ok: false, error: code },
      status: code === "departmentOutOfScope" ? 403 : 400,
    });
  });
  it.each([
    ["a management denial", new ProjectManagementDeniedError()],
    ["an access denial", new ProjectAccessDeniedError()],
    ["a ticket access denial", new WorkItemAccessDeniedError()],
  ])("answers %s with 403", (_label, error) => {
    expect(describeResponse(error)).toEqual({
      body: { error: "forbidden", ok: false },
      status: 403,
    });
  });

  it("answers a missing project with 404", () => {
    expect(describeResponse(new ProjectNotFoundError())).toEqual({
      body: { error: "invalidInput", ok: false },
      status: 404,
    });
  });

  it.each([
    ["a validation failure", new WorkItemValidationError("too long")],
    ["any other error", new Error("Rejected")],
  ])("answers %s with 400", (_label, error) => {
    expect(describeResponse(error)).toEqual({
      body: { error: "invalidInput", ok: false },
      status: 400,
    });
  });

  it("rethrows values that are no errors", () => {
    expect(() => toActionError("broken")).toThrow("broken");
  });
});
