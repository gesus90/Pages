import { describe, expect, it, vi } from "vitest";

import { RemoteInstallFindingRepository } from "./RemoteInstallFindingRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { HostObservation, InstallFinding } from "@/definition/RemoteSetup";

const OBSERVATION: HostObservation = {
  isUbuntu: true,
  architecture: "x86_64",
  serviceManager: "systemd",
  canQueryService: true,
  isRunnerInstalled: true,
  runnerVersion: "1.2.3",
  isServiceInstalled: true,
  isServiceEnabled: true,
  isServiceActive: true,
  tools: [],
};

const FINDING: InstallFinding = {
  binding: {
    host: "box",
    port: 22,
    username: "root",
    hostKeyFingerprint: "SHA256:abc",
  },
  observedAt: "2026-01-01T00:00:00Z",
  observation: OBSERVATION,
};

function doubleOf(rows: DatabaseValue[][] = []): {
  repository: RemoteInstallFindingRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new RemoteInstallFindingRepository({ query, execute }),
    query,
    execute,
  };
}

describe("RemoteInstallFindingRepository", () => {
  it("maps a stored finding", async () => {
    const { repository, query } = doubleOf([
      [
        "box",
        22,
        "root",
        "SHA256:abc",
        JSON.stringify(OBSERVATION),
        "2026-01-01T00:00:00Z",
      ],
    ]);

    await expect(repository.find("c1")).resolves.toEqual(FINDING);
    expect(query.mock.calls[0]?.[1]).toEqual({ connection_id: "c1" });
  });

  it("returns null when no probe was made", async () => {
    await expect(doubleOf([]).repository.find("c1")).resolves.toBeNull();
  });

  it("replaces the finding of a connection", async () => {
    const { repository, execute } = doubleOf();

    await repository.save("c1", FINDING);

    expect(execute.mock.calls[0]?.[1]).toEqual({
      connection_id: "c1",
      host: "box",
      port: 22,
      username: "root",
      host_key_fingerprint: "SHA256:abc",
      observation_json: JSON.stringify(OBSERVATION),
      observed_at: "2026-01-01T00:00:00Z",
    });
  });
});
