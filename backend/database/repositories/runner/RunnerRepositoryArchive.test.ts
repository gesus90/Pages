import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { Database } from "@/backend/database/Database";
import { runnerStateSchema } from "@/definition/RunnerProtocol";
import {
  freeLoopbackPort,
  runProgram,
  startOwnedPostgres,
} from "@/scripts/postgres-restore-check/postgres-programs";

import { RunnerRepository } from "./RunnerRepository";

import type { RunnerState } from "@/definition/RunnerProtocol";
import type { OwnedPostgres } from "@/scripts/postgres-restore-check/postgres-programs";

const HAS_POSTGRES = existsSync("/usr/lib/postgresql/18/bin/postgres");
const CONNECTION = "00000000-0000-4000-8000-000000000001";
const SESSION = "11111111-1111-4111-8111-111111111111";
const DELETED_RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIVE_RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DELETED_RUN_JOB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LIVE_RUN_JOB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MIGRATION = path.join(
  process.cwd(),
  "backend/database/postgres/migrations/068_runner_job_archive.sql",
);

interface ScratchDatabase {
  readonly database: Database;
  stop(): Promise<void>;
}

function finishedJob(runId: string, jobId: string): unknown {
  return {
    jobId,
    sessionId: SESSION,
    status: "failed",
    plan: {
      managed: true,
      planId: "22222222-2222-4222-8222-222222222222",
      runId,
      stepId: "33333333-3333-4333-8333-333333333333",
      attemptId: jobId.replace(/^./u, "e"),
      planRevision: 1,
    },
    outcome: { output: "", closeout: "confirmed", exitCode: 127 },
  };
}

function stateOf(jobs: readonly unknown[]): RunnerState {
  return runnerStateSchema.parse({
    version: 1,
    sessionId: SESSION,
    sequence: 1,
    lastEventId: null,
    jobs,
  });
}

async function waitUntilReady(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await runProgram("pg_isready", ["-h", "127.0.0.1", "-p", `${port}`]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("The scratch PostgreSQL server did not become ready");
}

/** Creates only what the checkpoint touches; the archive table is read from its migration. */
async function createSchema(database: Database): Promise<void> {
  const migration = await readFile(MIGRATION, "utf8");
  const archiveTable = migration.slice(
    migration.indexOf("CREATE TABLE runner_job_archive"),
  );
  await database.execute(
    "CREATE FUNCTION utc_now() RETURNS text LANGUAGE sql AS $$ SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') $$;",
  );
  await database.execute(
    "CREATE TABLE pages_runners (connection_id TEXT PRIMARY KEY, state_json TEXT NOT NULL);",
  );
  await database.execute("CREATE TABLE agent_plan_runs (id TEXT PRIMARY KEY);");
  for (const statement of archiveTable.split(";"))
    if (statement.trim()) await database.execute(`${statement.trim()};`);
  await database.execute(
    "INSERT INTO pages_runners (connection_id, state_json) VALUES ($connection_id, '{}');",
    { connection_id: CONNECTION },
  );
}

/** Starts a throw-away PostgreSQL server of its own and opens the schema the checkpoint needs. */
async function startScratchDatabase(
  directory: string,
): Promise<ScratchDatabase> {
  const files = path.join(directory, "cluster");
  await runProgram("initdb", [
    "-D",
    files,
    "-A",
    "trust",
    "-E",
    "UTF8",
    "--locale=C.UTF-8",
  ]);
  const port = await freeLoopbackPort();
  const server: OwnedPostgres = await startOwnedPostgres({
    logFile: path.join(directory, "postgres.log"),
    arguments: [
      "-D",
      files,
      "-p",
      `${port}`,
      "-c",
      "listen_addresses=127.0.0.1",
      "-c",
      "unix_socket_directories=",
      "-c",
      "fsync=off",
    ],
  });
  await waitUntilReady(port);
  const database = await Database.connect(
    `postgres://${os.userInfo().username}@127.0.0.1:${port}/postgres`,
  );
  await createSchema(database);
  return {
    database,
    stop: async () => {
      await database.close();
      await server.stop();
    },
  };
}

async function archivedJobs(database: Database): Promise<string[]> {
  const rows = await database.query(
    "SELECT job_id FROM runner_job_archive ORDER BY job_id;",
  );
  return rows.map((row) => String(row[0]));
}

describe.skipIf(!HAS_POSTGRES || process.platform !== "linux")(
  "runner job archive checkpoint on PostgreSQL",
  () => {
    let directory = "";
    let scratch: ScratchDatabase | null = null;

    function connected(): Database {
      if (!scratch) throw new Error("The database is not open");
      return scratch.database;
    }

    beforeAll(async () => {
      const root = pagesTempDirectory("runner-archive-tests");
      await mkdir(root, { recursive: true, mode: 0o700 });
      directory = await mkdtemp(path.join(root, "case-"));
      scratch = await startScratchDatabase(directory);
    }, 120_000);

    afterAll(async () => {
      await scratch?.stop();
      await rm(directory, { recursive: true, force: true });
    }, 60_000);

    it("archives finished jobs of an existing run and skips jobs of a run that was deleted", async () => {
      await connected().execute(
        "INSERT INTO agent_plan_runs (id) VALUES ($run_id);",
        { run_id: LIVE_RUN },
      );

      await new RunnerRepository(connected()).checkpoint(
        CONNECTION,
        stateOf([
          finishedJob(DELETED_RUN, DELETED_RUN_JOB),
          finishedJob(LIVE_RUN, LIVE_RUN_JOB),
        ]),
      );

      expect(await archivedJobs(connected())).toEqual([LIVE_RUN_JOB]);
      const [stored] = await connected().query(
        "SELECT state_json FROM pages_runners WHERE connection_id = $connection_id;",
        { connection_id: CONNECTION },
      );
      expect(String(stored?.[0])).toContain(DELETED_RUN_JOB);
    });

    it("keeps checkpointing after the plan was started again and its earlier run was removed", async () => {
      const repository = new RunnerRepository(connected());
      const state = stateOf([finishedJob(LIVE_RUN, LIVE_RUN_JOB)]);
      await repository.checkpoint(CONNECTION, state);
      await connected().execute(
        "DELETE FROM agent_plan_runs WHERE id = $run_id;",
        { run_id: LIVE_RUN },
      );

      await expect(
        repository.checkpoint(CONNECTION, state),
      ).resolves.toBeUndefined();
      expect(await archivedJobs(connected())).toEqual([]);
    });
  },
);
