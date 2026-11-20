import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, expect, it } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import {
  maintainCodexThreadHistoryDatabase,
  maintainOpenCodeDatabase,
  maintainProviderSessions,
} from "./ProviderSessionMaintenance";

let directory = "";

beforeEach(async () => {
  const root = pagesTempDirectory("provider-maintenance-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("removes old OpenCode sessions and dependents while preserving active session trees", async () => {
  const file = path.join(directory, "opencode.db");
  const database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_updated INTEGER);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT);
    CREATE TABLE todo (session_id TEXT);
    INSERT INTO session VALUES ('old', NULL, 1), ('parent', NULL, 1), ('child', 'parent', 9999999999), ('message-active', NULL, 1);
    INSERT INTO message VALUES ('old-message', 'old', 1), ('recent-message', 'message-active', 9999999999);
    INSERT INTO part VALUES ('old-part', 'old-message'), ('recent-part', 'recent-message');
    INSERT INTO todo VALUES ('old'), ('child');
  `);
  database.close();
  expect(await maintainOpenCodeDatabase(file, 2_000_000_000_000)).toBe(true);
  const checked = new DatabaseSync(file);
  try {
    expect(checked.prepare("SELECT id FROM session ORDER BY id").all()).toEqual(
      [{ id: "child" }, { id: "message-active" }, { id: "parent" }],
    );
    expect(checked.prepare("SELECT id FROM message ORDER BY id").all()).toEqual(
      [{ id: "recent-message" }],
    );
    expect(checked.prepare("SELECT id FROM part ORDER BY id").all()).toEqual([
      { id: "recent-part" },
    ]);
    expect(checked.prepare("SELECT session_id FROM todo").all()).toEqual([
      { session_id: "child" },
    ]);
  } finally {
    checked.close();
  }
});

it("retains Codex threads with recent or unknown activity and removes expired thread rows", async () => {
  const file = path.join(directory, "thread_history_1.sqlite");
  const database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE threads (id TEXT PRIMARY KEY, updated_at INTEGER);
    CREATE TABLE thread_turns (thread_id TEXT, updated_at INTEGER);
    CREATE TABLE thread_items (thread_id TEXT, updated_at INTEGER);
    CREATE TABLE thread_history_projection_state (thread_id TEXT, updated_at INTEGER);
    INSERT INTO threads VALUES ('old', 1), ('active', 1), ('unknown', NULL);
    INSERT INTO thread_turns VALUES ('old', 1), ('active', 9999999999), ('unknown', NULL);
    INSERT INTO thread_items VALUES ('old', 1), ('active', 9999999999);
    INSERT INTO thread_history_projection_state VALUES ('old', 1);
  `);
  database.close();
  expect(
    await maintainCodexThreadHistoryDatabase(file, 2_000_000_000_000),
  ).toBe(true);
  const checked = new DatabaseSync(file);
  try {
    expect(checked.prepare("SELECT id FROM threads ORDER BY id").all()).toEqual(
      [{ id: "active" }, { id: "unknown" }],
    );
    expect(
      checked
        .prepare("SELECT thread_id FROM thread_turns ORDER BY thread_id")
        .all(),
    ).toEqual([{ thread_id: "active" }, { thread_id: "unknown" }]);
    expect(checked.prepare("SELECT thread_id FROM thread_items").all()).toEqual(
      [{ thread_id: "active" }],
    );
    expect(
      checked
        .prepare("SELECT thread_id FROM thread_history_projection_state")
        .all(),
    ).toEqual([]);
  } finally {
    checked.close();
  }
});

it("skips missing, linked and busy provider databases", async () => {
  const file = path.join(directory, "locked.db");
  const link = path.join(directory, "link.db");
  const database = new DatabaseSync(file);
  database.exec(
    "CREATE TABLE session (id TEXT, time_updated INTEGER); BEGIN EXCLUSIVE;",
  );
  await symlink(file, link);
  try {
    expect(
      await maintainOpenCodeDatabase(path.join(directory, "missing"), 1000),
    ).toBe(false);
    expect(await maintainCodexThreadHistoryDatabase(link, 1000)).toBe(false);
    expect(await maintainOpenCodeDatabase(file, 1000)).toBe(false);
  } finally {
    database.exec("ROLLBACK;");
    database.close();
  }
});

it("cleans expired transcript files and legacy stores while retaining protected and linked content", async () => {
  const connection = path.join(directory, "agents", "connection");
  const transcript = path.join(connection, "codex", "sessions");
  const history = path.join(
    connection,
    "antigravity",
    "antigravity-acp",
    "history",
  );
  const legacy = path.join(connection, "opencode", "pnpm");
  const outside = path.join(directory, "outside");
  for (const folder of [transcript, history, legacy, outside])
    await mkdir(folder, { recursive: true });
  for (const file of [
    path.join(transcript, "old.json"),
    path.join(history, "old.json"),
    path.join(history, "auth.json"),
    path.join(outside, "safe"),
  ]) {
    await writeFile(file, "safe");
    await utimes(file, 1, 1);
  }
  await symlink(outside, path.join(transcript, "linked"));
  await maintainProviderSessions(directory, 2000);
  expect((await readdir(transcript)).sort()).toEqual(["linked"]);
  expect(await readdir(history)).toEqual(["auth.json"]);
  expect(await readFile(path.join(outside, "safe"), "utf8")).toBe("safe");
  await expect(readdir(legacy)).rejects.toMatchObject({ code: "ENOENT" });
});

it("handles OpenCode schemas without a parent column and cleans direct dependents", async () => {
  const file = path.join(directory, "alternate.db");
  const database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, created_at TEXT);
    CREATE TABLE message (session_id TEXT, content TEXT);
    CREATE TABLE part (session_id TEXT);
    CREATE TABLE session_share (session_id TEXT);
    INSERT INTO session VALUES ('old', '2020-01-01T00:00:00Z'), ('new', '2030-01-01T00:00:00Z'), ('unknown', NULL);
    INSERT INTO message VALUES ('old', 'obsolete'), ('new', 'keep');
    INSERT INTO part VALUES ('old'), ('new');
    INSERT INTO session_share VALUES ('old'), ('new');
  `);
  database.close();
  expect(
    await maintainOpenCodeDatabase(file, Date.parse("2025-01-01T00:00:00Z")),
  ).toBe(true);
  const checked = new DatabaseSync(file);
  try {
    expect(checked.prepare("SELECT id FROM session ORDER BY id").all()).toEqual(
      [{ id: "new" }, { id: "unknown" }],
    );
    for (const table of ["message", "part", "session_share"]) {
      expect(checked.prepare(`SELECT session_id FROM ${table}`).all()).toEqual([
        { session_id: "new" },
      ]);
    }
  } finally {
    checked.close();
  }
});

it("leaves unknown provider schemas and sessions without timestamps untouched", async () => {
  for (const [name, schema] of [
    [
      "empty.db",
      "CREATE TABLE unrelated (id TEXT); INSERT INTO unrelated VALUES ('kept');",
    ],
    [
      "without-id.db",
      "CREATE TABLE session (time_updated INTEGER); INSERT INTO session VALUES (1);",
    ],
    [
      "without-time.db",
      "CREATE TABLE session (id TEXT); INSERT INTO session VALUES ('kept');",
    ],
  ]) {
    const file = path.join(directory, name);
    const database = new DatabaseSync(file);
    database.exec(schema);
    database.close();
    expect(await maintainOpenCodeDatabase(file, 5000)).toBe(true);
    const checked = new DatabaseSync(file);
    try {
      const table = name === "empty.db" ? "unrelated" : "session";
      expect(
        checked.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get(),
      ).toEqual({ total: 1 });
    } finally {
      checked.close();
    }
  }
});

it("cleans alternate Codex thread keys and keeps malformed timestamps", async () => {
  const file = path.join(directory, "alternate-history.db");
  const database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE threads (thread_id TEXT, created_at TEXT);
    CREATE TABLE thread_items (thread_id TEXT, created_at_ms INTEGER);
    INSERT INTO threads VALUES ('old', '2020-01-01T00:00:00Z'), ('unknown', 'invalid-date'), ('recent', '2030-01-01T00:00:00Z');
    INSERT INTO thread_items VALUES ('old', 1577836800000), ('recent', 1893456000000);
  `);
  database.close();
  expect(
    await maintainCodexThreadHistoryDatabase(
      file,
      Date.parse("2025-01-01T00:00:00Z"),
    ),
  ).toBe(true);
  const checked = new DatabaseSync(file);
  try {
    expect(
      checked.prepare("SELECT thread_id FROM threads ORDER BY thread_id").all(),
    ).toEqual([{ thread_id: "recent" }, { thread_id: "unknown" }]);
    expect(checked.prepare("SELECT thread_id FROM thread_items").all()).toEqual(
      [{ thread_id: "recent" }],
    );
  } finally {
    checked.close();
  }
});

it("discovers provider databases in a connection and isolates a malformed one", async () => {
  const connection = path.join(directory, "agents", "connection");
  const openCode = path.join(connection, "opencode", "opencode", "opencode.db");
  const broken = path.join(connection, "opencode", "opencode.db");
  const codex = path.join(connection, "codex", "thread_history_1.sqlite");
  await mkdir(path.dirname(openCode), { recursive: true });
  await mkdir(path.dirname(codex), { recursive: true });
  const first = new DatabaseSync(openCode);
  first.exec(
    "CREATE TABLE session (id TEXT, updated_at INTEGER); INSERT INTO session VALUES ('old', 1);",
  );
  first.close();
  await writeFile(broken, "not a database");
  const second = new DatabaseSync(codex);
  second.exec(
    "CREATE TABLE threads (id TEXT, updated_at INTEGER); INSERT INTO threads VALUES ('old', 1);",
  );
  second.close();
  await maintainProviderSessions(directory, 5000);
  const checkedFirst = new DatabaseSync(openCode);
  const checkedSecond = new DatabaseSync(codex);
  try {
    expect(checkedFirst.prepare("SELECT id FROM session").all()).toEqual([]);
    expect(checkedSecond.prepare("SELECT id FROM threads").all()).toEqual([]);
    expect(await readFile(broken, "utf8")).toBe("not a database");
  } finally {
    checkedFirst.close();
    checkedSecond.close();
  }
});

it("cleans nested history files while preserving credentials and unrelated entries", async () => {
  const home = path.join(
    directory,
    "agents",
    "connection",
    "antigravity",
    "antigravity-acp",
  );
  const nested = path.join(home, "nested");
  await mkdir(nested, { recursive: true });
  for (const name of [
    "history-old.json",
    "notes.json",
    "session-new.json",
    "config.json",
  ])
    await writeFile(path.join(nested, name), name);
  for (const name of ["history-old.json", "notes.json", "config.json"])
    await utimes(path.join(nested, name), 1, 1);
  await maintainProviderSessions(directory, 2000);
  expect((await readdir(nested)).sort()).toEqual([
    "config.json",
    "notes.json",
    "session-new.json",
  ]);
});

it("rolls back all provider deletions when a database trigger refuses cleanup", async () => {
  const file = path.join(directory, "rollback.db");
  const database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, time_updated INTEGER);
    CREATE TABLE message (session_id TEXT);
    INSERT INTO session VALUES ('old', 1);
    INSERT INTO message VALUES ('old');
    CREATE TRIGGER reject_cleanup BEFORE DELETE ON session BEGIN SELECT RAISE(ABORT, 'cleanup denied'); END;
  `);
  database.close();
  await expect(maintainOpenCodeDatabase(file, 5000)).rejects.toThrow(
    "cleanup denied",
  );
  const checked = new DatabaseSync(file);
  try {
    expect(checked.prepare("SELECT id FROM session").all()).toEqual([
      { id: "old" },
    ]);
    expect(checked.prepare("SELECT session_id FROM message").all()).toEqual([
      { session_id: "old" },
    ]);
    checked.exec("DROP TRIGGER reject_cleanup;");
  } finally {
    checked.close();
  }
  expect(await maintainOpenCodeDatabase(file, 5000)).toBe(true);
  const cleaned = new DatabaseSync(file);
  try {
    expect(cleaned.prepare("SELECT id FROM session").all()).toEqual([]);
    expect(cleaned.prepare("SELECT session_id FROM message").all()).toEqual([]);
  } finally {
    cleaned.close();
  }
});

it("handles Codex databases without usable activity and with no expired threads", async () => {
  const incomplete = path.join(directory, "incomplete.db");
  const active = path.join(directory, "active.db");
  const first = new DatabaseSync(incomplete);
  first.exec(
    "CREATE TABLE threads (id TEXT); CREATE TABLE thread_turns (updated_at INTEGER); INSERT INTO threads VALUES ('preserved');",
  );
  first.close();
  const second = new DatabaseSync(active);
  second.exec(
    "CREATE TABLE threads (id TEXT, updated_at INTEGER); INSERT INTO threads VALUES ('active', 9000000000000);",
  );
  second.close();
  expect(await maintainCodexThreadHistoryDatabase(incomplete, 5000)).toBe(true);
  expect(await maintainCodexThreadHistoryDatabase(active, 5000)).toBe(true);
  const checkedFirst = new DatabaseSync(incomplete);
  const checkedSecond = new DatabaseSync(active);
  try {
    expect(checkedFirst.prepare("SELECT id FROM threads").all()).toEqual([
      { id: "preserved" },
    ]);
    expect(checkedSecond.prepare("SELECT id FROM threads").all()).toEqual([
      { id: "active" },
    ]);
  } finally {
    checkedFirst.close();
    checkedSecond.close();
  }
});

it("uses fallback timestamps and preserves a parent tree with recent message activity", async () => {
  const file = path.join(directory, "fallback.db");
  const database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, time_updated INTEGER, time_created INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, updated_at TEXT, created_at TEXT);
    INSERT INTO session VALUES ('old', NULL, NULL, 1), ('parent', NULL, NULL, 1), ('child', 'parent', NULL, 1);
    INSERT INTO message VALUES ('current', 'child', NULL, '2030-01-01T00:00:00Z');
  `);
  database.close();
  expect(
    await maintainOpenCodeDatabase(file, Date.parse("2025-01-01T00:00:00Z")),
  ).toBe(true);
  const checked = new DatabaseSync(file);
  try {
    expect(checked.prepare("SELECT id FROM session ORDER BY id").all()).toEqual(
      [{ id: "child" }, { id: "parent" }],
    );
    expect(checked.prepare("SELECT id FROM message").all()).toEqual([
      { id: "current" },
    ]);
  } finally {
    checked.close();
  }
});

it("keeps unrelated dependent tables when their session keys are unavailable", async () => {
  const file = path.join(directory, "unrelated-dependents.db");
  const database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, time_updated INTEGER);
    CREATE TABLE message (id TEXT, session_id TEXT);
    CREATE TABLE part (message_id TEXT);
    CREATE TABLE todo (description TEXT);
    CREATE TABLE session_share (description TEXT);
    INSERT INTO session VALUES ('old', 1), ('active', 9000000000000);
    INSERT INTO message VALUES ('old-message', 'old'), ('active-message', 'active');
    INSERT INTO part VALUES ('old-message'), ('active-message');
    INSERT INTO todo VALUES ('keep todo');
    INSERT INTO session_share VALUES ('keep share');
  `);
  database.close();
  expect(await maintainOpenCodeDatabase(file, 5000)).toBe(true);
  const checked = new DatabaseSync(file);
  try {
    expect(checked.prepare("SELECT id FROM session").all()).toEqual([
      { id: "active" },
    ]);
    expect(checked.prepare("SELECT message_id FROM part").all()).toEqual([
      { message_id: "active-message" },
    ]);
    expect(checked.prepare("SELECT description FROM todo").all()).toEqual([
      { description: "keep todo" },
    ]);
    expect(
      checked.prepare("SELECT description FROM session_share").all(),
    ).toEqual([{ description: "keep share" }]);
  } finally {
    checked.close();
  }
});

it("does not follow linked history entries or linked agent connections", async () => {
  const agents = path.join(directory, "agents");
  const home = path.join(
    agents,
    "connection",
    "antigravity",
    "antigravity-acp",
  );
  const outside = path.join(directory, "outside");
  await mkdir(home, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, "history-old.json"), "keep");
  await utimes(path.join(outside, "history-old.json"), 1, 1);
  await symlink(outside, path.join(home, "history-linked"));
  await symlink(outside, path.join(agents, "linked-connection"));
  await maintainProviderSessions(directory, 2000);
  expect(await readFile(path.join(outside, "history-old.json"), "utf8")).toBe(
    "keep",
  );
  expect(await readdir(home)).toEqual(["history-linked"]);
});

it("retains unresolvable message parts while deleting expired sessions", async () => {
  const file = path.join(directory, "missing-message-key.db");
  const database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, time_updated INTEGER);
    CREATE TABLE message (session_id TEXT);
    CREATE TABLE part (message_id TEXT);
    INSERT INTO session VALUES ('old', 1), ('active', 9000000000000);
    INSERT INTO message VALUES ('old'), ('active');
    INSERT INTO part VALUES ('unknown-message');
  `);
  database.close();
  expect(await maintainOpenCodeDatabase(file, 5000)).toBe(true);
  const checked = new DatabaseSync(file);
  try {
    expect(checked.prepare("SELECT id FROM session").all()).toEqual([
      { id: "active" },
    ]);
    expect(checked.prepare("SELECT session_id FROM message").all()).toEqual([
      { session_id: "active" },
    ]);
    expect(checked.prepare("SELECT message_id FROM part").all()).toEqual([
      { message_id: "unknown-message" },
    ]);
  } finally {
    checked.close();
  }
});

it.each([
  ["missing", ""],
  [
    "without-key",
    "CREATE TABLE threads (note TEXT); INSERT INTO threads VALUES ('keep');",
  ],
])(
  "cleans thread activity when the threads table is %s",
  async (name, schema) => {
    const file = path.join(directory, `${name}.db`);
    const database = new DatabaseSync(file);
    database.exec(`
    ${schema}
    CREATE TABLE thread_turns (thread_id TEXT, updated_at INTEGER);
    INSERT INTO thread_turns VALUES ('old', 1), ('active', 9000000000000);
  `);
    database.close();
    expect(await maintainCodexThreadHistoryDatabase(file, 5000)).toBe(true);
    const checked = new DatabaseSync(file);
    try {
      expect(
        checked.prepare("SELECT thread_id FROM thread_turns").all(),
      ).toEqual([{ thread_id: "active" }]);
      if (name === "without-key")
        expect(checked.prepare("SELECT note FROM threads").all()).toEqual([
          { note: "keep" },
        ]);
    } finally {
      checked.close();
    }
  },
);

it("reports a failed rollback after the database ended the transaction itself", async () => {
  const file = path.join(directory, "self-rollback.db");
  const database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, time_updated INTEGER);
    INSERT INTO session VALUES ('old', 1);
    CREATE TRIGGER end_cleanup BEFORE DELETE ON session BEGIN SELECT RAISE(ROLLBACK, 'cleanup ended'); END;
  `);
  database.close();
  await expect(maintainOpenCodeDatabase(file, 5000)).rejects.toThrow(
    "cleanup ended",
  );
  const checked = new DatabaseSync(file);
  try {
    expect(checked.prepare("SELECT id FROM session").all()).toEqual([
      { id: "old" },
    ]);
  } finally {
    checked.close();
  }
});

it("ignores a storage root without agent connections", async () => {
  await expect(
    maintainProviderSessions(directory, 5000),
  ).resolves.toBeUndefined();
});
