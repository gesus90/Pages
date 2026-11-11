import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentAssignmentService } from "@/backend/service/agents/AgentAssignmentService";

import type { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentAssignment } from "@/definition/AgentAssignment";
import type { AccountAccess } from "@/definition/Authorization";

function stub<T>(standIn: object): T {
  return standIn as T;
}

const resolution = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("@/backend/service/agents/AgentAssignmentResolution", () => ({
  resolveAgentAssignment: resolution.resolve,
}));

const ADMIN: AccountAccess = {
  userId: "admin",
  role: null,
  isAdmin: true,
  mode: "admin",
  firstName: "Ada",
  lastName: "Admin",
  isActive: true,
  departments: [],
  managedDepartments: [],
  allDepartments: true,
  allProjects: true,
  hasHadDepartment: false,
};

const MEMBER: AccountAccess = { ...ADMIN, userId: "member", isAdmin: false };

const SKILLS: AgentAssignment = {
  function: "skills",
  connectionId: "connection-1",
  model: "synthetic-model",
  reasoningEffort: null,
};

interface Setup {
  readonly service: AgentAssignmentService;
  readonly list: Mock<() => Promise<readonly AgentAssignment[]>>;
  readonly remove: Mock<(assignedFunction: string) => Promise<void>>;
  readonly connections: AgentConnectionRepository;
}

function setup(stored: readonly AgentAssignment[] = [SKILLS]): Setup {
  const list = vi.fn<() => Promise<readonly AgentAssignment[]>>(
    async () => stored,
  );
  const remove = vi.fn<(assignedFunction: string) => Promise<void>>(
    async () => undefined,
  );
  const connections = stub<AgentConnectionRepository>({});
  const service = new AgentAssignmentService({
    assignments: stub<AgentAssignmentRepository>({ list, remove }),
    connections,
  });
  return { service, list, remove, connections };
}

beforeEach(() => {
  resolution.resolve.mockReset();
});

describe("AgentAssignmentService.list", () => {
  it("lists a usable assignment without an error", async () => {
    resolution.resolve.mockResolvedValue({});
    const { service, connections } = setup();

    expect(await service.list(ADMIN)).toEqual([{ ...SKILLS, error: null }]);
    expect(resolution.resolve).toHaveBeenCalledWith(connections, SKILLS);
  });

  it("keeps an unusable assignment visible with the code of its refusal", async () => {
    resolution.resolve.mockRejectedValue(
      new AgentExecutionError("modelUnavailable"),
    );
    const { service } = setup();

    expect(await service.list(ADMIN)).toEqual([
      { ...SKILLS, error: "modelUnavailable" },
    ]);
  });

  it("resolves each assignment on its own", async () => {
    const second = { ...SKILLS, connectionId: "connection-2" };
    resolution.resolve.mockImplementation(
      async (_: unknown, assignment: AgentAssignment) => {
        if (assignment.connectionId === "connection-2")
          throw new AgentExecutionError("connectionUnavailable");
        return {};
      },
    );
    const { service } = setup([SKILLS, second]);

    expect(await service.list(ADMIN)).toEqual([
      { ...SKILLS, error: null },
      { ...second, error: "connectionUnavailable" },
    ]);
  });

  it("rethrows a failure that is no execution refusal", async () => {
    resolution.resolve.mockRejectedValue(new Error("database down"));
    const { service } = setup();

    await expect(service.list(ADMIN)).rejects.toThrow("database down");
  });

  it("refuses a person who is not an administrator before reading anything", async () => {
    const { service, list } = setup();

    await expect(service.list(MEMBER)).rejects.toThrow(
      "Administrator mode is required",
    );
    expect(list).not.toHaveBeenCalled();
  });
});

describe("AgentAssignmentService.remove", () => {
  it("removes the named function", async () => {
    const { service, remove } = setup();

    await service.remove(ADMIN, "skills");

    expect(remove).toHaveBeenCalledExactlyOnceWith("skills");
  });

  it("rejects a function that is not defined and removes nothing", async () => {
    const { service, remove } = setup();

    await expect(service.remove(ADMIN, "unknown")).rejects.toMatchObject({
      constructor: AgentError,
      code: "function_invalid",
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("refuses a person who is not an administrator", async () => {
    const { service, remove } = setup();

    await expect(service.remove(MEMBER, "skills")).rejects.toThrow(
      "Administrator mode is required",
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("serializes writes so a second removal waits for the first", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const { service, remove } = setup();
    remove.mockImplementationOnce(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push("first:end");
    });
    remove.mockImplementationOnce(async () => {
      order.push("second");
    });

    const first = service.remove(ADMIN, "skills");
    const second = service.remove(ADMIN, "skills");
    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(["first:start", "first:end", "second"]);
  });
});
