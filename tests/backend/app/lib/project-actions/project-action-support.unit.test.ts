import { beforeEach, expect, it, vi } from "vitest";

import {
  invalidInput,
  succeeded,
  toActionError,
  updateProjectDetails,
} from "@/app/lib/project-actions/project-action-support.server";
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

import { ACTOR, outcomeOf } from "../../actions/action-fixtures";
import { PROJECT_ID, projectContext } from "./project-action-fixtures";

const STORED_DETAILS = {
  description: "Stored description",
  managerId: "manager-1",
  name: "Stored name",
  notes: "Stored notes",
  progress: 40,
  startDate: "2026-01-01",
  status: "active",
  targetDate: "2026-12-31",
};

const services = {
  projectService: { getById: vi.fn(), updateDetails: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
});

it("answers a successful action with ok", async () => {
  expect(await outcomeOf(succeeded())).toMatchObject({
    body: { ok: true },
    status: 200,
  });
});

it("answers malformed input with 400 invalidInput", async () => {
  expect(await outcomeOf(invalidInput())).toMatchObject({
    body: { error: "invalidInput", ok: false },
    status: 400,
  });
});

it.each([
  [
    new ProjectDepartmentError("departmentOutOfScope"),
    403,
    "departmentOutOfScope",
  ],
  [new ProjectDepartmentError("departmentRequired"), 400, "departmentRequired"],
  [new ProjectDepartmentError("invalidDepartment"), 400, "invalidDepartment"],
  [new ProjectManagementDeniedError(), 403, "forbidden"],
  [new ProjectAccessDeniedError(), 403, "forbidden"],
  [new WorkItemAccessDeniedError(), 403, "forbidden"],
  [new ProjectNotFoundError(), 404, "invalidInput"],
  [new WorkItemValidationError("milestoneNotFound"), 400, "invalidInput"],
  [new Error("unexpected"), 400, "invalidInput"],
])("maps %o to status %i with %s", async (error, status, code) => {
  expect(await outcomeOf(toActionError(error))).toMatchObject({
    body: { error: code, ok: false },
    status,
  });
});

it("rethrows a failure that is no Error", () => {
  expect(() => toActionError("broken")).toThrow("broken");
});

it("keeps the stored details and replaces only the changed values", async () => {
  services.projectService.getById.mockResolvedValue({
    ...STORED_DETAILS,
    id: PROJECT_ID,
  });

  await updateProjectDetails(projectContext(services), { name: "New name" });

  expect(services.projectService.getById).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
  );
  expect(services.projectService.updateDetails).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
    { ...STORED_DETAILS, name: "New name" },
  );
});
