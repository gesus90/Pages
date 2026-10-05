import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { TaskService } from "@/backend/service/TaskService";
import { MILESTONE_LINK_TYPE } from "@/definition/Task";

import { createUser } from "../helpers/factories";
import {
  WorkItemAccessDeniedError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { Milestone, MilestoneDependency } from "@/definition/Task";

const ACTOR = createUser();

function createMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    archivedAt: null,
    completedAt: null,
    createdAt: "2026-01-01",
    description: "First release",
    dueAt: "2026-09-30",
    id: "milestone-1",
    name: "MVP",
    projectId: "project-1",
    startAt: null,
    status: "open",
    updatedAt: "2026-01-02",
    ...overrides,
  };
}

function createDependency(
  overrides: Partial<MilestoneDependency> = {},
): MilestoneDependency {
  return {
    createdAt: "2026-01-01",
    id: "dependency-1",
    linkType: MILESTONE_LINK_TYPE.BLOCKS,
    projectId: "project-1",
    sourceId: "milestone-1",
    targetId: "milestone-2",
    ...overrides,
  };
}

/** Passes a deliberately unsupported value to an API with a narrower type. */
function unsupported<Expected>(value: unknown): Expected {
  return value as Expected;
}

interface Doubles {
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
  readonly projects: Record<string, ReturnType<typeof vi.fn>>;
  readonly service: TaskService;
}

function createDoubles(): Doubles {
  const repository = {
    archiveMilestone: vi.fn().mockResolvedValue(undefined),
    deleteDependenciesByMilestone: vi.fn().mockResolvedValue(undefined),
    deleteDependency: vi.fn().mockResolvedValue(undefined),
    findDependenciesByProjectIds: vi.fn().mockResolvedValue([]),
    findMilestoneById: vi.fn().mockResolvedValue(createMilestone()),
    findMilestonesByProjectIds: vi.fn().mockResolvedValue([]),
    insertDependency: vi.fn().mockResolvedValue(undefined),
    insertMilestone: vi.fn().mockResolvedValue(undefined),
    updateMilestone: vi.fn().mockResolvedValue(undefined),
  };
  const projects = {
    canWriteProject: vi.fn().mockResolvedValue(true),
    findAll: vi.fn().mockResolvedValue([{ id: "project-1" }]),
    getById: vi.fn().mockResolvedValue(undefined),
  };

  return {
    projects,
    repository,
    service: new TaskService(
      repository as unknown as TaskRepository,
      projects as unknown as ProjectService,
      new PermissionService(),
    ),
  };
}

type MilestoneFields = Record<string, unknown>;

/** Submits milestone values through the create and the update entry point. */
const SUBMISSIONS = {
  create: (service: TaskService, fields: MilestoneFields) =>
    service.createMilestone(ACTOR, {
      name: "MVP",
      projectId: "project-1",
      ...fields,
    }),
  update: (service: TaskService, fields: MilestoneFields) =>
    service.updateMilestone(ACTOR, "milestone-1", {
      description: "",
      dueAt: null,
      name: "MVP",
      status: "open",
      ...fields,
    }),
};

function persistedFields(
  doubles: Doubles,
  operation: keyof typeof SUBMISSIONS,
): Record<string, unknown> {
  const write =
    operation === "create"
      ? doubles.repository.insertMilestone
      : doubles.repository.updateMilestone;
  const calls = write.mock.calls as unknown[][];
  const written = calls[0]?.at(-1);

  return written as Record<string, unknown>;
}

describe.each(Object.entries(SUBMISSIONS))(
  "TaskService %s milestone validation",
  (operation, submit) => {
    let doubles: Doubles;
    const kind = operation as keyof typeof SUBMISSIONS;

    beforeEach(() => {
      doubles = createDoubles();
    });

    it.each([
      ["a blank name", { name: "   " }, "between 1 and 200 characters"],
      [
        "an overlong name",
        { name: "x".repeat(201) },
        "between 1 and 200 characters",
      ],
      [
        "a malformed start date",
        { startAt: "01.01.2026" },
        "start date must use the format",
      ],
      [
        "a malformed due date",
        { dueAt: "30.09.2026" },
        "due date must use the format",
      ],
      [
        "a start date after the due date",
        { dueAt: "2026-01-01", startAt: "2026-02-01" },
        "must not be after its due date",
      ],
      [
        "an unsupported color",
        { colorKey: unsupported("neon") },
        "supported color type",
      ],
      [
        "an unsupported icon",
        { iconKey: unsupported("skull") },
        "supported symbol",
      ],
      ["a malformed custom color", { colorCustom: "orange" }, "format #RRGGBB"],
    ])("rejects %s", async (_label, fields, message) => {
      await expect(submit(doubles.service, fields)).rejects.toThrow(message);
    });

    it("rejects an unsupported status when updating", async () => {
      if (kind === "create") {
        return;
      }

      await expect(
        submit(doubles.service, { status: unsupported("paused") }),
      ).rejects.toThrow("Unsupported milestone status.");
    });

    it("persists supported appearance values", async () => {
      await submit(doubles.service, {
        colorCustom: "#a1B2c3",
        colorKey: "release",
        iconKey: "rocket",
      });

      expect(persistedFields(doubles, kind)).toMatchObject({
        colorCustom: "#a1B2c3",
        colorKey: "release",
        iconKey: "rocket",
      });
    });

    it.each([[undefined], [null]])(
      "stores no appearance values for %p",
      async (value) => {
        await submit(doubles.service, {
          colorCustom: value,
          colorKey: value,
          iconKey: value,
        });

        expect(persistedFields(doubles, kind)).toMatchObject({
          colorCustom: null,
          colorKey: null,
          iconKey: null,
        });
      },
    );

    it.each<[string, { dueAt?: string; startAt?: string }]>([
      ["only a start date", { startAt: "2026-01-01" }],
      ["only a due date", { dueAt: "2026-09-30" }],
      [
        "a start date before the due date",
        { dueAt: "2026-09-30", startAt: "2026-01-01" },
      ],
      [
        "a start date equal to the due date",
        { dueAt: "2026-01-01", startAt: "2026-01-01" },
      ],
    ])("accepts %s", async (_label, fields) => {
      await submit(doubles.service, fields);

      expect(persistedFields(doubles, kind)).toMatchObject({
        dueAt: fields.dueAt ?? null,
        startAt: fields.startAt ?? null,
      });
    });

    it("denies users without write access to the project", async () => {
      doubles.projects.canWriteProject.mockResolvedValue(false);

      await expect(submit(doubles.service, {})).rejects.toBeInstanceOf(
        WorkItemAccessDeniedError,
      );
    });
  },
);

describe("TaskService milestone lifecycle", () => {
  let doubles: Doubles;

  beforeEach(() => {
    doubles = createDoubles();
  });

  it("reports a created milestone that cannot be read back", async () => {
    doubles.repository.findMilestoneById.mockResolvedValue(null);

    await expect(
      doubles.service.createMilestone(ACTOR, {
        name: "MVP",
        projectId: "project-1",
      }),
    ).rejects.toThrow("Created milestone could not be retrieved.");
  });

  it("reports an unknown milestone when updating", async () => {
    doubles.repository.findMilestoneById.mockResolvedValue(null);

    await expect(
      doubles.service.updateMilestone(ACTOR, "missing", {
        description: "",
        dueAt: null,
        name: "MVP",
        status: "open",
      }),
    ).rejects.toBeInstanceOf(WorkItemValidationError);
    expect(doubles.repository.updateMilestone).not.toHaveBeenCalled();
  });

  it("reports an updated milestone that cannot be read back", async () => {
    doubles.repository.findMilestoneById
      .mockResolvedValueOnce(createMilestone())
      .mockResolvedValueOnce(null);

    await expect(
      doubles.service.updateMilestone(ACTOR, "milestone-1", {
        description: "",
        dueAt: null,
        name: "MVP",
        status: "open",
      }),
    ).rejects.toThrow("Updated milestone could not be retrieved.");
  });

  it("deletes a milestone together with its dependencies", async () => {
    await doubles.service.deleteMilestone(ACTOR, "milestone-1");

    expect(
      doubles.repository.deleteDependenciesByMilestone,
    ).toHaveBeenCalledWith("milestone-1");
    expect(doubles.repository.archiveMilestone).toHaveBeenCalledWith(
      "milestone-1",
    );
  });

  it("reports an unknown milestone when deleting", async () => {
    doubles.repository.findMilestoneById.mockResolvedValue(null);

    await expect(
      doubles.service.deleteMilestone(ACTOR, "missing"),
    ).rejects.toBeInstanceOf(WorkItemValidationError);
    expect(doubles.repository.archiveMilestone).not.toHaveBeenCalled();
  });

  it("denies deleting milestones without write access", async () => {
    doubles.projects.canWriteProject.mockResolvedValue(false);

    await expect(
      doubles.service.deleteMilestone(ACTOR, "milestone-1"),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
    expect(doubles.repository.archiveMilestone).not.toHaveBeenCalled();
  });
});

describe("TaskService milestone dependencies", () => {
  let doubles: Doubles;
  const input = {
    linkType: MILESTONE_LINK_TYPE.BLOCKS,
    projectId: "project-1",
    sourceId: "milestone-1",
    targetId: "milestone-2",
  };

  beforeEach(() => {
    doubles = createDoubles();
    doubles.repository.findMilestonesByProjectIds.mockResolvedValue([
      createMilestone({ id: "milestone-1" }),
      createMilestone({ id: "milestone-2" }),
    ]);
  });

  it("only returns dependencies of accessible projects", async () => {
    doubles.repository.findDependenciesByProjectIds.mockResolvedValue([
      createDependency(),
    ]);

    await expect(
      doubles.service.findDependencies(ACTOR, ["project-1", "foreign"]),
    ).resolves.toEqual([createDependency()]);
    expect(
      doubles.repository.findDependenciesByProjectIds,
    ).toHaveBeenCalledWith(["project-1"]);
  });

  it("links two milestones of one project", async () => {
    doubles.repository.findDependenciesByProjectIds
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async () => {
        const [[created]] = doubles.repository.insertDependency.mock.calls as [
          [{ id: string }],
        ];

        return [createDependency({ id: created.id })];
      });

    const created = await doubles.service.addDependency(ACTOR, input);

    expect(doubles.repository.insertDependency).toHaveBeenCalledWith(
      expect.objectContaining({
        linkType: "blocks",
        projectId: "project-1",
        sourceId: "milestone-1",
        targetId: "milestone-2",
      }),
    );
    expect(created.sourceId).toBe("milestone-1");
  });

  it("reports a created dependency that cannot be read back", async () => {
    await expect(doubles.service.addDependency(ACTOR, input)).rejects.toThrow(
      "Created dependency could not be retrieved.",
    );
  });

  it("denies linking without write access", async () => {
    doubles.projects.canWriteProject.mockResolvedValue(false);

    await expect(
      doubles.service.addDependency(ACTOR, input),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
  });

  it("rejects an unsupported link type", async () => {
    await expect(
      doubles.service.addDependency(ACTOR, {
        ...input,
        linkType: unsupported("depends_on"),
      }),
    ).rejects.toThrow("Unsupported dependency type.");
  });

  it("rejects a milestone that depends on itself", async () => {
    await expect(
      doubles.service.addDependency(ACTOR, {
        ...input,
        targetId: "milestone-1",
      }),
    ).rejects.toThrow("cannot depend on itself");
  });

  it.each([
    ["source", { sourceId: "other" }],
    ["target", { targetId: "other" }],
  ])("rejects an unknown %s milestone", async (_label, override) => {
    await expect(
      doubles.service.addDependency(ACTOR, { ...input, ...override }),
    ).rejects.toThrow("two milestones of the same project");
  });

  it.each([
    ["in the same direction", createDependency()],
    [
      "in the opposite direction",
      createDependency({ sourceId: "milestone-2", targetId: "milestone-1" }),
    ],
  ])("rejects milestones that are already linked %s", async (_label, link) => {
    doubles.repository.findDependenciesByProjectIds.mockResolvedValue([link]);

    await expect(doubles.service.addDependency(ACTOR, input)).rejects.toThrow(
      "already linked",
    );
    expect(doubles.repository.insertDependency).not.toHaveBeenCalled();
  });

  it("allows milestones that only share one end with another link", async () => {
    doubles.repository.findDependenciesByProjectIds.mockResolvedValue([
      createDependency({ sourceId: "milestone-1", targetId: "milestone-3" }),
      createDependency({ sourceId: "milestone-4", targetId: "milestone-2" }),
      createDependency({ sourceId: "milestone-3", targetId: "milestone-1" }),
      createDependency({ sourceId: "milestone-2", targetId: "milestone-4" }),
    ]);

    await expect(doubles.service.addDependency(ACTOR, input)).rejects.toThrow(
      "Created dependency could not be retrieved.",
    );
    expect(doubles.repository.insertDependency).toHaveBeenCalledTimes(1);
  });

  it("removes an existing dependency", async () => {
    doubles.repository.findDependenciesByProjectIds.mockResolvedValue([
      createDependency(),
    ]);

    await doubles.service.removeDependency(ACTOR, "project-1", "dependency-1");

    expect(doubles.repository.deleteDependency).toHaveBeenCalledWith(
      "dependency-1",
    );
  });

  it("reports an unknown dependency", async () => {
    await expect(
      doubles.service.removeDependency(ACTOR, "project-1", "missing"),
    ).rejects.toBeInstanceOf(WorkItemValidationError);
    expect(doubles.repository.deleteDependency).not.toHaveBeenCalled();
  });

  it("denies removing dependencies without write access", async () => {
    doubles.projects.canWriteProject.mockResolvedValue(false);

    await expect(
      doubles.service.removeDependency(ACTOR, "project-1", "dependency-1"),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
  });
});
