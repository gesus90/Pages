import { describe, expect, it } from "vitest";

import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import {
  WORK_ITEM_ERROR_MESSAGES,
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import { gitHubJobErrorCode, restoreGitHubJobError } from "./GitHubJobErrors";

import type { WorkItemErrorCode } from "@/backend/error/WorkItemErrors";

const validationCode = Object.keys(
  WORK_ITEM_ERROR_MESSAGES,
)[0] as WorkItemErrorCode;

describe("gitHubJobErrorCode", () => {
  it("returns the code of a validation error", () => {
    expect(
      gitHubJobErrorCode(new WorkItemValidationError(validationCode)),
    ).toBe(validationCode);
  });

  it.each([
    [new ProjectAccessDeniedError(), "project_access"],
    [new ProjectManagementDeniedError(), "project_management"],
    [new ProjectNotFoundError(), "project_missing"],
    [new WorkItemAccessDeniedError(), "task_access"],
    [new WorkItemNotFoundError(), "task_missing"],
  ])("maps known domain errors", (error, code) => {
    expect(gitHubJobErrorCode(error)).toBe(code);
  });

  it("returns null for unknown errors", () => {
    expect(gitHubJobErrorCode(new Error("secret"))).toBeNull();
  });
});

describe("restoreGitHubJobError", () => {
  it("restores validation errors from work item codes", () => {
    const error = restoreGitHubJobError(validationCode);
    expect(error).toBeInstanceOf(WorkItemValidationError);
  });

  it.each([
    ["project_access", ProjectAccessDeniedError],
    ["project_management", ProjectManagementDeniedError],
    ["project_missing", ProjectNotFoundError],
    ["task_access", WorkItemAccessDeniedError],
    ["task_missing", WorkItemNotFoundError],
  ])("restores %s", (code, ErrorClass) => {
    expect(restoreGitHubJobError(code)).toBeInstanceOf(ErrorClass);
  });

  it("explains an uncertain outcome", () => {
    expect(
      restoreGitHubJobError("integration_outcome_uncertain").message,
    ).toContain("reconciliation");
  });

  it("falls back to a generic failure", () => {
    expect(restoreGitHubJobError("other").message).toContain("failed");
  });
});
