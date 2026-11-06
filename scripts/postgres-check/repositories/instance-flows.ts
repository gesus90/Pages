import { Client } from "pg";

import {
  LIVE_CHANGE_CHANNEL,
  LiveChangeNotificationRepository,
} from "@/backend/database/repositories/LiveChangeNotificationRepository";

import { call, MISSING_TEXT, prepare, refused, stored } from "./world";

import type { RepositoryFlow } from "./world";

/**
 * Sends one live notice and returns what a listening session of the API receives.
 *
 * @param databaseUrl - The disposable check database.
 * @param repository - The repository under check.
 * @param payload - The notice.
 * @returns The payload as it arrived on the channel.
 */
async function notifiedPayload(
  databaseUrl: string,
  repository: LiveChangeNotificationRepository,
  payload: string,
): Promise<string | undefined> {
  const listener = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  await listener.connect();
  try {
    await listener.query(`LISTEN ${LIVE_CHANGE_CHANNEL};`);
    const received = new Promise<string | undefined>((resolve) => {
      listener.on("notification", (message) => resolve(message.payload));
    });
    await repository.notify(payload);
    return await received;
  } finally {
    await listener.end();
  }
}

const CONNECTION = {
  id: "connection-b",
  name: "Beta Schlüssel",
  provider: "anthropic",
  secretEncrypted: "cipher-1",
  testModel: null,
  actorId: "user-admin",
} as const;

const CONNECTION_CHANGE = {
  name: "Beta Schlüssel",
  secretEncrypted: null,
  testModel: "model-a",
  reasoningEffort: "low",
  clearModel: false,
  actorId: "user-manager",
} as const;

/** Instance-wide settings, the company logo and the administration log. */
export const INSTANCE_FLOW: RepositoryFlow = {
  title: "instance",
  steps: [
    call("InstanceSettingsRepository.find", ({ instance }) => instance.find()),
    call("InstanceSettingsRepository.save", ({ instance }) =>
      instance.save({
        companyName: "Müller & Söhne",
        primaryAdministratorId: "user-admin",
      }),
    ),
    call("InstanceSettingsRepository.save", ({ instance }) =>
      instance.save({
        companyName: "Müller & Töchter",
        primaryAdministratorId: "user-admin",
      }),
    ),
    call("InstanceSettingsRepository.find", ({ instance }) => instance.find()),
    call("InstanceSettingsRepository.updateCompanyName", ({ instance }) =>
      instance.updateCompanyName("Neu GmbH"),
    ),
    call("InstanceSettingsRepository.find", ({ instance }) => instance.find()),
    refused("InstanceSettingsRepository.updateCompanyName", ({ instance }) =>
      instance.updateCompanyName(MISSING_TEXT),
    ),
    call("InstanceSettingsRepository.findLogo", ({ instance }) =>
      instance.findLogo(),
    ),
    call("InstanceSettingsRepository.findLogoVersion", ({ instance }) =>
      instance.findLogoVersion(),
    ),
    call("InstanceSettingsRepository.saveLogo", ({ instance }) =>
      instance.saveLogo({
        mimeType: "image/png",
        data: Buffer.from([1, 2, 3]),
      }),
    ),
    call("InstanceSettingsRepository.saveLogo", ({ instance }) =>
      instance.saveLogo({
        mimeType: "image/webp",
        data: Buffer.from([0, 255]),
      }),
    ),
    call("InstanceSettingsRepository.findLogo", ({ instance }) =>
      instance.findLogo(),
    ),
    call("InstanceSettingsRepository.findLogoVersion", ({ instance }) =>
      instance.findLogoVersion(),
    ),
    call("InstanceSettingsRepository.deleteLogo", ({ instance }) =>
      instance.deleteLogo(),
    ),
    call("InstanceSettingsRepository.findLogo", ({ instance }) =>
      instance.findLogo(),
    ),
    call("AdministrationActivityRepository.insert", ({ activity }) =>
      activity.insert({
        actorId: "user-admin",
        operation: "admin.roles.save",
        source: "mcp",
        result: {
          id: "role-lead",
          targetType: "role",
          changed: true,
          affectedUserIds: ["user-manager"],
        },
      }),
    ),
    call("AdministrationActivityRepository.insert", ({ activity }) =>
      activity.insert({
        actorId: "user-manager",
        operation: "admin.groups.save",
        source: "ai",
        result: {
          id: "group-b",
          targetType: "group",
          changed: false,
          affectedUserIds: [],
        },
      }),
    ),
    prepare(`
      UPDATE administration_activity
      SET created_at = CASE operation
          WHEN 'admin.roles.save' THEN '2026-01-01 00:00:00'
          ELSE '2026-02-01 00:00:00'
      END;
    `),
    call("AdministrationActivityRepository.findAll", ({ activity }) =>
      activity.findAll(),
    ),
    refused("AdministrationActivityRepository.insert", ({ activity }) =>
      activity.insert({
        actorId: "user-admin",
        operation: MISSING_TEXT,
        source: "mcp",
        result: {
          id: "x",
          targetType: "role",
          changed: true,
          affectedUserIds: [],
        },
      }),
    ),
    call(
      "LiveChangeNotificationRepository.notify",
      ({ database, databaseUrl }) =>
        notifiedPayload(
          databaseUrl,
          new LiveChangeNotificationRepository(database),
          '{"type":"wiki.page.updated","id":"page-1"}',
        ),
    ),
  ],
};

/** Connections of agents; what lies behind them belongs to the agent repositories. */
export const CONNECTION_FLOW: RepositoryFlow = {
  title: "agent connections",
  steps: [
    call("AgentConnectionRepository.count", ({ connections }) =>
      connections.count(),
    ),
    call("AgentConnectionRepository.insert", ({ connections }) =>
      connections.insert(CONNECTION),
    ),
    call("AgentConnectionRepository.insert", ({ connections }) =>
      connections.insert({
        id: "connection-a",
        name: "älter",
        provider: "claude_code",
        secretEncrypted: null,
        testModel: null,
        actorId: "user-admin",
      }),
    ),
    call("AgentConnectionRepository.insert", ({ connections }) =>
      connections.insert({
        ...CONNECTION,
        id: "connection-c",
        name: "Alpha",
        zaiAccountType: "coding-plan",
      }),
    ),
    refused("AgentConnectionRepository.insert", ({ connections }) =>
      connections.insert({ ...CONNECTION, id: "other", name: "ALPHA" }),
    ),
    refused("AgentConnectionRepository.insert", ({ connections }) =>
      connections.insert({
        ...CONNECTION,
        id: "other",
        name: "Ohne Schlüssel",
        secretEncrypted: null,
      }),
    ),
    call("AgentConnectionRepository.list", ({ connections }) =>
      connections.list(),
    ),
    call("AgentConnectionRepository.find", ({ connections }) =>
      connections.find("connection-b"),
    ),
    call("AgentConnectionRepository.find", ({ connections }) =>
      connections.find("nothing"),
    ),
    call("AgentConnectionRepository.count", ({ connections }) =>
      connections.count(),
    ),
    call("AgentConnectionRepository.findSecretEncrypted", ({ connections }) =>
      connections.findSecretEncrypted("connection-b"),
    ),
    call("AgentConnectionRepository.findSecretEncrypted", ({ connections }) =>
      connections.findSecretEncrypted("connection-a"),
    ),
    call("AgentConnectionRepository.setActive", ({ connections }) =>
      connections.setActive("connection-b", false, "user-manager"),
    ),
    call("AgentConnectionRepository.find", ({ connections }) =>
      connections.find("connection-b"),
    ),
    call("AgentConnectionRepository.setActive", ({ connections }) =>
      connections.setActive("connection-b", true, "user-manager"),
    ),
    call("AgentConnectionRepository.find", ({ connections }) =>
      connections.find("connection-b"),
    ),
    call("AgentConnectionRepository.update", ({ connections }) =>
      connections.update("connection-b", CONNECTION_CHANGE),
    ),
    call("AgentConnectionRepository.update", ({ connections }) =>
      connections.update("connection-b", {
        ...CONNECTION_CHANGE,
        secretEncrypted: "cipher-2",
        testModel: null,
        reasoningEffort: null,
        clearModel: true,
        zaiAccountType: "api",
        scope: { mode: "global", targets: [] },
      }),
    ),
    call("AgentConnectionRepository.update", ({ connections }) =>
      connections.update("connection-c", {
        ...CONNECTION_CHANGE,
        name: "Alpha",
        clearAccess: true,
      }),
    ),
    call("AgentConnectionRepository.update", ({ connections }) =>
      connections.update("connection-c", {
        ...CONNECTION_CHANGE,
        name: "Alpha",
        clearModel: true,
      }),
    ),
    call("AgentConnectionRepository.find", ({ connections }) =>
      connections.find("connection-b"),
    ),
    call("AgentConnectionRepository.findSecretEncrypted", ({ connections }) =>
      connections.findSecretEncrypted("connection-b"),
    ),
    call("AgentConnectionRepository.assignDefaultModel", ({ connections }) =>
      connections.assignDefaultModel("connection-b", "model-b"),
    ),
    call("AgentConnectionRepository.assignDefaultModel", ({ connections }) =>
      connections.assignDefaultModel("connection-b", "model-c"),
    ),
    call("AgentConnectionRepository.find", ({ connections }) =>
      connections.find("connection-b"),
    ),
    call("AgentConnectionRepository.setCliAccount", ({ connections }) =>
      connections.setCliAccount(
        "connection-a",
        { loggedInAt: "2026-01-01 00:00:00", label: "konto@example.test" },
        "user-manager",
      ),
    ),
    call("AgentConnectionRepository.find", ({ connections }) =>
      connections.find("connection-a"),
    ),
    prepare(`
      INSERT INTO agent_execution_profiles (id, name, connection_id, model, owner_id)
      VALUES
          ('profile-b', 'Zweiter', 'connection-b', 'model-a', NULL),
          ('profile-a', 'erster', 'connection-b', 'model-a', NULL),
          ('profile-private', 'Privat', 'connection-b', 'model-a', 'user-manager');
    `),
    call("AgentConnectionRepository.usages", ({ connections }) =>
      connections.usages("connection-b"),
    ),
    prepare("DELETE FROM agent_execution_profiles;"),
    call("AgentConnectionRepository.catalogs", ({ connections }) =>
      Promise.resolve(connections.catalogs() !== null),
    ),
    call("AgentConnectionRepository.profiles", ({ connections }) =>
      Promise.resolve(connections.profiles() !== null),
    ),
    call("AgentConnectionRepository.checks", ({ connections }) =>
      Promise.resolve(connections.checks() !== null),
    ),
    call("AgentConnectionRepository.scopes", ({ connections }) =>
      Promise.resolve(connections.scopes() !== null),
    ),
    call("AgentConnectionRepository.remove", ({ connections }) =>
      connections.remove("connection-c"),
    ),
    stored("SELECT id FROM agent_connections ORDER BY id;"),
  ],
};
