import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { AgentError } from "@/backend/error/AgentErrors";

import {
  PLAN_HOMES_DIRECTORY,
  PLAN_SESSIONS_DIRECTORY,
  prepareClaudePlanSessionHome,
} from "./ClaudePlanSessionHome";

import type { CliHome } from "./CliContracts";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_RUN_ID = "33333333-3333-4333-8333-333333333333";
const SCOPE_ID = "node-one";
const SCOPE_HASH = createHash("sha256").update(SCOPE_ID).digest("hex");

let root = "";
let connection: CliHome;

beforeEach(async () => {
  const parent = pagesTempDirectory("claude-plan-home-tests");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  root = await mkdtemp(path.join(parent, "case-"));
  connection = {
    root,
    home: path.join(root, "home"),
    config: path.join(root, "claude"),
    work: path.join(root, "work"),
    sharedEnvironment: "/synthetic/shared",
  };
  await mkdir(connection.config, { recursive: true });
  await writeFile(path.join(connection.config, ".credentials.json"), "{}");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function scope(
  overrides: Partial<Parameters<typeof prepareClaudePlanSessionHome>[1]> = {},
): Parameters<typeof prepareClaudePlanSessionHome>[1] {
  return { planId: PLAN_ID, runId: RUN_ID, scopeId: SCOPE_ID, ...overrides };
}

async function legacyHome(runId: string): Promise<string> {
  const source = path.join(root, PLAN_SESSIONS_DIRECTORY, runId, SCOPE_HASH);
  await mkdir(path.join(source, "home", "cache"), { recursive: true });
  await mkdir(path.join(source, "home", "keep"), { recursive: true });
  await writeFile(path.join(source, "home", "keep", "note.txt"), "kept");
  return source;
}

it("refuses invalid plan, run and scope identifiers", async () => {
  const expected = new AgentError("plan_context_changed");
  for (const invalid of [
    scope({ planId: "x" }),
    scope({ runId: "x" }),
    scope({ scopeId: "" }),
    scope({ scopeId: "a".repeat(201) }),
  ])
    await expect(
      prepareClaudePlanSessionHome(connection, invalid),
    ).rejects.toEqual(expected);
});

it("requires a regular credential file", async () => {
  const expected = new AgentError("cli_not_logged_in");
  await rm(path.join(connection.config, ".credentials.json"));
  await expect(
    prepareClaudePlanSessionHome(connection, scope()),
  ).rejects.toEqual(expected);
  await mkdir(path.join(connection.config, ".credentials.json"));
  await expect(
    prepareClaudePlanSessionHome(connection, scope()),
  ).rejects.toEqual(expected);
});

it("creates a private stable home with a credential placeholder and reuses it", async () => {
  const prepared = await prepareClaudePlanSessionHome(connection, scope());
  const homeRoot = path.join(root, PLAN_HOMES_DIRECTORY, PLAN_ID, SCOPE_HASH);
  expect(prepared.home).toEqual({
    root: homeRoot,
    home: path.join(homeRoot, "home"),
    config: path.join(homeRoot, "claude"),
    work: path.join(homeRoot, "work"),
    sharedEnvironment: "/synthetic/shared",
  });
  expect(prepared.credential).toEqual({
    source: path.join(connection.config, ".credentials.json"),
    target: path.join(homeRoot, "claude", ".credentials.json"),
  });
  expect((await stat(homeRoot)).mode & 0o777).toBe(0o700);
  expect(await readFile(prepared.credential.target, "utf8")).toBe("");
  await expect(
    prepareClaudePlanSessionHome(connection, scope()),
  ).resolves.toEqual(prepared);
});

it("refuses a credential target that is not a regular file", async () => {
  const prepared = await prepareClaudePlanSessionHome(connection, scope());
  await rm(prepared.credential.target);
  await mkdir(prepared.credential.target);
  await expect(
    prepareClaudePlanSessionHome(connection, scope()),
  ).rejects.toEqual(new AgentError("cli_isolation_unavailable"));
});

it("refuses a symbolic link in place of a private directory", async () => {
  const sessions = path.join(root, PLAN_HOMES_DIRECTORY);
  await mkdir(path.join(root, "elsewhere"));
  await symlink(path.join(root, "elsewhere"), sessions);
  await expect(
    prepareClaudePlanSessionHome(connection, scope()),
  ).rejects.toEqual(new AgentError("cli_isolation_unavailable"));
});

it("refuses a regular file in place of a private directory", async () => {
  await writeFile(path.join(root, PLAN_HOMES_DIRECTORY), "x");
  await expect(
    prepareClaudePlanSessionHome(connection, scope()),
  ).rejects.toBeDefined();
});

it("adopts the legacy home of the run and drops its caches", async () => {
  const source = await legacyHome(RUN_ID);
  const prepared = await prepareClaudePlanSessionHome(connection, scope());
  await expect(lstat(source)).rejects.toBeDefined();
  expect(
    await readFile(path.join(prepared.home.home, "keep", "note.txt"), "utf8"),
  ).toBe("kept");
  await expect(
    lstat(path.join(prepared.home.home, "cache")),
  ).rejects.toBeDefined();
});

it("adopts the legacy home of the source run of a recovery first", async () => {
  await legacyHome(SOURCE_RUN_ID);
  const prepared = await prepareClaudePlanSessionHome(
    connection,
    scope({ sourceRunId: SOURCE_RUN_ID }),
  );
  expect(
    await readFile(path.join(prepared.home.home, "keep", "note.txt"), "utf8"),
  ).toBe("kept");
});

it("skips invalid, missing and linked legacy sources", async () => {
  const linked = path.join(root, PLAN_SESSIONS_DIRECTORY, SOURCE_RUN_ID);
  await mkdir(linked, { recursive: true });
  await mkdir(path.join(root, "elsewhere"));
  await symlink(path.join(root, "elsewhere"), path.join(linked, SCOPE_HASH));
  const prepared = await prepareClaudePlanSessionHome(
    connection,
    scope({ sourceRunId: "not-a-uuid" }),
  );
  await expect(
    lstat(path.join(prepared.home.home, "cache")),
  ).rejects.toBeDefined();
  await rm(path.join(root, PLAN_HOMES_DIRECTORY), { recursive: true });
  await expect(
    prepareClaudePlanSessionHome(
      connection,
      scope({ sourceRunId: SOURCE_RUN_ID }),
    ),
  ).resolves.toBeDefined();
  expect((await lstat(path.join(linked, SCOPE_HASH))).isSymbolicLink()).toBe(
    true,
  );
});
