import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Database } from "@/backend/database/Database";

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pages-dirty-wal-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const hash = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const dirtyWriter = `
import { createRequire } from 'node:module';
const require = createRequire(process.argv[2]);
const { DuckDBInstance } = require('@duckdb/node-api');
const instance = await DuckDBInstance.create(process.argv[1]);
const connection = await instance.connect();
await connection.run("CREATE MACRO utc_now() AS strftime(now(), '%Y-%m-%d %H:%M:%S'); CREATE TABLE items (id INTEGER, created_at TEXT DEFAULT utc_now()); INSERT INTO items (id) SELECT range FROM range(1, 1025); CHECKPOINT; ALTER TABLE items ADD COLUMN label TEXT; INSERT INTO items (id, label) SELECT range, 'committed-in-WAL' FROM range(1025, 4097);");
const counts = await connection.runAndReadAll('SELECT COUNT(*), COUNT(label), SUM(id) FROM items;');
process.send(counts.getRows().map(row => row.map(Number)));
setInterval(() => {}, 1000);
`;

describe("dirty ALTER TABLE WAL and migration checkpoint", () => {
  it("recovers after a real SIGKILL without loss, preserving an untouched database/WAL snapshot", async () => {
    const dirty = path.join(directory, "dirty.duckdb");
    const snapshot = path.join(directory, "snapshot.duckdb");
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        dirtyWriter,
        dirty,
        path.resolve("package.json"),
      ],
      {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { PATH: process.env.PATH },
      },
    );
    try {
      const before = await new Promise<unknown>((resolve, reject) => {
        child.once("message", resolve);
        child.once("error", reject);
        child.once("exit", (code) =>
          reject(new Error(`Writer exited before proof: ${code}`)),
        );
      });
      const stopped = new Promise<void>((resolve) =>
        child.once("close", () => resolve()),
      );
      child.kill("SIGKILL");
      await stopped;
      expect(before).toEqual([[4096, 3072, 8390656]]);
      expect((await stat(`${dirty}.wal`)).size).toBeGreaterThan(0);
      await copyFile(dirty, snapshot);
      await copyFile(`${dirty}.wal`, `${snapshot}.wal`);
      const databaseHash = await hash(snapshot);
      const walHash = await hash(`${snapshot}.wal`);
      await expect(DuckDBInstance.create(dirty)).rejects.toThrow(
        "Failure while replaying WAL",
      );
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const recovered = await Database.create(dirty);
      expect(
        await recovered.query(
          "SELECT COUNT(*), COUNT(label), SUM(id) FROM items;",
        ),
      ).toEqual(before);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("through an attached database"),
      );
      await recovered.close();
      const reopened = await Database.create(dirty);
      expect(
        await reopened.query(
          "SELECT COUNT(*), COUNT(label), SUM(id) FROM items;",
        ),
      ).toEqual(before);
      await reopened.close();
      expect(await hash(snapshot)).toBe(databaseHash);
      expect(await hash(`${snapshot}.wal`)).toBe(walHash);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  });

  it("checkpoints applied schema changes and skips checkpoint for an unchanged migration set", async () => {
    const file = path.join(directory, "checkpoint.duckdb");
    const crashed = path.join(directory, "copied.duckdb");
    const database = await Database.create(file);
    const migrations = [
      {
        name: "001.sql",
        sql: "CREATE TABLE items (id INTEGER, created_at TEXT DEFAULT utc_now()); INSERT INTO items (id) VALUES (1);",
      },
      { name: "002.sql", sql: "ALTER TABLE items ADD COLUMN label TEXT;" },
    ];
    const execute = vi.spyOn(database, "execute");
    try {
      await database.migrate(migrations);
      expect(execute).toHaveBeenCalledWith("CHECKPOINT;");
      execute.mockClear();
      await database.migrate(migrations);
      expect(execute).not.toHaveBeenCalledWith("CHECKPOINT;");
      await database.execute(
        "INSERT INTO items (id, label) VALUES (2, 'after-migration');",
      );
      await copyFile(file, crashed);
      await copyFile(`${file}.wal`, `${crashed}.wal`);
    } finally {
      await database.close();
    }
    const native = await DuckDBInstance.create(crashed);
    const connection = await native.connect();
    try {
      const rows = await connection.runAndReadAll(
        "SELECT COUNT(*) FROM items;",
      );
      expect(rows.getRows()).toEqual([[2n]]);
    } finally {
      connection.closeSync();
      native.closeSync();
    }
  });
});
