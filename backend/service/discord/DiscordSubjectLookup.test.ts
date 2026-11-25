import { describe, expect, it, vi } from "vitest";

import { DiscordSubjectLookup } from "./DiscordSubjectLookup";

function createLookup(): {
  readonly lookup: DiscordSubjectLookup;
  readonly findById: ReturnType<typeof vi.fn>;
  readonly findMilestoneById: ReturnType<typeof vi.fn>;
  readonly findProject: ReturnType<typeof vi.fn>;
} {
  const findById = vi.fn();
  const findMilestoneById = vi.fn();
  const findProject = vi.fn();

  return {
    findById,
    findMilestoneById,
    findProject,
    lookup: new DiscordSubjectLookup(
      { findById, findMilestoneById },
      { findById: findProject },
    ),
  };
}

describe("DiscordSubjectLookup.findTicket", () => {
  it("returns null for an unknown or archived ticket", async () => {
    const { lookup, findById } = createLookup();

    findById.mockResolvedValue(null);

    expect(await lookup.findTicket("t1")).toBeNull();
    expect(findById).toHaveBeenCalledWith("t1");
  });

  it("returns the facts of a ticket without a department", async () => {
    const { lookup, findById } = createLookup();

    findById.mockResolvedValue({
      departmentIds: [],
      key: "TICKET-1",
      projectId: "p1",
      projectName: "Project",
      statusName: "Open",
      title: "Title",
    });

    expect(await lookup.findTicket("t1")).toEqual({
      hasDepartment: false,
      key: "TICKET-1",
      projectId: "p1",
      projectName: "Project",
      statusName: "Open",
      title: "Title",
    });
  });

  it("marks a ticket of a department", async () => {
    const { lookup, findById } = createLookup();

    findById.mockResolvedValue({
      departmentIds: ["d1"],
      key: "TICKET-2",
      projectId: "p1",
      projectName: "Project",
      statusName: "Done",
      title: "Other",
    });

    expect((await lookup.findTicket("t2"))?.hasDepartment).toBe(true);
  });
});

describe("DiscordSubjectLookup.findMilestone", () => {
  it("returns null for an unknown milestone", async () => {
    const { lookup, findMilestoneById, findProject } = createLookup();

    findMilestoneById.mockResolvedValue(null);

    expect(await lookup.findMilestone("m1")).toBeNull();
    expect(findProject).not.toHaveBeenCalled();
  });

  it("returns null when the project is gone", async () => {
    const { lookup, findMilestoneById, findProject } = createLookup();

    findMilestoneById.mockResolvedValue({ projectId: "p1" });
    findProject.mockResolvedValue(null);

    expect(await lookup.findMilestone("m1")).toBeNull();
    expect(findProject).toHaveBeenCalledWith("p1");
  });

  it("combines the milestone with the project name", async () => {
    const { lookup, findMilestoneById, findProject } = createLookup();

    findMilestoneById.mockResolvedValue({
      name: "Release",
      projectId: "p1",
      status: "open",
    });
    findProject.mockResolvedValue({ name: "Project" });

    expect(await lookup.findMilestone("m1")).toEqual({
      name: "Release",
      projectId: "p1",
      projectName: "Project",
      status: "open",
    });
  });
});
