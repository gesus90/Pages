import { beforeEach, expect, it, vi } from "vitest";

import { handleProjectScopeAction } from "@/app/lib/project-actions/project-scope-actions.server";
import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  ACTOR,
  formOf,
  outcomeOf,
  servicesOf,
} from "../../actions/action-fixtures";

import type { ProjectScopeActionContext } from "@/app/lib/project-actions/project-scope-actions.server";
import type { FormFields } from "../../actions/action-fixtures";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const PROJECT_ID = "project/1";

const projectService = {
  archive: vi.fn(),
  deletePermanently: vi.fn(),
  getById: vi.fn(),
  setDepartments: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

function scopeContext(fields: FormFields = {}): ProjectScopeActionContext {
  return {
    actor: ACTOR,
    formData: formOf(fields),
    projectId: PROJECT_ID,
    services: servicesOf({ projectService }),
  };
}

it("archives the project and opens the archive list", async () => {
  const result = await handleProjectScopeAction(
    "archive-project",
    scopeContext(),
  );

  expect(projectService.archive).toHaveBeenCalledWith(ACTOR, PROJECT_ID);
  expect(await outcomeOf(result)).toMatchObject({
    location: "/projekte?archiv=1",
    status: 302,
  });
});

it("deletes the project and opens the project list", async () => {
  const result = await handleProjectScopeAction(
    "delete-project",
    scopeContext(),
  );

  expect(projectService.deletePermanently).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
  );
  expect(await outcomeOf(result)).toMatchObject({
    location: "/projekte",
    status: 302,
  });
});

it.each([null, "update-name"])(
  "leaves the intent %j to other handlers",
  async (intent) => {
    expect(
      await handleProjectScopeAction(intent, scopeContext()),
    ).toBeUndefined();
    expect(projectService.setDepartments).not.toHaveBeenCalled();
  },
);

it("refuses departments submitted as files", async () => {
  const result = await handleProjectScopeAction(
    "set-departments",
    scopeContext({ departmentIds: new File(["dep-1"], "dep.txt") }),
  );

  expect(await outcomeOf(result)).toMatchObject({
    body: { error: "invalidInput", ok: false },
    status: 400,
  });
  expect(projectService.setDepartments).not.toHaveBeenCalled();
});

it("stores the departments and returns to the still visible project", async () => {
  const result = await handleProjectScopeAction(
    "set-departments",
    scopeContext({ departmentIds: ["dep-1", "dep-2"] }),
  );

  expect(projectService.setDepartments).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
    ["dep-1", "dep-2"],
  );
  expect(projectService.getById).toHaveBeenCalledWith(ACTOR, PROJECT_ID);
  expect(await outcomeOf(result)).toMatchObject({
    location: "/projekte/project%2F1",
    status: 302,
  });
});

it("opens the project list when the new departments hide the project", async () => {
  const denied = new ProjectAccessDeniedError();
  projectService.getById.mockRejectedValue(denied);

  const result = await handleProjectScopeAction(
    "set-departments",
    scopeContext({ departmentIds: [] }),
  );

  expect(projectService.setDepartments).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
    [],
  );
  expect(logCaughtError).toHaveBeenCalledWith("project_scope_actions", denied);
  expect(await outcomeOf(result)).toMatchObject({
    location: "/projekte",
    status: 302,
  });
});

it("rethrows other failures of the visibility check", async () => {
  const missing = new ProjectNotFoundError();
  projectService.getById.mockRejectedValue(missing);

  await expect(
    handleProjectScopeAction(
      "set-departments",
      scopeContext({ departmentIds: ["dep-1"] }),
    ),
  ).rejects.toBe(missing);
  expect(logCaughtError).toHaveBeenCalledWith("project_scope_actions", missing);
});
