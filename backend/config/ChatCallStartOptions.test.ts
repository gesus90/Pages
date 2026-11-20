import path from "node:path";

import { describe, expect, it } from "vitest";

import type { TomlTable } from "smol-toml";

import { readChatCallConfig } from "./ChatCallConfig";
import { parseStartOptions, StartOptionsError } from "./StartOptions";

describe("chat call configuration", () => {
  it("reads optional settings and normalizes the secret path", () => {
    expect(readChatCallConfig({})).toEqual({});
    expect(readChatCallConfig({ chatCalls: {} })).toEqual({ chatCalls: {} });
    expect(
      readChatCallConfig({
        chatCalls: {
          stunUrls: ["stun:example.org", "stuns:example.org"],
          turnUrls: ["turn:example.org", "turns:example.org"],
          turnSecretFile: "/etc/pages/../secret",
          turnCredentialSeconds: 60,
          relayOnly: false,
        },
      }),
    ).toEqual({
      chatCalls: {
        stunUrls: ["stun:example.org", "stuns:example.org"],
        turnUrls: ["turn:example.org", "turns:example.org"],
        turnSecretFile: "/etc/secret",
        turnCredentialSeconds: 60,
        relayOnly: false,
      },
    });
    expect(readChatCallConfig({ chatCalls: { turnUrls: [] } })).toEqual({
      chatCalls: { turnUrls: [] },
    });
    expect(
      readChatCallConfig({ chatCalls: { turnCredentialSeconds: 86400 } }),
    ).toEqual({ chatCalls: { turnCredentialSeconds: 86400 } });
  });

  it.each<TomlTable>([
    { chatCalls: [] },
    { chatCalls: "invalid" },
    { chatCalls: { stunUrls: "stun:example.org" } },
    { chatCalls: { stunUrls: [1] } },
    { chatCalls: { stunUrls: ["turn:example.org"] } },
    { chatCalls: { stunUrls: ["stun:user@example.org"] } },
    { chatCalls: { turnUrls: ["turn:example.org"] } },
    { chatCalls: { turnSecretFile: "relative" } },
    { chatCalls: { turnSecretFile: 4 } },
    { chatCalls: { turnCredentialSeconds: "60" } },
    { chatCalls: { turnCredentialSeconds: 60.5 } },
    { chatCalls: { turnCredentialSeconds: 59 } },
    { chatCalls: { turnCredentialSeconds: 86401 } },
    { chatCalls: { relayOnly: "true" } },
  ])("rejects malformed settings %o", (document) => {
    expect(() => readChatCallConfig(document)).toThrow();
  });
});

describe("start options", () => {
  it("accepts both argument forms and lets later options override earlier ones", () => {
    expect(parseStartOptions([])).toEqual({ port: null, configPath: null });
    expect(
      parseStartOptions([
        "--port",
        "1",
        "--config=./config.toml",
        "--port=65535",
      ]),
    ).toEqual({ port: 65535, configPath: path.resolve("./config.toml") });
    expect(parseStartOptions(["--config", "/etc/pages.toml"])).toEqual({
      port: null,
      configPath: "/etc/pages.toml",
    });
  });

  it.each([
    ["--unknown"],
    ["--port"],
    ["--config="],
    ["--port=0"],
    ["--port=65536"],
    ["--port=1.5"],
    ["--port=-1"],
  ])("rejects invalid arguments %o", (...argumentsList) => {
    expect(() => parseStartOptions(argumentsList)).toThrow(StartOptionsError);
  });
});
