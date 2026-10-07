import { describe, expect, it, vi } from "vitest";

import { handleProjectAction } from "@/app/lib/project-actions/project-actions.server";

import { createUser } from "../helpers/factories";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type { ProjectActionContext } from "@/app/lib/project-actions/project-action-support.server";
import type { Project } from "@/definition/Project";
import type { Milestone, MilestoneDependency } from "@/definition/Task";

const ACTOR = createUser();

const PROJECT: Project = {
  createdAt: "2026-01-01",
  description: "Stored description",
  departments: [],
  hasIcon: false,
  id: "project-1",
  managerId: "user-9",
  managerName: "Manager",
  name: "Pages",
  notes: "Stored notes",
  parentId: null,
  placeholderColor: "#FCE3D3",
  progress: 40,
  startDate: "2026-01-01",
  status: "active",
  targetDate: "2026-12-31",
  updatedAt: "2026-01-02",
};

const MILESTONE: Milestone = {
  archivedAt: null,
  colorCustom: "#112233",
  colorKey: "release",
  completedAt: null,
  createdAt: "2026-01-01",
  description: "Stored milestone",
  dueAt: "2026-09-30",
  iconKey: "rocket",
  id: "milestone-1",
  name: "MVP",
  projectId: "project-1",
  startAt: "2026-01-01",
  status: "open",
  updatedAt: "2026-01-02",
};

function createLink(
  overrides: Partial<MilestoneDependency>,
): MilestoneDependency {
  return {
    createdAt: "2026-01-01",
    id: "link-1",
    linkType: "blocks",
    projectId: "project-1",
    sourceId: "milestone-1",
    targetId: "milestone-2",
    ...overrides,
  };
}

function createServices() {
  return {
    gitHubSyncService: {
      syncProjectNow: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockResolvedValue(true),
    },
    projectService: {
      addMember: vi.fn(),
      archiveEvent: vi.fn(),
      createEvent: vi.fn(),
      createGoal: vi.fn(),
      deleteGoal: vi.fn(),
      disconnectIntegration: vi.fn(),
      setIntegrationSyncEnabled: vi.fn().mockResolvedValue({}),
      findGoals: vi
        .fn()
        .mockResolvedValue([{ id: "goal-1", isDone: false, title: "Release" }]),
      getById: vi.fn().mockResolvedValue(PROJECT),
      removeMember: vi.fn(),
      saveIntegration: vi.fn(),
      saveTemplate: vi.fn(),
      setTags: vi.fn(),
      updateDetails: vi.fn(),
      updateGoal: vi.fn(),
      updateMemberRole: vi.fn(),
    },
    taskService: {
      addDependency: vi.fn(),
      createMilestone: vi.fn(),
      deleteMilestone: vi.fn(),
      findDependencies: vi.fn().mockResolvedValue([]),
      findMilestones: vi.fn().mockResolvedValue([MILESTONE]),
      removeDependency: vi.fn(),
      updateMilestone: vi.fn(),
    },
  };
}

type Services = ReturnType<typeof createServices>;

interface Outcome {
  readonly body: unknown;
  readonly status: number | undefined;
}

async function run(
  intent: string | null,
  fields: Record<string, string> = {},
  services: Services = createServices(),
): Promise<Outcome> {
  const formData = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }

  const response = (await handleProjectAction(intent, {
    actor: ACTOR,
    formData,
    projectId: "project-1",
    services: services as unknown as ProjectActionContext["services"],
  })) as unknown as { data: unknown; init?: { status?: number } };

  return { body: response.data, status: response.init?.status };
}

const OK = { body: { ok: true }, status: undefined };
const INVALID = {
  body: { error: "invalidInput", ok: false },
  status: 400,
};

describe("handleProjectAction", () => {
  describe("dispatching", () => {
    it.each([[null], ["unknown"], ["constructor"], ["toString"]])(
      "treats the intent %p as invalid input",
      async (intent) => {
        await expect(run(intent)).resolves.toEqual(INVALID);
      },
    );
  });

  it("saves the current project template", async () => {
    const services = createServices();
    await expect(run("save-template", {}, services)).resolves.toEqual(OK);
    expect(services.projectService.saveTemplate).toHaveBeenCalledWith(
      ACTOR,
      "project-1",
    );
  });

  describe("project details", () => {
    it("rejects an unknown status when saving all details", async () => {
      const services = createServices();

      await expect(
        run("update-details", { status: "dormant" }, services),
      ).resolves.toEqual(INVALID);
      expect(services.projectService.updateDetails).not.toHaveBeenCalled();
    });

    it("saves all details and keeps the stored progress", async () => {
      const services = createServices();

      await expect(
        run(
          "update-details",
          {
            description: "New description",
            managerId: " user-2 ",
            name: "Renamed",
            notes: "New notes",
            startDate: " 2026-02-01 ",
            status: "paused",
            targetDate: "",
          },
          services,
        ),
      ).resolves.toEqual(OK);
      expect(services.projectService.updateDetails).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        {
          description: "New description",
          managerId: "user-2",
          name: "Renamed",
          notes: "New notes",
          progress: 40,
          startDate: "2026-02-01",
          status: "paused",
          targetDate: null,
        },
      );
    });

    it.each([
      ["update-status", { status: "completed" }, { status: "completed" }],
      [
        "update-description",
        { description: "Short" },
        { description: "Short" },
      ],
      ["update-manager", { managerId: "user-3" }, { managerId: "user-3" }],
      ["update-manager", { managerId: "  " }, { managerId: null }],
      [
        "update-dates",
        { startDate: "2026-03-01", targetDate: "" },
        { startDate: "2026-03-01", targetDate: null },
      ],
      ["update-name", { name: "Renamed" }, { name: "Renamed" }],
    ])("changes only what %s submits", async (intent, fields, changes) => {
      const services = createServices();

      await expect(run(intent, fields, services)).resolves.toEqual(OK);
      expect(services.projectService.updateDetails).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        {
          description: "Stored description",
          managerId: "user-9",
          name: "Pages",
          notes: "Stored notes",
          progress: 40,
          startDate: "2026-01-01",
          status: "active",
          targetDate: "2026-12-31",
          ...changes,
        },
      );
    });

    it("rejects an unknown status when only the status changes", async () => {
      await expect(
        run("update-status", { status: "dormant" }),
      ).resolves.toEqual(INVALID);
    });

    it("rejects a description beyond the length limit", async () => {
      const services = createServices();

      await expect(
        run("update-description", { description: "x".repeat(5001) }, services),
      ).resolves.toEqual(INVALID);
      expect(services.projectService.updateDetails).not.toHaveBeenCalled();
    });
  });

  describe("goals, tags and events", () => {
    it("creates a goal", async () => {
      const services = createServices();

      await expect(
        run("create-goal", { title: "Docs" }, services),
      ).resolves.toEqual(OK);
      expect(services.projectService.createGoal).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        "Docs",
      );
    });

    it("toggles a goal that exists", async () => {
      const services = createServices();

      await expect(
        run("toggle-goal", { goalId: "goal-1" }, services),
      ).resolves.toEqual(OK);
      expect(services.projectService.updateGoal).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        "goal-1",
        { isDone: true, title: "Release" },
      );
    });

    it("rejects toggling an unknown goal", async () => {
      await expect(run("toggle-goal", { goalId: "other" })).resolves.toEqual(
        INVALID,
      );
    });

    it("deletes a goal", async () => {
      const services = createServices();

      await run("delete-goal", { goalId: "goal-1" }, services);

      expect(services.projectService.deleteGoal).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        "goal-1",
      );
    });

    it("replaces the tags from a comma separated list", async () => {
      const services = createServices();

      await run("set-tags", { tags: "intern,wiki" }, services);

      expect(services.projectService.setTags).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        ["intern", "wiki"],
      );
    });

    it("creates an event with defaults for the optional fields", async () => {
      const services = createServices();

      await run(
        "create-event",
        { eventDate: " 2026-05-01 ", title: "Kickoff" },
        services,
      );

      expect(services.projectService.createEvent).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        {
          description: "",
          eventDate: "2026-05-01",
          eventTime: null,
          title: "Kickoff",
          type: "general",
        },
      );
    });

    it("creates an event with time and type", async () => {
      const services = createServices();

      await run(
        "create-event",
        {
          description: "Start",
          eventDate: "2026-05-01",
          eventTime: " 09:30 ",
          title: "Kickoff",
          type: "meeting",
        },
        services,
      );

      expect(services.projectService.createEvent).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        expect.objectContaining({ eventTime: "09:30", type: "meeting" }),
      );
    });

    it("archives an event", async () => {
      const services = createServices();

      await run("archive-event", { eventId: "event-1" }, services);

      expect(services.projectService.archiveEvent).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        "event-1",
      );
    });
  });

  describe("team members", () => {
    it.each([
      ["add-member", "addMember"],
      ["update-member-role", "updateMemberRole"],
    ] as const)("%s needs a known project role", async (intent, method) => {
      const services = createServices();

      await expect(
        run(intent, { role: "owner", userId: "user-2" }, services),
      ).resolves.toEqual(INVALID);
      expect(services.projectService[method]).not.toHaveBeenCalled();
    });

    it.each([
      ["add-member", "addMember"],
      ["update-member-role", "updateMemberRole"],
    ] as const)("%s passes a known role on", async (intent, method) => {
      const services = createServices();

      await expect(
        run(intent, { role: "viewer", userId: "user-2" }, services),
      ).resolves.toEqual(OK);
      expect(services.projectService[method]).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        "user-2",
        "viewer",
      );
    });

    it("removes a member", async () => {
      const services = createServices();

      await run("remove-member", { userId: "user-2" }, services);

      expect(services.projectService.removeMember).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        "user-2",
      );
    });
  });

  describe("milestones", () => {
    it("creates a milestone with trimmed optional values", async () => {
      const services = createServices();

      await expect(
        run(
          "create-milestone",
          {
            colorKey: "release",
            customColor: " #abcdef ",
            description: "First",
            dueAt: " 2026-09-30 ",
            iconKey: "rocket",
            name: "MVP",
            startAt: "",
          },
          services,
        ),
      ).resolves.toEqual(OK);
      expect(services.taskService.createMilestone).toHaveBeenCalledWith(ACTOR, {
        colorCustom: "#abcdef",
        colorKey: "release",
        description: "First",
        dueAt: "2026-09-30",
        iconKey: "rocket",
        name: "MVP",
        projectId: "project-1",
        startAt: null,
      });
    });

    it("ignores an unsupported color and icon when creating", async () => {
      const services = createServices();

      await run(
        "create-milestone",
        { colorKey: "neon", iconKey: "skull", name: "MVP" },
        services,
      );

      expect(services.taskService.createMilestone).toHaveBeenCalledWith(
        ACTOR,
        expect.objectContaining({ colorKey: null, iconKey: null }),
      );
    });

    describe("save-milestone", () => {
      const UPDATE_FIELDS = {
        milestoneId: "milestone-1",
        name: "MVP 2",
        status: "completed",
      };

      it("rejects an unknown status", async () => {
        await expect(
          run("save-milestone", { name: "MVP", status: "paused" }),
        ).resolves.toEqual(INVALID);
      });

      it("creates a milestone when no identifier is submitted", async () => {
        const services = createServices();

        await expect(
          run("save-milestone", { name: "New", status: "open" }, services),
        ).resolves.toEqual(OK);
        expect(services.taskService.createMilestone).toHaveBeenCalledTimes(1);
        expect(services.taskService.updateMilestone).not.toHaveBeenCalled();
      });

      it("rejects a milestone that does not belong to the project", async () => {
        await expect(
          run("save-milestone", {
            ...UPDATE_FIELDS,
            milestoneId: "milestone-9",
          }),
        ).resolves.toEqual(INVALID);
      });

      it.each([
        ["added links that are no JSON", { addLinks: "{" }],
        ["added links that are no list", { addLinks: '{"a":1}' }],
        ["an added link that is no object", { addLinks: "[1]" }],
        [
          "an added link without a target",
          { addLinks: '[{"linkType":"blocks"}]' },
        ],
        [
          "an added link with a numeric target",
          { addLinks: '[{"linkType":"blocks","targetId":5}]' },
        ],
        ["an added link without a type", { addLinks: '[{"targetId":"m-2"}]' }],
        [
          "an added link of an unknown type",
          { addLinks: '[{"linkType":"depends","targetId":"m-2"}]' },
        ],
        ["removed links that are no JSON", { removeLinks: "[" }],
        ["removed links that are no list", { removeLinks: '"link-1"' }],
        ["removed links that are no texts", { removeLinks: "[1]" }],
      ])("rejects %s before changing anything", async (_label, links) => {
        const services = createServices();

        await expect(
          run("save-milestone", { ...UPDATE_FIELDS, ...links }, services),
        ).resolves.toEqual(INVALID);
        expect(services.taskService.updateMilestone).not.toHaveBeenCalled();
      });

      it("keeps stored values the form leaves empty", async () => {
        const services = createServices();

        await expect(
          run("save-milestone", UPDATE_FIELDS, services),
        ).resolves.toEqual(OK);
        expect(services.taskService.updateMilestone).toHaveBeenCalledWith(
          ACTOR,
          "milestone-1",
          {
            colorCustom: "#112233",
            colorKey: "release",
            description: "",
            dueAt: null,
            iconKey: "rocket",
            name: "MVP 2",
            startAt: "2026-01-01",
            status: "completed",
          },
        );
      });

      it("replaces stored values the form provides", async () => {
        const services = createServices();

        await run(
          "save-milestone",
          {
            ...UPDATE_FIELDS,
            colorKey: "review",
            customColor: "#ffffff",
            dueAt: "2026-10-31",
            iconKey: "flag",
            startAt: "2026-02-01",
          },
          services,
        );

        expect(services.taskService.updateMilestone).toHaveBeenCalledWith(
          ACTOR,
          "milestone-1",
          expect.objectContaining({
            colorCustom: "#ffffff",
            colorKey: "review",
            dueAt: "2026-10-31",
            iconKey: "flag",
            startAt: "2026-02-01",
          }),
        );
      });

      it("falls back to null for stored values that are missing", async () => {
        const services = createServices();

        services.taskService.findMilestones.mockResolvedValue([
          {
            ...MILESTONE,
            colorCustom: null,
            colorKey: undefined,
            iconKey: null,
          },
        ]);

        await run("save-milestone", UPDATE_FIELDS, services);

        expect(services.taskService.updateMilestone).toHaveBeenCalledWith(
          ACTOR,
          "milestone-1",
          expect.objectContaining({
            colorCustom: null,
            colorKey: null,
            iconKey: null,
          }),
        );
      });

      describe("dependencies", () => {
        const REMOVE = { ...UPDATE_FIELDS, removeLinks: '["link-1"]' };
        const ADD = {
          ...UPDATE_FIELDS,
          addLinks: '[{"linkType":"blocks","targetId":"milestone-2"}]',
        };

        it("removes a stored link", async () => {
          const services = createServices();

          services.taskService.findDependencies.mockResolvedValue([
            createLink({ id: "link-1" }),
          ]);

          await run("save-milestone", REMOVE, services);

          expect(services.taskService.removeDependency).toHaveBeenCalledWith(
            ACTOR,
            "project-1",
            "link-1",
          );
        });

        it("skips a link that is already gone", async () => {
          const services = createServices();

          await run("save-milestone", REMOVE, services);

          expect(services.taskService.removeDependency).not.toHaveBeenCalled();
        });

        it("tolerates a removal that failed because the link just vanished", async () => {
          const services = createServices();

          services.taskService.findDependencies
            .mockResolvedValueOnce([createLink({ id: "link-1" })])
            .mockResolvedValueOnce([]);
          services.taskService.removeDependency.mockRejectedValue(
            new WorkItemValidationError("titleLength"),
          );

          await expect(
            run("save-milestone", REMOVE, services),
          ).resolves.toEqual(OK);
        });

        it("rethrows a rejected removal of a link that is still stored", async () => {
          const services = createServices();
          const rejection = new WorkItemValidationError("titleLength");

          services.taskService.findDependencies.mockResolvedValue([
            createLink({ id: "link-1" }),
          ]);
          services.taskService.removeDependency.mockRejectedValue(rejection);

          await expect(run("save-milestone", REMOVE, services)).rejects.toBe(
            rejection,
          );
        });

        it("rethrows other failures of a removal without looking again", async () => {
          const services = createServices();
          const failure = new Error("Disk broken");

          services.taskService.findDependencies.mockResolvedValue([
            createLink({ id: "link-1" }),
          ]);
          services.taskService.removeDependency.mockRejectedValue(failure);

          await expect(run("save-milestone", REMOVE, services)).rejects.toBe(
            failure,
          );
          expect(services.taskService.findDependencies).toHaveBeenCalledTimes(
            1,
          );
        });

        it("adds a link that is not stored yet", async () => {
          const services = createServices();

          await run("save-milestone", ADD, services);

          expect(services.taskService.addDependency).toHaveBeenCalledWith(
            ACTOR,
            {
              linkType: "blocks",
              projectId: "project-1",
              sourceId: "milestone-1",
              targetId: "milestone-2",
            },
          );
        });

        it.each([
          ["a different target", { targetId: "milestone-3" }],
          ["a different type", { linkType: "follows" as const }],
          ["a different source", { sourceId: "milestone-5" }],
        ])("adds a link when the stored one has %s", async (_label, other) => {
          const services = createServices();

          services.taskService.findDependencies.mockResolvedValue([
            createLink(other),
          ]);

          await run("save-milestone", ADD, services);

          expect(services.taskService.addDependency).toHaveBeenCalledTimes(1);
        });

        it("skips a link that is already stored", async () => {
          const services = createServices();

          services.taskService.findDependencies.mockResolvedValue([
            createLink({}),
          ]);

          await run("save-milestone", ADD, services);

          expect(services.taskService.addDependency).not.toHaveBeenCalled();
        });

        it("tolerates an addition that failed because the link just appeared", async () => {
          const services = createServices();

          services.taskService.findDependencies
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([createLink({})]);
          services.taskService.addDependency.mockRejectedValue(
            new WorkItemValidationError("titleLength"),
          );

          await expect(run("save-milestone", ADD, services)).resolves.toEqual(
            OK,
          );
        });

        it("rethrows a rejected addition that left no link behind", async () => {
          const services = createServices();
          const rejection = new WorkItemValidationError("titleLength");

          services.taskService.addDependency.mockRejectedValue(rejection);

          await expect(run("save-milestone", ADD, services)).rejects.toBe(
            rejection,
          );
        });

        it("rethrows other failures of an addition without looking again", async () => {
          const services = createServices();
          const failure = new Error("Disk broken");

          services.taskService.addDependency.mockRejectedValue(failure);

          await expect(run("save-milestone", ADD, services)).rejects.toBe(
            failure,
          );
          expect(services.taskService.findDependencies).toHaveBeenCalledTimes(
            1,
          );
        });
      });
    });

    it("deletes a milestone", async () => {
      const services = createServices();

      await expect(
        run("delete-milestone", { milestoneId: " milestone-1 " }, services),
      ).resolves.toEqual(OK);
      expect(services.taskService.deleteMilestone).toHaveBeenCalledWith(
        ACTOR,
        "milestone-1",
      );
    });

    it("rejects deleting a milestone without identifier", async () => {
      await expect(
        run("delete-milestone", { milestoneId: " " }),
      ).resolves.toEqual(INVALID);
    });

    describe("update-milestone-status", () => {
      it("changes only the status", async () => {
        const services = createServices();

        await expect(
          run(
            "update-milestone-status",
            { milestoneId: "milestone-1", status: "archived" },
            services,
          ),
        ).resolves.toEqual(OK);
        expect(services.taskService.updateMilestone).toHaveBeenCalledWith(
          ACTOR,
          "milestone-1",
          {
            colorCustom: "#112233",
            colorKey: "release",
            description: "Stored milestone",
            dueAt: "2026-09-30",
            iconKey: "rocket",
            name: "MVP",
            startAt: "2026-01-01",
            status: "archived",
          },
        );
      });

      it("keeps empty appearance values as null", async () => {
        const services = createServices();

        services.taskService.findMilestones.mockResolvedValue([
          {
            ...MILESTONE,
            colorCustom: undefined,
            colorKey: null,
            iconKey: undefined,
          },
        ]);

        await run(
          "update-milestone-status",
          { milestoneId: "milestone-1", status: "open" },
          services,
        );

        expect(services.taskService.updateMilestone).toHaveBeenCalledWith(
          ACTOR,
          "milestone-1",
          expect.objectContaining({
            colorCustom: null,
            colorKey: null,
            iconKey: null,
          }),
        );
      });

      it.each([
        ["an unknown milestone", { milestoneId: "other", status: "open" }],
        ["an unknown status", { milestoneId: "milestone-1", status: "paused" }],
      ])("rejects %s", async (_label, fields) => {
        await expect(run("update-milestone-status", fields)).resolves.toEqual(
          INVALID,
        );
      });
    });
  });

  describe("GitHub integration", () => {
    const VALID = {
      repoUrl: "https://github.com/acme/pages",
      syncIntervalMinutes: "15",
      token: "secret",
    };

    it("rejects an unsupported sync interval", async () => {
      await expect(
        run("save-integration", { ...VALID, syncIntervalMinutes: "7" }),
      ).resolves.toEqual(INVALID);
    });

    it("saves the settings, reading checkboxes as switches", async () => {
      const services = createServices();

      await expect(
        run(
          "save-integration",
          {
            ...VALID,
            syncComments: "on",
            syncDirection: "push",
            syncIssues: "on",
          },
          services,
        ),
      ).resolves.toEqual(OK);
      expect(services.projectService.saveIntegration).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        {
          repoUrl: "https://github.com/acme/pages",
          syncComments: true,
          syncCommits: false,
          syncDirection: "push",
          syncIntervalMinutes: 15,
          syncIssues: true,
          syncPullRequests: false,
          syncStatus: false,
          token: "secret",
        },
      );
    });

    it.each([
      ["pull", "pull"],
      ["bidirectional", "bidirectional"],
      ["anything else", "bidirectional"],
      ["", "bidirectional"],
    ])("reads the direction %p as %s", async (submitted, stored) => {
      const services = createServices();

      await run(
        "save-integration",
        { ...VALID, syncDirection: submitted },
        services,
      );

      expect(services.projectService.saveIntegration).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
        expect.objectContaining({ syncDirection: stored }),
      );
    });

    it("reports a working connection as success", async () => {
      await expect(run("test-integration")).resolves.toEqual(OK);
    });

    it("reports an unreachable repository as invalid input", async () => {
      const services = createServices();

      services.gitHubSyncService.testConnection.mockResolvedValue(false);

      await expect(run("test-integration", {}, services)).resolves.toEqual(
        INVALID,
      );
    });

    it("synchronizes right away", async () => {
      const services = createServices();

      await expect(run("sync-integration", {}, services)).resolves.toEqual(OK);
      expect(services.gitHubSyncService.syncProjectNow).toHaveBeenCalledWith(
        ACTOR,
        "project-1",
      );
    });

    it.each([
      ["on", true],
      ["", false],
    ])("switches the synchronization (%j)", async (field, isEnabled) => {
      const services = createServices();

      await expect(
        run("set-integration-sync", { syncEnabled: field }, services),
      ).resolves.toEqual(OK);
      expect(
        services.projectService.setIntegrationSyncEnabled,
      ).toHaveBeenCalledWith(ACTOR, "project-1", isEnabled);
    });

    it("rejects switching a project without an integration", async () => {
      const services = createServices();

      services.projectService.setIntegrationSyncEnabled.mockResolvedValue(null);

      await expect(
        run("set-integration-sync", { syncEnabled: "on" }, services),
      ).resolves.toEqual(INVALID);
    });

    it("disconnects the project", async () => {
      const services = createServices();

      await expect(
        run("disconnect-integration", {}, services),
      ).resolves.toEqual(OK);
      expect(
        services.projectService.disconnectIntegration,
      ).toHaveBeenCalledWith(ACTOR, "project-1");
    });
  });
});
