import { describe, expect, it, vi } from "vitest";

import {
  parseRemoteRoots,
  RemoteConnectionRepository,
} from "./RemoteConnectionRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { RemoteConnectionRecord } from "./RemoteConnectionRepository";

type Row = DatabaseValue[];

function rowOf(overrides: Record<number, DatabaseValue> = {}): Row {
  const row: Row = [
    "c1",
    "Box",
    "host.example",
    22,
    "root",
    "password",
    "d1",
    "ssh-ed25519",
    "KEY",
    "SHA256:abc",
    "pw",
    "pk",
    "pp",
    "2026-01-01T00:00:00Z",
    "host_key",
    "not_ssh",
    4,
    '["/srv"]',
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

const RECORD: RemoteConnectionRecord = {
  id: "c1",
  name: "Box",
  host: "host.example",
  port: 22,
  username: "root",
  authMethod: "password",
  departmentId: "d1",
  hostKey: { algorithm: "ssh-ed25519", key: "KEY", fingerprint: "SHA256:abc" },
  allowedRoots: ["/srv"],
  secrets: { password: "pw", privateKey: "pk", passphrase: "pp" },
  lastCheck: {
    checkedAt: "2026-01-01T00:00:00Z",
    stage: "host_key",
    code: "not_ssh",
  },
  revision: 4,
};

interface Double {
  repository: RemoteConnectionRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
}

/** Answers the connection listing with `rows` and every other query with `others`. */
function doubleOf(rows: Row[], others: Row[] = []): Double {
  const query = vi.fn(async (statement: string) =>
    statement.includes("FROM remote_connections\n    ORDER BY") ? rows : others,
  );
  const execute = vi.fn(async () => undefined);
  const transaction = { query, execute };
  return {
    repository: new RemoteConnectionRepository({
      transaction: async (work: (value: typeof transaction) => unknown) =>
        work(transaction),
      readTransaction: async (work: (value: typeof transaction) => unknown) =>
        work(transaction),
    } as unknown as ConstructorParameters<
      typeof RemoteConnectionRepository
    >[0]),
    query,
    execute,
  };
}

describe("parseRemoteRoots", () => {
  it("returns a list of texts", () => {
    expect(parseRemoteRoots('["/a"]', "col")).toEqual(["/a"]);
  });

  it.each(["{}", "[1]"])("rejects %s", (json) => {
    expect(() => parseRemoteRoots(json, "col")).toThrow('"col"');
  });
});

describe("RemoteConnectionRepository reads", () => {
  it("maps a full row", async () => {
    await expect(doubleOf([rowOf()]).repository.list()).resolves.toEqual([
      RECORD,
    ]);
  });

  it("maps sparse rows", async () => {
    const [record] = await doubleOf([
      rowOf({
        7: null,
        13: null,
        17: null,
        5: "key_passphrase",
      }),
    ]).repository.list();

    expect(record).toMatchObject({
      hostKey: null,
      lastCheck: null,
      allowedRoots: [],
      authMethod: "key_passphrase",
    });
  });

  it.each([
    ["reachability", "reachability"],
    ["authentication", "authentication"],
    ["bogus", null],
    [null, null],
  ])("reads check stage %s as %s", async (stored, stage) => {
    const [record] = await doubleOf([
      rowOf({ 14: stored, 15: "nonsense" }),
    ]).repository.list();

    expect(record?.lastCheck).toEqual({
      checkedAt: "2026-01-01T00:00:00Z",
      stage,
      code: null,
    });
  });

  it("rejects an unknown sign-in method", async () => {
    await expect(
      doubleOf([rowOf({ 5: "telepathy" })]).repository.list(),
    ).rejects.toThrow('"auth_method"');
  });

  it("finds a connection or null", async () => {
    const { repository } = doubleOf([rowOf()]);

    await expect(repository.find("c1")).resolves.toEqual(RECORD);
    await expect(repository.find("other")).resolves.toBeNull();
  });

  it("counts workspaces per connection", async () => {
    const { repository } = doubleOf([], [["c1", 2]]);

    await expect(repository.workspaceCounts()).resolves.toEqual(
      new Map([["c1", 2]]),
    );
  });
});

describe("RemoteConnectionRepository.create", () => {
  it("inserts with the actor", async () => {
    const { repository, execute } = doubleOf([]);

    await repository.create(RECORD, "admin");

    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      id: "c1",
      host_key_fingerprint: "SHA256:abc",
      allowed_roots_json: '["/srv"]',
      actor_id: "admin",
    });
  });

  it("stores null host key columns without a pinned key", async () => {
    const { repository, execute } = doubleOf([]);

    await repository.create({ ...RECORD, hostKey: null }, "admin");

    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      host_key_algorithm: null,
      host_key: null,
      host_key_fingerprint: null,
    });
  });

  it("rejects a used name", async () => {
    const { repository } = doubleOf([], [["other"]]);

    await expect(repository.create(RECORD, "admin")).rejects.toMatchObject({
      code: "remote_connection_name_taken",
    });
  });
});

describe("RemoteConnectionRepository.update", () => {
  it("rejects an unknown connection", async () => {
    await expect(
      doubleOf([]).repository.update(RECORD, "admin"),
    ).rejects.toMatchObject({ code: "remote_connection_not_found" });
  });

  it("rejects a stale revision", async () => {
    await expect(
      doubleOf([rowOf()]).repository.update(
        { ...RECORD, revision: 3 },
        "admin",
      ),
    ).rejects.toMatchObject({ code: "remote_conflict" });
  });

  it("rejects a used name", async () => {
    await expect(
      doubleOf([rowOf()], [["other"]]).repository.update(RECORD, "admin"),
    ).rejects.toMatchObject({ code: "remote_connection_name_taken" });
  });

  it("keeps the pairing for a metadata change", async () => {
    const { repository, execute } = doubleOf([rowOf()]);

    await repository.update(
      { ...RECORD, name: "Renamed", host: "HOST.example" },
      "admin",
    );

    expect(execute.mock.calls).toHaveLength(2);
    expect(execute.mock.calls[0]?.[0]).toContain("UPDATE pages_runners");
    expect(execute.mock.calls[0]?.[1]).toEqual({
      id: "c1",
      revision: 4,
      next_revision: 5,
    });
  });

  it.each([
    ["host", { host: "other.example" }],
    ["port", { port: 2222 }],
    ["username", { username: "deploy" }],
    ["department", { departmentId: "d2" }],
    ["auth method", { authMethod: "key" as const }],
    ["host key", { hostKey: null }],
  ])("ends the finding when the %s changes", async (label, change) => {
    const { repository, execute } = doubleOf([rowOf()]);

    await repository.update({ ...RECORD, ...change }, "admin");

    expect(execute.mock.calls).toHaveLength(2);
    expect(execute.mock.calls[0]?.[0]).toContain(
      "DELETE FROM remote_install_findings",
    );
  });
});

describe("RemoteConnectionRepository.saveCheck", () => {
  it("writes the classified result", async () => {
    const { repository, execute } = doubleOf([]);

    await repository.saveCheck("c1", 4, {
      checkedAt: "now",
      stage: "reachability",
      code: "unreachable_timeout",
    });

    expect(execute.mock.calls[0]?.[1]).toEqual({
      id: "c1",
      revision: 4,
      checked_at: "now",
      check_stage: "reachability",
      check_code: "unreachable_timeout",
    });
  });
});

describe("RemoteConnectionRepository.remove", () => {
  it("rejects an unknown connection", async () => {
    await expect(doubleOf([]).repository.remove("c1", 4)).rejects.toMatchObject(
      { code: "remote_connection_not_found" },
    );
  });

  it("rejects a stale revision", async () => {
    await expect(
      doubleOf([rowOf()]).repository.remove("c1", 3),
    ).rejects.toMatchObject({ code: "remote_conflict" });
  });

  it("rejects a connection that profiles still use", async () => {
    await expect(
      doubleOf([rowOf()], [["w1"]]).repository.remove("c1", 4),
    ).rejects.toMatchObject({ code: "remote_connection_in_use" });
  });

  it("deletes findings and the connection", async () => {
    const { repository, execute } = doubleOf([rowOf()]);

    await repository.remove("c1", 4);

    expect(execute.mock.calls.map((call) => call[0])).toEqual([
      expect.stringContaining("remote_install_findings"),
      expect.stringContaining("DELETE FROM remote_connections"),
    ]);
  });
});
