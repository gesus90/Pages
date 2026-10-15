import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
} from "@/backend/error/ProjectErrors";

import { ProjectWorld } from "./project-service-world";

import type { ProjectRole } from "@/definition/Project";

let world = new ProjectWorld();
beforeEach(() => {
  world = new ProjectWorld();
});

describe("project members", () => {
  it("lists the members for a reader", async () => {
    await expect(
      world.service.findMembers(world.user("writer"), "alpha"),
    ).resolves.toMatchObject([{ userId: "writer" }]);
  });

  it("refuses the member list without project access", async () => {
    await expect(
      world.service.findMembers(world.user("outsider"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });

  it("adds a member, forgets membership caches and records the change", async () => {
    const invalidate = vi.spyOn(world.cache, "invalidateProjectMembership");

    await world.service.addMember(
      world.user("lead"),
      "alpha",
      "outsider",
      "viewer",
    );

    expect(world.state.members.get("alpha")?.map((m) => m.userId)).toEqual([
      "writer",
      "outsider",
    ]);
    expect(invalidate).toHaveBeenCalled();
    expect(world.state.activity).toMatchObject([
      { action: "member_added", category: "team", userId: "lead" },
    ]);
  });

  it("rejects an unsupported role without writing", async () => {
    await expect(
      world.service.addMember(
        world.user("lead"),
        "alpha",
        "outsider",
        "owner" as ProjectRole,
      ),
    ).rejects.toThrow("Unsupported project role.");
    expect(world.writes).toEqual([]);
  });

  it("refuses to add a member without responsibility", async () => {
    await expect(
      world.service.addMember(
        world.user("writer"),
        "alpha",
        "outsider",
        "member",
      ),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.writes).toEqual([]);
  });

  it("changes the role of a member and records it", async () => {
    await world.service.updateMemberRole(
      world.user("lead"),
      "alpha",
      "writer",
      "manager",
    );

    expect(world.state.members.get("alpha")).toMatchObject([
      { userId: "writer", projectRole: "manager" },
    ]);
    expect(world.state.activity[0]).toMatchObject({ action: "role_changed" });
  });

  it("rejects an unsupported role change", async () => {
    await expect(
      world.service.updateMemberRole(
        world.user("lead"),
        "alpha",
        "writer",
        "root" as ProjectRole,
      ),
    ).rejects.toThrow("Unsupported project role.");
  });

  it("removes a member and records it", async () => {
    await world.service.removeMember(world.user("lead"), "alpha", "writer");

    expect(world.state.members.get("alpha")).toEqual([]);
    expect(world.state.activity[0]).toMatchObject({ action: "member_removed" });
  });

  it("refuses to remove a member without responsibility", async () => {
    await expect(
      world.service.removeMember(world.user("writer"), "alpha", "writer"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.state.members.get("alpha")).toHaveLength(1);
  });
});

describe("project goals", () => {
  it("creates a trimmed goal at the end of the list and records it", async () => {
    await world.service.createGoal(world.user("lead"), "alpha", "First");
    await world.service.createGoal(world.user("lead"), "alpha", "  Second  ");

    expect(
      world.state.goals
        .get("alpha")
        ?.map((goal) => [goal.title, goal.position]),
    ).toEqual([
      ["First", 0],
      ["Second", 1],
    ]);
    expect(world.state.activity.map((entry) => entry.action)).toEqual([
      "goal_created",
      "goal_created",
    ]);
  });

  it.each(["", "   ", "g".repeat(201)])(
    "rejects the title %j",
    async (title) => {
      await expect(
        world.service.createGoal(world.user("lead"), "alpha", title),
      ).rejects.toThrow("Goal title must be between 1 and 200 characters.");
      expect(world.writes).toEqual([]);
    },
  );

  it("accepts a title of exactly 200 characters", async () => {
    await world.service.createGoal(
      world.user("lead"),
      "alpha",
      "g".repeat(200),
    );

    expect(world.state.goals.get("alpha")).toHaveLength(1);
  });

  it("refuses goal changes without responsibility", async () => {
    await expect(
      world.service.createGoal(world.user("writer"), "alpha", "Goal"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });

  it("updates and deletes a goal of the project", async () => {
    await world.service.createGoal(world.user("lead"), "alpha", "Goal");
    const goalId = world.state.goals.get("alpha")?.[0]?.id ?? "";

    await world.service.updateGoal(world.user("lead"), "alpha", goalId, {
      title: "  Done goal ",
      isDone: true,
    });

    expect(world.state.goals.get("alpha")?.[0]).toMatchObject({
      title: "Done goal",
      isDone: true,
    });

    await world.service.deleteGoal(world.user("lead"), "alpha", goalId);

    expect(world.state.goals.get("alpha")).toEqual([]);
  });

  it("refuses a goal that belongs to another project", async () => {
    world.addProject("beta", ["engineering"]);
    world.state.goals.set("beta", [
      {
        id: "foreign",
        projectId: "beta",
        title: "T",
        isDone: false,
        position: 0,
      },
    ]);

    await expect(
      world.service.deleteGoal(world.user("admin"), "alpha", "foreign"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    await expect(
      world.service.updateGoal(world.user("admin"), "alpha", "foreign", {
        title: "x",
        isDone: false,
      }),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.state.goals.get("beta")).toHaveLength(1);
  });
});

describe("project tags", () => {
  it("trims, shortens, deduplicates and drops empty tags", async () => {
    await world.service.setTags(world.user("lead"), "alpha", [
      " web ",
      "web",
      "",
      "   ",
      "t".repeat(60),
    ]);

    expect(world.state.tags.get("alpha")).toEqual(["web", "t".repeat(40)]);
  });

  it("keeps at most twenty tags", async () => {
    const tags = Array.from({ length: 25 }, (_, index) => `tag-${index}`);

    await world.service.setTags(world.user("lead"), "alpha", tags);

    expect(world.state.tags.get("alpha")).toEqual(tags.slice(0, 20));
  });

  it("refuses tag changes without responsibility", async () => {
    await expect(
      world.service.setTags(world.user("writer"), "alpha", ["x"]),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });

  it("lists tags for a reader only", async () => {
    world.state.tags.set("alpha", ["web"]);

    await expect(
      world.service.findTags(world.user("writer"), "alpha"),
    ).resolves.toEqual(["web"]);
    await expect(
      world.service.findTags(world.user("outsider"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });
});

describe("project planning dates", () => {
  const event = {
    title: "  Kickoff ",
    description: "  Meet  ",
    eventDate: "2026-04-01",
    eventTime: " 09:30 ",
    type: " milestone ",
  };

  it("creates a trimmed date and records it", async () => {
    await world.service.createEvent(world.user("lead"), "alpha", event);

    expect(world.state.events.get("alpha")).toMatchObject([
      {
        title: "Kickoff",
        description: "Meet",
        eventDate: "2026-04-01",
        eventTime: "09:30",
        type: "milestone",
      },
    ]);
    expect(world.state.activity[0]).toMatchObject({
      action: "event_created",
      category: "planning",
    });
  });

  it("stores a blank time as none and an empty type as general", async () => {
    await world.service.createEvent(world.user("lead"), "alpha", {
      ...event,
      eventTime: "  ",
      type: "   ",
    });

    expect(world.state.events.get("alpha")?.[0]).toMatchObject({
      eventTime: null,
      type: "general",
    });
  });

  it("shortens the type to 40 characters", async () => {
    await world.service.createEvent(world.user("lead"), "alpha", {
      ...event,
      type: "t".repeat(50),
    });

    expect(world.state.events.get("alpha")?.[0]?.type).toBe("t".repeat(40));
  });

  it.each([
    ["a blank title", { title: " " }, "Event title must be between"],
    ["a long title", { title: "t".repeat(201) }, "Event title must be between"],
    ["a malformed date", { eventDate: "01.04.2026" }, "YYYY-MM-DD"],
    [
      "a date with a time part",
      { eventDate: "2026-04-01T10:00" },
      "YYYY-MM-DD",
    ],
  ])("rejects %s", async (_, overrides, message) => {
    await expect(
      world.service.createEvent(world.user("lead"), "alpha", {
        ...event,
        ...overrides,
      }),
    ).rejects.toThrow(message);
    expect(world.writes).toEqual([]);
  });

  it("updates and archives a date of the project", async () => {
    await world.service.createEvent(world.user("lead"), "alpha", event);
    const eventId = world.state.events.get("alpha")?.[0]?.id ?? "";

    await world.service.updateEvent(world.user("lead"), "alpha", eventId, {
      ...event,
      title: "Moved",
      eventDate: "2026-05-01",
    });

    expect(world.state.events.get("alpha")?.[0]).toMatchObject({
      title: "Moved",
      eventDate: "2026-05-01",
    });

    await world.service.archiveEvent(world.user("lead"), "alpha", eventId);

    expect(world.state.events.get("alpha")).toEqual([]);
  });

  it("refuses a date that belongs to another project", async () => {
    await expect(
      world.service.archiveEvent(world.user("admin"), "alpha", "foreign"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    await expect(
      world.service.updateEvent(world.user("admin"), "alpha", "foreign", event),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });
});

describe("project activity log", () => {
  it("reads the log within the current ticket and wiki scope", async () => {
    const read = vi.spyOn(ProjectRepository.prototype, "findActivity");

    await world.service.findActivity(world.user("writer"), "alpha");

    expect(read).toHaveBeenCalledWith(
      "alpha",
      { departmentIds: ["engineering"], projectIds: ["alpha"] },
      {
        departmentIds: ["engineering"],
        isAdmin: false,
        projectIds: ["alpha"],
        userId: "writer",
      },
    );
  });

  it("refuses the log without project access", async () => {
    await expect(
      world.service.findActivity(world.user("outsider"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });
});
