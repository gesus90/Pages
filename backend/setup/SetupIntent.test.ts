import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import {
  createSetupIntent,
  readSetupIntent,
  retireMatchingSetupIntent,
  retireSetupIntent,
  setupFingerprint,
} from "./SetupIntent";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

let directory = "";
let configPath = "";
let intentPath = "";

beforeEach(async () => {
  const root = pagesTempDirectory("setup-intent-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
  configPath = path.join(directory, "config.json");
  intentPath = path.join(directory, ".setup-postgres-intent.json");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("creates a private intent, binds its values and retires only the matching database", async () => {
  expect(await readSetupIntent(configPath)).toBeNull();
  const intent = await createSetupIntent(
    configPath,
    "synthetic database",
    "values",
  );
  expect(intent.fingerprint).toBe(
    setupFingerprint(intent.sessionToken, "values"),
  );
  expect(setupFingerprint(intent.sessionToken, "other")).not.toBe(
    intent.fingerprint,
  );
  expect(await readSetupIntent(configPath)).toEqual(intent);
  await expect(
    createSetupIntent(configPath, "other", "values"),
  ).rejects.toThrow();
  await retireMatchingSetupIntent(configPath, "other");
  expect(await readSetupIntent(configPath)).toEqual(intent);
  await retireMatchingSetupIntent(configPath, "synthetic database");
  expect(await readSetupIntent(configPath)).toBeNull();
});

it("rejects public, malformed and invalid intent files", async () => {
  await writeFile(intentPath, "{}", { mode: 0o600 });
  await expect(readSetupIntent(configPath)).rejects.toThrow("invalid");
  await writeFile(intentPath, "not json");
  await expect(readSetupIntent(configPath)).rejects.toThrow();
  await chmod(intentPath, 0o644);
  await expect(readSetupIntent(configPath)).rejects.toThrow("not private");
  await expect(
    retireMatchingSetupIntent(configPath, "any"),
  ).resolves.toBeUndefined();
  await retireSetupIntent(configPath);
  expect(await readSetupIntent(configPath)).toBeNull();
});
