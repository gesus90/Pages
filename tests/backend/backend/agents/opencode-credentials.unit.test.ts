import { expect, it, vi } from "vitest";

import { partial } from "../../app/lib/service-wiring-fakes";

import type { CliHome } from "@/backend/agents/cli/CliContracts";

const lstat = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({ lstat }));

import {
  isOpenCodeModelProvider,
  openCodeCredentialFile,
  readOpenCodeKey,
  requireOpenCodeCredentialDirectory,
} from "@/backend/agents/cli/OpenCodeCredentials";

it("reads exactly one native provider key", () => {
  expect(
    readOpenCodeKey(
      JSON.stringify({ provider_1: { type: "api", key: "test-key" } }),
    ),
  ).toEqual({ modelProvider: "provider_1", apiKey: "test-key" });
  expect(isOpenCodeModelProvider("provider-1")).toBe(true);
  expect(isOpenCodeModelProvider("../provider")).toBe(false);
});

it.each([
  "invalid",
  "null",
  "[]",
  "{}",
  JSON.stringify({ "https://host": { type: "api", key: "key" } }),
  JSON.stringify({ provider: { type: "oauth", key: "key" } }),
  JSON.stringify({ provider: { type: "api", key: "a b" } }),
  JSON.stringify({ provider: { type: "api", key: "x".repeat(513) } }),
  JSON.stringify({ a: {}, b: {} }),
])("rejects invalid credential records", (value) => {
  expect(() => readOpenCodeKey(value)).toThrow();
});

it("checks the credential directory owner and rejects symlinks", async () => {
  const home = partial<CliHome>({ config: "/simulated/config" });
  expect(openCodeCredentialFile(home)).toBe(
    "/simulated/config/opencode/auth.json",
  );
  lstat.mockResolvedValueOnce({
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: process.getuid?.(),
  });
  await expect(
    requireOpenCodeCredentialDirectory(home),
  ).resolves.toBeUndefined();
  lstat.mockResolvedValueOnce({
    isDirectory: () => true,
    isSymbolicLink: () => true,
    uid: process.getuid?.(),
  });
  await expect(requireOpenCodeCredentialDirectory(home)).rejects.toThrow();
});
