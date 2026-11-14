import { beforeEach, expect, it, vi } from "vitest";

import { AgentEnvironmentRepository } from "@/backend/database/repositories/agent/AgentEnvironmentRepository";
import { AgentEnvironmentMaintenance } from "@/backend/storage/AgentEnvironmentMaintenance";

import { environmentFiles as files } from "./page352-files";

import type { DatabaseTransaction } from "@/backend/database/Database";

vi.mock("node:fs/promises", async () => {
  const { environmentFiles } = await import("./page352-files");
  return environmentFiles.module();
});

const ROOT = "/memory/page416";
const CACHES = [
  "data/pnpm",
  "cache/pnpm",
  "cache/ms-playwright",
  "cache/pages-browser-tests",
  "cache/node",
  "cache/node-gyp",
  "cache/google-chrome-headless",
  ".npm/_cacache",
  ".npm/_npx",
  ".npm/_logs",
];
const PRESERVED = [
  "config/settings",
  "state/history",
  "data/opencode/sessions",
  ".codex/auth.json",
  ".claude/history",
  ".gemini/session",
  ".npmrc",
  ".npm/credentials",
  "cache/unrelated",
  "data/other",
];

function seedConnection(connection: string): string {
  const home = `${ROOT}/agents/${connection}/home`;
  for (const name of CACHES)
    files.seed(`${home}/${name}/entry`, "file", `${connection}:${name}`);
  for (const name of PRESERVED)
    files.seed(`${home}/${name}`, "file", `${connection}:${name}`);
  files.seed(`${ROOT}/agents/${connection}/codex/auth.json`, "file", "credential");
  return home;
}

function maintenance(isBusy: () => boolean): AgentEnvironmentMaintenance {
  const query = vi.fn<DatabaseTransaction["query"]>(async () =>
    isBusy() ? [["worker"]] : [],
  );
  const repository = new AgentEnvironmentRepository({
    query,
    transaction: async (work) => work({ query, execute: vi.fn() }),
  });
  return new AgentEnvironmentMaintenance(ROOT, {
    purgeObsoleteRuns: async () => undefined,
    canRemoveRun: async () => false,
    maintainPlan: async () => undefined,
    maintainConnectionCaches: (maintain) =>
      repository.maintainConnectionCaches(maintain),
  });
}

beforeEach(() => files.reset());

it("removes exactly the ten obsolete caches on every connection and leaves credentials and sessions intact", async () => {
  const homes = [seedConnection("one"), seedConnection("two")];
  files.seed(`${ROOT}/shared-env/pnpm/store/package`, "file", "shared package");
  const preserved = [...files.entries].filter(
    ([location, entry]) =>
      entry.kind === "file" &&
      !homes.some((home) =>
        CACHES.some((cache) => location.startsWith(`${home}/${cache}/`)),
      ),
  );
  const cleanup = maintenance(() => false);
  await cleanup.run();
  expect(files.removed.sort()).toEqual(
    homes.flatMap((home) => CACHES.map((cache) => `${home}/${cache}`)).sort(),
  );
  for (const [location, entry] of preserved)
    expect(files.entries.get(location)).toEqual(entry);
  files.removed.length = 0;
  await cleanup.run();
  expect(files.removed).toEqual([]);
});

it.each(["lease", "unreleased local owner"])(
  "defers caches for a %s and retries on the next sweep after release",
  async () => {
    const home = seedConnection("busy");
    let isBusy = true;
    const cleanup = maintenance(() => isBusy);
    const before = [...files.entries];
    await cleanup.run();
    expect([...files.entries]).toEqual(before);
    expect(files.removed).toEqual([]);
    isBusy = false;
    await cleanup.run();
    for (const cache of CACHES)
      expect(files.entries.has(`${home}/${cache}`)).toBe(false);
    for (const name of PRESERVED)
      expect(files.entries.get(`${home}/${name}`)?.content).toBe(
        `busy:${name}`,
      );
  },
);

it("does not traverse symbolic links at the connection, home or cache-parent boundary", async () => {
  const first = seedConnection("linked-connection");
  const second = seedConnection("linked-home");
  const third = seedConnection("linked-cache");
  files.seed(`${ROOT}/agents/linked-connection`, "link");
  files.seed(second, "link");
  files.seed(`${third}/cache`, "link");
  await maintenance(() => false).run();
  expect(files.removed.some((entry) => entry.startsWith(first))).toBe(false);
  expect(files.removed.some((entry) => entry.startsWith(second))).toBe(false);
  expect(
    files.removed.some((entry) => entry.startsWith(`${third}/cache`)),
  ).toBe(false);
});

it("checks leases and unreleased local owners inside the writer transaction and holds it through cleanup", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]);
  let isInTransaction = false;
  const repository = new AgentEnvironmentRepository({
    query,
    transaction: async (work) => {
      isInTransaction = true;
      try {
        return await work({ query, execute: vi.fn() });
      } finally {
        isInTransaction = false;
      }
    },
  });
  const remove = vi.fn(async () => {
    expect(isInTransaction).toBe(true);
    expect(query).toHaveBeenCalledOnce();
  });
  await repository.maintainConnectionCaches(remove);
  expect(remove).toHaveBeenCalledOnce();
  expect(isInTransaction).toBe(false);
  const statement = query.mock.calls[0]?.[0];
  expect(statement).toContain("FROM acp_resource_leases");
  expect(statement).toContain(
    "FROM agent_local_session_owners WHERE released_at IS NULL",
  );
  remove.mockClear();
  query.mockResolvedValue([["retained-owner"]]);
  await repository.maintainConnectionCaches(remove);
  expect(remove).not.toHaveBeenCalled();
});
