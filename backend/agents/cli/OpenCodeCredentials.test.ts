import { afterEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  isOpenCodeModelProvider,
  openCodeCredentialFile,
  readOpenCodeKey,
  requireOpenCodeCredentialDirectory,
} from "@/backend/agents/cli/OpenCodeCredentials";

import type { Stats } from "node:fs";
import type { CliHome } from "@/backend/agents/cli/CliContracts";

const h = vi.hoisted(() => ({ lstat: vi.fn(), logCaught: vi.fn() }));

vi.mock("node:fs/promises", () => ({ lstat: h.lstat }));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: h.logCaught,
  logEvent: vi.fn(),
}));

const HOME: CliHome = {
  root: "/root",
  home: "/root/home",
  config: "/root/config",
  work: "/root/work",
};

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

function facts(parts: object = {}): Stats {
  return fake<Stats>({
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: process.getuid?.() ?? 0,
    ...parts,
  });
}

function credential(entries: unknown): string {
  return JSON.stringify(entries);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reads the key of exactly one native API provider", () => {
  expect(
    readOpenCodeKey(credential({ google: { type: "api", key: "abc" } })),
  ).toEqual({ modelProvider: "google", apiKey: "abc" });
});

it.each([
  { name: "invalid JSON", content: "{" },
  { name: "a primitive", content: "1" },
  { name: "null", content: "null" },
  { name: "an array", content: "[]" },
  { name: "no provider", content: "{}" },
  {
    name: "two providers",
    content: credential({ a: { type: "api", key: "k" }, b: 1 }),
  },
  {
    name: "a URL as provider",
    content: credential({ "a/b": { type: "api", key: "k" } }),
  },
  { name: "a primitive credential", content: credential({ a: 1 }) },
  { name: "a null credential", content: credential({ a: null }) },
  {
    name: "a wrong type",
    content: credential({ a: { type: "oauth", key: "k" } }),
  },
  {
    name: "a numeric key",
    content: credential({ a: { type: "api", key: 1 } }),
  },
  {
    name: "an empty key",
    content: credential({ a: { type: "api", key: "" } }),
  },
  {
    name: "an oversized key",
    content: credential({ a: { type: "api", key: "k".repeat(513) } }),
  },
  {
    name: "a key with whitespace",
    content: credential({ a: { type: "api", key: "a b" } }),
  },
])("refuses $name", ({ content }) => {
  expect(() => readOpenCodeKey(content)).toThrow(
    new AgentError("cli_not_logged_in"),
  );
  expect(h.logCaught).toHaveBeenCalled();
});

it("places the credential file in the connection's configuration", () => {
  expect(openCodeCredentialFile(HOME)).toBe("/root/config/opencode/auth.json");
});

it("accepts only plain native provider IDs", () => {
  expect(isOpenCodeModelProvider("opencode-1_x")).toBe(true);
  expect(isOpenCodeModelProvider("-x")).toBe(false);
  expect(isOpenCodeModelProvider("a/b")).toBe(false);
  expect(isOpenCodeModelProvider(undefined)).toBe(false);
});

it("accepts an own directory", async () => {
  h.lstat.mockResolvedValue(facts());
  await expect(
    requireOpenCodeCredentialDirectory(HOME),
  ).resolves.toBeUndefined();
  expect(h.lstat).toHaveBeenCalledWith("/root/config/opencode");
});

it("refuses a redirected or foreign directory", async () => {
  const refusal = new AgentError("cli_not_logged_in");
  h.lstat.mockResolvedValueOnce(facts({ isDirectory: () => false }));
  await expect(requireOpenCodeCredentialDirectory(HOME)).rejects.toEqual(
    refusal,
  );
  h.lstat.mockResolvedValueOnce(facts({ isSymbolicLink: () => true }));
  await expect(requireOpenCodeCredentialDirectory(HOME)).rejects.toEqual(
    refusal,
  );
  h.lstat.mockResolvedValueOnce(facts({ uid: (process.getuid?.() ?? 0) + 1 }));
  await expect(requireOpenCodeCredentialDirectory(HOME)).rejects.toEqual(
    refusal,
  );
});

it("skips the owner check on a platform without user IDs", async () => {
  vi.stubGlobal("process", { ...process, getuid: undefined });
  h.lstat.mockResolvedValue(facts({ uid: 99_999 }));
  await expect(
    requireOpenCodeCredentialDirectory(HOME),
  ).resolves.toBeUndefined();
});
