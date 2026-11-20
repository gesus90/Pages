import { describe, expect, it } from "vitest";

import type { TomlTable } from "smol-toml";

import {
  readAcpResourceLimitSource,
  readAcpResourceOptions,
} from "./AcpResourceConfig";
import { readAcpResourceSettings } from "./AcpResourceSettings";
import { readAgentGitBridges } from "./AgentGitBridgeConfig";
import { readPublicAddressConfig } from "./PublicAddressConfig";
import {
  readSpeechRecognitionConfig,
  voiceMaximumDurationMs,
} from "./SpeechRecognitionConfig";
import { readStorageSettings } from "./StorageConfig";
import { parseTrustedProxyEntry } from "./TrustedProxies";

describe("resource configuration", () => {
  it("validates settings and applies environment overrides", () => {
    expect(readAcpResourceSettings({})).toEqual({});
    const settings = readAcpResourceSettings({
      maxConcurrentAcpSessions: 3,
      memoryAwareScheduling: false,
      minimumAvailableMemory: 0,
      queueDiscipline: "fifo",
    });
    expect(
      readAcpResourceOptions(settings, {
        PAGES_MAX_CONCURRENT_ACP_SESSIONS: "4",
        PAGES_ACP_MEMORY_AWARE: "1",
        PAGES_ACP_MIN_AVAILABLE_MEMORY_MB: "512",
      }),
    ).toEqual({
      maxConcurrentAcpSessions: 4,
      memoryAwareScheduling: true,
      minimumAvailableMemory: 512,
      queueDiscipline: "fifo",
    });
    expect(readAcpResourceLimitSource({}, {})).toBe("default");
    expect(readAcpResourceLimitSource(settings, {})).toBe("config");
    expect(
      readAcpResourceLimitSource(settings, {
        PAGES_MAX_CONCURRENT_ACP_SESSIONS: "4",
      }),
    ).toBe("environment");
  });

  it.each<TomlTable>([
    { maxConcurrentAcpSessions: "3" },
    { memoryAwareScheduling: "true" },
    { minimumAvailableMemory: "0" },
    { queueDiscipline: "lifo" },
    { minimumAvailableMemory: -1 },
  ])("rejects invalid resource settings %o", (settings) => {
    expect(() => readAcpResourceSettings(settings)).toThrow();
  });

  it.each([
    { PAGES_MAX_CONCURRENT_ACP_SESSIONS: "1000" },
    { PAGES_ACP_MEMORY_AWARE: "yes" },
    { PAGES_ACP_MIN_AVAILABLE_MEMORY_MB: "1.5" },
  ])("rejects invalid environment overrides %o", (environment) => {
    expect(() => readAcpResourceOptions({}, environment)).toThrow();
  });

  it("rejects an unsupported queue discipline", () => {
    const settings = { queueDiscipline: "fifo" as const };
    Object.assign(settings, { queueDiscipline: "lifo" });
    expect(() => readAcpResourceOptions(settings, {})).toThrow(
      "Invalid ACP resource setting: queueDiscipline",
    );
  });
});

describe("address and storage configuration", () => {
  it("accepts explicit and legacy origins and loopback HTTP", () => {
    expect(
      readPublicAddressConfig({
        listenAddress: "::1",
        publicUrl: "http://localhost:3000",
        chatPlayerOrigin: "https://play.example",
      }),
    ).toEqual({
      listenAddress: "::1",
      publicUrl: "http://localhost:3000",
      chatPlayerOrigin: "https://play.example",
    });
    expect(
      readPublicAddressConfig({
        mcpHttp: { publicUrl: "https://legacy.example" },
      }),
    ).toEqual({ publicUrl: "https://legacy.example" });
    expect(readPublicAddressConfig({})).toEqual({});
  });

  it.each([
    "http://example.com",
    "https://user@example.com",
    "https://example.com/path",
    "invalid",
  ])("rejects unsafe origin %s", (publicUrl) => {
    expect(() => readPublicAddressConfig({ publicUrl })).toThrow();
  });

  it("validates storage limits", () => {
    expect(readStorageSettings({})).toEqual({});
    expect(
      readStorageSettings({
        storageWarningBytes: 1,
        storageRetentionDays: 3650,
      }),
    ).toEqual({ storageWarningBytes: 1, storageRetentionDays: 3650 });
    expect(() => readStorageSettings({ storageWarningBytes: 0 })).toThrow();
    expect(() => readStorageSettings({ storageRetentionDays: 3651 })).toThrow();
  });

  it.each([
    "localhost",
    "10.0.0.1/0",
    "10.0.0.1/33",
    "::1/129",
    "::1%eth0",
    "10.0.0.1/1/2",
    "10.0.0.1/x",
  ])("rejects untrusted proxy entry %s", (entry) => {
    expect(parseTrustedProxyEntry(entry)).toBeNull();
  });

  it("parses individual and network proxy addresses", () => {
    expect(parseTrustedProxyEntry("127.0.0.1")).toEqual({
      address: "127.0.0.1",
      family: "ipv4",
      prefix: null,
    });
    expect(parseTrustedProxyEntry("2001:db8::/64")).toEqual({
      address: "2001:db8::",
      family: "ipv6",
      prefix: 64,
    });
  });
});

describe("speech and bridge configuration", () => {
  it("validates speech settings and duration", () => {
    expect(readSpeechRecognitionConfig({})).toEqual({});
    expect(readSpeechRecognitionConfig({ speechRecognition: {} })).toEqual({
      speechRecognition: {},
    });
    expect(
      readSpeechRecognitionConfig({
        speechRecognition: {
          model: " whisper ",
          url: "https://example.com/api",
          apiKeyFile: "/etc/pages/../key",
          maximumRecordingSeconds: 12,
        },
      }),
    ).toEqual({
      speechRecognition: {
        model: "whisper",
        url: "https://example.com/api",
        apiKeyFile: "/etc/key",
        maximumRecordingSeconds: 12,
      },
    });
    expect(voiceMaximumDurationMs(undefined)).toBe(300000);
    expect(voiceMaximumDurationMs({ maximumRecordingSeconds: 12 })).toBe(12000);
  });

  it.each<TomlTable>([
    { speechRecognition: [] },
    { speechRecognition: { model: " " } },
    { speechRecognition: { url: "not a url" } },
    { speechRecognition: { url: "ftp://example.com" } },
    {
      speechRecognition: {
        url: "https://example.com",
        maximumRecordingSeconds: 1.5,
      },
    },
    { speechRecognition: { url: "https://user@example.com" } },
    { speechRecognition: { apiKeyFile: "relative" } },
    { speechRecognition: { maximumRecordingSeconds: 0 } },
    { speechRecognition: { maximumRecordingSeconds: 3601 } },
  ])("rejects invalid speech settings %o", (document) => {
    expect(() => readSpeechRecognitionConfig(document)).toThrow();
  });

  it("validates bridge entries and rejects duplicate steps", () => {
    const bridge = {
      projectId: "12345678-1234-1234-1234-123456789abc",
      planId: "abcdefab-1234-1234-1234-123456789abc",
      stepId: "build",
      repository: "owner/repo",
      sshAlias: "github",
      pushRefs: ["refs/heads/main"],
    };
    expect(readAgentGitBridges({})).toEqual([]);
    expect(readAgentGitBridges({ agentGitBridges: [bridge] })).toEqual([
      bridge,
    ]);
    expect(() =>
      readAgentGitBridges({ agentGitBridges: [bridge, bridge] }),
    ).toThrow();
    expect(() =>
      readAgentGitBridges({
        agentGitBridges: [{ ...bridge, pushRefs: ["refs/heads/../main"] }],
      }),
    ).toThrow();
    expect(() =>
      readAgentGitBridges({
        agentGitBridges: [{ ...bridge, sshAlias: "bad alias" }],
      }),
    ).toThrow();
    expect(() => readAgentGitBridges({ agentGitBridges: "bad" })).toThrow();
    const bridgeWithoutPushRefs = {
      projectId: bridge.projectId,
      planId: bridge.planId,
      stepId: bridge.stepId,
      repository: bridge.repository,
      sshAlias: bridge.sshAlias,
    };
    expect(
      readAgentGitBridges({ agentGitBridges: [bridgeWithoutPushRefs] }),
    ).toEqual([{ ...bridge, pushRefs: [] }]);
    expect(() => readAgentGitBridges({ agentGitBridges: [[]] })).toThrow(
      '"agentGitBridges" must hold tables.',
    );
  });
});
