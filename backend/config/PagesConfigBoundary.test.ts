import { beforeEach, expect, it, vi } from "vitest";

import type * as OperatingSystem from "node:os";
import type * as AgentGitBridgeConfig from "./AgentGitBridgeConfig";
import type * as ChatCallConfig from "./ChatCallConfig";
import type * as SpeechRecognitionConfig from "./SpeechRecognitionConfig";
import type * as StorageConfig from "./StorageConfig";

const boundary = vi.hoisted(() => ({
  home: vi.fn<() => string>(),
  bridge: vi.fn(),
  speech: vi.fn(),
  calls: vi.fn(),
  storage: vi.fn(),
}));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof OperatingSystem>()),
  homedir: boundary.home,
}));
vi.mock("./AgentGitBridgeConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof AgentGitBridgeConfig>()),
  readAgentGitBridges: boundary.bridge,
}));
vi.mock("./SpeechRecognitionConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof SpeechRecognitionConfig>()),
  readSpeechRecognitionConfig: boundary.speech,
}));
vi.mock("./ChatCallConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof ChatCallConfig>()),
  readChatCallConfig: boundary.calls,
}));
vi.mock("./StorageConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof StorageConfig>()),
  readStorageSettings: boundary.storage,
}));

import {
  ConfigError,
  readPagesConfig,
  resolveDefaultConfigPath,
} from "./PagesConfig";

beforeEach(() => {
  boundary.home.mockReset().mockReturnValue("/home/example");
  boundary.bridge.mockReset().mockReturnValue([]);
  boundary.speech.mockReset().mockReturnValue({});
  boundary.calls.mockReset().mockReturnValue({});
  boundary.storage.mockReset().mockReturnValue({});
});

it("reports an unavailable home directory rather than selecting a relative configuration", () => {
  expect(resolveDefaultConfigPath()).toBe("/home/example/.pages/config.toml");
  boundary.home.mockReturnValue("");
  expect(() => resolveDefaultConfigPath()).toThrow(ConfigError);
  expect(() => resolveDefaultConfigPath()).toThrow(
    "could not determine the home directory",
  );
});

it.each([
  ["bridge", '"agentGitBridges" is invalid.'],
  ["speech", '"speechRecognition" is invalid.'],
  ["calls", '"chatCalls" is invalid.'],
  ["storage", '"storageWarningBytes" is invalid.'],
] as const)(
  "safely wraps non-Error failures from %s settings",
  (kind, detail) => {
    boundary[kind].mockImplementationOnce(() => {
      throw "unexpected";
    });
    expect(() => readPagesConfig({}, "instance.toml")).toThrow(
      `The configuration file "instance.toml" is invalid: ${detail}`,
    );
  },
);
