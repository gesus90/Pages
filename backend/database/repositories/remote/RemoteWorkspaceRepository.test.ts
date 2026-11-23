import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentWorkspaceReferencesRepository } from "../agent/AgentWorkspaceReferencesRepository";

import { RemoteWorkspaceRepository } from "./RemoteWorkspaceRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { RemoteWorkspaceRecord } from "./RemoteWorkspaceRepository";

const usages = vi.fn();
const detach = vi.fn();

vi.mock("../agent/AgentWorkspaceReferencesRepository", () => ({
  AgentWorkspaceReferencesRepository: vi.fn(
    class {
      public readonly usages = usages;
      public readonly detach = detach;
    },
  ),
}));

type Row = DatabaseValue[];

function rowOf(overrides: Record<number, DatabaseValue> = {}): Row {
  const row: Row = [
    "w1",
    "Work",
    "c1",
    "/srv/work",
    "p1",
    "u1",
    "2026-01-01T00:00:00Z",
    "path_missing",
    2,
    '["/srv"]',
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

const RECORD: RemoteWorkspaceRecord = {
  id: "w1",
  name: "Work",
  connectionId: "c1",
  path: "/srv/work",
  projectId: "p1",
  registeredBy: "u1",
  check: {
    checkedAt: "2026-01-01T00:00:00Z",
    issue: "path_missing",
    roots: ["/srv"],
  },
  revision: 2,
};

beforeEach(() => {
  usages.mockReset();
  detach.mockReset();
});

function doubleOf(
  rows: Row[],
  overlaps: Row[] = [],
): {
  repository: RemoteWorkspaceRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (statement: string) =>
    statement.includes("ORDER BY lower(name)") ? rows : overlaps,
  );
  const execute = vi.fn(async () => undefined);
  const transaction = { query, execute };
  return {
    repository: new RemoteWorkspaceRepository({
      transaction: async (work: (value: typeof transaction) => unknown) =>
        work(transaction),
      readTransaction: async (work: (value: typeof transaction) => unknown) =>
        work(transaction),
    } as unknown as ConstructorParameters<typeof RemoteWorkspaceRepository>[0]),
    query,
    execute,
  };
}

describe("RemoteWorkspaceRepository reads", () => {
  it("maps a full row", async () => {
    await expect(doubleOf([rowOf()]).repository.list()).resolves.toEqual([
      RECORD,
    ]);
  });

  it("maps a profile that was never checked", async () => {
    const [record] = await doubleOf([rowOf({ 6: null })]).repository.list();

    expect(record?.check).toBeNull();
  });

  it("accepts a failure code and drops unknown issues and old roots", async () => {
    const [code, unknown, old] = await doubleOf([
      rowOf({ 7: "not_ssh" }),
      rowOf({ 7: "garbage" }),
      rowOf({ 7: null, 9: null }),
    ]).repository.list();

    expect(code?.check?.issue).toBe("not_ssh");
    expect(unknown?.check?.issue).toBeNull();
    expect(old?.check).toMatchObject({ issue: null, roots: null });
  });

  it("finds a profile or null", async () => {
    const { repository } = doubleOf([rowOf()]);

    await expect(repository.find("w1")).resolves.toEqual(RECORD);
    await expect(repository.find("x")).resolves.toBeNull();
  });

  it("reads usages through the shared reference repository", async () => {
    usages.mockResolvedValue([{ kind: "plan" }]);
    const { repository } = doubleOf([]);

    await expect(repository.usages("w1")).resolves.toEqual([{ kind: "plan" }]);
    expect(usages).toHaveBeenCalledWith("w1");
    expect(AgentWorkspaceReferencesRepository).toHaveBeenCalledTimes(1);
  });
});

describe("RemoteWorkspaceRepository.save", () => {
  it("inserts a new profile with its author", async () => {
    const { repository, execute } = doubleOf([]);

    await repository.save(RECORD, true);

    expect(execute.mock.calls[0]?.[0]).toContain("INSERT INTO");
    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      id: "w1",
      registered_by: "u1",
      check_roots_json: '["/srv"]',
    });
  });

  it("stores null check columns for an unchecked profile", async () => {
    const { repository, execute } = doubleOf([]);

    await repository.save({ ...RECORD, check: null }, true);

    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      checked_at: null,
      check_issue: null,
      check_roots_json: null,
    });
  });

  it("stores no roots for a check that predates them", async () => {
    const { repository, execute } = doubleOf([]);

    await repository.save(
      { ...RECORD, check: { checkedAt: "now", issue: null, roots: null } },
      true,
    );

    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      check_roots_json: null,
    });
  });

  it("updates an existing profile at its revision", async () => {
    const { repository, execute } = doubleOf([rowOf()]);

    await repository.save(RECORD, false);

    expect(execute.mock.calls[0]?.[0]).toContain("UPDATE remote_workspaces");
    expect(execute.mock.calls[0]?.[1]).not.toHaveProperty("registered_by");
  });

  it("rejects a duplicate identifier", async () => {
    await expect(
      doubleOf([rowOf()]).repository.save(RECORD, true),
    ).rejects.toMatchObject({ code: "remote_conflict" });
  });

  it("rejects a change of an unknown profile", async () => {
    await expect(
      doubleOf([]).repository.save(RECORD, false),
    ).rejects.toMatchObject({ code: "remote_workspace_not_found" });
  });

  it("rejects a stale revision", async () => {
    await expect(
      doubleOf([rowOf()]).repository.save({ ...RECORD, revision: 1 }, false),
    ).rejects.toMatchObject({ code: "remote_conflict" });
  });

  it.each(["/srv/work/", "/"])(
    "rejects an overlapping path %s",
    async (path) => {
      const { repository, query } = doubleOf([], [["w2"]]);

      await expect(
        repository.save({ ...RECORD, path }, true),
      ).rejects.toMatchObject({ code: "remote_workspace_path_conflict" });
      const overlap = query.mock.calls.find((call) =>
        String(call[0]).includes("starts_with"),
      );
      expect(overlap?.[1]).toMatchObject({
        prefix: path.endsWith("/") ? path : `${path}/`,
      });
    },
  );
});

describe("RemoteWorkspaceRepository.saveCheck", () => {
  it("writes the check at the revision", async () => {
    const { repository, execute } = doubleOf([]);

    await repository.saveCheck("w1", 2, {
      checkedAt: "now",
      issue: "path_denied",
      roots: ["/a"],
    });

    expect(execute.mock.calls[0]?.[1]).toEqual({
      id: "w1",
      revision: 2,
      checked_at: "now",
      check_issue: "path_denied",
      check_roots_json: '["/a"]',
    });
  });
});

describe("RemoteWorkspaceRepository.remove", () => {
  it("rejects an unknown profile", async () => {
    await expect(doubleOf([]).repository.remove("w1", 2)).rejects.toMatchObject(
      { code: "remote_workspace_not_found" },
    );
  });

  it("rejects a stale revision", async () => {
    await expect(
      doubleOf([rowOf()]).repository.remove("w1", 1),
    ).rejects.toMatchObject({ code: "remote_conflict" });
  });

  it("detaches references as the remover and deletes", async () => {
    const { repository, execute } = doubleOf([rowOf()]);

    await repository.remove("w1", 2, "admin");

    expect(detach).toHaveBeenCalledWith("w1", {
      userId: "admin",
      name: "Work",
    });
    expect(execute.mock.calls[0]?.[1]).toEqual({ id: "w1" });
  });

  it("attributes the removal to the registrant by default", async () => {
    const { repository } = doubleOf([rowOf()]);

    await repository.remove("w1", 2);

    expect(detach).toHaveBeenCalledWith("w1", { userId: "u1", name: "Work" });
  });
});
