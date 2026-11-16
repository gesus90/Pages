import { describe, expect, it } from "vitest";

import {
  ProjectAccessDeniedError,
  ProjectDepartmentError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { WorkItemAccessDeniedError } from "@/backend/error/WorkItemErrors";
import {
  McpProjectError,
  toMcpProjectError,
} from "@/backend/service/mcp/project/McpProjectError";

describe("project API error translation", () => {
  it("maps policy, missing and validation errors to safe statuses", () => {
    for (const error of [
      new ProjectManagementDeniedError(),
      new WorkItemAccessDeniedError(),
      new ProjectDepartmentError("departmentOutOfScope"),
    ])
      expect(toMcpProjectError(error)).toMatchObject({
        code: "forbidden",
        status: 403,
      });
    for (const error of [
      new ProjectNotFoundError(),
      new ProjectAccessDeniedError(),
    ])
      expect(toMcpProjectError(error)).toMatchObject({
        code: "not_found",
        status: 404,
      });
    expect(
      toMcpProjectError(new ProjectDepartmentError("departmentRequired")),
    ).toMatchObject({ code: "invalid_request", status: 400 });
    expect(new McpProjectError("invalid_token").status).toBe(401);
  });

  it("keeps a known API error and leaves unexpected failures internal", () => {
    const known = new McpProjectError("forbidden");
    expect(toMcpProjectError(known)).toBe(known);
    expect(toMcpProjectError(new Error("secret"))).toBeNull();
  });
});
