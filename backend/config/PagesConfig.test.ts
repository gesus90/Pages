import { homedir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ConfigError,
  DEFAULT_CONFIG,
  MissingDatabaseUrlError,
  isValidPort,
  readPagesConfig,
  resolveAgentsDirectory,
  resolveDefaultConfigPath,
  resolveDefaultDataDirectory,
  resolveDefaultDatabasePath,
  writePagesConfig,
} from "./PagesConfig";

import type { TomlTable } from "smol-toml";

const source = "/instance/config.toml";
const profiles = [
  { id: "python", name: "Python", path: "/usr/bin/python" },
  { id: "node", name: "Node", path: "/usr/bin/node" },
  { id: "shell", name: "Shell", path: "/bin/sh" },
];

it("resolves instance paths and validates port boundaries", () => {
  expect(resolveDefaultConfigPath()).toBe(
    path.join(homedir(), ".pages", "config.toml"),
  );
  expect(resolveDefaultDataDirectory(source)).toBe("/instance/data");
  expect(resolveDefaultDatabasePath(source)).toBe(
    "/instance/data/pages.duckdb",
  );
  expect(resolveAgentsDirectory(source)).toBe("/instance/Agents");
  for (const port of [1, 3000, 65535]) expect(isValidPort(port)).toBe(true);
  for (const port of [0, 65536, 1.5, "3000", null, Number.NaN])
    expect(isValidPort(port)).toBe(false);
});

it("reads pending setup defaults and a completed PostgreSQL setup", () => {
  expect(readPagesConfig({}, source)).toEqual(DEFAULT_CONFIG);
  expect(
    readPagesConfig(
      {
        firstRun: true,
        databasePath: "/instance/../instance/data.db",
        port: 3001,
      },
      source,
    ),
  ).toEqual({ firstRun: true, databasePath: "/instance/data.db", port: 3001 });
  expect(
    readPagesConfig(
      {
        firstRun: false,
        databasePath: "/instance/data.db",
        databaseUrl: "postgresql://user:secret@localhost/pages",
      },
      source,
    ),
  ).toEqual({
    firstRun: false,
    databasePath: "/instance/data.db",
    databaseUrl: "postgresql://user:secret@localhost/pages",
    port: 3000,
  });
  expect(() =>
    readPagesConfig(
      { firstRun: false, databasePath: "/instance/data.db" },
      source,
    ),
  ).toThrow(MissingDatabaseUrlError);
  expect(() =>
    readPagesConfig(
      { firstRun: false, databaseUrl: "postgres://localhost/pages" },
      source,
    ),
  ).toThrow('"databasePath" is missing');
});

describe("rejects invalid setup configuration", () => {
  it.each<{ table: TomlTable; detail: string }>([
    {
      table: { firstRun: "false" },
      detail: '"firstRun" must be true or false',
    },
    { table: { port: 0 }, detail: '"port" must be a whole number' },
    {
      table: { databasePath: "relative" },
      detail: '"databasePath" must be an absolute',
    },
    {
      table: { databaseUrl: "postgres://localhost/pages" },
      detail: '"databaseUrl" needs a finished setup',
    },
    {
      table: {
        firstRun: false,
        databasePath: "/db",
        databaseUrl: "https://example.test",
      },
      detail: '"databaseUrl" must be a postgres',
    },
    {
      table: {
        firstRun: false,
        databasePath: "/db",
        databaseUrl: "postgres://user:%zz@localhost/db",
      },
      detail: '"databaseUrl" must be a postgres',
    },
    {
      table: { firstRun: false, databasePath: "/db", databaseUrl: 3 },
      detail: '"databaseUrl" must be a postgres',
    },
    {
      table: { integrationsMode: "invalid" },
      detail: '"integrationsMode" must be',
    },
    { table: { runsMode: "invalid" }, detail: '"runsMode" must be' },
    { table: { logRetentionDays: 366 }, detail: '"logRetentionDays" must be' },
    { table: { storageWarningBytes: 0 }, detail: "storageWarningBytes" },
    { table: { trustedProxies: ["10.0.0.0/0"] }, detail: "trustedProxies" },
    { table: { trustedProxies: [4] }, detail: "trustedProxies" },
    {
      table: { interpreterProfiles: [] },
      detail: "Invalid interpreter profiles",
    },
    {
      table: { picaBrowserLocalOrigins: ["https://example.test/path"] },
      detail: "picaBrowserLocalOrigins",
    },
    {
      table: { picaBrowserLocalOrigins: ["broken"] },
      detail: "picaBrowserLocalOrigins",
    },
    {
      table: { picaBrowserLocalOrigins: [42] },
      detail: "picaBrowserLocalOrigins",
    },
    { table: { picaMobilePort: 0 }, detail: "picaMobilePort" },
    {
      table: { picaMobileFcmServiceAccountFile: "relative" },
      detail: "picaMobileFcmServiceAccountFile",
    },
    {
      table: { picaMobileReplayTtlSeconds: 59 },
      detail: "picaMobileReplayTtlSeconds",
    },
    { table: { pagesCoreSecret: "short" }, detail: "pagesCoreSecret" },
    {
      table: { pagesCoreSecret: "x".repeat(31) + " " },
      detail: "pagesCoreSecret",
    },
    {
      table: { picaMobileRelayPort: 3000, pagesCoreSecret: "x".repeat(32) },
      detail: "picaMobileRelayPort",
    },
    {
      table: {
        picaMobileRelayPort: 3002,
        picaMobilePort: 3002,
        pagesCoreSecret: "x".repeat(32),
      },
      detail: "picaMobileRelayPort",
    },
    { table: { picaMobileRelayPort: 3002 }, detail: "needs" },
    { table: { agentGitBridges: "invalid" }, detail: "agentGitBridges" },
    { table: { speechRecognition: [] }, detail: "speechRecognition" },
    { table: { chatCalls: [] }, detail: "chatCalls" },
  ])("rejects $table", ({ table, detail }) => {
    expect(() => readPagesConfig(table, source)).toThrow(ConfigError);
    expect(() => readPagesConfig(table, source)).toThrow(detail);
  });
});

it("reads and writes supported optional settings without mutating the source", () => {
  const input: TomlTable = {
    firstRun: false,
    databasePath: "/data/db",
    databaseUrl: "postgres://localhost/pages",
    port: 3001,
    integrationsMode: "separate",
    runsMode: "server",
    listenAddress: "127.0.0.1",
    publicUrl: "https://pages.example",
    chatPlayerOrigin: "https://player.example",
    picaMobilePort: 3002,
    picaMobileRelayPort: 3003,
    pagesCoreSecret: "x".repeat(32),
    picaMobileFcmServiceAccountFile: "/keys/../keys/service.json",
    picaMobileReplayTtlSeconds: 900,
    interpreterProfiles: profiles,
    logRetentionDays: 10,
    storageWarningBytes: 4096,
    storageRetentionDays: 15,
    trustedProxies: ["127.0.0.1", "10.0.0.0/8"],
    picaBrowserLocalOrigins: ["http://127.0.0.1:3000"],
    maxConcurrentAcpSessions: 3,
    memoryAwareScheduling: false,
    minimumAvailableMemory: 256,
    queueDiscipline: "fifo",
    speechRecognition: { model: "whisper", maximumRecordingSeconds: 120 },
    chatCalls: {
      stunUrls: ["stun:example.test"],
      turnUrls: ["turn:example.test"],
      turnSecretFile: "/keys/turn",
      relayOnly: true,
    },
  };
  const config = readPagesConfig(input, source);
  expect(config).toMatchObject({
    firstRun: false,
    picaMobileFcmServiceAccountFile: "/keys/service.json",
    interpreterProfiles: profiles,
    trustedProxies: ["127.0.0.1", "10.0.0.0/8"],
  });
  const prior: TomlTable = {
    other: "kept",
    mcpHttp: { publicUrl: "https://old.example" },
  };
  const written = writePagesConfig(prior, config);
  expect(written).toMatchObject({
    ...input,
    other: "kept",
    picaMobileFcmServiceAccountFile: "/keys/service.json",
  });
  expect(written).not.toHaveProperty("mcpHttp");
  expect(prior).toEqual({
    other: "kept",
    mcpHttp: { publicUrl: "https://old.example" },
  });
  expect(readPagesConfig(written, source)).toEqual(config);
  expect(written.trustedProxies).not.toBe(config.trustedProxies);
  expect(written.interpreterProfiles).not.toBe(config.interpreterProfiles);
});

it("removes obsolete database and mobile keys when returning to setup", () => {
  const previous: TomlTable = {
    firstRun: false,
    databasePath: "/data/db",
    databaseUrl: "postgres://localhost/pages",
    picaMobilePort: 3002,
    unrelated: true,
  };
  expect(writePagesConfig(previous, DEFAULT_CONFIG)).toEqual({
    firstRun: true,
    port: 3000,
    unrelated: true,
  });
  expect(previous).toHaveProperty("databaseUrl");
});

it("keeps secrets out of invalid database URL and core secret errors", () => {
  const secret = "confidential secret";
  const tables: TomlTable[] = [
    {
      firstRun: false,
      databasePath: "/db",
      databaseUrl: `https://user:${secret}@example.test`,
    },
    { pagesCoreSecret: secret },
  ];
  for (const table of tables) {
    try {
      readPagesConfig(table, source);
      throw new Error("Expected configuration failure");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).not.toContain(secret);
    }
  }
});

it("preserves a standalone core secret and reads configured Git bridges", () => {
  const bridge = {
    projectId: "12345678-1234-1234-1234-123456789abc",
    planId: "abcdefab-1234-1234-1234-123456789abc",
    stepId: "build",
    repository: "owner/repo",
    sshAlias: "github",
    pushRefs: ["refs/heads/main"],
  };
  const secret = "x".repeat(32);
  const config = readPagesConfig(
    { pagesCoreSecret: secret, agentGitBridges: [bridge] },
    source,
  );
  expect(config).toMatchObject({
    pagesCoreSecret: secret,
    agentGitBridges: [bridge],
  });
  expect(config).not.toHaveProperty("picaMobileRelayPort");
});

it("writes call settings without adding unspecified server lists", () => {
  const config = readPagesConfig({ chatCalls: { relayOnly: false } }, source);
  const written = writePagesConfig({}, config);
  expect(written.chatCalls).toEqual({ relayOnly: false });
  expect(readPagesConfig(written, source)).toEqual(config);
});
