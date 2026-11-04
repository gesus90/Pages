import {
  parseRemoteRoots,
  RemoteConnectionRepository,
} from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import { RemoteInstallFindingRepository } from "@/backend/database/repositories/remote/RemoteInstallFindingRepository";
import { RemoteWorkspaceRepository } from "@/backend/database/repositories/remote/RemoteWorkspaceRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";

import { OWNER, planFixture, PROJECT } from "./plan-fixtures";
import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { RemoteConnectionRecord } from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import type { RemoteWorkspaceRecord } from "@/backend/database/repositories/remote/RemoteWorkspaceRepository";
import type { InstallFinding } from "@/definition/RemoteSetup";

const CONNECTION: RemoteConnectionRecord = {
  id: "remote-b",
  name: "beta",
  host: "beta.example",
  port: 22,
  username: "pages",
  authMethod: "password",
  departmentId: "department-remote",
  hostKey: null,
  allowedRoots: ["/srv", "/home/pages"],
  secrets: { password: "cipher-password", privateKey: null, passphrase: null },
  lastCheck: null,
  revision: 1,
};

const FINDING: InstallFinding = {
  binding: {
    host: "beta.example",
    port: 22,
    username: "pages",
    hostKeyFingerprint: "SHA256:abc",
  },
  observedAt: "2026-03-01 08:00:00",
  observation: {
    isUbuntu: true,
    architecture: "x86_64",
    serviceManager: null,
    canQueryService: false,
    isRunnerInstalled: false,
    runnerVersion: null,
    isServiceInstalled: false,
    isServiceEnabled: false,
    isServiceActive: false,
    tools: [],
  },
};

const WORKSPACE: RemoteWorkspaceRecord = {
  id: "remote-workspace-b",
  name: "Entfernt b",
  connectionId: "remote-b",
  path: "/srv/remote/b",
  projectId: PROJECT,
  registeredBy: OWNER,
  check: null,
  revision: 1,
};

function connections({
  database,
}: RepositoryWorld): RemoteConnectionRepository {
  return new RemoteConnectionRepository(database);
}

function findings({
  database,
}: RepositoryWorld): RemoteInstallFindingRepository {
  return new RemoteInstallFindingRepository(database);
}

function workspaces({ database }: RepositoryWorld): RemoteWorkspaceRepository {
  return new RemoteWorkspaceRepository(database);
}

/** SSH connections and their latest test. */
export const REMOTE_CONNECTION_FLOW: RepositoryFlow = {
  title: "remote connections",
  steps: [
    call("RemoteConnectionRepository.list", async (world) =>
      (await connections(world).list()).filter((entry) =>
        entry.id.startsWith("remote-"),
      ),
    ),
    call("RemoteConnectionRepository.find", (world) =>
      connections(world).find("remote-b"),
    ),
    call("RemoteConnectionRepository.create", (world) =>
      connections(world).create(CONNECTION, OWNER),
    ),
    call("RemoteConnectionRepository.create", (world) =>
      connections(world).create(
        {
          ...CONNECTION,
          id: "remote-a",
          name: "Alpha",
          authMethod: "key_passphrase",
          hostKey: {
            algorithm: "ssh-ed25519",
            key: "AAAA",
            fingerprint: "SHA256:abc",
          },
          allowedRoots: [],
          secrets: {
            password: null,
            privateKey: "cipher-key",
            passphrase: "cipher-phrase",
          },
        },
        OWNER,
      ),
    ),
    refused("RemoteConnectionRepository.create", (world) =>
      connections(world).create(
        { ...CONNECTION, id: "remote-c", name: "BETA" },
        OWNER,
      ),
    ),
    call("RemoteConnectionRepository.create", (world) =>
      connections(world).create(
        { ...CONNECTION, id: "remote-umlaut", name: "Änderung" },
        OWNER,
      ),
    ),
    refused("RemoteConnectionRepository.create", (world) =>
      connections(world).create(
        { ...CONNECTION, id: "remote-umlaut-2", name: "änderung" },
        OWNER,
      ),
    ),
    refused("RemoteConnectionRepository.create", (world) =>
      connections(world).create({ ...CONNECTION, name: "Andere" }, OWNER),
    ),
    reversedInPostgres("remote_connections"),
    call("RemoteConnectionRepository.list", async (world) =>
      (await connections(world).list()).filter((entry) =>
        entry.id.startsWith("remote-"),
      ),
    ),
    call("RemoteConnectionRepository.find", (world) =>
      connections(world).find("remote-a"),
    ),
    call("RemoteConnectionRepository.workspaceCounts", (world) =>
      connections(world).workspaceCounts(),
    ),
    call("RemoteConnectionRepository.saveCheck", (world) =>
      connections(world).saveCheck("remote-b", 1, {
        checkedAt: "2026-03-01 09:00:00",
        stage: "authentication",
        code: "host_unknown",
      }),
    ),
    call("RemoteConnectionRepository.saveCheck", (world) =>
      connections(world).saveCheck("remote-b", 9, {
        checkedAt: "2030-01-01 09:00:00",
        stage: null,
        code: null,
      }),
    ),
    call("RemoteConnectionRepository.find", (world) =>
      connections(world).find("remote-b"),
    ),
    prepare(`
      INSERT INTO pages_runners (connection_id, runner_id, token_hash, connection_revision, state_json)
      VALUES ('remote-b', 'runner-remote', 'token', 1, '{}');
    `),
    call("RemoteInstallFindingRepository.save", (world) =>
      findings(world).save("remote-b", FINDING),
    ),
    call("RemoteConnectionRepository.update", (world) =>
      connections(world).update(
        { ...CONNECTION, name: "Beta neu" },
        "user-manager",
      ),
    ),
    stored(`
      SELECT connection_revision
      FROM pages_runners
      WHERE connection_id = 'remote-b';
    `),
    call("RemoteInstallFindingRepository.find", (world) =>
      findings(world).find("remote-b"),
    ),
    refused("RemoteConnectionRepository.update", (world) =>
      connections(world).update({ ...CONNECTION, name: "Veraltet" }, OWNER),
    ),
    refused("RemoteConnectionRepository.update", (world) =>
      connections(world).update({ ...CONNECTION, id: "remote-none" }, OWNER),
    ),
    refused("RemoteConnectionRepository.update", (world) =>
      connections(world).update(
        { ...CONNECTION, name: "alpha", revision: 2 },
        OWNER,
      ),
    ),
    call("RemoteConnectionRepository.update", (world) =>
      connections(world).update(
        {
          ...CONNECTION,
          name: "Beta neu",
          host: "anders.example",
          revision: 2,
        },
        OWNER,
      ),
    ),
    stored(`
      SELECT connection_revision
      FROM pages_runners
      WHERE connection_id = 'remote-b';
    `),
    call("RemoteInstallFindingRepository.find", (world) =>
      findings(world).find("remote-b"),
    ),
    stored(
      "SELECT updated_by, revision, checked_at, check_stage, check_code FROM remote_connections WHERE id = 'remote-b';",
    ),
    call("parseRemoteRoots", async () => parseRemoteRoots('["/a", "/b"]', "c")),
    refused("parseRemoteRoots", async () => parseRemoteRoots("[1]", "c")),
    prepare("DELETE FROM pages_runners WHERE connection_id = 'remote-b';"),
  ],
};

/** What a probe found on a machine. */
export const REMOTE_FINDING_FLOW: RepositoryFlow = {
  title: "remote findings",
  steps: [
    call("RemoteInstallFindingRepository.find", (world) =>
      findings(world).find("remote-finding"),
    ),
    call("RemoteInstallFindingRepository.save", (world) =>
      findings(world).save("remote-finding", FINDING),
    ),
    call("RemoteInstallFindingRepository.save", (world) =>
      findings(world).save("remote-finding", {
        ...FINDING,
        observedAt: "2026-03-02 08:00:00",
        observation: { ...FINDING.observation, isUbuntu: null },
      }),
    ),
    call("RemoteInstallFindingRepository.find", (world) =>
      findings(world).find("remote-finding"),
    ),
    refused("RemoteInstallFindingRepository.save", (world) =>
      findings(world).save("remote-finding-2", {
        ...FINDING,
        binding: { ...FINDING.binding, host: MISSING_TEXT },
      }),
    ),
    prepare(
      "UPDATE remote_install_findings SET observation_json = '{}' WHERE connection_id = 'remote-finding';",
    ),
    refused("RemoteInstallFindingRepository.find", (world) =>
      findings(world).find("remote-finding"),
    ),
    prepare(
      "DELETE FROM remote_install_findings WHERE connection_id = 'remote-finding';",
    ),
  ],
};

/** Directory profiles on a machine, and what removing one does. */
export const REMOTE_WORKSPACE_FLOW: RepositoryFlow = {
  title: "remote workspaces",
  steps: [
    call("RemoteWorkspaceRepository.list", async (world) =>
      (await workspaces(world).list()).filter((entry) =>
        entry.id.startsWith("remote-workspace-"),
      ),
    ),
    call("RemoteWorkspaceRepository.find", (world) =>
      workspaces(world).find("remote-workspace-b"),
    ),
    call("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save(WORKSPACE, true),
    ),
    call("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        {
          ...WORKSPACE,
          id: "remote-workspace-a",
          name: "ENTFERNT A",
          path: "/srv/remote/a",
          check: {
            checkedAt: "2026-03-01 08:00:00",
            issue: "path_missing",
            roots: ["/srv"],
          },
        },
        true,
      ),
    ),
    call("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        {
          ...WORKSPACE,
          id: "remote-workspace-other-machine",
          name: "Andere Maschine",
          connectionId: "remote-a",
        },
        true,
      ),
    ),
    refused("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save(WORKSPACE, true),
    ),
    refused("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        { ...WORKSPACE, id: "remote-workspace-none" },
        false,
      ),
    ),
    refused("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save({ ...WORKSPACE, revision: 5 }, false),
    ),
    refused("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        { ...WORKSPACE, id: "remote-workspace-c", path: "/srv/remote/b/kind" },
        true,
      ),
    ),
    refused("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        { ...WORKSPACE, id: "remote-workspace-c", path: "/srv/remote" },
        true,
      ),
    ),
    refused("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        { ...WORKSPACE, id: "remote-workspace-c", path: "/srv/remote/b" },
        true,
      ),
    ),
    call("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        {
          ...WORKSPACE,
          id: "remote-workspace-root",
          name: "Wurzel",
          connectionId: "remote-root",
          path: "/",
        },
        true,
      ),
    ),
    refused("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save(
        {
          ...WORKSPACE,
          id: "remote-workspace-root-child",
          connectionId: "remote-root",
          path: "/irgendwo",
        },
        true,
      ),
    ),
    reversedInPostgres("remote_workspaces"),
    call("RemoteWorkspaceRepository.list", async (world) =>
      (await workspaces(world).list()).filter((entry) =>
        entry.id.startsWith("remote-workspace-"),
      ),
    ),
    call("RemoteConnectionRepository.workspaceCounts", (world) =>
      connections(world).workspaceCounts(),
    ),
    call("RemoteWorkspaceRepository.saveCheck", (world) =>
      workspaces(world).saveCheck("remote-workspace-b", 1, {
        checkedAt: "2026-03-01 09:00:00",
        issue: null,
        roots: null,
      }),
    ),
    call("RemoteWorkspaceRepository.saveCheck", (world) =>
      workspaces(world).saveCheck("remote-workspace-b", 7, {
        checkedAt: "2030-01-01 09:00:00",
        issue: null,
        roots: [],
      }),
    ),
    call("RemoteWorkspaceRepository.find", (world) =>
      workspaces(world).find("remote-workspace-b"),
    ),
    call("RemoteWorkspaceRepository.save", (world) =>
      workspaces(world).save({ ...WORKSPACE, name: "Entfernt neu" }, false),
    ),
    call("RemoteWorkspaceRepository.find", (world) =>
      workspaces(world).find("remote-workspace-b"),
    ),
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(
        planFixture("plan-remote", {
          name: "Entfernt",
          executionTarget: {
            kind: "remote",
            workspaceId: "remote-workspace-b",
          },
          workspaceId: "remote-workspace-b",
        }),
        true,
      ),
    ),
    call("RemoteWorkspaceRepository.usages", (world) =>
      workspaces(world).usages("remote-workspace-b"),
    ),
    refused("RemoteConnectionRepository.remove", (world) =>
      connections(world).remove("remote-b", 3),
    ),
    refused("RemoteConnectionRepository.remove", (world) =>
      connections(world).remove("remote-none", 1),
    ),
    refused("RemoteConnectionRepository.remove", (world) =>
      connections(world).remove("remote-b", 99),
    ),
    refused("RemoteWorkspaceRepository.remove", (world) =>
      workspaces(world).remove("remote-workspace-none", 1),
    ),
    refused("RemoteWorkspaceRepository.remove", (world) =>
      workspaces(world).remove("remote-workspace-b", 99),
    ),
    call("RemoteWorkspaceRepository.remove", (world) =>
      workspaces(world).remove("remote-workspace-b", 2, OWNER),
    ),
    call("RemoteWorkspaceRepository.remove", (world) =>
      workspaces(world).remove("remote-workspace-a", 1),
    ),
    call("AgentPlanRepository.find", ({ database }) =>
      new AgentPlanRepository(database).find("plan-remote"),
    ),
    prepare(
      "UPDATE remote_workspaces SET checked_at = '2026-03-01 08:00:00', check_roots_json = 'kein JSON' WHERE id = 'remote-workspace-root';",
    ),
    refused("RemoteWorkspaceRepository.list", (world) =>
      workspaces(world).list(),
    ),
    prepare(
      "DELETE FROM remote_workspaces WHERE id LIKE 'remote-workspace-%';",
    ),
    call("RemoteConnectionRepository.remove", (world) =>
      connections(world).remove("remote-b", 3),
    ),
    call("RemoteConnectionRepository.remove", (world) =>
      connections(world).remove("remote-a", 1),
    ),
    call("RemoteConnectionRepository.remove", (world) =>
      connections(world).remove("remote-umlaut", 1),
    ),
    stored("SELECT id FROM remote_connections WHERE id LIKE 'remote-%';"),
  ],
};
