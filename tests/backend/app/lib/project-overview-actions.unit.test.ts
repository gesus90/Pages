import { randomUUID } from "node:crypto";

import { beforeEach, expect, it, vi } from "vitest";

import { handleProjectOverviewAction } from "@/app/lib/project-overview-actions.server";
import {
  ProjectAccessDeniedError,
  ProjectDepartmentError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  ACTOR,
  formOf,
  outcomeOf,
  servicesOf,
} from "../actions/action-fixtures";

import type { ProjectOverviewActionContext } from "@/app/lib/project-overview-actions.server";
import type * as NodeCrypto from "node:crypto";
import type { FormFields } from "../actions/action-fixtures";

vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof NodeCrypto>()),
  randomUUID: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

// The character codes of this id sum to 1728, so it selects the fourth color.
const PROJECT_ID = "00000000-0000-4000-8000-000000000000";
const VALID_FIELDS = {
  departmentIds: ["dep-1", "dep-2"],
  description: "  A wiki for the team  ",
  name: "  Pages  ",
  status: "planned",
};

const projectService = { create: vi.fn(), createFromTemplate: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(randomUUID).mockReturnValue(PROJECT_ID);
  projectService.create.mockResolvedValue(true);
  projectService.createFromTemplate.mockResolvedValue(true);
});

function overviewContext(fields: FormFields): ProjectOverviewActionContext {
  return {
    actor: ACTOR,
    formData: formOf(fields),
    services: servicesOf({ projectService }),
  };
}

async function create(fields: FormFields): Promise<unknown> {
  const outcome = await outcomeOf(
    await handleProjectOverviewAction(
      "create-project",
      overviewContext(fields),
    ),
  );

  return { body: outcome.body, status: outcome.status };
}

function failure(error: string, status: number): unknown {
  return { body: { error, intent: "create-project", ok: false }, status };
}

it.each([null, "delete-project"])(
  "refuses the overview intent %j",
  async (intent) => {
    const outcome = await outcomeOf(
      await handleProjectOverviewAction(intent, overviewContext(VALID_FIELDS)),
    );

    expect({ body: outcome.body, status: outcome.status }).toEqual(
      failure("invalidInput", 400),
    );
    expect(projectService.create).not.toHaveBeenCalled();
  },
);

it("creates a project from the trimmed form values", async () => {
  expect(await create(VALID_FIELDS)).toEqual({
    body: { intent: "create-project", ok: true, projectId: PROJECT_ID },
    status: 200,
  });
  expect(projectService.create).toHaveBeenCalledWith(ACTOR, {
    departmentIds: ["dep-1", "dep-2"],
    description: "A wiki for the team",
    id: PROJECT_ID,
    name: "Pages",
    ownerId: ACTOR.id,
    placeholderColor: "#EEE4F8",
    status: "planned",
  });
});

it("tells the client when the creator cannot open the new project", async () => {
  projectService.create.mockResolvedValue(false);

  expect(await create(VALID_FIELDS)).toEqual({
    body: {
      canOpen: false,
      intent: "create-project",
      ok: true,
      projectId: PROJECT_ID,
    },
    status: 200,
  });
});

it("creates a project from the selected template", async () => {
  const fields = { ...VALID_FIELDS, templateId: "template-1" };

  expect(await create(fields)).toMatchObject({ status: 200 });
  expect(projectService.createFromTemplate).toHaveBeenCalledWith(
    ACTOR,
    "template-1",
    expect.objectContaining({ id: PROJECT_ID, name: "Pages" }),
  );
  expect(projectService.create).not.toHaveBeenCalled();
});

it("creates a plain project for an empty template choice", async () => {
  expect(await create({ ...VALID_FIELDS, templateId: "" })).toMatchObject({
    status: 200,
  });
  expect(projectService.create).toHaveBeenCalledOnce();
  expect(projectService.createFromTemplate).not.toHaveBeenCalled();
});

it.each([
  ["00000000-0000-4000-8000-000000000001", "#E9EDF2"],
  ["00000000-0000-4000-8000-000000000002", "#FCE3D3"],
  ["00000000-0000-4000-8000-000000000003", "#DFEAFE"],
  ["00000000-0000-4000-8000-000000000004", "#DCF2E5"],
] as const)("derives the placeholder color of the id %s", async (id, color) => {
  vi.mocked(randomUUID).mockReturnValue(id);

  await create(VALID_FIELDS);

  expect(projectService.create).toHaveBeenCalledWith(
    ACTOR,
    expect.objectContaining({ id, placeholderColor: color }),
  );
});

const FILE = new File(["x"], "x.txt");

it.each<[string, FormFields]>([
  ["no name", { ...VALID_FIELDS, name: [] }],
  ["no description", { ...VALID_FIELDS, description: [] }],
  ["an unknown status", { ...VALID_FIELDS, status: "deleted" }],
  ["a template sent as file", { ...VALID_FIELDS, templateId: FILE }],
  ["a department sent as file", { ...VALID_FIELDS, departmentIds: FILE }],
  ["a blank name", { ...VALID_FIELDS, name: "   " }],
  ["a name over 200 characters", { ...VALID_FIELDS, name: "n".repeat(201) }],
  [
    "a description over 10000 characters",
    { ...VALID_FIELDS, description: "d".repeat(10_001) },
  ],
])("refuses a project with %s", async (situation, fields) => {
  expect(await create(fields)).toEqual(failure("invalidInput", 400));
  expect(projectService.create).not.toHaveBeenCalled();
});

it("accepts a name and description of the maximum length", async () => {
  const fields = {
    ...VALID_FIELDS,
    description: "d".repeat(10_000),
    name: "n".repeat(200),
  };

  expect(await create(fields)).toMatchObject({ status: 200 });
});

it.each<[string, Error, string, number]>([
  [
    "an out-of-scope department",
    new ProjectDepartmentError("departmentOutOfScope"),
    "departmentOutOfScope",
    403,
  ],
  [
    "a missing department",
    new ProjectDepartmentError("departmentRequired"),
    "departmentRequired",
    400,
  ],
  ["a denied management", new ProjectManagementDeniedError(), "forbidden", 403],
  ["a denied access", new ProjectAccessDeniedError(), "forbidden", 403],
  [
    "a missing template project",
    new ProjectNotFoundError(),
    "projectNotFound",
    404,
  ],
])("answers %s", async (situation, error, code, status) => {
  projectService.create.mockRejectedValue(error);

  expect(await create(VALID_FIELDS)).toEqual(failure(code, status));
  expect(logCaughtError).toHaveBeenCalledWith(
    "project_overview_actions",
    error,
  );
});

it("rethrows an unexpected creation failure", async () => {
  const unexpected = new Error("database unavailable");
  projectService.createFromTemplate.mockRejectedValue(unexpected);

  await expect(
    create({ ...VALID_FIELDS, templateId: "template-1" }),
  ).rejects.toBe(unexpected);
  expect(logCaughtError).toHaveBeenCalledWith(
    "project_overview_actions",
    unexpected,
  );
});
