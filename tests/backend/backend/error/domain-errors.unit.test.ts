import { describe, expect, it } from "vitest";

import {
  AdministrationError,
  AgentScopeInUseError,
} from "@/backend/error/AdministrationError";
import {
  ProjectAccessDeniedError,
  ProjectDepartmentError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
  ProjectRunsActiveError,
} from "@/backend/error/ProjectErrors";
import {
  EmailTakenError,
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UserNotFoundError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";
import {
  WORK_ITEM_ERROR_MESSAGES,
  WorkItemAccessDeniedError,
  WorkItemConflictError,
  WorkItemHierarchyError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

describe("administration errors", () => {
  it("carries a stable code that is also the message", () => {
    const error = new AdministrationError("lastAdministrator");

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("lastAdministrator");
    expect(error.message).toBe("lastAdministrator");
  });

  it("names the agents that block a deletion without changing the code", () => {
    const error = new AgentScopeInUseError(["Reviewer", "Planner"]);

    expect(error).toBeInstanceOf(AdministrationError);
    expect(error.code).toBe("agentInUse");
    expect(error.agents).toEqual(["Reviewer", "Planner"]);
  });
});

describe("user errors", () => {
  it("name the conflicting value without leaking more", () => {
    expect(new UsernameTakenError("anna").message).toBe(
      'The username "anna" is already taken.',
    );
    expect(new EmailTakenError("a@example.com").message).toBe(
      'The email address "a@example.com" is already taken.',
    );
  });

  it.each([
    [new UserManagementDeniedError(), /not allowed to manage users/u],
    [
      new RoleAssignmentDeniedError(),
      /not allowed to assign the requested role/u,
    ],
    [new UserNotFoundError(), /does not exist/u],
    [new LastAdministratorError(), /last active administrator/u],
  ])("explains %s", (error, message) => {
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(message);
  });
});

describe("project errors", () => {
  it("distinguish missing, forbidden and unmanageable projects", () => {
    expect(new ProjectNotFoundError().message).toMatch(/does not exist/u);
    expect(new ProjectAccessDeniedError().message).toMatch(/access/u);
    expect(new ProjectManagementDeniedError().message).toMatch(/manage/u);
    expect(new ProjectRunsActiveError().message).toMatch(/still active/u);
  });

  it("keeps the department failure as a code", () => {
    const error = new ProjectDepartmentError("departmentOutOfScope");

    expect(error.code).toBe("departmentOutOfScope");
    expect(error.message).toBe("departmentOutOfScope");
  });
});

describe("work item errors", () => {
  it("maps a hierarchy or validation code to its logged message", () => {
    const hierarchy = new WorkItemHierarchyError("taskSelfParent");
    const validation = new WorkItemValidationError("titleLength");

    expect(hierarchy.code).toBe("taskSelfParent");
    expect(hierarchy.message).toBe(WORK_ITEM_ERROR_MESSAGES.taskSelfParent);
    expect(validation.code).toBe("titleLength");
    expect(validation.message).toBe(
      "Title must be between 1 and 200 characters.",
    );
  });

  it("has a non-empty message for every code", () => {
    for (const [code, message] of Object.entries(WORK_ITEM_ERROR_MESSAGES)) {
      expect(message, code).not.toBe("");
    }
  });

  it("names the conflicting field", () => {
    const error = new WorkItemConflictError("dueAt");

    expect(error.field).toBe("dueAt");
    expect(error.message).toBe(
      "The dueAt was changed by someone else since it was read.",
    );
  });

  it("reports missing and forbidden work items without detail", () => {
    expect(new WorkItemNotFoundError().message).toMatch(/does not exist/u);
    expect(new WorkItemAccessDeniedError().message).toMatch(/not allowed/u);
  });
});
